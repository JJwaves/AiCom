import { beforeEach, describe, expect, it } from "vitest";
import { COST_MODEL } from "@/config/costs";
import { listCatalogProducts } from "@/lib/commerce/catalog";
import { createOrder } from "@/lib/data/order-service";
import type { CostModelConfig, ProductCostConfig } from "@/modules/pricing";
import { periodFromDays } from "@/modules/customer-intelligence";
import {
  computeProductPerformance,
  computeProfitability,
  computeRevenueMetrics,
  isCostModelFullyConfigured,
  loadPeriodOrders,
} from "@/modules/business-intelligence";
import { makeSession, resetDb } from "./db-helpers";

/**
 * Session 09 §46 — REQUIRED cost-config tests. The production placeholders
 * in config/costs.ts are ALL null: revenue/orders/AOV must stay available
 * while every profit metric is UNAVAILABLE with its reason — never zero.
 * A TEST-ONLY configured model then verifies the actual profit math
 * (production placeholders are never touched).
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
  colorId: "black",
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

/** TEST-ONLY cost model — never production data (production stays null). */
const configuredProduct: ProductCostConfig = {
  baseManufacturingCentsPerUnit: 10,
  sizeAdjustmentCentsPerUnit: { s: 0, m: 1, l: 2, xl: 3 },
  materialAdjustmentCentsPerUnit: { standard: 0, heavy: 2 },
  printing: {
    none: { centsPerUnit: 0, setupFeeCents: 0 },
    "one-color": { centsPerUnit: 2, setupFeeCents: 2000 },
    "two-color": { centsPerUnit: 4, setupFeeCents: 3000 },
    "full-custom": { centsPerUnit: 8, setupFeeCents: 5000 },
  },
  packagingCentsPerUnit: 1,
  shipping: { kind: "per_order", centsPerOrder: 5000 },
  otherVariableCentsPerUnit: 0,
};

const TEST_MODEL: CostModelConfig = {
  version: "test-fixture-bi",
  products: { "p-custom-takeout": configuredProduct },
  orderCosts: { packagingCentsPerOrder: 0, handlingCentsPerOrder: 0 },
  paymentFee: { percentBps: 290, fixedCents: 30 },
  shippingPolicy: { customerCharge: { kind: "not_collected" } },
  marginPolicy: {
    minimumGrossMarginBps: null,
    minimumContributionMarginBps: null,
    targetGrossMarginBps: null,
    targetContributionMarginBps: null,
  },
};

describe("current production state — all cost placeholders null (§46)", () => {
  it("keeps revenue metrics available while every profit metric is UNAVAILABLE with a reason", async () => {
    await createOrder({ sessionId: (await makeSession()).id, provider: "mock", currency: "USD", lines: [line(1000, 54_000)] });

    const { orders, lines } = await loadPeriodOrders(period30());
    const revenue = computeRevenueMetrics(orders, lines);
    expect(revenue.revenueCents).toEqual({ status: "AVAILABLE", value: 54_000 });
    expect(revenue.orders).toEqual({ status: "AVAILABLE", value: 1 });
    expect(revenue.aovCents).toEqual({ status: "AVAILABLE", value: 54_000 });

    const products = await listCatalogProducts();
    const p = computeProfitability(orders, lines, products, COST_MODEL);
    for (const metric of [
      p.grossProfitCents,
      p.grossMarginPct,
      p.contributionProfitBeforePaidMediaCents,
      p.contributionMarginBeforePaidMediaPct,
    ]) {
      expect(metric.status).toBe("UNAVAILABLE");
      // No null→zero conversion: an unavailable metric has NO value at all.
      expect("value" in metric).toBe(false);
    }
    // Costs were unknown when the order was placed, so no snapshot exists:
    // the default basis says exactly that instead of re-costing it today.
    expect(p.costBasis).toBe("SNAPSHOT_ONLY");
    expect(p.ordersWithoutCostSnapshot).toBe(1);
    expect(p.grossProfitCents.status === "UNAVAILABLE" && p.grossProfitCents.reason).toContain(
      "HISTORICAL_COST_UNAVAILABLE",
    );

    // The clearly-labelled current-cost scenario explains the missing
    // configuration in owner language and names real config keys.
    const scenario = computeProfitability(orders, lines, products, COST_MODEL, {
      historicalCostBasis: "CURRENT_CONFIG_SCENARIO",
    });
    expect(scenario.grossProfitCents.status === "UNAVAILABLE" && scenario.grossProfitCents.reason).toContain(
      "configure manufacturing costs",
    );
    expect(scenario.missingCostInputs.some((m) => m.includes("baseManufacturingCentsPerUnit"))).toBe(true);
    expect(scenario.notes.some((n) => n.startsWith("SCENARIO:"))).toBe(true);
    expect(isCostModelFullyConfigured(COST_MODEL)).toBe(false);
  });

  it("reports no orders as 'no orders', not as $0 profit", async () => {
    const products = await listCatalogProducts();
    const p = computeProfitability([], [], products, COST_MODEL);
    expect(p.grossProfitCents.status).toBe("UNAVAILABLE");
    expect(p.grossProfitCents.status === "UNAVAILABLE" && p.grossProfitCents.reason).toContain("No completed orders");
  });
});

/**
 * These orders are created while the PRODUCTION cost model is all-null, so
 * they carry no cost snapshot. The math below is therefore exercised through
 * the explicitly-labelled current-cost SCENARIO basis — the same posture the
 * dashboard takes: snapshot-only by default, scenario only when asked for.
 */
const SCENARIO = { historicalCostBasis: "CURRENT_CONFIG_SCENARIO" } as const;

describe("test-configured cost model — profit math (§9–§10)", () => {
  it("computes gross and contribution (before paid media) per the documented formulas", async () => {
    await createOrder({ sessionId: (await makeSession()).id, provider: "mock", currency: "USD", lines: [line(1000, 54_000)] });

    const { orders, lines } = await loadPeriodOrders(period30());
    const products = await listCatalogProducts();
    const p = computeProfitability(orders, lines, products, TEST_MODEL, SCENARIO);

    // COGS = (10+2+0)×1000 mfg + 2×1000 print + 2000 setup + 1×1000 pkg = 17,000
    expect(p.grossProfitCents).toEqual({ status: "AVAILABLE", value: 54_000 - 17_000 });
    // Variable = COGS + 5,000 shipping; fee = round(54,000×2.9%) + 30 = 1,596
    expect(p.contributionProfitBeforePaidMediaCents).toEqual({ status: "AVAILABLE", value: 54_000 - 22_000 - 1_596 });
    expect(p.grossMarginPct.status).toBe("AVAILABLE");
    expect(p.grossMarginPct.status === "AVAILABLE" && p.grossMarginPct.value).toBeCloseTo(37_000 / 54_000, 6);
    expect(isCostModelFullyConfigured(TEST_MODEL)).toBe(true);
  });

  it("charges per-ORDER costs once per order, not once per line", async () => {
    await createOrder({
      sessionId: (await makeSession()).id,
      provider: "mock",
      currency: "USD",
      lines: [line(1000, 54_000), line(500, 30_000)],
    });

    const { orders, lines } = await loadPeriodOrders(period30());
    const products = await listCatalogProducts();
    const p = computeProfitability(orders, lines, products, TEST_MODEL, SCENARIO);

    // Line COGS: 17,000 (as above) + [(10+2)×500 + 2×500 + 2,000 + 500] = 9,500 → gross = 84,000 − 26,500
    expect(p.grossProfitCents).toEqual({ status: "AVAILABLE", value: 84_000 - 26_500 });
    // Variable costs, each applied ONCE for the order:
    //   freight  — the fixture quotes it `per_order` (5,000), and both lines are the
    //              SAME product, so it is ONE shipment: 5,000, not 2 × 5,000.
    //   fee      — round(84,000 × 2.9%) + ONE fixed 30 = 2,466, not two fixed fees.
    expect(p.contributionProfitBeforePaidMediaCents).toEqual({
      status: "AVAILABLE",
      value: 84_000 - 26_500 - 5_000 - 2_466,
    });
  });

  it("goes PARTIAL when only some orders are costable, listing what is missing", async () => {
    await createOrder({ sessionId: (await makeSession()).id, provider: "mock", currency: "USD", lines: [line(1000, 54_000)] });
    await createOrder({
      sessionId: (await makeSession()).id,
      provider: "mock",
      currency: "USD",
      lines: [line(1000, 66_000, { productId: "p-heavy-duty", materialId: "heavy", sizeId: "m" })],
    });

    const { orders, lines } = await loadPeriodOrders(period30());
    const products = await listCatalogProducts();
    const p = computeProfitability(orders, lines, products, TEST_MODEL, SCENARIO);

    expect(p.ordersCosted).toBe(1);
    expect(p.ordersTotal).toBe(2);
    expect(p.grossProfitCents.status).toBe("PARTIAL");
    expect(p.grossProfitCents.status === "PARTIAL" && p.grossProfitCents.value).toBe(54_000 - 17_000);
    expect(p.missingCostInputs.some((m) => m.includes("p-heavy-duty"))).toBe(true);
  });

  it("computes per-product GROSS profit (contribution stays order-level)", async () => {
    await createOrder({ sessionId: (await makeSession()).id, provider: "mock", currency: "USD", lines: [line(1000, 54_000)] });
    const { orders, lines } = await loadPeriodOrders(period30());
    const products = await listCatalogProducts();
    const perf = computeProductPerformance(orders, lines, products, TEST_MODEL, SCENARIO);
    expect(perf).toHaveLength(1);
    expect(perf[0].grossProfitCents).toEqual({ status: "AVAILABLE", value: 54_000 - 17_000 });
    expect(perf[0].units).toBe(1000);
    // With the production null model the same line is honestly unavailable.
    const nullPerf = computeProductPerformance(orders, lines, products, COST_MODEL, SCENARIO);
    expect(nullPerf[0].grossProfitCents.status).toBe("UNAVAILABLE");
  });
});
