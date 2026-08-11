import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { customerNeedProfiles } from "@/db/schema";
import { newId } from "./id";

/**
 * CustomerNeedProfile — what we currently understand about a prospective
 * customer. One profile per session; every field optional; enriched
 * progressively (configurator → quote form → orders → AI chat).
 *
 * PROVENANCE RULE (the important part): each field carries the source that
 * wrote it. A weaker source never overwrites a stronger one:
 *
 *   USER_STATED (4) > ORDER_DATA (3) > CONFIGURATOR (2)
 *     > SYSTEM_DERIVED (1) > AI_INFERRED (0)
 *
 * Equal rank overwrites (newer info from the same class of source wins);
 * lower rank is dropped silently. AI inference is data about our guess, not
 * about the customer — it must never displace what the customer actually
 * said or did. Unknown stays unknown: absent fields are simply not written.
 *
 * CONCURRENCY (Session 05): every update runs in a transaction that locks
 * the profile row with SELECT … FOR UPDATE before merging, so the
 * read-merge-write is serialized per profile. Session 05 introduces
 * concurrent writers (AI extraction runs alongside checkout/quote/tool
 * writers); without the lock, two writers could each read the same
 * fieldSources snapshot and the later UPDATE would silently erase the
 * earlier writer's fields AND its provenance entries — which would let a
 * weaker source's stale map overwrite stronger data. Row locking was chosen
 * over (a) optimistic version-retry — same serialization, plus a retry loop
 * for a low-contention per-session row — and (b) a pure-SQL jsonb merge —
 * the rank gate would have to be duplicated in SQL, forking the tested TS
 * logic. On real Postgres the lock is per-row; on embedded PGlite (dev/
 * test) transactions serialize on the single connection, which is the same
 * guarantee, coarser. Creation races resolve via the sessionId unique
 * index + ON CONFLICT DO NOTHING + re-lock. Tested in
 * tests/need-profile-concurrency.test.ts.
 */

export const FIELD_SOURCES = ["USER_STATED", "ORDER_DATA", "CONFIGURATOR", "SYSTEM_DERIVED", "AI_INFERRED"] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

const SOURCE_RANK: Record<FieldSource, number> = {
  USER_STATED: 4,
  ORDER_DATA: 3,
  CONFIGURATOR: 2,
  SYSTEM_DERIVED: 1,
  AI_INFERRED: 0,
};

const shortText = z.string().trim().min(1).max(500);
const stringList = z.array(z.string().trim().min(1).max(500)).max(50);

/** Validated updatable fields. Arrays overwrite whole (append is the caller's read-modify-write). */
export const needProfileUpdateSchema = z
  .object({
    businessName: shortText,
    businessType: shortText,
    industry: shortText,
    location: shortText,
    estimatedDailyOrders: z.number().int().positive().max(1_000_000),
    estimatedMonthlyUsage: z.number().int().positive().max(100_000_000),
    productInterest: shortText,
    desiredCapacity: shortText,
    desiredWidth: z.number().positive().max(1000),
    desiredHeight: z.number().positive().max(1000),
    desiredGusset: z.number().positive().max(1000),
    materialPreference: shortText,
    gsmPreference: z.number().int().positive().max(10_000),
    colorPreference: shortText,
    handlePreference: shortText,
    printingRequirement: shortText,
    printingColors: z.number().int().min(0).max(20),
    printingSides: z.number().int().min(0).max(2),
    logoAvailable: z.boolean(),
    quantity: z.number().int().positive().max(100_000_000),
    budgetCents: z.number().int().positive().max(2_000_000_000),
    targetUnitPriceCents: z.number().int().positive().max(2_000_000_000),
    shippingPostalCode: z.string().trim().min(1).max(12),
    desiredDeliveryDate: shortText,
    priceSensitivity: z.enum(["low", "medium", "high"]),
    purchaseIntent: z.enum(["low", "medium", "high"]),
    painPoints: stringList,
    objections: stringList,
    questionsAsked: stringList,
    conversationSummary: z.string().trim().min(1).max(8000),
  })
  .partial();

export type NeedProfileUpdate = z.infer<typeof needProfileUpdateSchema>;

/** Update-field → jsonb column name where they differ. */
const ARRAY_COLUMNS: Partial<Record<keyof NeedProfileUpdate, "painPointsJson" | "objectionsJson" | "questionsAskedJson">> = {
  painPoints: "painPointsJson",
  objections: "objectionsJson",
  questionsAsked: "questionsAskedJson",
};

export type NeedProfileRow = typeof customerNeedProfiles.$inferSelect;

export async function getNeedProfile(sessionId: string): Promise<NeedProfileRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(customerNeedProfiles)
    .where(eq(customerNeedProfiles.sessionId, sessionId))
    .limit(1);
  return row ?? null;
}

/**
 * Apply a progressive update. Only fields present in `update` are considered;
 * each is written only if `source` outranks-or-equals the field's current
 * source. Returns the resulting row plus which fields were actually applied.
 *
 * Runs in a transaction holding a SELECT … FOR UPDATE lock on the profile
 * row, so concurrent writers serialize: each merge sees the previous
 * writer's committed fields and provenance (see module doc).
 *
 * `opts.confidence` stamps every applied field; `opts.fieldConfidence`
 * overrides it per field (evidence-validated extraction has per-candidate
 * confidence — Session 05).
 */
export async function applyNeedProfileUpdate(
  sessionId: string,
  update: NeedProfileUpdate,
  source: FieldSource,
  opts: {
    confidence?: number;
    fieldConfidence?: Partial<Record<keyof NeedProfileUpdate, number>>;
    customerId?: string | null;
    businessId?: string | null;
  } = {},
): Promise<{ profile: NeedProfileRow; appliedFields: string[] }> {
  const parsed = needProfileUpdateSchema.parse(update);
  for (const confidence of [opts.confidence, ...Object.values(opts.fieldConfidence ?? {})]) {
    if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
      throw new Error("confidence must be within [0, 1]");
    }
  }
  const db = await getDb();

  return db.transaction(async (tx) => {
    const lockBySession = () =>
      tx
        .select()
        .from(customerNeedProfiles)
        .where(eq(customerNeedProfiles.sessionId, sessionId))
        .limit(1)
        .for("update");

    let [profile] = await lockBySession();
    if (!profile) {
      // Creation race: ON CONFLICT waits out a concurrent inserter, then the
      // re-select locks whichever row won. A successful insert already holds
      // its own row lock for the rest of this transaction.
      const [created] = await tx
        .insert(customerNeedProfiles)
        .values({
          id: newId("cnp"),
          sessionId,
          customerId: opts.customerId ?? null,
          businessId: opts.businessId ?? null,
          fieldSourcesJson: {},
        })
        .onConflictDoNothing({ target: customerNeedProfiles.sessionId })
        .returning();
      profile = created ?? (await lockBySession())[0];
      if (!profile) throw new Error(`need profile for session ${sessionId} could not be created`);
    }

    const sources = { ...profile.fieldSourcesJson };
    const columns: Record<string, unknown> = {};
    const appliedFields: string[] = [];

    for (const [field, value] of Object.entries(parsed)) {
      if (value === undefined) continue;
      const existing = sources[field];
      if (existing && SOURCE_RANK[source] < (SOURCE_RANK[existing.source as FieldSource] ?? 0)) continue;
      const column = ARRAY_COLUMNS[field as keyof NeedProfileUpdate] ?? field;
      const confidence = opts.fieldConfidence?.[field as keyof NeedProfileUpdate] ?? opts.confidence;
      columns[column] = value;
      sources[field] = {
        source,
        ...(confidence !== undefined ? { confidence } : {}),
        updatedAt: new Date().toISOString(),
      };
      appliedFields.push(field);
    }

    if (appliedFields.length === 0 && !opts.customerId && !opts.businessId) {
      return { profile, appliedFields };
    }

    const [updated] = await tx
      .update(customerNeedProfiles)
      .set({
        ...columns,
        customerId: profile.customerId ?? opts.customerId ?? null,
        businessId: profile.businessId ?? opts.businessId ?? null,
        fieldSourcesJson: sources,
        updatedAt: new Date(),
      })
      .where(eq(customerNeedProfiles.id, profile.id))
      .returning();
    return { profile: updated, appliedFields };
  });
}
