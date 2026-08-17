import { deliverPurchaseConversions, type ConversionDelivery } from "./conversions";
import { track, type EcommerceItem } from "./track";

/**
 * The client half of authoritative purchase tracking (Production Launch
 * Session 03 §3–§5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FLOW
 * ═══════════════════════════════════════════════════════════════════════════
 *   /api/checkout returns the BagDirect order id
 *        ↓  recorded as PENDING (localStorage) — an intention, not a sale
 *   customer pays on Shopify
 *        ↓  Shopify → signed webhook → markOrderPaid → paidAt
 *   customer returns to the site
 *        ↓  the SERVER is asked whether that order is paid
 *   paid ⇒ GA4 / Google Ads / Meta purchase, exactly once
 *
 * Nothing here decides that a purchase happened. It asks, and it believes
 * only the server.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE RELIABILITY LIMITATION, STATED RATHER THAN HIDDEN (§7)
 * ═══════════════════════════════════════════════════════════════════════════
 * Browser-based conversion tracking depends on the buyer coming back to a
 * BagDirect page after paying. A customer who closes the tab on Shopify's
 * order-status page never runs this code, so GA4 and Google Ads will
 * UNDERCOUNT relative to reality.
 *
 * That is a measurement gap, not a data gap: BagDirect's own
 * `purchase_completed` is written server-side from the webhook and is
 * complete regardless. Revenue, AOV, conversion rate and profitability all
 * read that. The ad platforms see a subset, and
 * docs/ANALYTICS_PRODUCTION.md tells the owner exactly how to close it
 * (Shopify's own checkout pixels) rather than pretending it is closed.
 */

const PENDING_KEY = "bd_pending_order_v1";
const FIRED_KEY = "bd_fired_purchases_v1";
/** Bounded so the guard cannot grow forever in a long-lived browser. */
const MAX_REMEMBERED = 20;

type ConfirmationResponse = {
  ok: true;
  order: {
    orderId: string;
    transactionId: string;
    paid: boolean;
    status: string;
    currency: string;
    valueCents: number;
    placedAt: string;
    paidAt: string | null;
    demo: boolean;
    lines: {
      productId: string;
      title: string;
      optionSummary: string | null;
      quantity: number;
      unitPriceCents: number;
      totalCents: number;
    }[];
  };
};

export type ConfirmedPurchase = ConfirmationResponse["order"];

/* ------------------------------------------------------------------ */
/* Pending order (an INTENTION — never a purchase)                     */
/* ------------------------------------------------------------------ */

export function rememberPendingOrder(orderId: string): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(PENDING_KEY, orderId);
  } catch {
    /* private mode, storage full — tracking is optional, ordering is not */
  }
}

export function readPendingOrder(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function clearPendingOrder(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* best effort */
  }
}

/* ------------------------------------------------------------------ */
/* Exactly-once guard                                                  */
/* ------------------------------------------------------------------ */

function firedTransactions(): string[] {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function hasFiredPurchase(transactionId: string): boolean {
  return firedTransactions().includes(transactionId);
}

function rememberFiredPurchase(transactionId: string): void {
  try {
    const next = [...firedTransactions().filter((id) => id !== transactionId), transactionId].slice(-MAX_REMEMBERED);
    localStorage.setItem(FIRED_KEY, JSON.stringify(next));
  } catch {
    /* best effort — the destinations deduplicate on transaction_id too */
  }
}

/* ------------------------------------------------------------------ */
/* Confirmation                                                        */
/* ------------------------------------------------------------------ */

/** Ask the server. Returns null for unknown, someone else's, or unavailable. */
export async function fetchOrderConfirmation(orderId: string): Promise<ConfirmedPurchase | null> {
  try {
    const res = await fetch(`/api/orders/confirmation?order=${encodeURIComponent(orderId)}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ConfirmationResponse;
    return data.ok ? data.order : null;
  } catch {
    return null;
  }
}

function toItems(order: ConfirmedPurchase): EcommerceItem[] {
  return order.lines.map((line) => ({
    product_id: line.productId,
    product_name: line.title,
    variant: line.optionSummary ?? undefined,
    quantity: line.quantity,
    unit_price: line.unitPriceCents / 100,
  }));
}

/**
 * Fire the purchase for a CONFIRMED PAID order, once.
 *
 * Refuses an unpaid order outright — that is the whole point of the module,
 * and it is asserted in tests rather than left to call-site discipline.
 */
export function firePurchase(order: ConfirmedPurchase): { fired: boolean; delivery?: ConversionDelivery } {
  if (!order.paid) return { fired: false };
  if (hasFiredPurchase(order.transactionId)) return { fired: false };
  rememberFiredPurchase(order.transactionId);

  const items = toItems(order);
  const value = order.valueCents / 100;

  // The dataLayer copy (GTM reads this), then the direct vendor sends.
  track({ name: "purchase", params: { transaction_id: order.transactionId, items, value, currency: order.currency } });
  const delivery = deliverPurchaseConversions({
    transactionId: order.transactionId,
    value,
    currency: order.currency,
    items,
  });
  return { fired: true, delivery };
}

/**
 * Confirm and fire the pending order, if there is one and it is paid.
 *
 * Runs on any page load (from AnalyticsProvider), because after paying on
 * Shopify the customer may land anywhere on the site — or nowhere, which is
 * the documented limitation above.
 *
 * A pending order that is confirmed NOT paid is left pending: the webhook
 * may simply not have arrived yet. It is only cleared once it is paid, or
 * once the server says it does not exist for this session.
 */
export async function confirmPendingPurchase(): Promise<{ fired: boolean; order?: ConfirmedPurchase }> {
  const orderId = readPendingOrder();
  if (!orderId) return { fired: false };

  const order = await fetchOrderConfirmation(orderId);
  if (!order) {
    // Unknown to this session — a cleared cookie, a different browser
    // profile, or a purged order. Keeping it pending would retry forever.
    clearPendingOrder();
    return { fired: false };
  }
  if (!order.paid) return { fired: false, order };

  clearPendingOrder();
  const result = firePurchase(order);
  return { fired: result.fired, order };
}
