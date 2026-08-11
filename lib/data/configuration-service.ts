import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { productConfigurations } from "@/db/schema";
import { configurationSchema } from "@/lib/validation/checkout";
import { newId } from "./id";

/**
 * Product-configuration persistence: ONE live row per session × product,
 * versioned in place (abandoned-config analysis). Orders and quotes embed
 * their own immutable configuration copies, so history stays reproducible
 * even when config/products.ts changes later.
 *
 * Writers (Session 06): the configurator sync route (source "configurator"),
 * the AI updateConfiguration tool (source "ai"), and the checkout re-quote
 * (source "checkout") — all through this same service. `version` is the
 * configuration REVISION: it increments on every write and is the stale-
 * update guard for AI patches (an AI suggestion computed against revision N
 * must not blindly overwrite revision N+1 — see updateConfigurationChecked).
 */

const priceSnapshotSchema = z.object({
  unitPriceCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  currency: z.string().max(8),
});

export const configurationUpsertSchema = z.object({
  sessionId: z.string().min(1),
  productId: z.string().min(1).max(100),
  config: configurationSchema,
  /** Sell-side snapshot only — cost/margin data never enters this table. */
  priceSnapshot: priceSnapshotSchema.optional(),
  source: z.enum(["configurator", "checkout", "quote", "ai"]),
});

export type ConfigurationRow = typeof productConfigurations.$inferSelect;

export async function upsertActiveConfiguration(
  input: z.input<typeof configurationUpsertSchema>,
): Promise<ConfigurationRow> {
  const parsed = configurationUpsertSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(productConfigurations)
    .values({
      id: newId("cfg"),
      sessionId: parsed.sessionId,
      productId: parsed.productId,
      configJson: parsed.config,
      priceSnapshotJson: parsed.priceSnapshot ?? null,
      source: parsed.source,
    })
    .onConflictDoUpdate({
      target: [productConfigurations.sessionId, productConfigurations.productId],
      set: {
        configJson: parsed.config,
        priceSnapshotJson: parsed.priceSnapshot ?? null,
        source: parsed.source,
        version: sql`${productConfigurations.version} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function getActiveConfiguration(sessionId: string, productId: string): Promise<ConfigurationRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(productConfigurations)
    .where(and(eq(productConfigurations.sessionId, sessionId), eq(productConfigurations.productId, productId)))
    .limit(1);
  return row ?? null;
}

/** The session's most recently touched configuration — what "the current configuration" means without a productId. */
export async function getLatestActiveConfiguration(sessionId: string): Promise<ConfigurationRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(productConfigurations)
    .where(eq(productConfigurations.sessionId, sessionId))
    .orderBy(desc(productConfigurations.updatedAt), desc(productConfigurations.createdAt))
    .limit(1);
  return row ?? null;
}

export type CheckedUpdateResult =
  | { ok: true; row: ConfigurationRow }
  | { ok: false; reason: "stale_revision"; current: ConfigurationRow };

/**
 * Revision-checked configuration write (the AI-patch path). Runs in a
 * transaction holding SELECT … FOR UPDATE on the row so concurrent writers
 * (manual sync, a second AI turn) serialize; when `expectedRevision` is
 * given and the locked row has moved past it, nothing is written and the
 * caller gets the current row back — the agent re-reads instead of
 * clobbering a newer manual change. No expectedRevision = last-write-wins
 * (the manual-sync semantics of upsertActiveConfiguration, but atomic).
 */
export async function updateConfigurationChecked(
  input: z.input<typeof configurationUpsertSchema> & { expectedRevision?: number },
): Promise<CheckedUpdateResult> {
  const parsed = configurationUpsertSchema.parse(input);
  const expectedRevision = input.expectedRevision;
  const db = await getDb();

  return db.transaction(async (tx) => {
    const lock = () =>
      tx
        .select()
        .from(productConfigurations)
        .where(
          and(eq(productConfigurations.sessionId, parsed.sessionId), eq(productConfigurations.productId, parsed.productId)),
        )
        .limit(1)
        .for("update");

    let [existing] = await lock();
    if (!existing) {
      const [created] = await tx
        .insert(productConfigurations)
        .values({
          id: newId("cfg"),
          sessionId: parsed.sessionId,
          productId: parsed.productId,
          configJson: parsed.config,
          priceSnapshotJson: parsed.priceSnapshot ?? null,
          source: parsed.source,
        })
        .onConflictDoNothing({ target: [productConfigurations.sessionId, productConfigurations.productId] })
        .returning();
      if (created) return { ok: true, row: created };
      [existing] = await lock(); // lost a creation race — the winner's row is now locked
      if (!existing) throw new Error(`configuration row for ${parsed.sessionId}×${parsed.productId} could not be created`);
    }

    if (expectedRevision !== undefined && existing.version !== expectedRevision) {
      return { ok: false, reason: "stale_revision", current: existing };
    }

    const [updated] = await tx
      .update(productConfigurations)
      .set({
        configJson: parsed.config,
        priceSnapshotJson: parsed.priceSnapshot ?? null,
        source: parsed.source,
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(productConfigurations.id, existing.id))
      .returning();
    return { ok: true, row: updated };
  });
}
