import { createHmac } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { POST as reconcileRoute } from "@/app/api/admin/commerce/reconcile/route";
import { POST as webhookRoute } from "@/app/api/webhooks/shopify/route";
import { PRODUCTS } from "@/config/products";
import { runShopifyReconciliation } from "@/lib/commerce/reconciliation";
import { orderIdFromGid, type ShopifyOrderReader } from "@/lib/commerce/shopify-orders";
import { createOrder, getOrder } from "@/lib/data/order-service";
import { listReconciliationRuns } from "@/lib/data/reconciliation-run-service";
import { getDb } from "@/db/client";
import { events } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";
import { makeSession, resetDb } from "./db-helpers";
import type { SessionRow } from "@/lib/data/session-service";

/**
 * Production Launch Session 03 §24–§28, §63 — lost-webhook recovery.
 *
 * The one property that makes this feature safe rather than dangerous:
 * repairing is IDEMPOTENT. A sweep over orders that webhooks already handled
 * must change nothing at all — no duplicate purchase event, no duplicate
 * revenue, no re-derived attribution.
 *
 * NO NETWORK: the Shopify reader is injected.
 */

const SECRET = "whsec_recon";
const product = PRODUCTS[0];
let savedSecret: string | undefined;

beforeEach(async () => {
  savedSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  process.env.SHOPIFY_WEBHOOK_SECRET = SECRET;
  process.env.ADMIN_USER = "owner";
  process.env.ADMIN_PASSWORD = "correct-horse";
  await resetDb();
  __resetRateLimitsForTests();
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.SHOPIFY_WEBHOOK_SECRET;
  else process.env.SHOPIFY_WEBHOOK_SECRET = savedSecret;
  delete process.env.ADMIN_USER;
  delete process.env.ADMIN_PASSWORD;
  vi.unstubAllGlobals();
});

async function pendingOrder(session: SessionRow) {
  const { order } = await createOrder({
    sessionId: session.id,
    provider: "shopify",
    currency: "USD",
    status: "pending_payment",
    attribution: { utm_source: "google", utm_campaign: "launch" },
    lines: [
      {
        productId: product.id,
        quantity: 5000,
        unitPriceCents: 42,
        totalCents: 210_000,
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

function readerFor(
  orders: {
    providerOrderId: string;
    bagdirectOrderId: string | null;
    financialStatus?: string | null;
    cancelledAt?: Date | null;
    refundedTotalCents?: number;
  }[],
  opts: { truncated?: boolean } = {},
): ShopifyOrderReader {
  return async () => ({
    truncated: opts.truncated ?? false,
    orders: orders.map((o) => ({
      providerOrderId: o.providerOrderId,
      gid: `gid://shopify/Order/${o.providerOrderId}`,
      name: `#${o.providerOrderId}`,
      createdAt: new Date(),
      cancelledAt: o.cancelledAt ?? null,
      financialStatus: o.financialStatus ?? "paid",
      currency: "USD",
      totalCents: 210_000,
      refundedTotalCents: o.refundedTotalCents ?? 0,
      bagdirectOrderId: o.bagdirectOrderId,
    })),
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

/** How many first-party events of a given name exist right now. */
async function countEventsByName(name: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.name, name));
  return Number(row?.count ?? 0);
}

/* ------------------------------------------------------------------ */

describe("a missed webhook is repaired (§24, §63)", () => {
  it("marks an unpaid-but-actually-paid order paid, and fires purchase_completed ONCE", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);

    const result = await runShopifyReconciliation({
      reader: readerFor([{ providerOrderId: "5001", bagdirectOrderId: order.id }]),
      triggeredBy: "admin:test",
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("unreachable");
    expect(result.ordersInspected).toBe(1);
    expect(result.repairsPerformed).toBe(1);

    const record = await getOrder(order.id);
    expect(record?.order.status).toBe("paid");
    expect(record?.order.paidAt).not.toBeNull();
    expect(record?.order.providerOrderId).toBe("5001");
    expect(await countEventsByName("purchase_completed")).toBe(1);
  });

  it("repairs a cancellation the webhook never delivered", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    const cancelledAt = new Date("2026-08-15T12:00:00Z");

    await runShopifyReconciliation({
      reader: readerFor([
        { providerOrderId: "5002", bagdirectOrderId: order.id, financialStatus: "voided", cancelledAt },
      ]),
      triggeredBy: "admin:test",
    });

    const record = await getOrder(order.id);
    expect(record?.order.status).toBe("cancelled");
    // A voided order was never paid: no purchase may be invented for it.
    expect(await countEventsByName("purchase_completed")).toBe(0);
  });

  it("repairs a refund the webhook never delivered", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);

    await runShopifyReconciliation({
      reader: readerFor([
        { providerOrderId: "5003", bagdirectOrderId: order.id, financialStatus: "refunded", refundedTotalCents: 210_000 },
      ]),
      triggeredBy: "admin:test",
    });

    const record = await getOrder(order.id);
    expect(record?.order.refundedTotalCents).toBe(210_000);
    expect(record?.order.status).toBe("refunded");
  });
});

describe("idempotence is the safety property (§28, §63)", () => {
  it("an order the WEBHOOK already handled is left completely alone", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await webhookRoute(paidWebhook("5010", order.id));

    const before = await getOrder(order.id);
    const result = await runShopifyReconciliation({
      reader: readerFor([{ providerOrderId: "5010", bagdirectOrderId: order.id }]),
      triggeredBy: "admin:test",
    });

    if (result.status !== "success") throw new Error("unreachable");
    expect(result.repairsPerformed).toBe(0);
    expect(result.alreadyConsistent).toBe(1);

    const after = await getOrder(order.id);
    expect(after?.order.status).toBe(before?.order.status);
    expect(after?.order.paidAt?.toISOString()).toBe(before?.order.paidAt?.toISOString());
    expect(after?.order.attributionJson).toEqual(before?.order.attributionJson);
    expect(await countEventsByName("purchase_completed")).toBe(1);
  });

  it("running the sweep TWICE produces no duplicate of anything", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    const reader = readerFor([
      { providerOrderId: "5011", bagdirectOrderId: order.id, refundedTotalCents: 50_000 },
    ]);

    const first = await runShopifyReconciliation({ reader, triggeredBy: "admin:test" });
    const second = await runShopifyReconciliation({ reader, triggeredBy: "admin:test" });

    if (first.status !== "success" || second.status !== "success") throw new Error("unreachable");
    expect(first.repairsPerformed).toBe(1);
    expect(second.repairsPerformed).toBe(0);

    const record = await getOrder(order.id);
    // The refund total was SET to the provider's cumulative figure, not added
    // twice — the failure mode a naive implementation would have.
    expect(record?.order.refundedTotalCents).toBe(50_000);
    expect(await countEventsByName("purchase_completed")).toBe(1);
  });

  it("a webhook arriving AFTER a repair still changes nothing", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await runShopifyReconciliation({
      reader: readerFor([{ providerOrderId: "5012", bagdirectOrderId: order.id }]),
      triggeredBy: "admin:test",
    });
    const res = await webhookRoute(paidWebhook("5012", order.id));
    expect(res.status).toBe(200);
    expect(await countEventsByName("purchase_completed")).toBe(1);
  });
});

describe("orders that are not ours are never fabricated (§25)", () => {
  it("reports an admin-created Shopify order as unmatched and creates nothing", async () => {
    const result = await runShopifyReconciliation({
      reader: readerFor([{ providerOrderId: "6001", bagdirectOrderId: null }]),
      triggeredBy: "admin:test",
    });
    if (result.status !== "success") throw new Error("unreachable");
    expect(result.unmatched).toBe(1);
    expect(result.repairsPerformed).toBe(0);
    expect(await countEventsByName("purchase_completed")).toBe(0);
  });
});

describe("run records tell the truth (§27, §63)", () => {
  it("records the range, counts and status", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    await runShopifyReconciliation({
      lookbackHours: 24,
      reader: readerFor([{ providerOrderId: "7001", bagdirectOrderId: order.id }]),
      triggeredBy: "admin:owner",
    });

    const [run] = await listReconciliationRuns();
    expect(run.status).toBe("success");
    expect(run.ordersInspected).toBe(1);
    expect(run.repairsPerformed).toBe(1);
    expect(run.triggeredBy).toBe("admin:owner");
    expect(run.rangeEnd.getTime() - run.rangeStart.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(run.completedAt).not.toBeNull();
  });

  it("a Shopify read failure is FAILED, never an empty success", async () => {
    const result = await runShopifyReconciliation({
      reader: async () => {
        throw new Error("403 access denied: read_orders scope missing");
      },
      triggeredBy: "admin:test",
    });

    expect(result.status).toBe("failed");
    const [run] = await listReconciliationRuns();
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("PROVIDER_READ_FAILED");
    expect(run.ordersInspected).toBe(0);
  });

  it("a truncated window is reported as PARTIAL, never silently narrowed", async () => {
    const session = await makeSession();
    const order = await pendingOrder(session);
    const result = await runShopifyReconciliation({
      reader: readerFor([{ providerOrderId: "7002", bagdirectOrderId: order.id }], { truncated: true }),
      triggeredBy: "admin:test",
    });
    expect(result.status).toBe("partial");
    const [run] = await listReconciliationRuns();
    expect(run.truncated).toBe(true);
  });

  it("one failing order does not abort the sweep", async () => {
    const session = await makeSession();
    const good = await pendingOrder(session);
    const result = await runShopifyReconciliation({
      reader: readerFor([
        // A malformed correlation id fails to resolve and is unmatched, not fatal.
        { providerOrderId: "7003", bagdirectOrderId: "ord_missing" },
        { providerOrderId: "7004", bagdirectOrderId: good.id },
      ]),
      triggeredBy: "admin:test",
    });
    if (result.status !== "success") throw new Error("unreachable");
    expect(result.ordersInspected).toBe(2);
    expect(result.repairsPerformed).toBe(1);
    expect(result.unmatched).toBe(1);
  });
});

describe("the admin operation is guarded", () => {
  const body = JSON.stringify({ lookbackHours: 24 });
  const authHeader = `Basic ${Buffer.from("owner:correct-horse").toString("base64")}`;

  it("refuses an unauthenticated call", async () => {
    const res = await reconcileRoute(
      new Request("http://localhost/api/admin/commerce/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body,
      }),
    );
    expect(res.status).toBe(401);
  });

  it("refuses a cross-origin call even with valid credentials", async () => {
    const res = await reconcileRoute(
      new Request("http://localhost/api/admin/commerce/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example", authorization: authHeader },
        body,
      }),
    );
    expect(res.status).toBe(403);
  });

  it("reports NOT_CONFIGURED rather than failing when Shopify is absent", async () => {
    const res = await reconcileRoute(
      new Request("http://localhost/api/admin/commerce/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", authorization: authHeader },
        body,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.code).toBe("NOT_CONFIGURED");
  });
});

describe("the order reader is structurally read-only (§25)", () => {
  it("extracts the numeric id webhooks use from a GID", () => {
    expect(orderIdFromGid("gid://shopify/Order/12345")).toBe("12345");
  });
});
