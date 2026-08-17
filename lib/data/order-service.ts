import { and, desc, eq } from "drizzle-orm";
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

/**
 * Artwork snapshot stored on an order line. `artworkId` is the durable
 * reference; `url` is deliberately ABSENT — a browser object URL on a paid
 * order line is a link the factory can never open (Session 02 §21).
 */
const artworkRefSchema = z.object({
  artworkId: z.string().max(64).optional(),
  fileName: z.string().max(255),
  fileType: z.string().max(120),
  fileSizeBytes: z.number().int().nonnegative(),
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

/* ------------------------------------------------------------------ */
/* Provider reconciliation (Production Launch Session 02 §16, §17)     */
/* ------------------------------------------------------------------ */

/**
 * ORDER AUTHORITY, stated once:
 *
 *   cart            → BagDirect browser state
 *   price           → BagDirect deterministic pricing engine
 *   checkout        → Shopify hosted checkout
 *   PAYMENT TRUTH   → Shopify
 *   PAID ORDER TRUTH→ Shopify, delivered by webhook
 *   BagDirect order → RECONCILED from that truth
 *
 * A browser returning from Shopify proves nothing and is never treated as
 * payment. The functions below are the only way an order becomes paid,
 * cancelled or refunded, and each is idempotent so Shopify's retries cannot
 * double-count anything.
 */

/** Terminal-ish statuses a later webhook must not silently undo. */
const PAID_STATUSES = new Set(["paid", "artwork_review", "in_production", "shipped", "delivered"]);

export async function findOrderByProviderOrderId(
  provider: string,
  providerOrderId: string,
): Promise<OrderRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.provider, provider), eq(orders.providerOrderId, providerOrderId)))
    .limit(1);
  return row ?? null;
}

export async function findOrderByCheckoutRef(provider: string, checkoutRef: string): Promise<OrderRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.provider, provider), eq(orders.providerCheckoutRef, checkoutRef)))
    .limit(1);
  return row ?? null;
}

/**
 * Attach the provider's order id to a BagDirect order created at checkout
 * time. Idempotent: re-attaching the same id is a no-op, and attaching a
 * DIFFERENT id is refused rather than silently overwriting — that would mean
 * two Shopify orders claiming one BagDirect order, which is a reconciliation
 * bug worth failing loudly on.
 */
export async function attachProviderOrderId(input: {
  orderId: string;
  providerOrderId: string;
  /** `linked` distinguishes a NEW link from a re-confirmation of an existing one. */
}): Promise<{ attached: boolean; conflict: boolean; linked: boolean }> {
  const db = await getDb();
  const existing = await getOrder(input.orderId);
  if (!existing) return { attached: false, conflict: false, linked: false };
  if (existing.order.providerOrderId === input.providerOrderId) return { attached: true, conflict: false, linked: false };
  if (existing.order.providerOrderId) return { attached: false, conflict: true, linked: false };

  await db
    .update(orders)
    .set({ providerOrderId: input.providerOrderId, updatedAt: new Date() })
    .where(eq(orders.id, input.orderId));
  return { attached: true, conflict: false, linked: true };
}

export type OrderPaymentResult = {
  order: OrderRow;
  /** True only on the transition into paid — the caller fires purchase_completed exactly then. */
  transitioned: boolean;
};

/**
 * Mark an order paid, ONCE.
 *
 * The `transitioned` flag is the whole point: `purchase_completed`,
 * conversion marking and the `purchased` conversation outcome all hang off
 * it, so a replayed `orders/paid` — or an `orders/paid` arriving after
 * `orders/create` already reported payment — updates nothing and fires
 * nothing. The check and the write happen in ONE transaction under a row
 * lock, so two concurrent deliveries cannot both see "not yet paid".
 */
export async function markOrderPaid(input: {
  orderId: string;
  paidAt?: Date;
  /** Provider's authoritative total, when it differs from the BagDirect subtotal. */
  providerTotalCents?: number | null;
}): Promise<OrderPaymentResult | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for("update")
      .limit(1);
    if (!locked) return null;
    if (PAID_STATUSES.has(locked.status)) return { order: locked, transitioned: false };

    const [updated] = await tx
      .update(orders)
      .set({
        status: "paid",
        paidAt: input.paidAt ?? new Date(),
        ...(typeof input.providerTotalCents === "number" ? { totalCents: input.providerTotalCents } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, input.orderId))
      .returning();
    return { order: updated, transitioned: true };
  });
}

export async function markOrderCancelled(input: {
  orderId: string;
  cancelledAt?: Date;
}): Promise<OrderPaymentResult | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update").limit(1);
    if (!locked) return null;
    if (locked.status === "cancelled") return { order: locked, transitioned: false };

    const [updated] = await tx
      .update(orders)
      .set({ status: "cancelled", cancelledAt: input.cancelledAt ?? new Date(), updatedAt: new Date() })
      .where(eq(orders.id, input.orderId))
      .returning();
    return { order: updated, transitioned: true };
  });
}

/**
 * Record a refund reported by the provider (§45 — minimal, honest).
 *
 * `refundedTotalCents` accumulates. Reaching the order total moves the status
 * to `refunded` (so business intelligence stops counting it as revenue);
 * anything less leaves the order `paid` with the partial amount recorded.
 * Per-LINE refund allocation is deliberately not modelled — Shopify refunds
 * can be arbitrary amounts against arbitrary lines, and inventing an
 * allocation would produce precise-looking per-product profit that is not
 * true. Documented in docs/SHOPIFY_PRODUCTION.md §"Refunds".
 */
export async function recordOrderRefund(input: {
  orderId: string;
  refundAmountCents: number;
}): Promise<{ order: OrderRow; fullyRefunded: boolean } | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update").limit(1);
    if (!locked) return null;

    const refunded = Math.max(0, locked.refundedTotalCents + Math.max(0, input.refundAmountCents));
    const fullyRefunded = refunded >= locked.totalCents && locked.totalCents > 0;
    const [updated] = await tx
      .update(orders)
      .set({
        refundedTotalCents: refunded,
        ...(fullyRefunded ? { status: "refunded" } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, input.orderId))
      .returning();
    return { order: updated, fullyRefunded };
  });
}

/**
 * Set the CUMULATIVE refunded total to the provider's authoritative figure
 * (Production Launch Session 03 §25, §28).
 *
 * `recordOrderRefund` ACCUMULATES, which is right for a `refunds/create`
 * webhook: each delivery describes one new refund event. A reconciliation
 * sweep sees something different — Shopify's `totalRefunded`, the running
 * total — and adding that to an existing total would double-count every
 * refund on every sweep.
 *
 * So reconciliation SETS rather than adds. That makes it idempotent by
 * construction: running the sweep twice writes the same number twice, and
 * `changed` reports whether anything actually moved. The value never
 * decreases (a provider figure lower than what we already recorded is
 * treated as stale and ignored), so a webhook that arrived first is never
 * undone by a sweep reading an older snapshot.
 */
export async function setOrderRefundTotal(input: {
  orderId: string;
  refundedTotalCents: number;
}): Promise<{ order: OrderRow; changed: boolean; fullyRefunded: boolean } | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update").limit(1);
    if (!locked) return null;

    const refunded = Math.max(locked.refundedTotalCents, Math.max(0, input.refundedTotalCents));
    const fullyRefunded = refunded >= locked.totalCents && locked.totalCents > 0;
    const statusChange = fullyRefunded && locked.status !== "refunded";
    if (refunded === locked.refundedTotalCents && !statusChange) {
      return { order: locked, changed: false, fullyRefunded };
    }

    const [updated] = await tx
      .update(orders)
      .set({
        refundedTotalCents: refunded,
        ...(fullyRefunded ? { status: "refunded" } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, input.orderId))
      .returning();
    return { order: updated, changed: true, fullyRefunded };
  });
}

/** Record the provider's pre-payment checkout handle (Shopify draft order GID). */
export async function setOrderCheckoutRef(input: { orderId: string; checkoutRef: string }): Promise<void> {
  const db = await getDb();
  await db
    .update(orders)
    .set({ providerCheckoutRef: input.checkoutRef, updatedAt: new Date() })
    .where(eq(orders.id, input.orderId));
}
