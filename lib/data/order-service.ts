import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { COST_MODEL } from "@/config/costs";
import { getDb } from "@/db/client";
import { orderLines, orders } from "@/db/schema";
import { listCatalogProducts } from "@/lib/commerce/catalog";
import { captureOrderCostSnapshot, type CapturedOrderCosts } from "@/modules/pricing";
import { configurationSchema } from "@/lib/validation/checkout";
import { newId } from "./id";

/**
 * Order intelligence records. The commerce provider (Shopify, or mock in
 * development) remains the system of record for the order itself — these
 * rows exist to CONNECT an order to session, customer, business,
 * conversation, attribution, and configuration snapshots for future
 * intelligence work. Never a competing order-management system.
 *
 * Statuses are the start of the factory pipeline (MASTER_PROMPT §37) and
 * grow additively: created → paid → artwork_review → in_production →
 * shipped → delivered (plus cancelled/refunded when webhooks land).
 */

const artworkRefSchema = z.object({
  fileName: z.string().max(255),
  fileType: z.string().max(120),
  fileSizeBytes: z.number().int().nonnegative(),
  url: z.string().max(2048).optional(),
  notes: z.string().max(1000).optional(),
});

export const orderCreateSchema = z.object({
  sessionId: z.string().optional(),
  customerId: z.string().optional(),
  businessId: z.string().optional(),
  conversationId: z.string().optional(),
  provider: z.enum(["mock", "shopify"]),
  providerOrderId: z.string().max(128).optional(),
  providerCheckoutRef: z.string().max(2048).optional(),
  currency: z.enum(["USD", "CAD"]),
  status: z.string().min(1).max(50).default("created"),
  aiAssisted: z.boolean().default(false),
  attribution: z.record(z.string().max(64), z.string().max(512)).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1).max(100),
        quantity: z.number().int().positive(),
        unitPriceCents: z.number().int().nonnegative(),
        totalCents: z.number().int().nonnegative(),
        title: z.string().min(1).max(300),
        optionSummary: z.string().max(500).optional(),
        config: configurationSchema,
        artwork: artworkRefSchema.nullish(),
      }),
    )
    .min(1),
});

export type OrderRow = typeof orders.$inferSelect;
export type OrderLineRow = typeof orderLines.$inferSelect;

/**
 * Freeze the order's economics under the CURRENT cost model (Session 13.5
 * §28). Best-effort by design:
 *
 *  - With `config/costs.ts` unconfigured — its shipped state — this returns
 *    null, the order stores no snapshot, and its profit is reported as
 *    HISTORICAL_COST_UNAVAILABLE rather than back-filled later from costs
 *    that were not in force.
 *  - Any failure is swallowed. A cost snapshot is INTERNAL ANALYTICS; a
 *    customer who paid must get an order (§47). The catch is the same
 *    "persistence is additive to commerce" posture as the rest of S03.
 */
async function captureCosts(
  parsed: z.output<typeof orderCreateSchema>,
  revenueCents: number,
  now: Date,
): Promise<CapturedOrderCosts | null> {
  try {
    const products = await listCatalogProducts();
    const byId = new Map(products.map((p) => [p.id, p]));
    return captureOrderCostSnapshot(
      {
        revenueCents,
        currency: parsed.currency,
        model: COST_MODEL,
        lines: parsed.lines.map((l) => ({
          productId: l.productId,
          product: byId.get(l.productId) ?? null,
          config: l.config,
          revenueCents: l.totalCents,
        })),
      },
      now,
    );
  } catch (error) {
    console.error("[order-service] cost snapshot capture failed (order unaffected)", error);
    return null;
  }
}

export async function createOrder(
  input: z.input<typeof orderCreateSchema>,
): Promise<{ order: OrderRow; lines: OrderLineRow[] }> {
  const parsed = orderCreateSchema.parse(input);
  const subtotalCents = parsed.lines.reduce((s, l) => s + l.totalCents, 0);
  const captured = await captureCosts(parsed, subtotalCents, new Date());
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [order] = await tx
      .insert(orders)
      .values({
        id: newId("ord"),
        sessionId: parsed.sessionId ?? null,
        customerId: parsed.customerId ?? null,
        businessId: parsed.businessId ?? null,
        conversationId: parsed.conversationId ?? null,
        provider: parsed.provider,
        providerOrderId: parsed.providerOrderId ?? null,
        providerCheckoutRef: parsed.providerCheckoutRef ?? null,
        currency: parsed.currency,
        subtotalCents,
        totalCents: subtotalCents,
        status: parsed.status,
        aiAssisted: parsed.aiAssisted,
        attributionJson: parsed.attribution ?? null,
        costModelVersion: captured?.snapshot.costModelVersion ?? null,
        costSnapshotJson: captured?.snapshot ?? null,
      })
      .returning();

    const lines = await tx
      .insert(orderLines)
      .values(
        parsed.lines.map((l, i) => ({
          id: newId("oln"),
          orderId: order.id,
          productId: l.productId,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          totalCents: l.totalCents,
          title: l.title,
          optionSummary: l.optionSummary ?? null,
          configJson: l.config,
          artworkJson: l.artwork ?? null,
          costSnapshotJson: captured?.lineSnapshots[i] ?? null,
        })),
      )
      .returning();

    return { order, lines };
  });
}

export async function getOrder(id: string): Promise<{ order: OrderRow; lines: OrderLineRow[] } | null> {
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) return null;
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, id));
  return { order, lines };
}

export async function listOrdersBySession(sessionId: string): Promise<OrderRow[]> {
  const db = await getDb();
  return db.select().from(orders).where(eq(orders.sessionId, sessionId)).orderBy(desc(orders.createdAt));
}
