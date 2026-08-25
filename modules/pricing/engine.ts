import type { PriceQuote, PricingTier, Product, ProductConfiguration } from "@/types/commerce";

/**
 * Tiered pricing engine. Pure functions — unit-tested in tests/pricing.test.ts.
 * All money is integer cents; formatting happens at the edge (lib/format.ts).
 */

/** Find the applicable tier for a quantity. Tiers must be ascending by minQty. */
export function tierForQuantity(tiers: PricingTier[], quantity: number): PricingTier | null {
  if (!tiers.length || quantity < tiers[0].minQty) return null;
  let match = tiers[0];
  for (const t of tiers) {
    if (quantity >= t.minQty) match = t;
    else break;
  }
  return match;
}

/**
 * Sum of per-unit option deltas (size + material + printing) in cents.
 *
 * The SIZE delta is what lets one quantity-tier table serve differently
 * priced sizes: Product #1's Extra Large is a flat +4¢/bag over Large at
 * every tier, which reproduces its four confirmed prices exactly in integer
 * cents (config/products.ts). An unknown option id contributes 0 — the
 * caller's validation, not arithmetic, is what rejects it.
 */
export function optionDeltaCents(
  product: Product,
  config: Pick<ProductConfiguration, "materialId" | "printOptionId"> & Partial<Pick<ProductConfiguration, "sizeId">>,
): number {
  const size = config.sizeId === undefined ? undefined : product.sizes.find((s) => s.id === config.sizeId);
  const material = product.materials.find((m) => m.id === config.materialId);
  const print = product.printOptions.find((p) => p.id === config.printOptionId);
  return (size?.priceDeltaCents ?? 0) + (material?.priceDeltaCents ?? 0) + (print?.priceDeltaCents ?? 0);
}

/** Savings vs the smallest-quantity tier, as a fraction 0–1. */
export function savingsPct(tiers: PricingTier[], tier: PricingTier): number {
  if (!tiers.length) return 0;
  const base = tiers[0].unitPriceCents;
  if (base <= 0) return 0;
  return Math.max(0, (base - tier.unitPriceCents) / base);
}

/**
 * Quote a configuration. Returns null when the quantity is below the
 * product minimum (the UI routes that to Request Custom Pricing).
 */
export function quoteConfiguration(product: Product, config: ProductConfiguration): PriceQuote | null {
  if (config.quantity < product.minQuantity) return null;
  const tier = tierForQuantity(product.pricingTiers, config.quantity);
  if (!tier) return null;
  const unitPriceCents = tier.unitPriceCents + optionDeltaCents(product, config);
  return {
    unitPriceCents,
    totalCents: unitPriceCents * config.quantity,
    tier,
    savingsPct: savingsPct(product.pricingTiers, tier),
    currency: product.currency,
  };
}

/** Starting price = cheapest configured unit price at the highest tier's floor option set. */
export function startingUnitPriceCents(product: Product): number {
  const lastTier = product.pricingTiers[product.pricingTiers.length - 1];
  return lastTier?.unitPriceCents ?? 0;
}

/** Lowest-quantity ("starting at") price with no option deltas. */
export function baseUnitPriceCents(product: Product): number {
  return product.pricingTiers[0]?.unitPriceCents ?? 0;
}

/**
 * True when the configuration cannot be auto-priced and must go through the
 * custom-quote flow:
 *
 *   - custom dimensions       (the factory supports them; the price is not
 *                              a published number)
 *   - a custom colour
 *   - below the product MOQ
 *   - an off-tier quantity on a product with `allowCustomQuantity: false`.
 *     For Product #1 the two presets ARE the orderable quantities: 12,000
 *     and 25,000 have no published price, so they are quoted rather than
 *     invented. This is enforced here — in the engine both the configurator
 *     and /api/checkout call — so a hand-crafted request cannot buy a
 *     quantity nobody priced.
 */
export function requiresCustomQuote(product: Product, config: ProductConfiguration): boolean {
  if (config.customDimensions) return true;
  const color = product.colors.find((c) => c.id === config.colorId);
  if (color?.custom) return true;
  if (config.quantity < product.minQuantity) return true;
  if (!product.allowCustomQuantity && !product.quantityPresets.includes(config.quantity)) return true;
  return false;
}
