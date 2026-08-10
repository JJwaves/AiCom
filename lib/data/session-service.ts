import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { events, sessions } from "@/db/schema";
import { CAMPAIGN_PARAMS, mergeAttribution, type Touch } from "@/lib/attribution/attribution";
import { newId } from "./id";

/**
 * Server session identity + server-side attribution.
 *
 * A session row is minted the first time a browser hits a persisting API
 * route; its id travels in the `bd_sid` httpOnly cookie, the browser-durable
 * `bd_aid` anonymous id alongside it. Guests never log in — the session is
 * the spine that later connects events, configurations, conversations,
 * quotes, and orders.
 *
 * Attribution semantics mirror lib/attribution EXACTLY (same pure
 * `mergeAttribution`): first touch is written once and never overwritten;
 * last touch updates only when a visit carries campaign params.
 */

export const SESSION_COOKIE = "bd_sid";
export const ANONYMOUS_COOKIE = "bd_aid";

/** Untrusted client Touch → validated, size-capped, unknown params stripped. */
export const touchSchema = z
  .object({
    params: z
      .record(z.string(), z.string().max(500))
      .transform((p) => {
        const out: Touch["params"] = {};
        for (const key of CAMPAIGN_PARAMS) if (typeof p[key] === "string") out[key] = p[key];
        return out;
      })
      .default({}),
    landing_page: z.string().max(2048).default(""),
    referrer: z.string().max(2048).default(""),
    ts: z.string().max(64).default(""),
  })
  .transform((t): Touch => ({ params: t.params, landing_page: t.landing_page, referrer: t.referrer, ts: t.ts }));

export const attributionSnapshotSchema = z.object({
  first: touchSchema.optional(),
  last: touchSchema.optional(),
});

export type SessionRow = typeof sessions.$inferSelect;

const idShape = /^[a-z]+_[0-9a-f]{32}$/;

/**
 * Resolve-or-create the session for a request. Unknown/malformed ids are
 * treated as absent (a fresh session is minted — never trust client ids to
 * create arbitrary rows). Emits the platform `session_started` event exactly
 * once, when the row is created.
 */
export async function ensureSession(input: {
  sessionId?: string | null;
  anonymousId?: string | null;
  userAgent?: string | null;
}): Promise<{ session: SessionRow; created: boolean }> {
  const db = await getDb();

  if (input.sessionId && idShape.test(input.sessionId)) {
    const [existing] = await db.select().from(sessions).where(eq(sessions.id, input.sessionId)).limit(1);
    if (existing) {
      const [updated] = await db
        .update(sessions)
        .set({ lastSeenAt: new Date(), updatedAt: new Date() })
        .where(eq(sessions.id, existing.id))
        .returning();
      return { session: updated, created: false };
    }
  }

  const id = newId("sess");
  const anonymousId =
    input.anonymousId && idShape.test(input.anonymousId) ? input.anonymousId : newId("anon");
  const [created] = await db
    .insert(sessions)
    .values({ id, anonymousId, userAgent: input.userAgent?.slice(0, 512) ?? null })
    .returning();
  await db.insert(events).values({
    id: newId("evt"),
    sessionId: id,
    name: "session_started",
    propsJson: {},
    clientEventId: newId("evt"),
    occurredAt: new Date(),
  });
  return { session: created, created: true };
}

/**
 * Merge a client attribution snapshot into the session.
 * - First touch: written once (the client's first touch may predate the
 *   server session and is kept verbatim); NEVER overwritten afterwards.
 * - Last touch: updated through `mergeAttribution`, i.e. only when the
 *   incoming touch carries campaign params.
 */
export async function recordAttribution(
  sessionId: string,
  snapshot: { first?: Touch; last?: Touch },
): Promise<void> {
  if (!snapshot.first && !snapshot.last) return;
  const db = await getDb();
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!row) return;

  if (!row.firstTouchJson) {
    const first = snapshot.first ?? snapshot.last;
    const last = snapshot.last ?? snapshot.first;
    await db
      .update(sessions)
      .set({ firstTouchJson: first, lastTouchJson: last, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));
    return;
  }

  const incoming = snapshot.last ?? snapshot.first;
  if (!incoming) return;
  const merged = mergeAttribution(
    { first: row.firstTouchJson, last: row.lastTouchJson ?? row.firstTouchJson },
    incoming,
  );
  // First touch is immutable by construction of mergeAttribution; persist last only.
  await db
    .update(sessions)
    .set({ lastTouchJson: merged.last, updatedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

/** Attach a known customer to the session (kept if already set to someone else — no silent identity swaps). */
export async function linkCustomer(sessionId: string, customerId: string, businessId?: string | null): Promise<void> {
  const db = await getDb();
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!row) return;
  await db
    .update(sessions)
    .set({
      customerId: row.customerId ?? customerId,
      businessId: row.businessId ?? businessId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));
}

/** Stamp the first conversion moment (purchase). Never moves once set. */
export async function markConverted(sessionId: string): Promise<void> {
  const db = await getDb();
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!row || row.convertedAt) return;
  await db.update(sessions).set({ convertedAt: new Date(), updatedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function getSession(sessionId: string): Promise<SessionRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  return row ?? null;
}
