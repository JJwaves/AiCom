import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { artworks } from "@/db/schema";
import { newId } from "./id";

/**
 * Durable artwork records (Production Launch Session 02 §27).
 *
 * The `artworks` row is the AUTHORITATIVE association between a stored
 * object and the commerce record it belongs to. Shopify carries a copy of
 * the artwork id as a line attribute for human convenience, but BagDirect's
 * database — not Shopify, not the filename, not the customer's email, not the
 * browser session — is what answers "which artwork belongs to this order
 * line?" (§28, §31).
 *
 * Lifecycle:
 *   pending_upload  a signed PUT was issued; bytes not verified yet
 *   uploaded        bytes verified in object storage; usable by commerce
 *   rejected        bytes were verified and FAILED (wrong format/size)
 *   abandoned       issued but never completed — identifiable for cleanup
 *   then the fulfilment states: review_required → … → production_ready
 */

export const ARTWORK_STATUSES = [
  "pending_upload",
  "uploaded",
  "rejected",
  "abandoned",
  "review_required",
  "proof_created",
  "proof_sent",
  "approved",
  "revision_requested",
  "production_ready",
] as const;

export type ArtworkStatus = (typeof ARTWORK_STATUSES)[number];
export type ArtworkRow = typeof artworks.$inferSelect;

/** Statuses a cart line / order line may reference. */
const USABLE_STATUSES: ArtworkStatus[] = [
  "uploaded",
  "review_required",
  "proof_created",
  "proof_sent",
  "approved",
  "revision_requested",
  "production_ready",
];

const createSchema = z.object({
  sessionId: z.string().min(1),
  customerId: z.string().optional(),
  fileName: z.string().min(1).max(255),
  fileType: z.string().min(1).max(120),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  storageKey: z.string().min(1).max(1024),
  storageProvider: z.string().min(1).max(40),
  notes: z.string().max(1000).optional(),
});

/**
 * Reserve an artwork record before any bytes exist. Minting the id FIRST is
 * what makes the object key server-derived: the browser is handed a key it
 * had no part in choosing.
 */
export async function createPendingArtwork(
  input: z.input<typeof createSchema> & { id?: string },
): Promise<ArtworkRow> {
  const parsed = createSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(artworks)
    .values({
      id: input.id ?? newId("art"),
      sessionId: parsed.sessionId,
      customerId: parsed.customerId ?? null,
      fileName: parsed.fileName,
      fileType: parsed.fileType,
      sizeBytes: parsed.sizeBytes,
      storageKey: parsed.storageKey,
      storageProvider: parsed.storageProvider,
      notes: parsed.notes ?? null,
      status: "pending_upload",
    })
    .returning();
  return row;
}

export async function getArtwork(id: string): Promise<ArtworkRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(artworks).where(eq(artworks.id, id)).limit(1);
  return row ?? null;
}

/**
 * Fetch an artwork the given session is allowed to act on. Session ownership
 * is checked at the DATA layer, not only in the route, so no future caller
 * can accidentally hand one session's artwork to another.
 */
export async function getArtworkForSession(id: string, sessionId: string): Promise<ArtworkRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(artworks)
    .where(and(eq(artworks.id, id), eq(artworks.sessionId, sessionId)))
    .limit(1);
  return row ?? null;
}

export async function markArtworkUploaded(input: {
  id: string;
  sizeBytes: number;
  fileType: string;
  checksum?: string | null;
}): Promise<ArtworkRow | null> {
  const db = await getDb();
  const [row] = await db
    .update(artworks)
    .set({
      status: "uploaded",
      sizeBytes: input.sizeBytes,
      fileType: input.fileType,
      checksum: input.checksum ?? null,
      updatedAt: new Date(),
    })
    .where(eq(artworks.id, input.id))
    .returning();
  return row ?? null;
}

export async function markArtworkStatus(id: string, status: ArtworkStatus): Promise<void> {
  z.enum(ARTWORK_STATUSES).parse(status);
  const db = await getDb();
  await db.update(artworks).set({ status, updatedAt: new Date() }).where(eq(artworks.id, id));
}

/**
 * Is this artwork reference real, owned by this session, and actually backed
 * by verified bytes? Checkout calls this before an order can be created for
 * a print option that requires artwork — an id the customer invented, or one
 * whose upload never completed, must not reach the factory.
 */
export async function isArtworkUsableForSession(id: string, sessionId: string): Promise<boolean> {
  const row = await getArtworkForSession(id, sessionId);
  return Boolean(row && USABLE_STATUSES.includes(row.status as ArtworkStatus));
}

/**
 * THE artwork → order-line link (§28). Deterministic and explicit: no
 * matching on filename, email or session heuristics. Called inside the
 * order-persistence transaction boundary.
 */
export async function linkArtworkToOrderLine(input: {
  artworkId: string;
  orderId: string;
  orderLineId: string;
  customerId?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db
    .update(artworks)
    .set({
      orderId: input.orderId,
      orderLineId: input.orderLineId,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      status: "review_required",
      updatedAt: new Date(),
    })
    .where(eq(artworks.id, input.artworkId));
}

export async function listArtworkForOrder(orderId: string): Promise<ArtworkRow[]> {
  const db = await getDb();
  return db.select().from(artworks).where(eq(artworks.orderId, orderId));
}

/**
 * Abandoned uploads (§29): reserved or uploaded, never attached to an order
 * or a quote, older than `olderThanDays`.
 *
 * This is a QUERY, not a worker. Deleting stored bytes on a schedule is
 * deferred (docs/ARTWORK_STORAGE.md §"Retention"); what launch requires is
 * that abandoned data be IDENTIFIABLE rather than invisible, so retention can
 * be executed deliberately instead of discovered later.
 */
export async function listAbandonedArtwork(olderThanDays = 30): Promise<ArtworkRow[]> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(artworks)
    .where(
      and(
        inArray(artworks.status, ["pending_upload", "uploaded"]),
        isNull(artworks.orderId),
        isNull(artworks.quoteId),
        lt(artworks.createdAt, cutoff),
      ),
    );
}

/**
 * How many artwork records this session has created since `since`
 * (Production Launch Session 03 §19).
 *
 * Backs the per-session upload ALLOWANCE. Rate limiting bounds how FAST a
 * caller can mint signed upload URLs; this bounds how MANY objects one
 * anonymous session can create in the owner's bucket at any speed — the two
 * answer different questions, and only the second bounds total storage cost.
 *
 * Every status counts, deliberately: a rejected or abandoned upload still
 * consumed a signed URL and may still have put bytes in the bucket.
 */
export async function countArtworkForSession(sessionId: string, since: Date): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(artworks)
    .where(and(eq(artworks.sessionId, sessionId), gte(artworks.createdAt, since)));
  return Number(row?.count ?? 0);
}

/** Counts by status — operational visibility for the launch checklist. */
export async function artworkStatusCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db
    .select({ status: artworks.status, count: sql<number>`count(*)::int` })
    .from(artworks)
    .groupBy(artworks.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
}
