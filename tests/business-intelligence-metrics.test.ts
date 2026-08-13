import { beforeEach, describe, expect, it } from "vitest";
import { BUSINESS_INTELLIGENCE } from "@/config/business-intelligence";
import { applyNeedProfileUpdate } from "@/lib/data/customer-need-service";
import { recordServerEvent } from "@/lib/data/event-service";
import { createOrder } from "@/lib/data/order-service";
import { getDb } from "@/db/client";
import { orders as ordersTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadConversationCorpus, periodFromDays } from "@/modules/customer-intelligence";
import {
  available,
  buildBusinessHealthSnapshot,
  compareTrend,
  computeAttributionBreakdowns,
  computeRevenueMetrics,
  computeSegmentMetrics,
  loadBusinessFunnel,
  loadPeriodOrders,
  metricValue,
  partial,
  ratio,
  unavailable,
} from "@/modules/business-intelligence";
import { makeSession, resetDb } from "./db-helpers";
import { seedConversation, setConversationOutcome, setSessionFirstTouch } from "./ci-helpers";

/**
 * Session 09 — deterministic business metrics: the availability model,
 * revenue aggregation (multi-line orders never double counted), funnel
 * counts with documented denominators, explicit trend states, segments,
 * and attribution. No model anywhere — every number is a count over rows
 * these tests created.
 */

beforeEach(async () => {
  await resetDb();
});

// End the window slightly in the future: DB rows are stamped with microsecond
// precision, so a same-millisecond JS Date can exclude a just-created row.
const period30 = () => periodFromDays(30, new Date(Date.now() + 60_000));

const config = (quantity: number, overrides: Partial<Record<string, string>> = {}) => ({
  productId: overrides.productId ?? "p-custom-takeout",
  sizeId: overrides.sizeId ?? "l",
  materialId: overrides.materialId ?? "standard",
  colorId: overrides.colorId ?? "black",
  printOptionId: (overrides.printOptionId ?? "one-color") as "none" | "one-color" | "two-color" | "full-custom",
  quantity,
  artwork: null,
});

const line = (quantity: number, totalCents: number, overrides: Partial<Record<string, string>> = {}) => ({
  productId: overrides.productId ?? "p-custom-takeout",
  quantity,
  unitPriceCents: Math.round(totalCents / quantity),
  totalCents,
  title: "Custom bags",
  config: config(quantity, overrides),
});

describe("metric availability model (§3)", () => {
  it("distinguishes AVAILABLE / PARTIAL / UNAVAILABLE and never turns unavailable into zero", () => {
    expect(available(7)).toEqual({ status: "AVAILABLE", value: 7 });
    expect(partial(5, "covers 1 of 2")).toEqual({ status: "PARTIAL", value: 5, reason: "covers 1 of 2" });
    const un = unavailable("missing cost", ["a.b"]);
    expect(un.status).toBe("UNAVAILABLE");
    expect(metricValue(un)).toBeNull(); // null, NEVER 0
    expect(metricValue(available(0))).toBe(0); // a real zero stays zero
  });

  it("suppresses percentages under the minimum denominator", () => {
    expect(ratio(2, 4).percentage).toBeNull();
    expect(ratio(2, BUSINESS_INTELLIGENCE.MIN_DENOMINATOR_FOR_PERCENTAGE).percentage).toBe(40);
  });
});

describe("trend states (§16)", () => {
  it("uses explicit states instead of infinity/noise percentages", () => {
    expect(compareTrend(0, 0).state).toBe("NO_ACTIVITY");
    expect(compareTrend(3, 0).state).toBe("NEW_ACTIVITY");
    expect(compareTrend(3, 0).changePct).toBeNull();
    expect(compareTrend(3, 1).state).toBe("LOW_BASELINE"); // 1 → 3 is NOT "+200%"
    expect(compareTrend(10, 5)).toMatchObject({ state: "TREND", changePct: 100 });
    expect(compareTrend(4, 8)).toMatchObject({ state: "TREND", changePct: -50 });
  });
});

describe("revenue aggregation (§5)", () => {
  it("computes revenue/orders/AOV/units without double counting multi-line orders", async () => {
    const s = await makeSession();
    // One multi-line order: revenue must come from the ORDER total, units from lines.
    await createOrder({
      sessionId: s.id,
      provider: "mock",
      currency: "USD",
      lines: [line(1000, 54_000), line(500, 32_500)],
    });
    await createOrder({
      sessionId: (await makeSession()).id,
      provider: "mock",
      currency: "USD",
      aiAssisted: true,
      lines: [line(2000, 90_000)],
    });

    const { orders, lines } = await loadPeriodOrders(period30());
    const m = computeRevenueMetrics(orders, lines);
    expect(m.currency).toBe("USD");
    expect(m.revenueCents).toEqual({ status: "AVAILABLE", value: 54_000 + 32_500 + 90_000 });
    expect(m.orders).toEqual({ status: "AVAILABLE", value: 2 });
    expect(m.units).toEqual({ status: "AVAILABLE", value: 3500 });
    expect(m.aovCents).toEqual({ status: "AVAILABLE", value: Math.round(176_500 / 2) });
    expect(m.aiAssistedOrders).toEqual({ status: "AVAILABLE", value: 1 });
    expect(m.aiAssistedRevenueCents).toEqual({ status: "AVAILABLE", value: 90_000 });
  });

  it("keeps currencies separate — no combined totals without a conversion model", async () => {
    await createOrder({ sessionId: (await makeSession()).id, provider: "mock", currency: "USD", lines: [line(1000, 54_000)] });
    await createOrder({ sessionId: (await makeSession()).id, provider: "mock", currency: "CAD", lines: [line(1000, 60_000)] });

    const { orders, lines } = await loadPeriodOrders(period30());
    const m = computeRevenueMetrics(orders, lines);
    expect(m.currency).toBeNull();
    expect(m.revenueCents.status).toBe("UNAVAILABLE");
    expect(m.aovCents.status).toBe("UNAVAILABLE");
    // Counts are currency-independent and stay available.
    expect(m.orders).toEqual({ status: "AVAILABLE", value: 2 });
    // Per-currency rows stay exact.
    expect(m.byCurrency.map((c) => [c.currency, c.revenueCents]).sort()).toEqual([
      ["CAD", 60_000],
      ["USD", 54_000],
    ]);
  });

  it("excludes cancelled/refunded orders and reports the exclusion", async () => {
    const s = await makeSession();
    const { order } = await createOrder({ sessionId: s.id, provider: "mock", currency: "USD", lines: [line(1000, 54_000)] });
    await createOrder({ sessionId: s.id, provider: "mock", currency: "USD", lines: [line(500, 30_000)] });
    const db = await getDb();
    await db.update(ordersTable).set({ status: "cancelled" }).where(eq(ordersTable.id, order.id));

    const { orders, lines } = await loadPeriodOrders(period30());
    const m = computeRevenueMetrics(orders, lines);
    expect(m.orders).toEqual({ status: "AVAILABLE", value: 1 });
    expect(m.revenueCents).toEqual({ status: "AVAILABLE", value: 30_000 });
    expect(m.excludedOrders).toBe(1);
  });

  it("renders an honest empty state: zero revenue is a real zero, AOV is unavailable", async () => {
    const { orders, lines } = await loadPeriodOrders(period30());
    const m = computeRevenueMetrics(orders, lines);
    expect(m.revenueCents).toEqual({ status: "AVAILABLE", value: 0 });
    expect(m.orders).toEqual({ status: "AVAILABLE", value: 0 });
    expect(m.aovCents.status).toBe("UNAVAILABLE"); // 0/0 is not $0
  });
});

describe("business funnel (§6)", () => {
  it("counts distinct sessions per stage, purchases from the orders table, denominator-honest rates", async () => {
    const sessions = await Promise.all(Array.from({ length: 6 }, () => makeSession()));
    for (const s of sessions) {
      await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
      await recordServerEvent({ sessionId: s.id, name: "price_viewed" }); // same session twice
    }
    await recordServerEvent({ sessionId: sessions[0].id, name: "add_to_cart" });
    await recordServerEvent({ sessionId: sessions[1].id, name: "add_to_cart" });
    await recordServerEvent({ sessionId: sessions[0].id, name: "checkout_started" });
    await createOrder({ sessionId: sessions[0].id, provider: "mock", currency: "USD", lines: [line(1000, 54_000)] });

    const funnel = await loadBusinessFunnel(period30());
    expect(funnel.sessionsStarted).toBe(6);
    const price = funnel.stages.find((s) => s.name === "price_viewed")!;
    expect(price.sessions).toBe(6);
    expect(price.events).toBe(12);
    expect(funnel.purchases).toEqual({ total: 1, aiAssisted: 0 });

    const s2p = funnel.rates.find((r) => r.name === "session_to_purchase")!;
    expect(s2p.ratio).toMatchObject({ numerator: 1, denominator: 6, percentage: 17 });
    // add_to_cart denominator (2) is below the minimum → % suppressed, counts kept.
    const c2c = funnel.rates.find((r) => r.name === "cart_to_checkout")!;
    expect(c2c.ratio).toMatchObject({ numerator: 1, denominator: 2, percentage: null });
    expect(c2c.denominatorDefinition).toContain("add to cart");
  });
});

describe("segments (§11)", () => {
  it("reports orders/revenue/AOV by business type from need profiles; unknown stays unknown", async () => {
    const cafe = await makeSession();
    await applyNeedProfileUpdate(cafe.id, { businessType: "Cafe" }, "USER_STATED");
    await createOrder({ sessionId: cafe.id, provider: "mock", currency: "USD", lines: [line(1000, 54_000)] });
    const anon = await makeSession();
    await createOrder({ sessionId: anon.id, provider: "mock", currency: "USD", lines: [line(500, 30_000)] });

    const corpus = await loadConversationCorpus(period30());
    const { orders } = await loadPeriodOrders(period30());
    const segments = await computeSegmentMetrics(corpus, orders);

    const cafeSeg = segments.find((s) => s.key === "cafe")!;
    expect(cafeSeg).toMatchObject({ orders: 1, revenueCents: 54_000, aovCents: 54_000 });
    const unknown = segments.find((s) => s.key === "unknown")!;
    expect(unknown).toMatchObject({ orders: 1, revenueCents: 30_000 });
  });
});

describe("attribution (§13)", () => {
  it("breaks down sessions/orders/revenue by first touch without CAC/ROAS or click ids", async () => {
    for (let i = 0; i < 5; i += 1) {
      const s = await makeSession();
      await setSessionFirstTouch(s.id, { utm_source: "google", utm_medium: "cpc", gclid: "SECRET_CLICK_ID" });
    }
    const buyer = await makeSession();
    await setSessionFirstTouch(buyer.id, { utm_source: "google", utm_medium: "cpc", gclid: "SECRET_CLICK_ID" });
    await createOrder({ sessionId: buyer.id, provider: "mock", currency: "USD", lines: [line(1000, 54_000)] });

    const a = await computeAttributionBreakdowns(period30(), (await loadPeriodOrders(period30())).orders);
    expect(a.adSpendIntegrated).toBe(false);
    const google = a.firstTouchSourceMedium.find((r) => r.key === "google / cpc")!;
    expect(google).toMatchObject({ sessions: 6, orders: 1, revenueCents: 54_000 });
    // Click ids never surface in any key.
    expect(JSON.stringify(a)).not.toContain("SECRET_CLICK_ID");
  });
});

describe("BusinessHealthSnapshot (§17)", () => {
  it("assembles deterministic sections with explicit availability and data-quality warnings — no AI involved", async () => {
    const s = await makeSession();
    await recordServerEvent({ sessionId: s.id, name: "ai_chat_started" });
    const { conversation } = await seedConversation(s.id, ["What is your MOQ?"]);
    await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
    await setConversationOutcome(conversation.id, "purchased");
    await createOrder({
      sessionId: s.id,
      provider: "mock",
      currency: "USD",
      aiAssisted: true,
      lines: [line(1000, 54_000)],
    });

    const snapshot = await buildBusinessHealthSnapshot(period30());

    expect(snapshot.commerce.revenue.revenueCents).toEqual({ status: "AVAILABLE", value: 54_000 });
    expect(snapshot.aiSales.conversations).toBe(1);
    expect(snapshot.aiSales.assistedOrders).toBe(1);
    // Cost model is all-null placeholders → profitability UNAVAILABLE with reasons.
    expect(snapshot.profitability.grossProfitCents.status).toBe("UNAVAILABLE");
    expect(snapshot.dataQuality.map((w) => w.code)).toContain("COST_MODEL_UNCONFIGURED");
    expect(snapshot.dataQuality.map((w) => w.code)).toContain("NO_AD_SPEND_DATA");
    // Trends carry explicit states (previous period is empty).
    const orderTrend = snapshot.trends.find((t) => t.name === "orders")!;
    expect(orderTrend.trend.state).toBe("NEW_ACTIVITY");
    // The snapshot serializes cleanly (it is persisted verbatim with CEO reports).
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });
});
