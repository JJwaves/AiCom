import { describe, expect, it } from "vitest";
import {
  calculatePrice,
  computeCosts,
  evaluatePriceFloor,
  minimumAllowedPriceCents,
  productCostCents,
  type CostModelConfig,
} from "@/modules/pricing";
import { COST_MODEL } from "@/config/costs";
import { PRODUCTS } from "@/config/products";
import type { ProductConfiguration } from "@/types/commerce";

const product = PRODUCTS[0]; // Custom Insulated Takeout Bag (launch product)

const config: ProductConfiguration = {
  productId: product.id,
  sizeId: "l",
  materialId: "insulated",
  colorId: "black",
  printOptionId: "full-custom",
  quantity: 5000,
  artwork: { artworkId: "art_test", fileName: "logo.png", fileType: "image/png", fileSizeBytes: 1024 },
};

/**
 * Fully configured FIXTURE cost model — test-only numbers, clearly not
 * business data. Chosen for easy hand-verification.
 */
const FIXTURE: CostModelConfig = {
  version: "test-fixture-1",
  products: {
    [product.id]: {
      baseManufacturingCentsPerUnit: 5,
      sizeAdjustmentCentsPerUnit: { l: 1, xl: 2 },
      materialAdjustmentCentsPerUnit: { insulated: 0 },
      printing: {
        "full-custom": { centsPerUnit: 1, setupFeeCents: 1000 },
      },
      packagingCentsPerUnit: 1,
      shipping: { kind: "per_carton", centsPerCarton: 200, unitsPerCarton: 300 },
      otherVariableCentsPerUnit: 0,
    },
  },
  orderCosts: { packagingCentsPerOrder: 0, handlingCentsPerOrder: 0 }, // fixture: no order-scope costs
  paymentFee: { percentBps: 290, fixedCents: 30 }, // 2.9% + $0.30 (fixture)
  shippingPolicy: { customerCharge: { kind: "not_collected" } },
  marginPolicy: {
    minimumGrossMarginBps: 3000, // 30% (fixture)
    minimumContributionMarginBps: 1500, // 15% (fixture)
    targetGrossMarginBps: 4000,
    targetContributionMarginBps: 2500,
  },
};

// Engine sell price for the fixture config: tier 5,000 @19¢ + Large size delta 0¢ = 19¢ → $950.00
const SELL_TOTAL = 19 * 5000;

describe("cost model — unconfigured (the real config/costs.ts)", () => {
  it("ships with every input as a [TO BE PROVIDED] placeholder", () => {
    const computed = computeCosts(product, config, SELL_TOTAL, COST_MODEL);
    expect(computed.status).toBe("unconfigured");
    if (computed.status === "unconfigured") {
      expect(computed.missingInputs.length).toBeGreaterThan(0);
    }
  });

  it("calculatePrice still returns the deterministic sell price, with margins unavailable", () => {
    const calc = calculatePrice(product, config, COST_MODEL);
    expect(calc.ok).toBe(true);
    if (!calc.ok) return;
    expect(calc.unitPriceCents).toBe(19);
    expect(calc.totalPriceCents).toBe(SELL_TOTAL);
    expect(calc.costStatus).toBe("unconfigured");
    expect(calc.costs).toBeNull();
    expect(calc.grossProfitCents).toBeNull();
    expect(calc.grossMarginPct).toBeNull();
    expect(calc.contributionProfitCents).toBeNull();
    expect(calc.contributionMarginPct).toBeNull();
    expect(calc.minimumAllowedPriceCents).toBeNull();
    expect(calc.missingCostInputs.length).toBeGreaterThan(0);
  });

  it("price-floor guardrail FAILS CLOSED when costs are unconfigured", () => {
    const verdict = evaluatePriceFloor(SELL_TOTAL, product, config, COST_MODEL);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.violatedRules).toContain("cost_model_unconfigured");
    }
  });

  it("lists the exact missing input names for the owner", () => {
    const computed = computeCosts(product, config, SELL_TOTAL, COST_MODEL);
    if (computed.status !== "unconfigured") throw new Error("expected unconfigured");
    expect(computed.missingInputs).toContain(`products.${product.id}.baseManufacturingCentsPerUnit`);
    expect(computed.missingInputs).toContain("paymentFee.percentBps");
  });
});

describe("cost model — configured fixture math", () => {
  it("computes each cost component in integer cents", () => {
    const computed = computeCosts(product, config, SELL_TOTAL, FIXTURE);
    expect(computed.status).toBe("configured");
    if (computed.status !== "configured") return;
    const c = computed.costs;
    expect(c.manufacturingCents).toBe((5 + 1 + 0) * 5000); // 30000
    expect(c.printingCents).toBe(1 * 5000); // 5000
    expect(c.setupCents).toBe(1000);
    expect(c.packagingCents).toBe(1 * 5000); // 5000
    expect(c.estimatedShippingCents).toBe(Math.ceil(5000 / 300) * 200); // 17 cartons → 3400
    expect(c.paymentFeeCents).toBe(Math.round((SELL_TOTAL * 290) / 10_000) + 30); // 2755 + 30 = 2785
    expect(c.otherVariableCents).toBe(0);
    expect(c.totalCostCents).toBe(30000 + 5000 + 1000 + 5000 + 3400 + 2785);
    Object.values(c).forEach((v) => expect(Number.isInteger(v)).toBe(true));
  });

  it("calculatePrice reports gross and contribution profit/margins", () => {
    const calc = calculatePrice(product, config, FIXTURE);
    if (!calc.ok) throw new Error("expected priced");
    expect(calc.costStatus).toBe("configured");
    const productCost = 30000 + 5000 + 1000 + 5000; // manufacturing+printing+setup+packaging
    const totalCost = productCost + 3400 + 2785;
    expect(calc.grossProfitCents).toBe(SELL_TOTAL - productCost);
    expect(calc.contributionProfitCents).toBe(SELL_TOTAL - totalCost);
    expect(calc.grossMarginPct).toBeCloseTo((SELL_TOTAL - productCost) / SELL_TOTAL);
    expect(calc.contributionMarginPct).toBeCloseTo((SELL_TOTAL - totalCost) / SELL_TOTAL);
  });

  it("minimumAllowedPrice satisfies every configured floor (and its predecessor does not)", () => {
    const computed = computeCosts(product, config, SELL_TOTAL, FIXTURE);
    if (computed.status !== "configured") throw new Error("expected configured");
    const floor = minimumAllowedPriceCents(computed.costs, FIXTURE.paymentFee, FIXTURE.marginPolicy);
    expect(floor).not.toBeNull();
    if (floor === null) return;

    const productCost = productCostCents(computed.costs);
    const nonFeeCost = computed.costs.totalCostCents - computed.costs.paymentFeeCents;
    const grossMarginAt = (p: number) => (p - productCost) / p;
    const contributionAt = (p: number) => (p - nonFeeCost - (Math.round((p * 290) / 10_000) + 30)) / p;

    expect(grossMarginAt(floor)).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(contributionAt(floor)).toBeGreaterThanOrEqual(0.15 - 1e-9);
    // One cent lower violates at least one floor.
    const gOk = grossMarginAt(floor - 1) >= 0.3;
    const cOk = contributionAt(floor - 1) >= 0.15;
    expect(gOk && cOk).toBe(false);
  });

  it("price floor allows healthy prices and blocks below-floor prices", () => {
    const ok = evaluatePriceFloor(SELL_TOTAL, product, config, FIXTURE);
    expect(ok.allowed).toBe(true);

    const tooLow = evaluatePriceFloor(45_000, product, config, FIXTURE); // $450 — under the margin floor
    expect(tooLow.allowed).toBe(false);
    if (!tooLow.allowed) expect(tooLow.violatedRules).toContain("below_minimum_allowed_price");
  });

  it("fails closed when costs exist but no margin floor is configured", () => {
    const noPolicy: CostModelConfig = {
      ...FIXTURE,
      marginPolicy: {
        minimumGrossMarginBps: null,
        minimumContributionMarginBps: null,
        targetGrossMarginBps: null,
        targetContributionMarginBps: null,
      },
    };
    const calc = calculatePrice(product, config, noPolicy);
    if (!calc.ok) throw new Error("expected priced");
    expect(calc.costStatus).toBe("configured");
    expect(calc.minimumAllowedPriceCents).toBeNull();

    const verdict = evaluatePriceFloor(SELL_TOTAL, product, config, noPolicy);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.violatedRules).toContain("margin_policy_unconfigured");
  });

  it("per-unit and per-order shipping bases compute as configured", () => {
    const perUnit: CostModelConfig = structuredClone(FIXTURE);
    perUnit.products[product.id].shipping = { kind: "per_unit", centsPerUnit: 4 };
    const a = computeCosts(product, config, SELL_TOTAL, perUnit);
    if (a.status !== "configured") throw new Error("expected configured");
    expect(a.costs.estimatedShippingCents).toBe(4 * 5000);

    const perOrder: CostModelConfig = structuredClone(FIXTURE);
    perOrder.products[product.id].shipping = { kind: "per_order", centsPerOrder: 55_000 };
    const b = computeCosts(product, config, SELL_TOTAL, perOrder);
    if (b.status !== "configured") throw new Error("expected configured");
    expect(b.costs.estimatedShippingCents).toBe(55_000);
  });

  it("a partially configured model (one missing size entry) is unconfigured, never guessed", () => {
    const partial: CostModelConfig = structuredClone(FIXTURE);
    delete partial.products[product.id].sizeAdjustmentCentsPerUnit!.l;
    const computed = computeCosts(product, config, SELL_TOTAL, partial);
    expect(computed.status).toBe("unconfigured");
    if (computed.status === "unconfigured") {
      expect(computed.missingInputs).toEqual([`products.${product.id}.sizeAdjustmentCentsPerUnit.l`]);
    }
  });

  it("calculatePrice refuses configurations that need a custom quote", () => {
    const customDims = calculatePrice(
      product,
      { ...config, customDimensions: { width: 40, height: 40, gusset: 25 } },
      FIXTURE,
    );
    expect(customDims.ok).toBe(false);
    if (!customDims.ok) expect(customDims.reason).toBe("requires_custom_quote");
    const belowMoq = calculatePrice(product, { ...config, quantity: 100 }, FIXTURE);
    expect(belowMoq.ok).toBe(false);
    const offTier = calculatePrice(product, { ...config, quantity: 12_000 }, FIXTURE);
    expect(offTier.ok).toBe(false);
  });
});
