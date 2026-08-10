import { and, eq, sql } from "drizzle-orm";
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
 * Writers today: the checkout re-quote (source "checkout"). Session 06's
 * shared configurator store will write with source "configurator"; AI tools
 * with source "ai" — all through this same service.
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
