import type { Product } from "@/types/commerce";

/**
 * Quantity BANDS derived from the REAL catalog (spec §14).
 *
 * Nothing here is invented. A band is exactly one configured pricing tier:
 * `[tier.minQty, nextTier.minQty)`, plus a below-MOQ band taken from the
 * product's own `minQuantity`. If the owner changes the tier ladder, the
 * bands change with it — there is no parallel "reporting bucket" table to
 * drift out of sync.
 *
 * The displayed unit price on a band is the TIER's unit price, which is the
 * price before per-unit option deltas (material / printing). That is stated
 * on every rendering surface rather than silently averaged away: option
 * deltas are per-configuration and would make a band price a fiction.
 */

export type QuantityBand = {
  /** `${productId}:${minQty}` — stable and citable. */
  key: string;
  productId: string;
  productTitle: string;
  /** The tier's minQty. `null` for the below-MOQ band, which has no tier. */
  tierMinQty: number | null;
  /** Inclusive lower bound. */
  minQty: number;
  /** Exclusive upper bound; Infinity for the top band. */
  maxQty: number;
  label: string;
  /** Tier unit price in cents, BEFORE option deltas. Null below MOQ. */
  unitPriceCents: number | null;
  currency: string;
  /** True for the synthetic band below the product's minimum order quantity. */
  belowMoq: boolean;
};

const fmt = (n: number): string => n.toLocaleString("en-US");

const bandLabel = (min: number, max: number): string =>
  max === Number.POSITIVE_INFINITY ? `${fmt(min)}+` : `${fmt(min)}–${fmt(max - 1)}`;

/**
 * All bands for one product: a below-MOQ band (demand we do not serve
 * today) followed by one band per configured pricing tier, ascending.
 */
export function bandsForProduct(product: Product): QuantityBand[] {
  const tiers = [...product.pricingTiers].sort((a, b) => a.minQty - b.minQty);
  const bands: QuantityBand[] = [];

  if (product.minQuantity > 1) {
    bands.push({
      key: `${product.id}:below_moq`,
      productId: product.id,
      productTitle: product.title,
      tierMinQty: null,
      minQty: 0,
      maxQty: product.minQuantity,
      label: `Below MOQ (<${fmt(product.minQuantity)})`,
      unitPriceCents: null,
      currency: product.currency,
      belowMoq: true,
    });
  }

  tiers.forEach((tier, index) => {
    const next = tiers[index + 1];
    const maxQty = next ? next.minQty : Number.POSITIVE_INFINITY;
    bands.push({
      key: `${product.id}:${tier.minQty}`,
      productId: product.id,
      productTitle: product.title,
      tierMinQty: tier.minQty,
      minQty: tier.minQty,
      maxQty,
      label: bandLabel(tier.minQty, maxQty),
      unitPriceCents: tier.unitPriceCents,
      currency: product.currency,
      belowMoq: false,
    });
  });

  return bands;
}

export function bandsForCatalog(products: Product[]): QuantityBand[] {
  return products.flatMap(bandsForProduct);
}

/** The band a quantity falls in for a given product, or null when unknown. */
export function bandForQuantity(bands: QuantityBand[], productId: string, quantity: number): QuantityBand | null {
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  for (const band of bands) {
    if (band.productId !== productId) continue;
    if (quantity >= band.minQty && quantity < band.maxQty) return band;
  }
  return null;
}

/**
 * CATALOG-WIDE quantity buckets for distributions that are not scoped to a
 * single product (requested quantities rarely name one). Derived from the
 * DISTINCT tier breakpoints across the whole catalog plus the strictest
 * MOQ — again, no invented ranges.
 */
export type QuantityBucket = { key: string; label: string; minQty: number; maxQty: number; belowMoq: boolean };

export function catalogQuantityBuckets(products: Product[]): QuantityBucket[] {
  const moq = products.length > 0 ? Math.min(...products.map((p) => p.minQuantity)) : 0;
  const breakpoints = [...new Set(products.flatMap((p) => p.pricingTiers.map((t) => t.minQty)))]
    .filter((q) => q >= moq)
    .sort((a, b) => a - b);

  const buckets: QuantityBucket[] = [];
  if (moq > 0) {
    buckets.push({ key: "below_moq", label: `Below MOQ (<${fmt(moq)})`, minQty: 0, maxQty: moq, belowMoq: true });
  }
  breakpoints.forEach((min, index) => {
    const max = breakpoints[index + 1] ?? Number.POSITIVE_INFINITY;
    buckets.push({ key: `q_${min}`, label: bandLabel(min, max), minQty: min, maxQty: max, belowMoq: false });
  });
  return buckets;
}

export function bucketForQuantity(buckets: QuantityBucket[], quantity: number): QuantityBucket | null {
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  return buckets.find((b) => quantity >= b.minQty && quantity < b.maxQty) ?? null;
}

/** The strictest MOQ in the catalog — the "we do not serve this" boundary. */
export function catalogMoq(products: Product[]): number {
  return products.length > 0 ? Math.min(...products.map((p) => p.minQuantity)) : 0;
}
