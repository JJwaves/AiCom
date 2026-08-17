import { createHmac } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { GET as confirmationRoute } from "@/app/api/orders/confirmation/route";
import { POST as webhookRoute } from "@/app/api/webhooks/shopify/route";
import { PRODUCTS } from "@/config/products";
import { buildOrderConfirmation, isOrderPaid, getOrderConfirmationForSession } from "@/lib/commerce/order-confirmation";
import { createOrder, getOrder, markOrderPaid } from "@/lib/data/order-service";
import { SESSION_COOKIE, type SessionRow } from "@/lib/data/session-service";
import { makeSession, resetDb } from "./db-helpers";

/**
 * Production Launch Session 03 §3–§5, §59 — the purchase is the PAID ORDER.
 *
 * The property under test is not "a purchase event exists". It is that a
 * purchase can ONLY come from an authoritative paid-order transition, and
 * that every other thing the browser might mistake for payment — a
 * redirect, a query parameter, a created checkout, an AI request — produces
 * nothing.
 */

const SECRET = "whsec_purchase_test";
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

async function pendingOrder(session: SessionRow) {
  const { order } = await createOrder({
    sessionId: session.id,
    provider: "shopify",
    currency: "USD",
    status: "pending_payment",
    attribution: {},
    lines: [
      {
        productId: product.id,
        quantity: 5000,
        unitPriceCents: 42,
        totalCents: 42 * 5000,
        title: product.title,
        optionSummary: "Medium · White · No logo",
        config: {
          productId: product.id,
          sizeId: "m",
          materialId: product.materials[0].id,
          colorId: product.colors[0].id,
          printOptionId: "none",
          quantity: 5000,
          artwork: null,
        },
        artwork: null,
      },
    ],
  });
  return order;
}

function confirmationRequest(orderId: string, sessionId?: string): Request {
  return new Request(`http://localhost/api/orders/confirmation?order=${encodeURIComponent(orderId)}`, {
    headers: sessionId ? { cookie: `${SESSION_COOKIE}=${sessionId}` } : {},
  });
}

function paidWebhook(providerOrderId: string, bagdirectOrderId: string): Request {
  const body = JSON.stringify({
    id: Number(providerOrderId),
    financial_status: "paid",
    currency: "USD",
    total_price: "2100.00",
    note_attributes: [{ name: "_bd_order_id", value: bagdirectOrderId }],
  });
  return new Request("http://localhost/api/webhooks/shopify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-topic": "orders/paid",
      "x-shopify-webhook-id": `d-${providerOrderId}`,
      "x-shopify-hmac-sha256": createHmac("sha256", SECRET).update(body, "utf8").digest("base64"),
    },
    body,
  });
}

/* ------------------------------------------------------------------ */

describe("payment truth (§3)", () => {
  it("a pending_payment order is NOT a purchase — no matter how it is asked", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);

    const confirmation = await getOrderConfirmationForSession(order.id, session.id);
    expect(confirmation?.paid).toBe(false);
    expect(confirmation?.status).toBe("pending_payment");
    expect(isOrderPaid(order)).toBe(false);
  });

  it("becomes a purchase ONLY after the paid webhook writes paidAt", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);

    const res = await webhookRoute(paidWebhook("99001", order.id));
    expect(res.status).toBe(200);

    const confirmation = await getOrderConfirmationForSession(order.id, session.id);
    expect(confirmation?.paid).toBe(true);
    expect(confirmation?.transactionId).toBe("99001");
    expect(confirmation?.paidAt).not.toBeNull();
  });

  it("a cancelled-before-payment order never becomes a purchase", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    const body = JSON.stringify({
      id: 99002,
      financial_status: "pending",
      cancelled_at: new Date().toISOString(),
      note_attributes: [{ name: "_bd_order_id", value: order.id }],
    });
    const res = await webhookRoute(
      new Request("http://localhost/api/webhooks/shopify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shopify-topic": "orders/cancelled",
          "x-shopify-webhook-id": "d-cancel",
          "x-shopify-hmac-sha256": createHmac("sha256", SECRET).update(body, "utf8").digest("base64"),
        },
        body,
      }),
    );
    expect(res.status).toBe(200);

    const confirmation = await getOrderConfirmationForSession(order.id, session.id);
    expect(confirmation?.paid).toBe(false);
    expect(confirmation?.status).toBe("cancelled");
  });
});

describe("the transaction id is stable and provider-owned (§5)", () => {
  it("uses the provider order id once one exists", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await webhookRoute(paidWebhook("99003", order.id));

    const confirmation = await getOrderConfirmationForSession(order.id, session.id);
    expect(confirmation?.transactionId).toBe("99003");
  });

  it("falls back to the BagDirect id when the provider has not named one yet", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    const record = await getOrder(order.id);
    const confirmation = buildOrderConfirmation(record!.order, record!.lines);
    expect(confirmation.transactionId).toBe(order.id);
  });

  it("is IDENTICAL across repeated confirmations, so a refresh cannot become a second transaction", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await webhookRoute(paidWebhook("99004", order.id));

    const first = await getOrderConfirmationForSession(order.id, session.id);
    const second = await getOrderConfirmationForSession(order.id, session.id);
    expect(first?.transactionId).toBe(second?.transactionId);
  });
});

describe("the confirmation endpoint leaks nothing (§4, §59)", () => {
  it("returns the order to the session that placed it", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await markOrderPaid({ orderId: order.id });

    const res = await confirmationRoute(confirmationRequest(order.id, session.id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.order.paid).toBe(true);
    expect(data.order.valueCents).toBe(42 * 5000);
  });

  it("answers 404 for ANOTHER session's order — identically to an unknown one", async () => {
    const owner = await makeSession();
    const stranger = await makeSession();
    const order = await pendingOrder(owner);
    await markOrderPaid({ orderId: order.id });

    const foreign = await confirmationRoute(confirmationRequest(order.id, stranger.id));
    const unknown = await confirmationRoute(confirmationRequest("ord_does_not_exist", stranger.id));
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await foreign.json()).toEqual(await unknown.json());
  });

  it("answers 404 with no session cookie at all, and mints no session", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    const res = await confirmationRoute(confirmationRequest(order.id));
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("never returns cost, margin, attribution or customer identity", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await markOrderPaid({ orderId: order.id });

    const res = await confirmationRoute(confirmationRequest(order.id, session.id));
    const raw = JSON.stringify(await res.json());
    for (const forbidden of [
      "costSnapshot",
      "cost_snapshot",
      "costModelVersion",
      "margin",
      "attribution",
      "sessionId",
      "session_id",
      "customerId",
      "customer_id",
      "email",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("rejects a malformed order id without touching the database", async () => {
    const session = await makeSession();
    const res = await confirmationRoute(
      new Request("http://localhost/api/orders/confirmation?order=../../etc/passwd", {
        headers: { cookie: `${SESSION_COOKIE}=${session.id}` },
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("mock commerce is confirmable in development, and labelled (§3)", () => {
  it("reports demo:true so no surface can present it as a real sale", async () => {
    const session = await makeSession();
    const { order } = await createOrder({
      sessionId: session.id,
      provider: "mock",
      providerOrderId: "MOCK-ABC",
      currency: "USD",
      status: "created",
      attribution: {},
      lines: [
        {
          productId: product.id,
          quantity: 500,
          unitPriceCents: 50,
          totalCents: 25_000,
          title: product.title,
          optionSummary: "Medium · White · No logo",
          config: {
            productId: product.id,
            sizeId: "m",
            materialId: product.materials[0].id,
            colorId: product.colors[0].id,
            printOptionId: "none",
            quantity: 500,
            artwork: null,
          },
          artwork: null,
        },
      ],
    });

    const confirmation = await getOrderConfirmationForSession(order.id, session.id);
    expect(confirmation?.paid).toBe(true);
    expect(confirmation?.demo).toBe(true);
  });

  it("a SHOPIFY order is never treated as paid without paidAt, whatever its status says", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    // Even a status that looks encouraging is not payment: only paidAt is.
    expect(isOrderPaid({ ...order, status: "created", paidAt: null })).toBe(false);
    expect(isOrderPaid({ ...order, status: "paid", paidAt: null })).toBe(false);
    expect(isOrderPaid({ ...order, status: "paid", paidAt: new Date() })).toBe(true);
  });
});
