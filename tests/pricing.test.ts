import { describe, expect, it } from "vitest";
import {
  optionDeltaCents,
  quoteConfiguration,
  requiresCustomQuote,
  savingsPct,
  tierForQuantity,
} from "@/modules/pricing";
import { PRODUCTS } from "@/config/products";
import type { PricingTier, ProductConfiguration } from "@/types/commerce";

const product = PRODUCTS[0]; // Custom Insulated Takeout Bag (launch product)

const baseConfig: ProductConfiguration = {
  productId: product.id,
  sizeId: "l",
  materialId: "insulated",
  colorId: "black",
  printOptionId: "full-custom",
  quantity: 5000,
};

/** A multi-tier table, so the pure kernel is still exercised at boundaries. */
const TIERS: PricingTier[] = [
  { minQty: 500, unitPriceCents: 62 },
  { minQty: 1000, unitPriceCents: 54 },
  { minQty: 5000, unitPriceCents: 42 },
];

describe("tierForQuantity", () => {
  it("returns null below the smallest tier", () => {
    expect(tierForQuantity(TIERS, 100)).toBeNull();
    expect(tierForQuantity(product.pricingTiers, 4_999)).toBeNull();
  });
  it("selects the exact tier at a boundary", () => {
    expect(tierForQuantity(TIERS, 5000)?.unitPriceCents).toBe(42);
    expect(tierForQuantity(product.pricingTiers, 5000)?.unitPriceCents).toBe(19);
    expect(tierForQuantity(product.pricingTiers, 10000)?.unitPriceCents).toBe(15);
  });
  it("selects the lower tier just under a boundary", () => {
    expect(tierForQuantity(TIERS, 4999)?.unitPriceCents).toBe(54);
    expect(tierForQuantity(product.pricingTiers, 9_999)?.unitPriceCents).toBe(19);
  });
  it("selects the top tier for very large quantities", () => {
    expect(tierForQuantity(TIERS, 100000)?.unitPriceCents).toBe(42);
    expect(tierForQuantity(product.pricingTiers, 100000)?.unitPriceCents).toBe(15);
  });
  it("handles empty tier lists", () => {
    expect(tierForQuantity([], 5000)).toBeNull();
  });
});

describe("optionDeltaCents", () => {
  it("is 0 for the Large size with the fixed material and printing", () => {
    expect(optionDeltaCents(product, { sizeId: "l", materialId: "insulated", printOptionId: "full-custom" })).toBe(0);
  });
  it("adds the size delta — Extra Large is +4¢/bag", () => {
    expect(optionDeltaCents(product, { sizeId: "xl", materialId: "insulated", printOptionId: "full-custom" })).toBe(4);
  });
  it("ignores unknown option ids", () => {
    expect(optionDeltaCents(product, { sizeId: "nope", materialId: "nope", printOptionId: "none" })).toBe(0);
  });
});

/**
 * The four confirmed launch prices. These are the numbers a customer is
 * charged, so they are asserted as exact totals, not as arithmetic on the
 * same constants the engine uses.
 */
describe("Product #1 launch prices", () => {
  const price = (sizeId: string, quantity: number) =>
    quoteConfiguration(product, { ...baseConfig, sizeId, quantity });

  it("Large 5,000 = $950 ($0.19/bag)", () => {
    const q = price("l", 5000)!;
    expect(q.unitPriceCents).toBe(19);
    expect(q.totalCents).toBe(95_000);
  });
  it("Large 10,000 = $1,500 ($0.15/bag)", () => {
    const q = price("l", 10000)!;
    expect(q.unitPriceCents).toBe(15);
    expect(q.totalCents).toBe(150_000);
  });
  it("Extra Large 5,000 = $1,150 ($0.23/bag)", () => {
    const q = price("xl", 5000)!;
    expect(q.unitPriceCents).toBe(23);
    expect(q.totalCents).toBe(115_000);
  });
  it("Extra Large 10,000 = $1,900 ($0.19/bag)", () => {
    const q = price("xl", 10000)!;
    expect(q.unitPriceCents).toBe(19);
    expect(q.totalCents).toBe(190_000);
  });
  it("every launch price is a whole number of cents per unit", () => {
    for (const sizeId of ["l", "xl"]) {
      for (const quantity of product.quantityPresets) {
        const q = price(sizeId, quantity)!;
        expect(Number.isInteger(q.unitPriceCents)).toBe(true);
        expect(q.totalCents).toBe(q.unitPriceCents * quantity);
      }
    }
  });
});

describe("quoteConfiguration", () => {
  it("prices a standard configuration", () => {
    const q = quoteConfiguration(product, baseConfig);
    expect(q).not.toBeNull();
    expect(q!.unitPriceCents).toBe(19);
    expect(q!.totalCents).toBe(19 * 5000);
  });
  it("returns null below MOQ", () => {
    expect(quoteConfiguration(product, { ...baseConfig, quantity: 100 })).toBeNull();
  });
  it("total = unit × quantity, always in integer cents", () => {
    const q = quoteConfiguration(product, { ...baseConfig, quantity: 10000 });
    expect(q!.totalCents).toBe(q!.unitPriceCents * 10000);
    expect(Number.isInteger(q!.totalCents)).toBe(true);
  });
});

describe("savingsPct", () => {
  it("is 0 at the base tier", () => {
    expect(savingsPct(product.pricingTiers, product.pricingTiers[0])).toBe(0);
  });
  it("computes the discount vs the base tier", () => {
    const top = product.pricingTiers[product.pricingTiers.length - 1];
    expect(savingsPct(product.pricingTiers, top)).toBeCloseTo((19 - 15) / 19);
  });
});

describe("requiresCustomQuote", () => {
  it("an orderable configuration does not need a quote", () => {
    expect(requiresCustomQuote(product, baseConfig)).toBe(false);
    expect(requiresCustomQuote(product, { ...baseConfig, sizeId: "xl", quantity: 10000 })).toBe(false);
  });
  it("custom dimensions route to quote", () => {
    expect(
      requiresCustomQuote(product, { ...baseConfig, customDimensions: { width: 20, height: 20, gusset: 12 } }),
    ).toBe(true);
  });
  it("below-MOQ routes to quote", () => {
    expect(requiresCustomQuote(product, { ...baseConfig, quantity: 4_999 })).toBe(true);
    expect(requiresCustomQuote(product, { ...baseConfig, quantity: 200 })).toBe(true);
  });
  it("an off-tier quantity routes to quote when the product publishes fixed quantities", () => {
    expect(product.allowCustomQuantity).toBe(false);
    for (const quantity of [5_001, 7_500, 12_000, 25_000]) {
      expect(requiresCustomQuote(product, { ...baseConfig, quantity })).toBe(true);
    }
  });
  it("custom color routes to quote when a product offers one", () => {
    const withCustomColor = PRODUCTS.find((p) => p.colors.some((c) => c.custom))!;
    expect(
      requiresCustomQuote(withCustomColor, {
        productId: withCustomColor.id,
        sizeId: withCustomColor.sizes[0].id,
        materialId: withCustomColor.materials[0].id,
        colorId: "custom",
        printOptionId: "none",
        quantity: withCustomColor.quantityPresets[1],
      }),
    ).toBe(true);
  });
});
