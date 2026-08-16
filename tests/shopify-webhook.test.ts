import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/shopify/route";
import { getDb } from "@/db/client";
import { events, orders } from "@/db/schema";
import { createOrder, getOrder } from "@/lib/data/order-service";
import { verifyShopifyWebhook } from "@/lib/commerce/webhook-verify";
import { moneyStringToCents, parseShopifyOrder, parseShopifyRefund } from "@/lib/commerce/shopify-webhook-payload";
import { PRODUCTS } from "@/config/products";
import { makeSession, resetDb } from "./db-helpers";
import type { SessionRow } from "@/lib/data/session-service";

/**
 * Production Launch Session 02 §13–§19, §55 — Shopify → BagDirect order truth.
 *
 * Two properties are load-bearing and both are tested as PROPERTIES, not as
 * happy paths:
 *   1. NO DATABASE WRITE happens before the HMAC is verified.
 *   2. Replaying any delivery changes nothing — no duplicate order, no
 *      duplicate revenue, no duplicate purchase event.
 */

const SECRET = "whsec_test_secret";
const product = PRODUCTS[0];

let saved: string | undefined;

beforeEach(async () => {
  saved = process.env.SHOPIFY_WEBHOOK_SECRET;
  process.env.SHOPIFY_WEBHOOK_SECRET = SECRET;
  await resetDb();
});

afterEach(() => {
  if (saved === undefined) delete process.env.SHOPIFY_WEBHOOK_SECRET;
  else process.env.SHOPIFY_WEBHOOK_SECRET = saved;
});

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function webhookRequest(topic: string, payload: unknown, opts: { signature?: string | null; deliveryId?: string } = {}) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-shopify-topic": topic,
    "x-shopify-shop-domain": "bagdirect-test.myshopify.com",
    "x-shopify-webhook-id": opts.deliveryId ?? "delivery-1",
  };
  const signature = opts.signature === undefined ? sign(body) : opts.signature;
  if (signature !== null) headers["x-shopify-hmac-sha256"] = signature;
  return new Request("http://localhost/api/webhooks/shopify", { method: "POST", headers, body });
}

/** A pending_payment order exactly as /api/checkout creates one. */
async function pendingOrder(session: SessionRow, overrides: { quantity?: number } = {}) {
  const { order } = await createOrder({
    sessionId: session.id,
    provider: "shopify",
    currency: "USD",
    status: "pending_payment",
    attribution: { utm_source: "google" },
    lines: [
      {
        productId: product.id,
        quantity: overrides.quantity ?? 5000,
        unitPriceCents: 42,
        totalCents: 42 * (overrides.quantity ?? 5000),
        title: product.title,
        optionSummary: "Medium · White · No logo",
        config: {
          productId: product.id,
          sizeId: "m",
          materialId: "standard",
          colorId: "white",
          printOptionId: "none",
          quantity: overrides.quantity ?? 5000,
        },
      },
    ],
  });
  return order;
}

function shopifyOrderPayload(bagdirectOrderId: string | null, over: Record<string, unknown> = {}) {
  return {
    id: 5001,
    name: "#1001",
    currency: "USD",
    total_price: "2100.00",
    financial_status: "paid",
    note_attributes: [
      ...(bagdirectOrderId ? [{ name: "_bd_order_id", value: bagdirectOrderId }] : []),
      { name: "_bd_session_id", value: "ses_x" },
      { name: "_bd_attr_utm_source", value: "google" },
    ],
    ...over,
  };
}

async function purchaseEventCount(orderId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select().from(events).where(eq(events.orderId, orderId));
  return rows.filter((r) => r.name === "purchase_completed").length;
}

/* ------------------------------------------------------------------ */
/* HMAC                                                                */
/* ------------------------------------------------------------------ */

describe("HMAC verification (§14)", () => {
  it("accepts a correct signature over the RAW body", () => {
    const body = '{"id":1,"a":"b"}';
    expect(verifyShopifyWebhook({ rawBody: body, signatureHeader: sign(body), secret: SECRET })).toEqual({ valid: true });
  });

  it("rejects a signature computed over re-serialized JSON — parse-then-stringify changes the bytes", () => {
    // This is exactly the bug the route's read-raw-body-first ordering
    // prevents: Shopify signs the bytes it sent, whitespace included.
    const body = '{\n  "id": 1,\n  "total_price": "10.00"\n}';
    const reserialized = JSON.stringify(JSON.parse(body));
    expect(reserialized).not.toBe(body);
    const result = verifyShopifyWebhook({ rawBody: body, signatureHeader: sign(reserialized), secret: SECRET });
    expect(result.valid).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const body = '{"id":1}';
    const result = verifyShopifyWebhook({ rawBody: body, signatureHeader: sign(body, "other"), secret: SECRET });
    expect(result).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("rejects a missing signature", () => {
    expect(verifyShopifyWebhook({ rawBody: "{}", signatureHeader: null, secret: SECRET })).toEqual({
      valid: false,
      reason: "missing_signature",
    });
  });

  it("rejects (never throws on) a malformed signature of the wrong length", () => {
    expect(verifyShopifyWebhook({ rawBody: "{}", signatureHeader: "not-base64!!", secret: SECRET })).toEqual({
      valid: false,
      reason: "malformed_signature",
    });
  });

  it("fails CLOSED with no secret configured", () => {
    expect(verifyShopifyWebhook({ rawBody: "{}", signatureHeader: sign("{}"), secret: null })).toEqual({
      valid: false,
      reason: "missing_secret",
    });
  });

  it("rejects a tampered body even when the signature was valid for the original", () => {
    const original = '{"id":1,"total_price":"10.00"}';
    const signature = sign(original);
    const tampered = '{"id":1,"total_price":"0.01"}';
    expect(verifyShopifyWebhook({ rawBody: tampered, signatureHeader: signature, secret: SECRET }).valid).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Route-level: verification precedes every side effect                */
/* ------------------------------------------------------------------ */

describe("no side effect precedes verification (§14, §58)", () => {
  it("answers 401 on a bad signature and writes NOTHING", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);

    const res = await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id), { signature: "aaaa" }));
    expect(res.status).toBe(401);

    const after = await getOrder(order.id);
    expect(after?.order.status).toBe("pending_payment");
    expect(await purchaseEventCount(order.id)).toBe(0);
  });

  it("answers 401 with no signature header at all", async () => {
    const res = await POST(webhookRequest("orders/paid", shopifyOrderPayload(null), { signature: null }));
    expect(res.status).toBe(401);
  });

  it("fails closed with 503 when SHOPIFY_WEBHOOK_SECRET is unset", async () => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
    const session = await makeSession();
    const order = await pendingOrder(session);
    const res = await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id)));
    expect(res.status).toBe(503);
    expect((await getOrder(order.id))?.order.status).toBe("pending_payment");
  });

  it("acknowledges an unknown topic without processing it", async () => {
    const res = await POST(webhookRequest("customers/create", { id: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: false });
  });

  it("acknowledges a malformed body rather than making Shopify retry for 48 hours", async () => {
    const body = "{not json";
    const req = new Request("http://localhost/api/webhooks/shopify", {
      method: "POST",
      headers: {
        "x-shopify-topic": "orders/paid",
        "x-shopify-hmac-sha256": sign(body),
      },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: false });
  });

  it("acknowledges a payload with no identifiers", async () => {
    const res = await POST(webhookRequest("orders/paid", { name: "#1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: false });
  });
});

/* ------------------------------------------------------------------ */
/* Paid order truth                                                    */
/* ------------------------------------------------------------------ */

describe("orders/paid is the authoritative purchase moment (§19)", () => {
  it("marks the order paid and fires purchase_completed ONCE", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);

    const res = await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id)));
    expect(res.status).toBe(200);

    const after = await getOrder(order.id);
    expect(after?.order.status).toBe("paid");
    expect(after?.order.providerOrderId).toBe("5001");
    expect(after?.order.paidAt).toBeTruthy();
    expect(await purchaseEventCount(order.id)).toBe(1);
  });

  it("keeps the BagDirect subtotal as the order total — Shopify's grand total (shipping + tax) is not copied over it", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await POST(
      webhookRequest("orders/paid", shopifyOrderPayload(order.id, { total_price: "2350.00" })),
    );
    const after = await getOrder(order.id);
    expect(after?.order.totalCents).toBe(42 * 5000);
  });

  it("preserves first-party attribution recorded at checkout (§40)", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id)));
    const after = await getOrder(order.id);
    expect(after?.order.attributionJson).toEqual({ utm_source: "google" });
  });

  it("marks the session converted", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id)));
    const db = await getDb();
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("paid");
  });

  it("reconciles a MULTI-LINE order without duplicating anything", async () => {
    const session = await makeSession();
    const { order } = await createOrder({
      sessionId: session.id,
      provider: "shopify",
      currency: "USD",
      status: "pending_payment",
      lines: [1000, 2000].map((qty, i) => ({
        productId: product.id,
        quantity: qty,
        unitPriceCents: 50,
        totalCents: 50 * qty,
        title: product.title,
        optionSummary: `line ${i}`,
        config: {
          productId: product.id,
          sizeId: "m",
          materialId: "standard",
          colorId: i === 0 ? "white" : "black",
          printOptionId: "none",
          quantity: qty,
        },
      })),
    });

    await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id)));
    const after = await getOrder(order.id);
    expect(after?.lines).toHaveLength(2);
    expect(after?.order.totalCents).toBe(50 * 3000);
    expect(await purchaseEventCount(order.id)).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Idempotency / replay                                                */
/* ------------------------------------------------------------------ */

describe("replay is a no-op (§15)", () => {
  it("a repeated orders/paid does not duplicate the purchase event or the revenue", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);

    const first = await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id)));
    const second = await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id)));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });

    expect(await purchaseEventCount(order.id)).toBe(1);
    const db = await getDb();
    expect(await db.select().from(orders).where(eq(orders.id, order.id))).toHaveLength(1);
  });

  it("a MANUAL re-send (new delivery id, same order) is still a no-op", async () => {
    // This is why the idempotency key is the SUBJECT id, not the delivery id.
    const session = await makeSession();
    const order = await pendingOrder(session);
    await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id), { deliveryId: "delivery-1" }));
    const resend = await POST(
      webhookRequest("orders/paid", shopifyOrderPayload(order.id), { deliveryId: "delivery-999" }),
    );
    expect(await resend.json()).toMatchObject({ duplicate: true });
    expect(await purchaseEventCount(order.id)).toBe(1);
  });

  it("orders/create followed by orders/paid records the purchase exactly once", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);

    await POST(webhookRequest("orders/create", shopifyOrderPayload(order.id)));
    expect(await purchaseEventCount(order.id)).toBe(1);

    await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id)));
    expect(await purchaseEventCount(order.id)).toBe(1);
    expect((await getOrder(order.id))?.order.status).toBe("paid");
  });

  it("orders/create for an UNPAID order links it but does not report a purchase", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await POST(
      webhookRequest("orders/create", shopifyOrderPayload(order.id, { financial_status: "pending" })),
    );
    const after = await getOrder(order.id);
    expect(after?.order.status).toBe("pending_payment");
    expect(after?.order.providerOrderId).toBe("5001");
    expect(await purchaseEventCount(order.id)).toBe(0);
  });

  it("a paid order with no matching BagDirect order is acknowledged, never fabricated", async () => {
    const res = await POST(webhookRequest("orders/paid", shopifyOrderPayload(null)));
    expect(res.status).toBe(200);
    const db = await getDb();
    expect(await db.select().from(orders)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Cancellation and refunds                                            */
/* ------------------------------------------------------------------ */

describe("cancellation (§46)", () => {
  it("moves a paid order to cancelled so it stops counting as revenue", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id)));

    const res = await POST(
      webhookRequest("orders/cancelled", shopifyOrderPayload(order.id, { cancelled_at: "2026-08-16T10:00:00Z" })),
    );
    expect(res.status).toBe(200);
    const after = await getOrder(order.id);
    expect(after?.order.status).toBe("cancelled");
    expect(after?.order.cancelledAt).toBeTruthy();
  });

  it("is idempotent", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id)));
    await POST(webhookRequest("orders/cancelled", shopifyOrderPayload(order.id)));
    const again = await POST(webhookRequest("orders/cancelled", shopifyOrderPayload(order.id)));
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect((await getOrder(order.id))?.order.status).toBe("cancelled");
  });
});

describe("refunds (§45) — minimal and honest", () => {
  const refundPayload = (refundId: number, amount: string) => ({
    id: refundId,
    order_id: 5001,
    transactions: [{ kind: "refund", status: "success", amount }],
  });

  it("records a PARTIAL refund without changing the order status", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id)));

    await POST(webhookRequest("refunds/create", refundPayload(9001, "100.00")));
    const after = await getOrder(order.id);
    expect(after?.order.refundedTotalCents).toBe(10000);
    expect(after?.order.status).toBe("paid");
  });

  it("moves to refunded once the full amount is returned", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id)));

    await POST(webhookRequest("refunds/create", refundPayload(9001, "2100.00")));
    const after = await getOrder(order.id);
    expect(after?.order.status).toBe("refunded");
    expect(after?.order.refundedTotalCents).toBe(210000);
  });

  it("accumulates SEPARATE partial refunds but ignores a replay of the same one", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await POST(webhookRequest("orders/paid", shopifyOrderPayload(order.id)));

    await POST(webhookRequest("refunds/create", refundPayload(9001, "100.00")));
    await POST(webhookRequest("refunds/create", refundPayload(9001, "100.00"))); // replay
    await POST(webhookRequest("refunds/create", refundPayload(9002, "50.00"))); // different refund

    expect((await getOrder(order.id))?.order.refundedTotalCents).toBe(15000);
  });

  it("acknowledges a refund for an order BagDirect does not know", async () => {
    const res = await POST(webhookRequest("refunds/create", refundPayload(9001, "10.00")));
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* Payload parsing                                                     */
/* ------------------------------------------------------------------ */

describe("payload parsing is exact and defensive", () => {
  it("converts money strings to cents without floating-point error", () => {
    expect(moneyStringToCents("0.29")).toBe(29);
    expect(moneyStringToCents("2100.00")).toBe(210000);
    expect(moneyStringToCents("7")).toBe(700);
    expect(moneyStringToCents("abc")).toBeNull();
    expect(moneyStringToCents(undefined)).toBeNull();
  });

  it("recovers the correlation ids and attribution from note_attributes", () => {
    const parsed = parseShopifyOrder(shopifyOrderPayload("ord_1"));
    expect(parsed?.bagdirectOrderId).toBe("ord_1");
    expect(parsed?.bagdirectSessionId).toBe("ses_x");
    expect(parsed?.attribution).toEqual({ utm_source: "google" });
  });

  it("returns null on a payload with no order id", () => {
    expect(parseShopifyOrder({ name: "#1" })).toBeNull();
    expect(parseShopifyOrder(null)).toBeNull();
  });

  it("sums only SUCCESSFUL refund transactions", () => {
    const parsed = parseShopifyRefund({
      id: 1,
      order_id: 2,
      transactions: [
        { kind: "refund", status: "success", amount: "10.00" },
        { kind: "refund", status: "failure", amount: "99.00" },
        { kind: "sale", status: "success", amount: "50.00" },
      ],
    });
    expect(parsed?.refundAmountCents).toBe(1000);
  });
});
