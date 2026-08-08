import { describe, expect, it } from "vitest";
import {
  optionDeltaCents,
  quoteConfiguration,
  requiresCustomQuote,
  savingsPct,
  tierForQuantity,
} from "@/lib/pricing/engine";
import { PRODUCTS } from "@/config/products";
import type { ProductConfiguration } from "@/types/commerce";

const product = PRODUCTS[0]; // Custom Non-Woven Takeout Bag

const baseConfig: ProductConfiguration = {
  productId: product.id,
  sizeId: "m",
  materialId: "standard",
  colorId: "white",
  printOptionId: "none",
  quantity: 5000,
};

describe("tierForQuantity", () => {
  it("returns null below the smallest tier", () => {
    expect(tierForQuantity(product.pricingTiers, 100)).toBeNull();
  });
  it("selects the exact tier at a boundary", () => {
    expect(tierForQuantity(product.pricingTiers, 5000)?.unitPriceCents).toBe(42);
  });
  it("selects the lower tier just under a boundary", () => {
    expect(tierForQuantity(product.pricingTiers, 4999)?.unitPriceCents).toBe(47);
  });
  it("selects the top tier for very large quantities", () => {
    expect(tierForQuantity(product.pricingTiers, 100000)?.unitPriceCents).toBe(33);
  });
  it("handles empty tier lists", () => {
    expect(tierForQuantity([], 5000)).toBeNull();
  });
});

describe("optionDeltaCents", () => {
  it("is 0 for standard material + no print", () => {
    expect(optionDeltaCents(product, { materialId: "standard", printOptionId: "none" })).toBe(0);
  });
  it("sums material and print deltas", () => {
    expect(optionDeltaCents(product, { materialId: "heavy", printOptionId: "two-color" })).toBe(6 + 9);
  });
  it("ignores unknown option ids", () => {
    expect(optionDeltaCents(product, { materialId: "nope", printOptionId: "none" })).toBe(0);
  });
});

describe("quoteConfiguration", () => {
  it("prices a standard configuration", () => {
    const q = quoteConfiguration(product, baseConfig);
    expect(q).not.toBeNull();
    expect(q!.unitPriceCents).toBe(42);
    expect(q!.totalCents).toBe(42 * 5000);
  });
  it("adds option deltas to the tier price", () => {
    const q = quoteConfiguration(product, { ...baseConfig, printOptionId: "one-color" });
    expect(q!.unitPriceCents).toBe(42 + 5);
  });
  it("returns null below MOQ", () => {
    expect(quoteConfiguration(product, { ...baseConfig, quantity: 100 })).toBeNull();
  });
  it("total = unit × quantity, always in integer cents", () => {
    const q = quoteConfiguration(product, { ...baseConfig, quantity: 2500 });
    expect(q!.totalCents).toBe(q!.unitPriceCents * 2500);
    expect(Number.isInteger(q!.totalCents)).toBe(true);
  });
});

describe("savingsPct", () => {
  it("is 0 at the base tier", () => {
    expect(savingsPct(product.pricingTiers, product.pricingTiers[0])).toBe(0);
  });
  it("computes the discount vs the base tier", () => {
    const top = product.pricingTiers[product.pricingTiers.length - 1];
    expect(savingsPct(product.pricingTiers, top)).toBeCloseTo((62 - 33) / 62);
  });
});

describe("requiresCustomQuote", () => {
  it("standard config does not need a quote", () => {
    expect(requiresCustomQuote(product, baseConfig)).toBe(false);
  });
  it("custom color routes to quote", () => {
    expect(requiresCustomQuote(product, { ...baseConfig, colorId: "custom" })).toBe(true);
  });
  it("custom dimensions route to quote", () => {
    expect(
      requiresCustomQuote(product, { ...baseConfig, customDimensions: { width: 20, height: 20, gusset: 12 } }),
    ).toBe(true);
  });
  it("below-MOQ routes to quote", () => {
    expect(requiresCustomQuote(product, { ...baseConfig, quantity: 200 })).toBe(true);
  });
});
