import { PRICING_INTELLIGENCE } from "@/config/pricing-intelligence";
import { loadProductEventFacts } from "@/lib/data/pricing-intelligence-service";
import type { Period } from "@/modules/customer-intelligence/period";
import type { Product } from "@/types/commerce";
import { baseUnitPriceCents, startingUnitPriceCents } from "@/modules/pricing";
import { pricingRatio, type PricingRatio } from "./funnel";
import type { CostReadiness } from "./readiness";
import type { TierPerformance } from "./tier-performance";

/**
 * PER-PRODUCT PRICING PERFORMANCE (spec §15).
 *
 * Revenue, orders, AOV and units come from real rows. GROSS MARGIN does NOT:
 * while `config/costs.ts` holds unfilled placeholders it is reported as
 * UNAVAILABLE with the reason, because **revenue is not a proxy for profit**
 * (spec §44). A product that sells well may be the least profitable one in
 * the catalog, and this module refuses to imply otherwise.
 */

export type ProductPricingRow = {
  productId: string;
  title: string;
  currency: string;
  /** Catalog reference prices — what customers are shown, from the engine. */
  entryUnitPriceCents: number;
  bestUnitPriceCents: number;
  moq: number;
  tierCount: number;
  /** Distinct sessions that viewed this product's page. */
  productViewSessions: number;
  /** Distinct sessions that saw a computed price for this product. */
  priceViewSessions: number;
  /** Distinct sessions that added this product to a cart. */
  cartSessions: number;
  purchaseRateAfterPriceView: PricingRatio;
  orders: number;
  unitsPurchased: number;
  revenueCents: number;
  averageOrderLineValueCents: number | null;
  /** Which quantity band dominates this product's purchases. */
  dominantBandLabel: string | null;
  priceQuestionConversations: number;
  priceObjectionConversations: number;
  moqObjectionConversations: number;
  /**
   * Gross margin availability. Never a number while costs are unconfigured;
   * `null` here means UNKNOWN, and every renderer says so in words.
   */
  grossMargin: { available: false; reason: string } | { available: true; marginPct: number };
};

export type ProductPricingPerformance = {
  rows: ProductPricingRow[];
  marginAvailability: { available: boolean; reason: string; missingConfiguration: string[] };
  notes: string[];
};

export const PRODUCT_PRICING_NOTES = [
  "Revenue is not profit. While manufacturing costs are unconfigured, margin is unavailable — a high-revenue product may be the least profitable one.",
  "Entry price is the lowest-quantity tier price; best price is the highest-quantity tier price. Both exclude per-unit option costs.",
  "Purchase rate after a price view counts sessions that did both, over sessions that saw a price for this product.",
];

const PRODUCT_EVENTS = ["product_viewed", "price_viewed", "add_to_cart", "purchase_completed"] as const;

export async function loadProductPricingPerformance(
  period: Period,
  products: Product[],
  tiers: TierPerformance,
  costs: CostReadiness,
): Promise<ProductPricingPerformance> {
  const facts = await loadProductEventFacts(period.start, period.end, PRODUCT_EVENTS);

  const sessionsFor = (productId: string, name: string): Set<string> =>
    new Set(facts.filter((f) => f.productId === productId && f.name === name).map((f) => f.sessionId));

  const rows: ProductPricingRow[] = products.map((product) => {
    const bands = tiers.rows.filter((r) => r.productId === product.id);
    const purchases = bands.reduce(
      (acc, b) => ({
        lines: acc.lines + b.purchasedLines,
        units: acc.units + b.unitsPurchased,
        revenue: acc.revenue + b.revenueCents,
      }),
      { lines: 0, units: 0, revenue: 0 },
    );
    const dominant = bands.reduce<(typeof bands)[number] | null>(
      (acc, b) => (acc === null || b.unitsPurchased > acc.unitsPurchased ? b : acc),
      null,
    );

    const priceViewSessionIds = sessionsFor(product.id, "price_viewed");
    const purchaseSessions = new Set(facts.filter((f) => f.name === "purchase_completed").map((f) => f.sessionId));
    const bought = [...priceViewSessionIds].filter((s) => purchaseSessions.has(s)).length;

    return {
      productId: product.id,
      title: product.title,
      currency: product.currency,
      entryUnitPriceCents: baseUnitPriceCents(product),
      bestUnitPriceCents: startingUnitPriceCents(product),
      moq: product.minQuantity,
      tierCount: product.pricingTiers.length,
      productViewSessions: sessionsFor(product.id, "product_viewed").size,
      priceViewSessions: priceViewSessionIds.size,
      cartSessions: sessionsFor(product.id, "add_to_cart").size,
      purchaseRateAfterPriceView: pricingRatio(bought, priceViewSessionIds.size),
      orders: purchases.lines,
      unitsPurchased: purchases.units,
      revenueCents: purchases.revenue,
      averageOrderLineValueCents: purchases.lines > 0 ? Math.round(purchases.revenue / purchases.lines) : null,
      dominantBandLabel: dominant && dominant.unitsPurchased > 0 ? dominant.label : null,
      priceQuestionConversations: bands.reduce((n, b) => n + b.priceQuestionConversations, 0),
      priceObjectionConversations: bands.reduce((n, b) => n + b.priceObjectionConversations, 0),
      moqObjectionConversations: bands.reduce((n, b) => n + b.moqObjectionConversations, 0),
      grossMargin: {
        available: false,
        reason:
          "Unavailable — configure manufacturing costs. Margin cannot be computed from a price alone, and is never assumed to be zero.",
      },
    };
  });

  return {
    rows: rows.slice(0, PRICING_INTELLIGENCE.MAX_BREAKDOWN_ROWS),
    marginAvailability: {
      available: costs.grossMarginAvailable,
      reason: costs.grossMarginAvailable
        ? "Product cost inputs are configured — gross margin can be computed per order in Business Intelligence."
        : "Unavailable — configure manufacturing costs (config/costs.ts). Margin is never estimated and never rendered as zero.",
      missingConfiguration: costs.missingConfiguration,
    },
    notes: PRODUCT_PRICING_NOTES,
  };
}
