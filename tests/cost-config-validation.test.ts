import { describe, expect, it } from "vitest";
import { COST_MODEL } from "@/config/costs";
import { PRODUCTS } from "@/config/products";
import { assessCostReadiness, isCostModelConfigured, validateCostModel, type CostModelConfig } from "@/modules/pricing";

/**
 * Session 13.5 — cost configuration validation + readiness (spec §37–§39).
 *
 * The doctrine under test: `null` is the documented UNCONFIGURED state and
 * is never an error; a value that is PRESENT and WRONG is an error and is
 * never silently normalised into something plausible.
 */

const valid = (): CostModelConfig => ({
  version: "test-valid",
  products: Object.fromEntries(
    PRODUCTS.map((p) => [
      p.id,
      {
        baseManufacturingCentsPerUnit: 50,
        sizeAdjustmentCentsPerUnit: Object.fromEntries(p.sizes.map((s) => [s.id, 0])),
        materialAdjustmentCentsPerUnit: Object.fromEntries(p.materials.map((m) => [m.id, 0])),
        printing: Object.fromEntries(p.printOptions.map((o) => [o.id, { centsPerUnit: 5, setupFeeCents: 10_000 }])),
        packagingCentsPerUnit: 1,
        shipping: { kind: "per_order" as const, centsPerOrder: 20_000 },
        otherVariableCentsPerUnit: 0,
      },
    ]),
  ),
  orderCosts: { packagingCentsPerOrder: 0, handlingCentsPerOrder: 5_000 },
  paymentFee: { percentBps: 290, fixedCents: 30 },
  shippingPolicy: { customerCharge: { kind: "not_collected" } },
  marginPolicy: {
    minimumGrossMarginBps: 3000,
    minimumContributionMarginBps: 1500,
    targetGrossMarginBps: 5000,
    targetContributionMarginBps: 4000,
  },
});

const errorsAt = (model: CostModelConfig, pathFragment: string) =>
  validateCostModel(model, PRODUCTS).errors.filter((e) => e.path.includes(pathFragment));

/* ------------------------------------------------------------------ */
/* Valid + unconfigured baselines                                      */
/* ------------------------------------------------------------------ */

describe("validation baselines", () => {
  it("a fully configured model is valid with no errors", () => {
    const result = validateCostModel(valid(), PRODUCTS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("the SHIPPED all-null production model is VALID — null is not an error", () => {
    const result = validateCostModel(COST_MODEL, PRODUCTS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    // …but it is definitively not configured.
    expect(isCostModelConfigured(COST_MODEL)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* §39 — invalid values fail loudly                                    */
/* ------------------------------------------------------------------ */

describe("invalid configuration fails safely and is never normalised (§39)", () => {
  it("rejects a negative manufacturing cost", () => {
    const m = valid();
    m.products[PRODUCTS[0].id].baseManufacturingCentsPerUnit = -10;
    const errors = errorsAt(m, "baseManufacturingCentsPerUnit");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/cannot be negative/i);
  });

  it("rejects a fractional cent", () => {
    const m = valid();
    m.products[PRODUCTS[0].id].packagingCentsPerUnit = 1.5;
    expect(errorsAt(m, "packagingCentsPerUnit")[0].message).toMatch(/integer cents/i);
  });

  it("rejects a negative fixed payment fee", () => {
    const m = valid();
    m.paymentFee.fixedCents = -30;
    expect(errorsAt(m, "paymentFee.fixedCents")).toHaveLength(1);
  });

  it("rejects a payment fee of 100% or more", () => {
    const m = valid();
    m.paymentFee.percentBps = 10_000;
    expect(errorsAt(m, "paymentFee.percentBps")[0].message).toMatch(/below 10000 bps/i);
  });

  it("rejects a negative margin", () => {
    const m = valid();
    m.marginPolicy.minimumGrossMarginBps = -1;
    expect(errorsAt(m, "minimumGrossMarginBps")[0].message).toMatch(/cannot be negative/i);
  });

  it("rejects a margin of 100% or more — unsatisfiable at any price", () => {
    const m = valid();
    m.marginPolicy.minimumContributionMarginBps = 10_000;
    expect(errorsAt(m, "minimumContributionMarginBps").length).toBeGreaterThan(0);
  });

  it("rejects a minimum contribution margin that the payment fee makes unreachable", () => {
    const m = valid();
    m.marginPolicy.minimumContributionMarginBps = 9800; // 98% + 2.9% fee ≥ 100%
    expect(errorsAt(m, "minimumContributionMarginBps").some((e) => /reaches or exceeds 100%/.test(e.message))).toBe(
      true,
    );
  });

  it("rejects a target margin below its own minimum", () => {
    const m = valid();
    m.marginPolicy.targetGrossMarginBps = 1000; // below the 3000 floor
    expect(errorsAt(m, "targetGrossMarginBps")[0].message).toMatch(/below its own minimum/i);
  });

  it("rejects tiers that are not in ascending order", () => {
    const m = valid();
    m.products[PRODUCTS[0].id].manufacturingTiers = [
      { minQty: 5_000, centsPerUnit: 44 },
      { minQty: 1_000, centsPerUnit: 50 },
    ];
    expect(errorsAt(m, "manufacturingTiers")[0].message).toMatch(/ascending minQty order/i);
  });

  it("rejects duplicate tier breakpoints", () => {
    const m = valid();
    m.products[PRODUCTS[0].id].manufacturingTiers = [
      { minQty: 1_000, centsPerUnit: 50 },
      { minQty: 1_000, centsPerUnit: 44 },
    ];
    expect(errorsAt(m, "manufacturingTiers").some((e) => /Duplicate tier/.test(e.message))).toBe(true);
  });

  it("rejects an empty tier array — omit the key instead", () => {
    const m = valid();
    m.products[PRODUCTS[0].id].manufacturingTiers = [];
    expect(errorsAt(m, "manufacturingTiers")[0].message).toMatch(/non-empty array/i);
  });

  it("rejects a cost entry for a product that is not in the catalog", () => {
    const m = valid();
    m.products["p-does-not-exist"] = m.products[PRODUCTS[0].id];
    expect(errorsAt(m, "p-does-not-exist")[0].message).toMatch(/No catalog product/i);
  });

  it("rejects a catalog product that has no cost entry", () => {
    const m = valid();
    delete m.products[PRODUCTS[1].id];
    expect(errorsAt(m, PRODUCTS[1].id)[0].message).toMatch(/no cost entry/i);
  });

  it("rejects a missing printing option that the product actually offers", () => {
    const m = valid();
    delete m.products[PRODUCTS[0].id].printing!["full-custom"];
    expect(errorsAt(m, "printing.full-custom")[0].message).toMatch(/no cost is configured/i);
  });

  it("rejects a missing size the product actually offers", () => {
    const m = valid();
    delete m.products[PRODUCTS[0].id].sizeAdjustmentCentsPerUnit!.xl;
    expect(errorsAt(m, "sizeAdjustmentCentsPerUnit.xl")[0].message).toMatch(/no cost is configured/i);
  });

  it("rejects a non-positive units-per-carton", () => {
    const m = valid();
    m.products[PRODUCTS[0].id].shipping = { kind: "per_carton", centsPerCarton: 2_000, unitsPerCarton: 0 };
    expect(errorsAt(m, "unitsPerCarton")[0].message).toMatch(/positive integer/i);
  });

  it("rejects a missing cost-model version stamp", () => {
    const m = valid();
    m.version = "";
    expect(errorsAt(m, "version")[0].message).toMatch(/version stamp is required/i);
  });

  it("WARNS — rather than errors — on a cost that can never apply", () => {
    const m = valid();
    m.products[PRODUCTS[0].id].printing!["hot-foil"] = { centsPerUnit: 20, setupFeeCents: 5_000 };
    const result = validateCostModel(m, PRODUCTS);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.path.includes("hot-foil"))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* §38 — the owner-facing readiness view                               */
/* ------------------------------------------------------------------ */

describe("cost readiness view (§37, §38)", () => {
  it("reports every category MISSING and every capability UNAVAILABLE today", () => {
    const r = assessCostReadiness(COST_MODEL, PRODUCTS);
    expect(r.costModelConfigured).toBe(false);
    expect(r.marginFloorConfigured).toBe(false);
    expect(r.grossProfitAvailable).toBe(false);
    expect(r.contributionProfitAvailable).toBe(false);

    const byKey = Object.fromEntries(r.categories.map((c) => [c.key, c.state]));
    expect(byKey["manufacturing"]).toBe("MISSING");
    expect(byKey["printing"]).toBe("MISSING");
    expect(byKey["printing-setup"]).toBe("MISSING");
    expect(byKey["packaging-unit"]).toBe("MISSING");
    expect(byKey["packaging-order"]).toBe("MISSING");
    expect(byKey["payment-fee"]).toBe("MISSING");
    expect(byKey["min-gross-margin"]).toBe("MISSING");
    expect(byKey["min-contribution-margin"]).toBe("MISSING");

    for (const capability of r.capabilities) {
      expect(capability.state).toBe("UNAVAILABLE");
      expect(capability.blockers.length).toBeGreaterThan(0);
    }
  });

  it("reports the customer shipping charge as CONFIGURED — it is a known structural fact", () => {
    const r = assessCostReadiness(COST_MODEL, PRODUCTS);
    expect(r.categories.find((c) => c.key === "shipping-charge")?.state).toBe("CONFIGURED");
  });

  it("names exact config paths so the owner has a to-do list, not the word 'unavailable'", () => {
    const r = assessCostReadiness(COST_MODEL, PRODUCTS);
    expect(r.missingConfiguration.every((p) => p.startsWith("config/costs.ts → "))).toBe(true);
    expect(r.missingConfiguration.some((p) => p.includes("baseManufacturingCentsPerUnit"))).toBe(true);
    expect(r.missingConfiguration.some((p) => p.includes("orderCosts.handlingCentsPerOrder"))).toBe(true);
  });

  it("turns every capability READY once a valid model is fully configured", () => {
    const r = assessCostReadiness(valid(), PRODUCTS);
    expect(r.costModelConfigured).toBe(true);
    expect(r.marginFloorConfigured).toBe(true);
    expect(r.grossProfitAvailable).toBe(true);
    expect(r.contributionProfitAvailable).toBe(true);
    expect(r.categories.every((c) => c.state === "CONFIGURED")).toBe(true);
    expect(r.capabilities.every((c) => c.state === "READY")).toBe(true);
    expect(r.missingConfiguration).toEqual([]);
  });

  it("an INVALID value blocks profit intelligence even when nothing is missing", () => {
    const m = valid();
    m.paymentFee.percentBps = 20_000; // 200%
    const r = assessCostReadiness(m, PRODUCTS);
    expect(r.validation.valid).toBe(false);
    expect(r.categories.find((c) => c.key === "payment-fee")?.state).toBe("INVALID");
    expect(r.contributionProfitAvailable).toBe(false);
    expect(r.capabilities.find((c) => c.key === "POAS")?.state).toBe("UNAVAILABLE");
    expect(r.summary).toMatch(/invalid/i);
  });

  it("costs configured but no margin floor ⇒ price action safety stays UNAVAILABLE", () => {
    const m = valid();
    m.marginPolicy.minimumGrossMarginBps = null;
    m.marginPolicy.minimumContributionMarginBps = null;
    const r = assessCostReadiness(m, PRODUCTS);
    expect(r.costModelConfigured).toBe(true);
    expect(r.capabilities.find((c) => c.key === "GROSS_PROFIT")?.state).toBe("READY");
    expect(r.capabilities.find((c) => c.key === "PRICE_ACTION_SAFETY")?.state).toBe("UNAVAILABLE");
    expect(r.summary).toMatch(/fails closed/i);
  });

  it("stamps the cost-model version so a readout is attributable", () => {
    expect(assessCostReadiness(COST_MODEL, PRODUCTS).costModelVersion).toBe(COST_MODEL.version);
  });
});
