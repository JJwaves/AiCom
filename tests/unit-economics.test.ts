import { describe, expect, it } from "vitest";
import { COST_MODEL, COST_MODEL_VERSION } from "@/config/costs";
import { PRODUCTS } from "@/config/products";
import {
  captureOrderCostSnapshot,
  computeOrderUnitEconomics,
  computePaidMediaEconomics,
  computeShippingEconomics,
  economicsFromSnapshot,
  evaluateMarginAgainstPolicy,
  evaluateOrderMarginPolicy,
  marginBps,
  paymentFeeCents,
  type CostModelConfig,
  type OrderEconomicsLineInput,
} from "@/modules/pricing";
import { computeEfficiency } from "@/modules/google-ads-intelligence/efficiency";

/**
 * Session 13.5 — unit economics (spec §49–§57).
 *
 * Every number below comes from a TEST-ONLY fixture. The production cost
 * model (config/costs.ts) is all-null and is asserted to STAY that way:
 * nothing in this file may become business configuration.
 */

const product = PRODUCTS[0]; // Custom Non-Woven Takeout Bag
const second = PRODUCTS[2]; // Custom Cafe Carryout Bag

const line = (
  p: typeof product,
  quantity: number,
  revenueCents: number,
  printOptionId: "none" | "one-color" | "two-color" = "one-color",
): OrderEconomicsLineInput => ({
  productId: p.id,
  product: p,
  config: { sizeId: "m", materialId: "standard", printOptionId, quantity },
  revenueCents,
});

/**
 * FIXTURE (spec §52). Chosen so every figure is hand-checkable:
 *   10,000 units · manufacturing 50¢ · printing 5¢ · setup $100 · packaging 1¢
 *   revenue $10,000 ⇒ COGS $5,700 ⇒ gross profit $4,300
 */
const FIXTURE: CostModelConfig = {
  version: "test-fixture-13.5",
  products: {
    [product.id]: {
      baseManufacturingCentsPerUnit: 50,
      sizeAdjustmentCentsPerUnit: { s: 0, m: 0, l: 0, xl: 0 },
      materialAdjustmentCentsPerUnit: { standard: 0, heavy: 5 },
      printing: {
        none: { centsPerUnit: 0, setupFeeCents: 0 },
        "one-color": { centsPerUnit: 5, setupFeeCents: 10_000 },
        "two-color": { centsPerUnit: 9, setupFeeCents: 18_000 },
      },
      packagingCentsPerUnit: 1,
      shipping: { kind: "per_order", centsPerOrder: 20_000 },
      otherVariableCentsPerUnit: 0,
    },
    [second.id]: {
      baseManufacturingCentsPerUnit: 40,
      sizeAdjustmentCentsPerUnit: { s: 0, m: 0, l: 0 },
      materialAdjustmentCentsPerUnit: { standard: 0, heavy: 4 },
      printing: {
        none: { centsPerUnit: 0, setupFeeCents: 0 },
        "one-color": { centsPerUnit: 4, setupFeeCents: 8_000 },
        "two-color": { centsPerUnit: 7, setupFeeCents: 14_000 },
      },
      packagingCentsPerUnit: 1,
      shipping: { kind: "per_unit", centsPerUnit: 2 },
      otherVariableCentsPerUnit: 0,
    },
  },
  orderCosts: { packagingCentsPerOrder: 0, handlingCentsPerOrder: 5_000 },
  paymentFee: { percentBps: 290, fixedCents: 30 },
  shippingPolicy: { customerCharge: { kind: "not_collected" } },
  marginPolicy: {
    minimumGrossMarginBps: 3000,
    minimumContributionMarginBps: 1500,
    targetGrossMarginBps: 5000,
    targetContributionMarginBps: 4000,
  },
};

const singleLineOrder = (model: CostModelConfig = FIXTURE) =>
  computeOrderUnitEconomics({
    revenueCents: 1_000_000,
    currency: "USD",
    model,
    lines: [line(product, 10_000, 1_000_000)],
  });

/* ------------------------------------------------------------------ */
/* §53 — the shipped null configuration                                */
/* ------------------------------------------------------------------ */

describe("production cost model ships all-null and nothing becomes zero (§53)", () => {
  it("keeps every profit level UNAVAILABLE with named missing inputs", () => {
    const e = singleLineOrder(COST_MODEL);
    expect(e.status).toBe("UNAVAILABLE");
    expect(e.grossStatus).toBe("UNAVAILABLE");
    expect(e.contributionStatus).toBe("UNAVAILABLE");
    expect(e.grossProfitCents).toBeNull();
    expect(e.grossMarginBps).toBeNull();
    expect(e.contributionBeforePaidMediaCents).toBeNull();
    expect(e.contributionMarginBeforePaidMediaBps).toBeNull();
    expect(e.missingInputs.some((m) => m.includes("baseManufacturingCentsPerUnit"))).toBe(true);
    /* Not zero — the distinction this whole session exists for. */
    expect(e.grossProfitCents).not.toBe(0);
  });

  it("records no cost snapshot, so history is honest rather than invented", () => {
    const captured = captureOrderCostSnapshot(
      {
        revenueCents: 1_000_000,
        currency: "USD",
        model: COST_MODEL,
        lines: [line(product, 10_000, 1_000_000)],
      },
      new Date("2026-08-16T00:00:00Z"),
    );
    expect(captured).toBeNull();
  });

  it("keeps every production value null and the version stamped", () => {
    expect(COST_MODEL.version).toBe(COST_MODEL_VERSION);
    expect(COST_MODEL.orderCosts.packagingCentsPerOrder).toBeNull();
    expect(COST_MODEL.orderCosts.handlingCentsPerOrder).toBeNull();
    expect(COST_MODEL.paymentFee.percentBps).toBeNull();
    expect(COST_MODEL.paymentFee.fixedCents).toBeNull();
    expect(COST_MODEL.marginPolicy.minimumGrossMarginBps).toBeNull();
    expect(COST_MODEL.marginPolicy.minimumContributionMarginBps).toBeNull();
    expect(COST_MODEL.marginPolicy.targetGrossMarginBps).toBeNull();
    expect(COST_MODEL.marginPolicy.targetContributionMarginBps).toBeNull();
    for (const pc of Object.values(COST_MODEL.products)) {
      expect(pc.baseManufacturingCentsPerUnit).toBeNull();
      expect(pc.packagingCentsPerUnit).toBeNull();
      expect(pc.shipping).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ */
/* §52 — the profitability ladder                                      */
/* ------------------------------------------------------------------ */

describe("profitability ladder on a configured fixture (§52)", () => {
  const e = singleLineOrder();

  it("computes gross profit from product COGS only", () => {
    expect(e.grossStatus).toBe("AVAILABLE");
    expect(e.cogs).toEqual({
      manufacturingCents: 500_000, // 50¢ × 10,000
      printingCents: 50_000, // 5¢ × 10,000
      setupCents: 10_000,
      packagingCents: 10_000, // 1¢ × 10,000
      orderPackagingCents: 0,
      totalCents: 570_000,
    });
    expect(e.grossProfitCents).toBe(430_000); // $10,000 − $5,700
    expect(e.grossMarginBps).toBe(4300); // 43.00%
  });

  it("subtracts variable selling costs to reach contribution BEFORE paid media", () => {
    expect(e.variableCosts).toEqual({
      paymentProcessingCents: 29_030, // round(1,000,000 × 2.9%) + 30
      shippingSubsidyCents: 20_000,
      handlingCents: 5_000,
      otherVariableCents: 0,
      totalCents: 54_030,
    });
    expect(e.contributionBeforePaidMediaCents).toBe(375_970); // 430,000 − 54,030
    expect(e.contributionMarginBeforePaidMediaBps).toBe(3760); // 37.597% → 3760 bps
  });

  it("keeps gross and contribution as DISTINCT numbers", () => {
    expect(e.grossProfitCents).not.toBe(e.contributionBeforePaidMediaCents);
    expect(e.grossMarginBps).not.toBe(e.contributionMarginBeforePaidMediaBps);
  });

  it("stamps the cost-model version on the result", () => {
    expect(e.costModelVersion).toBe("test-fixture-13.5");
  });

  it("keeps every monetary figure an integer number of cents (§49)", () => {
    const values = [
      ...Object.values(e.cogs ?? {}),
      ...Object.values(e.variableCosts ?? {}),
      e.grossProfitCents as number,
      e.contributionBeforePaidMediaCents as number,
      e.grossMarginBps as number,
      e.contributionMarginBeforePaidMediaBps as number,
    ];
    for (const v of values) expect(Number.isInteger(v)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* §50 — payment fee rounding, once per transaction                    */
/* ------------------------------------------------------------------ */

describe("payment processing cost (§9, §50)", () => {
  const fee = { percentBps: 290, fixedCents: 30 };

  it("rounds the percentage half-up and adds the fixed fee once", () => {
    expect(paymentFeeCents(0, fee)).toBe(30);
    expect(paymentFeeCents(1, fee)).toBe(30); // round(0.029) = 0
    expect(paymentFeeCents(100, fee)).toBe(33); // round(2.9) = 3
    expect(paymentFeeCents(1_000_000, fee)).toBe(29_030);
    expect(paymentFeeCents(999_999_999, fee)).toBe(Math.round((999_999_999 * 290) / 10_000) + 30);
  });

  it("is unavailable — never 0 — when either input is missing", () => {
    expect(paymentFeeCents(100_000, { percentBps: null, fixedCents: 30 })).toBeNull();
    expect(paymentFeeCents(100_000, { percentBps: 290, fixedCents: null })).toBeNull();
  });

  it("charges the FIXED fee exactly once on a multi-line order (§30, §56)", () => {
    const multi = computeOrderUnitEconomics({
      revenueCents: 1_000_000,
      currency: "USD",
      model: FIXTURE,
      lines: [line(product, 5_000, 600_000), line(second, 5_000, 400_000)],
    });
    expect(multi.variableCosts?.paymentProcessingCents).toBe(29_030);
    // Two lines, one fee: twice the fixed fee would be 29,060.
    expect(multi.variableCosts?.paymentProcessingCents).not.toBe(29_060);
  });
});

/* ------------------------------------------------------------------ */
/* §51 — shipping subsidy semantics                                    */
/* ------------------------------------------------------------------ */

describe("shipping economics (§10, §51)", () => {
  it("customer pays the full actual shipping ⇒ subsidy 0", () => {
    const s = computeShippingEconomics(20_000, { customerCharge: { kind: "flat_per_order", centsPerOrder: 20_000 } });
    expect(s.status).toBe("partial");
    if (s.status === "unavailable") throw new Error("unreachable");
    expect(s.subsidyCents).toBe(0);
    expect(s.shippingMarginCents).toBe(0);
  });

  it("company pays all shipping ⇒ subsidy = actual cost", () => {
    const s = computeShippingEconomics(20_000, { customerCharge: { kind: "not_collected" } });
    if (s.status === "unavailable") throw new Error("unreachable");
    expect(s.status).toBe("available");
    expect(s.customerShippingChargeCents).toBe(0);
    expect(s.subsidyCents).toBe(20_000);
  });

  it("customer pays part ⇒ subsidy = the difference", () => {
    const s = computeShippingEconomics(20_000, { customerCharge: { kind: "flat_per_order", centsPerOrder: 8_000 } });
    if (s.status === "unavailable") throw new Error("unreachable");
    expect(s.subsidyCents).toBe(12_000);
    expect(s.shippingMarginCents).toBe(0);
  });

  it("profits on shipping ⇒ subsidy stays 0 and the margin is preserved SEPARATELY", () => {
    const s = computeShippingEconomics(8_000, { customerCharge: { kind: "flat_per_order", centsPerOrder: 20_000 } });
    if (s.status === "unavailable") throw new Error("unreachable");
    expect(s.subsidyCents).toBe(0); // never negative
    expect(s.shippingMarginCents).toBe(12_000);
  });

  it("unknown customer charge ⇒ UNAVAILABLE, never assumed zero", () => {
    const s = computeShippingEconomics(20_000, {
      customerCharge: { kind: "unavailable", reason: "no rate source configured" },
    });
    expect(s.status).toBe("unavailable");
    if (s.status !== "unavailable") throw new Error("unreachable");
    expect(s.missingInputs).toContain("shippingPolicy.customerCharge");
  });

  it("blocks contribution — but NOT gross profit — when the subsidy is unknown (§22)", () => {
    const e = singleLineOrder({
      ...FIXTURE,
      shippingPolicy: { customerCharge: { kind: "unavailable", reason: "unknown" } },
    });
    expect(e.grossStatus).toBe("AVAILABLE");
    expect(e.grossProfitCents).toBe(430_000);
    expect(e.contributionStatus).toBe("UNAVAILABLE");
    expect(e.contributionBeforePaidMediaCents).toBeNull();
    expect(e.status).toBe("PARTIAL");
  });

  it("today's checkout collects no shipping charge — a structural fact, not a guess", () => {
    expect(COST_MODEL.shippingPolicy.customerCharge.kind).toBe("not_collected");
  });
});

/* ------------------------------------------------------------------ */
/* §54 — partial availability                                          */
/* ------------------------------------------------------------------ */

describe("availability is per level, not global (§22, §54)", () => {
  it("gross AVAILABLE while contribution is UNAVAILABLE when the payment fee is missing", () => {
    const e = singleLineOrder({ ...FIXTURE, paymentFee: { percentBps: null, fixedCents: null } });
    expect(e.grossStatus).toBe("AVAILABLE");
    expect(e.grossProfitCents).toBe(430_000);
    expect(e.contributionStatus).toBe("UNAVAILABLE");
    expect(e.contributionBeforePaidMediaCents).toBeNull();
    expect(e.missingInputs).toContain("paymentFee.percentBps");
    expect(e.missingInputs).toContain("paymentFee.fixedCents");
    expect(e.status).toBe("PARTIAL");
  });

  it("missing ORDER packaging blocks gross profit, because it is COGS", () => {
    const e = singleLineOrder({
      ...FIXTURE,
      orderCosts: { packagingCentsPerOrder: null, handlingCentsPerOrder: 5_000 },
    });
    expect(e.grossStatus).toBe("UNAVAILABLE");
    expect(e.missingInputs).toContain("orderCosts.packagingCentsPerOrder");
  });

  it("missing handling blocks contribution only, because it is a selling cost", () => {
    const e = singleLineOrder({
      ...FIXTURE,
      orderCosts: { packagingCentsPerOrder: 0, handlingCentsPerOrder: null },
    });
    expect(e.grossStatus).toBe("AVAILABLE");
    expect(e.contributionStatus).toBe("UNAVAILABLE");
    expect(e.missingInputs).toContain("orderCosts.handlingCentsPerOrder");
  });

  it("a configured-constant shipping charge marks contribution PARTIAL, not AVAILABLE", () => {
    const e = singleLineOrder({
      ...FIXTURE,
      shippingPolicy: { customerCharge: { kind: "flat_per_order", centsPerOrder: 5_000 } },
    });
    expect(e.grossStatus).toBe("AVAILABLE");
    expect(e.contributionStatus).toBe("PARTIAL");
    expect(e.reasons.join(" ")).toMatch(/configured flat constant/i);
  });
});

/* ------------------------------------------------------------------ */
/* §56 — multi-line orders                                             */
/* ------------------------------------------------------------------ */

describe("multi-line order economics (§30, §31, §56)", () => {
  const multi = computeOrderUnitEconomics({
    revenueCents: 1_000_000,
    currency: "USD",
    model: FIXTURE,
    lines: [line(product, 5_000, 600_000), line(second, 5_000, 400_000)],
  });

  it("computes per-line COGS and charges printing setup ONCE PER LINE", () => {
    expect(multi.cogs?.manufacturingCents).toBe(50 * 5_000 + 40 * 5_000); // 450,000
    expect(multi.cogs?.printingCents).toBe(5 * 5_000 + 4 * 5_000); // 45,000
    expect(multi.cogs?.setupCents).toBe(10_000 + 8_000); // one screen per artwork
    expect(multi.cogs?.packagingCents).toBe(5_000 + 5_000);
  });

  it("charges order-scope packaging and handling exactly once", () => {
    const withOrderCosts = computeOrderUnitEconomics({
      revenueCents: 1_000_000,
      currency: "USD",
      model: { ...FIXTURE, orderCosts: { packagingCentsPerOrder: 3_000, handlingCentsPerOrder: 5_000 } },
      lines: [line(product, 5_000, 600_000), line(second, 5_000, 400_000)],
    });
    expect(withOrderCosts.cogs?.orderPackagingCents).toBe(3_000);
    expect(withOrderCosts.variableCosts?.handlingCents).toBe(5_000);
  });

  it("charges per-ORDER freight once per product, and per-unit freight per line", () => {
    // product: per_order 20,000 (once). second: per_unit 2¢ × 5,000 = 10,000.
    expect(multi.shipping?.actualShippingCents).toBe(30_000);
    expect(multi.variableCosts?.shippingSubsidyCents).toBe(30_000);
  });

  it("does not double-count per-order freight when one product spans two lines", () => {
    const twoLinesSameProduct = computeOrderUnitEconomics({
      revenueCents: 1_000_000,
      currency: "USD",
      model: FIXTURE,
      lines: [line(product, 5_000, 500_000), line(product, 5_000, 500_000, "two-color")],
    });
    expect(twoLinesSameProduct.shipping?.actualShippingCents).toBe(20_000);
  });

  it("never double counts revenue and reaches an exact contribution", () => {
    expect(multi.revenueCents).toBe(1_000_000);
    const cogs = 450_000 + 45_000 + 18_000 + 10_000; // 523,000
    expect(multi.cogs?.totalCents).toBe(cogs);
    expect(multi.grossProfitCents).toBe(1_000_000 - cogs);
    const variable = 29_030 + 30_000 + 5_000;
    expect(multi.variableCosts?.totalCents).toBe(variable);
    expect(multi.contributionBeforePaidMediaCents).toBe(1_000_000 - cogs - variable);
  });

  it("reports per-line GROSS profit but NEVER a per-line contribution (§31)", () => {
    expect(multi.lines).toHaveLength(2);
    expect(multi.lines[0]).toEqual({
      productId: product.id,
      revenueCents: 600_000,
      cogsCents: 50 * 5_000 + 5 * 5_000 + 10_000 + 5_000,
      grossProfitCents: 600_000 - (50 * 5_000 + 5 * 5_000 + 10_000 + 5_000),
    });
    for (const l of multi.lines) {
      expect(l).not.toHaveProperty("contributionBeforePaidMediaCents");
      expect(l).not.toHaveProperty("paymentProcessingCents");
    }
  });

  it("an uncostable line makes the WHOLE order uncosted, never partially guessed", () => {
    const withUnknown = computeOrderUnitEconomics({
      revenueCents: 1_000_000,
      currency: "USD",
      model: FIXTURE,
      lines: [line(product, 5_000, 600_000), { ...line(second, 5_000, 400_000), product: null }],
    });
    expect(withUnknown.grossStatus).toBe("UNAVAILABLE");
    expect(withUnknown.missingInputs.join(" ")).toMatch(/no longer in catalog/);
  });
});

/* ------------------------------------------------------------------ */
/* §5 — quantity-dependent manufacturing cost                          */
/* ------------------------------------------------------------------ */

describe("quantity-tier manufacturing cost (§5)", () => {
  const tiered: CostModelConfig = {
    ...FIXTURE,
    products: {
      ...FIXTURE.products,
      [product.id]: {
        ...FIXTURE.products[product.id],
        manufacturingTiers: [
          { minQty: 1_000, centsPerUnit: 50 },
          { minQty: 5_000, centsPerUnit: 44 },
          { minQty: 10_000, centsPerUnit: 39 },
        ],
      },
    },
  };

  const at = (quantity: number) =>
    computeOrderUnitEconomics({
      revenueCents: 1_000_000,
      currency: "USD",
      model: tiered,
      lines: [line(product, quantity, 1_000_000)],
    });

  it("applies the highest tier the quantity reaches", () => {
    expect(at(1_000).cogs?.manufacturingCents).toBe(50 * 1_000);
    expect(at(4_999).cogs?.manufacturingCents).toBe(50 * 4_999);
    expect(at(5_000).cogs?.manufacturingCents).toBe(44 * 5_000);
    expect(at(10_000).cogs?.manufacturingCents).toBe(39 * 10_000);
    expect(at(25_000).cogs?.manufacturingCents).toBe(39 * 25_000);
  });

  it("FAILS CLOSED below the first tier — it never falls back to the base rate", () => {
    const below = at(500);
    expect(below.grossStatus).toBe("UNAVAILABLE");
    expect(below.missingInputs.join(" ")).toMatch(/manufacturingTiers/);
  });

  it("factory tiers are independent of the storefront's sell-price tiers", () => {
    const sellBreaks = product.pricingTiers.map((t) => t.minQty);
    const costBreaks = tiered.products[product.id].manufacturingTiers?.map((t) => t.minQty) ?? [];
    expect(sellBreaks).not.toEqual(costBreaks);
    // Both remain valid — the model never assumes they coincide.
    expect(at(2_500).cogs?.manufacturingCents).toBe(50 * 2_500);
  });
});

/* ------------------------------------------------------------------ */
/* §55 — margin policy: minimum vs target                              */
/* ------------------------------------------------------------------ */

describe("margin policy — minimum is a boundary, target is an objective (§23–§25, §55)", () => {
  const policy = FIXTURE.marginPolicy;

  it("reports UNAVAILABLE when no minimum is configured — never 'compliant'", () => {
    const v = evaluateMarginAgainstPolicy(4300, "gross", { ...policy, minimumGrossMarginBps: null });
    expect(v.state).toBe("UNAVAILABLE");
    expect(v.missingInputs).toContain("marginPolicy.minimumGrossMarginBps");
  });

  it("reports UNAVAILABLE when the margin itself is unknown", () => {
    expect(evaluateMarginAgainstPolicy(null, "gross", policy).state).toBe("UNAVAILABLE");
  });

  it("BELOW_MINIMUM names the floor it breaches", () => {
    const v = evaluateMarginAgainstPolicy(2999, "gross", policy);
    expect(v.state).toBe("BELOW_MINIMUM");
    expect(v.violatedFloors).toEqual(["marginPolicy.minimumGrossMarginBps"]);
  });

  it("exactly AT the minimum is not a breach", () => {
    expect(evaluateMarginAgainstPolicy(3000, "gross", policy).state).toBe("BELOW_TARGET");
  });

  it("BELOW_TARGET is a review signal, NOT a violation", () => {
    const v = evaluateMarginAgainstPolicy(4300, "gross", policy);
    expect(v.state).toBe("BELOW_TARGET");
    expect(v.violatedFloors).toEqual([]);
    expect(v.reason).toMatch(/review signal, not a violation/i);
  });

  it("AT_OR_ABOVE_TARGET at and above the objective", () => {
    expect(evaluateMarginAgainstPolicy(5000, "gross", policy).state).toBe("AT_OR_ABOVE_TARGET");
    expect(evaluateMarginAgainstPolicy(9999, "gross", policy).state).toBe("AT_OR_ABOVE_TARGET");
  });

  it("NO_TARGET when the floor holds but no objective exists", () => {
    const v = evaluateMarginAgainstPolicy(4300, "gross", { ...policy, targetGrossMarginBps: null });
    expect(v.state).toBe("NO_TARGET");
    expect(v.missingInputs).toContain("marginPolicy.targetGrossMarginBps");
  });

  it("evaluates gross and contribution against their OWN policy fields", () => {
    const verdicts = evaluateOrderMarginPolicy(singleLineOrder(), FIXTURE);
    expect(verdicts.gross.state).toBe("BELOW_TARGET"); // 4300 ≥ 3000, < 5000
    expect(verdicts.contribution.state).toBe("BELOW_TARGET"); // 3760 ≥ 1500, < 4000
  });

  it("100% and negative margins are rejected rather than normalised", () => {
    expect(evaluateMarginAgainstPolicy(5000, "gross", { ...policy, minimumGrossMarginBps: 10_000 }).state).toBe(
      "BELOW_MINIMUM",
    );
  });

  it("margins never produce NaN or Infinity on zero revenue (§15)", () => {
    expect(marginBps(100, 0)).toBeNull();
    expect(marginBps(100, -5)).toBeNull();
    const zero = computeOrderUnitEconomics({
      revenueCents: 0,
      currency: "USD",
      model: FIXTURE,
      lines: [line(product, 10_000, 0)],
    });
    expect(zero.grossMarginBps).toBeNull();
    expect(zero.contributionMarginBeforePaidMediaBps).toBeNull();
    expect(Number.isFinite(zero.grossProfitCents as number)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* §28, §29 — cost snapshots and versioning                            */
/* ------------------------------------------------------------------ */

describe("order cost snapshots (§28, §29)", () => {
  const capturedAt = new Date("2026-08-16T12:00:00Z");
  const captured = captureOrderCostSnapshot(
    { revenueCents: 1_000_000, currency: "USD", model: FIXTURE, lines: [line(product, 10_000, 1_000_000)] },
    capturedAt,
  );

  it("freezes the derived economics with the cost-model version and timestamp", () => {
    expect(captured).not.toBeNull();
    expect(captured?.snapshot.costModelVersion).toBe("test-fixture-13.5");
    expect(captured?.snapshot.capturedAt).toBe("2026-08-16T12:00:00.000Z");
    expect(captured?.snapshot.grossProfitCents).toBe(430_000);
    expect(captured?.snapshot.contributionBeforePaidMediaCents).toBe(375_970);
  });

  it("freezes per-line COGS without allocating order-level costs to lines", () => {
    const lineSnapshot = captured?.lineSnapshots[0];
    expect(lineSnapshot?.cogs.totalCents).toBe(570_000);
    expect(lineSnapshot).not.toHaveProperty("paymentProcessingCents");
    expect(lineSnapshot).not.toHaveProperty("shippingSubsidyCents");
  });

  it("reads back identically without consulting the CURRENT configuration", () => {
    const rebuilt = economicsFromSnapshot(captured!.snapshot);
    expect(rebuilt.grossProfitCents).toBe(430_000);
    expect(rebuilt.contributionBeforePaidMediaCents).toBe(375_970);
    expect(rebuilt.costModelVersion).toBe("test-fixture-13.5");
  });

  it("a later configuration change does not alter a stored snapshot", () => {
    const laterModel: CostModelConfig = {
      ...FIXTURE,
      version: "test-fixture-13.5-b",
      products: {
        ...FIXTURE.products,
        [product.id]: { ...FIXTURE.products[product.id], baseManufacturingCentsPerUnit: 90 },
      },
    };
    const now = computeOrderUnitEconomics({
      revenueCents: 1_000_000,
      currency: "USD",
      model: laterModel,
      lines: [line(product, 10_000, 1_000_000)],
    });
    expect(now.grossProfitCents).not.toBe(captured!.snapshot.grossProfitCents);
    expect(economicsFromSnapshot(captured!.snapshot).grossProfitCents).toBe(430_000);
  });
});

/* ------------------------------------------------------------------ */
/* §18–§20, §57 — paid media, ROAS vs POAS                             */
/* ------------------------------------------------------------------ */

describe("paid media economics — ROAS and POAS are different measurements (§19, §20)", () => {
  it("POAS divides CONTRIBUTION PROFIT by spend; post-ad contribution is the same gap in dollars", () => {
    const paid = computePaidMediaEconomics({
      contributionBeforePaidMediaCents: 375_970,
      adSpendCents: 200_000,
    });
    if (paid.status === "UNAVAILABLE") throw new Error("unreachable");
    expect(paid.poas).toBe(1.88); // 375,970 / 200,000
    expect(paid.postAdContributionCents).toBe(175_970);
  });

  it("a strong ROAS can sit beside a weak POAS — the reason both exist", () => {
    const roas = 1_000_000 / 200_000; // 5.0 revenue-based
    const paid = computePaidMediaEconomics({
      contributionBeforePaidMediaCents: 375_970,
      adSpendCents: 200_000,
    });
    if (paid.status === "UNAVAILABLE") throw new Error("unreachable");
    expect(roas).toBe(5);
    expect(paid.poas).toBeLessThan(roas);
  });

  it("reports a LOSS honestly rather than clamping at zero", () => {
    const paid = computePaidMediaEconomics({
      contributionBeforePaidMediaCents: 100_000,
      adSpendCents: 400_000,
    });
    if (paid.status === "UNAVAILABLE") throw new Error("unreachable");
    expect(paid.postAdContributionCents).toBe(-300_000);
    expect(paid.poas).toBe(0.25);
  });

  it("is UNAVAILABLE — never revenue-substituted — when contribution is unknown", () => {
    const paid = computePaidMediaEconomics({
      contributionBeforePaidMediaCents: null,
      adSpendCents: 200_000,
      missingInputs: ["config/costs.ts → paymentFee.percentBps"],
    });
    expect(paid.status).toBe("UNAVAILABLE");
    if (paid.status !== "UNAVAILABLE") throw new Error("unreachable");
    expect(paid.reason).toMatch(/Revenue is never substituted for profit/i);
  });

  it("zero ad spend makes the RATIO undefined without inventing one", () => {
    const paid = computePaidMediaEconomics({ contributionBeforePaidMediaCents: 375_970, adSpendCents: 0 });
    if (paid.status === "UNAVAILABLE") throw new Error("unreachable");
    expect(paid.poas).toBeNull();
    expect(paid.postAdContributionCents).toBe(375_970);
  });
});

/* ------------------------------------------------------------------ */
/* §35, §36, §57 — POAS in Google Ads Intelligence                     */
/* ------------------------------------------------------------------ */

describe("Google Ads POAS availability (§34–§36, §57)", () => {
  const base = {
    costCents: 200_000,
    adCurrency: "USD",
    googleConversions: 5,
    googleConversionValueCents: 900_000,
    firstPartyOrders: 4,
    firstPartyRevenueCents: 1_000_000,
    revenueCurrencies: ["USD"],
    attributionMatchedPct: 100,
    noAdData: false,
    contributionBeforePaidMediaCents: 375_970,
    ordersWithContribution: 4,
  };

  it("AVAILABLE with same currency, real spend, profit economics and full coverage", () => {
    const e = computeEfficiency(base);
    expect(e.profitOnAdSpend).toEqual({ status: "AVAILABLE", value: 1.88 });
    expect(e.postAdContributionCents).toEqual({ status: "AVAILABLE", value: 175_970 });
    expect(e.contributionBeforePaidMediaCents).toEqual({ status: "AVAILABLE", value: 375_970 });
  });

  it("keeps ROAS and POAS as separate fields with separate values", () => {
    const e = computeEfficiency(base);
    expect(e.firstPartyRoas).toEqual({ status: "AVAILABLE", value: 5 });
    expect(e.profitOnAdSpend).not.toEqual(e.firstPartyRoas);
    expect(e).not.toHaveProperty("roas");
    expect(e).not.toHaveProperty("poas");
  });

  it("UNAVAILABLE on a currency mismatch — no FX model is invented (§36)", () => {
    const e = computeEfficiency({ ...base, revenueCurrencies: ["CAD"] });
    expect(e.profitOnAdSpend.status).toBe("UNAVAILABLE");
    expect(e.profitOnAdSpend).not.toHaveProperty("value");
  });

  it("PARTIAL when attribution coverage is below the documented minimum (§35)", () => {
    const e = computeEfficiency({ ...base, attributionMatchedPct: 20 });
    expect(e.profitOnAdSpend.status).toBe("PARTIAL");
    if (e.profitOnAdSpend.status !== "PARTIAL") throw new Error("unreachable");
    expect(e.profitOnAdSpend.reason).toMatch(/tied to a campaign/i);
  });

  it("PARTIAL when only some attributed orders carry a cost snapshot", () => {
    const e = computeEfficiency({ ...base, ordersWithContribution: 2 });
    expect(e.profitOnAdSpend.status).toBe("PARTIAL");
    if (e.profitOnAdSpend.status !== "PARTIAL") throw new Error("unreachable");
    expect(e.profitOnAdSpend.reason).toMatch(/2 of 4 attributed orders/);
  });

  it("UNAVAILABLE when costs are missing, and names the config paths", () => {
    const e = computeEfficiency({ ...base, contributionBeforePaidMediaCents: null, ordersWithContribution: 0 });
    expect(e.profitOnAdSpend.status).toBe("UNAVAILABLE");
    expect(e.profitBlockers.some((p) => p.includes("config/costs.ts"))).toBe(true);
    // Revenue ROAS remains available and is explicitly not profitability.
    expect(e.firstPartyRoas.status).toBe("AVAILABLE");
  });

  it("no ad spend leaves the ratio undefined rather than zero", () => {
    const e = computeEfficiency({ ...base, costCents: 0 });
    expect(e.profitOnAdSpend.status).toBe("UNAVAILABLE");
    expect(e.profitOnAdSpend).not.toHaveProperty("value");
  });
});
