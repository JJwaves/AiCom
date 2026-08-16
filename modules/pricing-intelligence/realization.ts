import { listPricedOrderLines, type PricedOrderLine } from "@/lib/data/pricing-intelligence-service";
import type { Period } from "@/modules/customer-intelligence/period";
import { quoteConfiguration } from "@/modules/pricing";
import type { Product } from "@/types/commerce";

/**
 * PRICE REALIZATION + REPRICING (spec §11–§12).
 *
 * There are no discounts in this system: the deterministic engine is the
 * only price authority and no discount mechanism exists. So "realization"
 * is NOT a leakage metric — inventing one would imply a leak that cannot
 * happen. What this file does instead is a narrow integrity check:
 *
 *   the price the customer actually paid (the immutable order-line snapshot)
 *   vs
 *   what the engine would charge for that same configuration TODAY.
 *
 * A difference is EXPECTED and legitimate whenever the catalog price list
 * changed after the order was placed. It is reported as `explained:
 * catalog_price_changed`, never as leakage. What it is genuinely useful for
 * is the opposite: a difference that CANNOT be explained (the product or its
 * tier no longer exists) surfaces as a data-integrity note.
 *
 * REPRICING (the /api/checkout 409 REPRICED path) is deliberately reported
 * as NOT INSTRUMENTED. The route answers 409 and the client re-confirms, but
 * no first-party event records it, so there is no deterministic count of
 * repricing events, confirmations after repricing, or abandonment after
 * repricing. Session 12 says so and lists it as a data gap rather than
 * deriving a number from something else.
 */

export type RealizationVariance = {
  orderId: string;
  lineId: string;
  productId: string;
  quantity: number;
  paidUnitPriceCents: number;
  currentUnitPriceCents: number | null;
  differenceCents: number | null;
  explanation: "catalog_price_changed" | "product_not_in_catalog" | "not_priceable_today";
};

export type PriceRealization = {
  linesChecked: number;
  linesMatchingCurrentCatalog: number;
  variances: RealizationVariance[];
  /** True when every checked line matched today's catalog exactly. */
  allMatch: boolean;
  notes: string[];
  repricing: RepricingAvailability;
};

export type RepricingAvailability = {
  instrumented: false;
  reason: string;
  /** What would need to exist before repricing metrics could be computed. */
  requirements: string[];
};

export const REPRICING_UNAVAILABLE: RepricingAvailability = {
  instrumented: false,
  reason:
    "Checkout re-quotes every cart against the live catalog and answers 409 REPRICED when a price moved, but no first-party event records that it happened. " +
    "So the number of repricing events, how many customers confirmed afterwards, and how many abandoned are all unknown — they are not estimated from anything else.",
  requirements: [
    "A first-party event recorded when /api/checkout answers 409 REPRICED (and when the customer confirms the new total).",
    "A first-party event for the AI cart path's `repriced` result (lib/commerce/cart-line.ts).",
  ],
};

const MAX_VARIANCES = 25;

export const REALIZATION_NOTES = [
  "There are no discounts: the deterministic pricing engine is the only price authority, so a difference here is never revenue leakage.",
  "Order lines store an immutable price snapshot. A difference from today's catalog means the price list changed after the order — that is legitimate repricing, not a loss.",
  "Prices are compared before per-unit option costs are re-derived from the stored configuration; the engine recomputes them from the same snapshot the order used.",
];

export async function loadPriceRealization(period: Period, products: Product[]): Promise<PriceRealization> {
  const lines = await listPricedOrderLines(period.start, period.end);
  const byId = new Map(products.map((p) => [p.id, p]));

  let matching = 0;
  const variances: RealizationVariance[] = [];

  for (const line of lines) {
    if (line.orderStatus === "cancelled" || line.orderStatus === "refunded") continue;
    const product = byId.get(line.productId);
    if (!product) {
      pushVariance(variances, {
        orderId: line.orderId,
        lineId: line.lineId,
        productId: line.productId,
        quantity: line.quantity,
        paidUnitPriceCents: line.unitPriceCents,
        currentUnitPriceCents: null,
        differenceCents: null,
        explanation: "product_not_in_catalog",
      });
      continue;
    }
    const quote = quoteConfiguration(product, line.configJson);
    if (!quote) {
      pushVariance(variances, {
        orderId: line.orderId,
        lineId: line.lineId,
        productId: line.productId,
        quantity: line.quantity,
        paidUnitPriceCents: line.unitPriceCents,
        currentUnitPriceCents: null,
        differenceCents: null,
        explanation: "not_priceable_today",
      });
      continue;
    }
    if (quote.unitPriceCents === line.unitPriceCents) {
      matching += 1;
      continue;
    }
    pushVariance(variances, {
      orderId: line.orderId,
      lineId: line.lineId,
      productId: line.productId,
      quantity: line.quantity,
      paidUnitPriceCents: line.unitPriceCents,
      currentUnitPriceCents: quote.unitPriceCents,
      differenceCents: quote.unitPriceCents - line.unitPriceCents,
      explanation: "catalog_price_changed",
    });
  }

  const checked = countedLines(lines);
  return {
    linesChecked: checked,
    linesMatchingCurrentCatalog: matching,
    variances,
    allMatch: checked > 0 && matching === checked,
    notes: REALIZATION_NOTES,
    repricing: REPRICING_UNAVAILABLE,
  };
}

const countedLines = (lines: PricedOrderLine[]): number =>
  lines.filter((l) => l.orderStatus !== "cancelled" && l.orderStatus !== "refunded").length;

function pushVariance(list: RealizationVariance[], variance: RealizationVariance): void {
  if (list.length < MAX_VARIANCES) list.push(variance);
}
