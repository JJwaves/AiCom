/**
 * Shopify webhook payload parsing (Production Launch Session 02 §13).
 *
 * Parsed defensively, as untrusted input, even AFTER the HMAC proves it came
 * from Shopify: a valid signature proves origin, not shape. Missing fields
 * produce a typed "cannot process" rather than an exception, so a payload
 * change on Shopify's side becomes a logged, retryable failure instead of a
 * 500 that Shopify retries forever.
 *
 * Money on the wire is a decimal STRING ("42.00"). It is converted to
 * integer cents exactly once, here, and never with floating-point
 * arithmetic — `parseFloat("0.29") * 100` is 28.999999999999996.
 */

export type ShopifyOrderPayload = {
  /** Shopify's numeric order id, as a string. The reconciliation identity. */
  providerOrderId: string;
  /** Human-facing order name, e.g. "#1001". */
  name: string | null;
  currency: string | null;
  totalCents: number | null;
  financialStatus: string | null;
  cancelledAt: Date | null;
  /** `_bd_order_id` from the draft order's custom attributes — our correlation key. */
  bagdirectOrderId: string | null;
  bagdirectSessionId: string | null;
  /** Attribution recovered from `_bd_attr_*` note attributes (§40). */
  attribution: Record<string, string>;
};

export type ShopifyRefundPayload = {
  /** Shopify refund id — the idempotency subject for refunds/create. */
  refundId: string;
  providerOrderId: string;
  refundAmountCents: number;
};

/** Decimal money string → integer cents, exactly. Returns null on anything unexpected. */
export function moneyStringToCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Shopify sends strings; a number here is a wire-format surprise worth
    // handling but not trusting to float arithmetic.
    return Math.round(value * 100);
  }
  if (typeof value !== "string") return null;
  const match = /^-?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const sign = value.trim().startsWith("-") ? -1 : 1;
  const whole = Number(match[1]);
  const frac = (match[2] ?? "").slice(0, 2).padEnd(2, "0");
  return sign * (whole * 100 + Number(frac));
}

type Attribute = { name?: unknown; value?: unknown; key?: unknown };

function readAttributes(raw: unknown): { name: string; value: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { name: string; value: string }[] = [];
  for (const entry of raw as Attribute[]) {
    // Order note_attributes use {name, value}; line-item properties and cart
    // attributes use {name,value} or {key,value} depending on the surface.
    const name = typeof entry?.name === "string" ? entry.name : typeof entry?.key === "string" ? entry.key : null;
    if (!name) continue;
    out.push({ name, value: typeof entry.value === "string" ? entry.value : String(entry?.value ?? "") });
  }
  return out;
}

const BD_ATTR_PREFIX = "_bd_attr_";

export function parseShopifyOrder(payload: unknown): ShopifyOrderPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;

  const rawId = body.id;
  const providerOrderId =
    typeof rawId === "number" ? String(rawId) : typeof rawId === "string" && rawId.length > 0 ? rawId : null;
  if (!providerOrderId) return null;

  const attributes = readAttributes(body.note_attributes);
  const attribution: Record<string, string> = {};
  let bagdirectOrderId: string | null = null;
  let bagdirectSessionId: string | null = null;
  for (const { name, value } of attributes) {
    if (name === "_bd_order_id") bagdirectOrderId = value || null;
    else if (name === "_bd_session_id") bagdirectSessionId = value || null;
    else if (name.startsWith(BD_ATTR_PREFIX)) attribution[name.slice(BD_ATTR_PREFIX.length)] = value;
  }

  const cancelledRaw = body.cancelled_at;
  const cancelledAt = typeof cancelledRaw === "string" ? new Date(cancelledRaw) : null;

  return {
    providerOrderId,
    name: typeof body.name === "string" ? body.name : null,
    currency: typeof body.currency === "string" ? body.currency : null,
    totalCents: moneyStringToCents(body.total_price),
    financialStatus: typeof body.financial_status === "string" ? body.financial_status : null,
    cancelledAt: cancelledAt && !Number.isNaN(cancelledAt.getTime()) ? cancelledAt : null,
    bagdirectOrderId,
    bagdirectSessionId,
    attribution,
  };
}

export function parseShopifyRefund(payload: unknown): ShopifyRefundPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;

  const rawId = body.id;
  const refundId = typeof rawId === "number" ? String(rawId) : typeof rawId === "string" ? rawId : null;
  const rawOrderId = body.order_id;
  const providerOrderId =
    typeof rawOrderId === "number" ? String(rawOrderId) : typeof rawOrderId === "string" ? rawOrderId : null;
  if (!refundId || !providerOrderId) return null;

  // A Shopify refund's amount lives in its transactions. Summing them is the
  // only honest total: `refund_line_items` excludes shipping and manual
  // adjustments, so it would systematically under-report.
  let refundAmountCents = 0;
  if (Array.isArray(body.transactions)) {
    for (const tx of body.transactions as Record<string, unknown>[]) {
      if (tx?.kind !== "refund") continue;
      if (typeof tx?.status === "string" && tx.status !== "success") continue;
      refundAmountCents += moneyStringToCents(tx?.amount) ?? 0;
    }
  }

  return { refundId, providerOrderId, refundAmountCents: Math.max(0, refundAmountCents) };
}

/** Shopify financial statuses that mean money has actually been captured. */
const PAID_FINANCIAL_STATUSES = new Set(["paid", "partially_refunded", "refunded"]);

export function isPaidFinancialStatus(status: string | null): boolean {
  return status !== null && PAID_FINANCIAL_STATUSES.has(status);
}
