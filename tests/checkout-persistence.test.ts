import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST } from "@/app/api/checkout/route";
import { PRODUCTS } from "@/config/products";
import { getDb } from "@/db/client";
import { events, orderLines, orders, productConfigurations, sessions } from "@/db/schema";
import { resetDb } from "./db-helpers";
import { getNeedProfile } from "@/lib/data/customer-need-service";

/**
 * Session-03 half of the checkout contract: a successful mock checkout
 * leaves a queryable first-party record — Order + immutable line snapshots,
 * the authoritative purchase_completed event, conversion stamp, and
 * ORDER_DATA need-profile enrichment. (Validation/re-pricing behavior lives
 * in checkout-route.test.ts and must stay unchanged.)
 */

const product = PRODUCTS[0];

const makeRequest = (body: unknown, cookie?: string): Request =>
  new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

const validBody = {
  lines: [
    {
      lineId: "L1",
      config: {
        productId: product.id,
        sizeId: "m",
        materialId: "standard",
        colorId: "white",
        printOptionId: "none",
        quantity: 5000,
        artwork: null,
      },
      proposedUnitPriceCents: 42,
      proposedTotalCents: 42 * 5000,
    },
  ],
  attribution: { first_utm_source: "google" },
};

describe("checkout order persistence", () => {
  beforeEach(resetDb);

  it("persists the server-priced order with line snapshots and links", async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(res.headers.getSetCookie().some((c) => c.startsWith("bd_sid=sess_"))).toBe(true);

    const db = await getDb();
    const orderRows = await db.select().from(orders);
    expect(orderRows).toHaveLength(1);
    const order = orderRows[0];
    expect(order.provider).toBe("mock");
    expect(order.providerOrderId).toBe(data.result.orderId);
    expect(order.status).toBe("created");
    expect(order.totalCents).toBe(42 * 5000);
    expect(order.currency).toBe("USD");
    expect(order.aiAssisted).toBe(false);
    expect(order.attributionJson).toEqual({ first_utm_source: "google" });
    expect(order.sessionId).toMatch(/^sess_/);

    const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, order.id));
    expect(lines).toHaveLength(1);
    expect(lines[0].unitPriceCents).toBe(42);
    expect(lines[0].configJson).toEqual(validBody.lines[0].config); // immutable snapshot

    // Authoritative server-side purchase event, linked to the order.
    const [purchase] = await db.select().from(events).where(eq(events.name, "purchase_completed"));
    expect(purchase.orderId).toBe(order.id);
    expect(purchase.sessionId).toBe(order.sessionId);
    expect(purchase.propsJson.totalCents).toBe(42 * 5000);

    // Conversion stamp + checked-out configuration + ORDER_DATA enrichment.
    const [session] = await db.select().from(sessions);
    expect(session.convertedAt).toBeInstanceOf(Date);

    const configs = await db.select().from(productConfigurations);
    expect(configs).toHaveLength(1);
    expect(configs[0].source).toBe("checkout");
    expect(configs[0].priceSnapshotJson?.totalCents).toBe(42 * 5000);

    const profile = await getNeedProfile(session.id);
    expect(profile?.productInterest).toBe(product.id);
    expect(profile?.quantity).toBe(5000);
    expect(profile?.fieldSourcesJson.quantity.source).toBe("ORDER_DATA");
  });

  it("attaches repeat checkouts to the same cookie session", async () => {
    const first = await POST(makeRequest(validBody));
    const sid = first.headers.getSetCookie().find((c) => c.startsWith("bd_sid="))!.split(";")[0];
    const second = await POST(makeRequest(validBody, sid));
    expect(second.status).toBe(200);

    const db = await getDb();
    expect(await db.select().from(sessions)).toHaveLength(1);
    const orderRows = await db.select().from(orders);
    expect(orderRows).toHaveLength(2);
    expect(orderRows[0].sessionId).toBe(orderRows[1].sessionId);
  });

  it("persists nothing when the checkout is rejected", async () => {
    const tampered = {
      ...validBody,
      lines: [{ ...validBody.lines[0], proposedUnitPriceCents: 1, proposedTotalCents: 5000 }],
    };
    expect((await POST(makeRequest(tampered))).status).toBe(409);

    const db = await getDb();
    expect(await db.select().from(orders)).toHaveLength(0);
    expect(await db.select().from(events)).toHaveLength(0);
  });
});
