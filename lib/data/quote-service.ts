import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { artworks, quotes } from "@/db/schema";
import { newId } from "./id";

/**
 * Quote + artwork-metadata persistence. Today quotes arrive from the
 * request-pricing form (status "submitted"); the model already carries what
 * future AI Draft Quotes need (status "draft", createdBy "ai",
 * priceSnapshot, expiry, provider draft-order link) — preparation only, no
 * automated quoting exists.
 */

export const QUOTE_STATUSES = [
  "draft",
  "submitted",
  "priced",
  "customer_review",
  "accepted",
  "rejected",
  "expired",
  "manual_review",
] as const;

export const quoteCreateSchema = z.object({
  sessionId: z.string().optional(),
  customerId: z.string().optional(),
  businessId: z.string().optional(),
  configurationId: z.string().optional(),
  status: z.enum(QUOTE_STATUSES).default("submitted"),
  createdBy: z.enum(["customer", "ai", "admin"]).default("customer"),
  /** The validated quote request payload (contact + requirements). */
  payload: z.record(z.string(), z.unknown()),
  priceSnapshot: z
    .object({
      unitPriceCents: z.number().int().nonnegative(),
      totalCents: z.number().int().nonnegative(),
      currency: z.string().max(8),
    })
    .optional(),
  expiresAt: z.date().optional(),
  attribution: z.record(z.string().max(64), z.string().max(512)).optional(),
});

export const ARTWORK_STATUSES = [
  "uploaded",
  "review_required",
  "proof_created",
  "proof_sent",
  "approved",
  "revision_requested",
  "production_ready",
] as const;

export const artworkCreateSchema = z.object({
  sessionId: z.string().optional(),
  customerId: z.string().optional(),
  orderId: z.string().optional(),
  quoteId: z.string().optional(),
  fileName: z.string().min(1).max(255),
  fileType: z.string().min(1).max(120),
  sizeBytes: z.number().int().nonnegative(),
  storageUrl: z.string().max(2048).optional(),
  notes: z.string().max(1000).optional(),
  status: z.enum(ARTWORK_STATUSES).default("uploaded"),
});

export type QuoteRow = typeof quotes.$inferSelect;
export type ArtworkRow = typeof artworks.$inferSelect;

export async function createQuote(input: z.input<typeof quoteCreateSchema>): Promise<QuoteRow> {
  const parsed = quoteCreateSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(quotes)
    .values({
      id: newId("quo"),
      sessionId: parsed.sessionId ?? null,
      customerId: parsed.customerId ?? null,
      businessId: parsed.businessId ?? null,
      configurationId: parsed.configurationId ?? null,
      status: parsed.status,
      createdBy: parsed.createdBy,
      payloadJson: parsed.payload,
      priceSnapshotJson: parsed.priceSnapshot ?? null,
      expiresAt: parsed.expiresAt ?? null,
      attributionJson: parsed.attribution ?? null,
    })
    .returning();
  return row;
}

export async function updateQuoteStatus(id: string, status: (typeof QUOTE_STATUSES)[number]): Promise<void> {
  z.enum(QUOTE_STATUSES).parse(status);
  const db = await getDb();
  await db.update(quotes).set({ status, updatedAt: new Date() }).where(eq(quotes.id, id));
}

export async function getQuote(id: string): Promise<QuoteRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
  return row ?? null;
}

export async function listQuotesBySession(sessionId: string): Promise<QuoteRow[]> {
  const db = await getDb();
  return db.select().from(quotes).where(eq(quotes.sessionId, sessionId)).orderBy(desc(quotes.createdAt));
}

/** Artwork metadata only — binary storage remains a launch task (BUSINESS_CONFIG_TODO). */
export async function recordArtwork(input: z.input<typeof artworkCreateSchema>): Promise<ArtworkRow> {
  const parsed = artworkCreateSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(artworks)
    .values({
      id: newId("art"),
      sessionId: parsed.sessionId ?? null,
      customerId: parsed.customerId ?? null,
      orderId: parsed.orderId ?? null,
      quoteId: parsed.quoteId ?? null,
      fileName: parsed.fileName,
      fileType: parsed.fileType,
      sizeBytes: parsed.sizeBytes,
      storageUrl: parsed.storageUrl ?? null,
      notes: parsed.notes ?? null,
      status: parsed.status,
    })
    .returning();
  return row;
}
