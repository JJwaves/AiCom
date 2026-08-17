import { getOrder, type OrderLineRow, type OrderRow } from "@/lib/data/order-service";

/**
 * Customer-safe order confirmation (Production Launch Session 03 §3–§5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A SERVER ANSWER, AND NOT `?placed=1`
 * ═══════════════════════════════════════════════════════════════════════════
 * Before this session the confirmation page fired the `purchase` analytics
 * event when the URL said `?placed=1` and a matching object existed in
 * sessionStorage. Both are browser state. Anyone could type the query
 * parameter, a bookmark could replay it, and — the real problem — a Shopify
 * checkout that the customer ABANDONED at the payment step could still lead
 * to a page that reported a purchase, because the browser had been to
 * checkout and the browser was the one being asked.
 *
 * The rule now is the one the whole session is built on: PAYMENT TRUTH IS
 * SHOPIFY'S, delivered by webhook, recorded on the order row. This module
 * reads that row. It never infers payment from a redirect, a query
 * parameter, a stored cart, or the customer having been to checkout.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY IT IS SESSION-SCOPED
 * ═══════════════════════════════════════════════════════════════════════════
 * Order ids are unguessable, but "unguessable" is not an authorization
 * model: ids travel in URLs, browser history, screenshots and support
 * tickets. The confirmation is therefore only returned to the SESSION THAT
 * PLACED THE ORDER, and a mismatch is answered exactly like a non-existent
 * order (§59: no purchase data leak, and no existence oracle either).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT DELIBERATELY OMITS
 * ═══════════════════════════════════════════════════════════════════════════
 * No cost, no margin, no cost-model version, no attribution, no session or
 * customer id, no email, no artwork metadata, no Shopify internals beyond
 * the order identifier the customer already sees on their receipt. What
 * remains is what a confirmation page must show and what an analytics
 * purchase needs: an identifier, a value, a currency and the items.
 */

export type ConfirmedOrderLine = {
  productId: string;
  title: string;
  optionSummary: string | null;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};

export type OrderConfirmation = {
  orderId: string;
  /**
   * The id every analytics destination deduplicates on. It is the PROVIDER's
   * order id whenever one exists, because that is the identifier the owner
   * can also see in Shopify, in a GA4 purchase, and on the customer's
   * receipt — one transaction, one id, everywhere.
   */
  transactionId: string;
  /** TRUE only when the provider confirmed payment. Never inferred. */
  paid: boolean;
  status: string;
  currency: string;
  /** BagDirect's product subtotal — the same figure every margin divides by. */
  valueCents: number;
  placedAt: string;
  paidAt: string | null;
  lines: ConfirmedOrderLine[];
  /** True for mock-provider orders: development only, and labelled as such in the UI. */
  demo: boolean;
};

/**
 * Has the provider confirmed payment for this order?
 *
 * SHOPIFY: `paidAt` is set in exactly one place — `markOrderPaid`, inside a
 * row-locked transaction, driven by an HMAC-verified webhook. Nothing else
 * in the codebase writes it, so nothing else can make an order look paid.
 *
 * MOCK: development and test only. `mockProvider.createCheckout` throws
 * under NODE_ENV=production and `resolveCommerceConfiguration()` refuses to
 * select it there, so this branch cannot be reached by a production
 * deployment — which is what makes it safe to treat a completed mock
 * checkout as terminal. It is reported with `demo: true` so no surface can
 * present it as a real sale.
 */
export function isOrderPaid(order: OrderRow): boolean {
  if (order.provider === "mock") return order.status === "created" || order.paidAt !== null;
  return order.paidAt !== null;
}

export function buildOrderConfirmation(order: OrderRow, lines: OrderLineRow[]): OrderConfirmation {
  return {
    orderId: order.id,
    transactionId: order.providerOrderId ?? order.id,
    paid: isOrderPaid(order),
    status: order.status,
    currency: order.currency,
    valueCents: order.totalCents,
    placedAt: order.createdAt.toISOString(),
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    demo: order.provider === "mock",
    lines: lines.map((line) => ({
      productId: line.productId,
      title: line.title,
      optionSummary: line.optionSummary,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      totalCents: line.totalCents,
    })),
  };
}

/**
 * The ONE read path for a confirmation. Returns null for an unknown order
 * AND for an order belonging to a different session — the caller cannot tell
 * the two apart, and neither can the customer.
 */
export async function getOrderConfirmationForSession(
  orderId: string,
  sessionId: string,
): Promise<OrderConfirmation | null> {
  const record = await getOrder(orderId);
  if (!record) return null;
  if (!record.order.sessionId || record.order.sessionId !== sessionId) return null;
  return buildOrderConfirmation(record.order, record.lines);
}
