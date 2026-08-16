import { PRICING_INTELLIGENCE } from "@/config/pricing-intelligence";
import { listConfigurationsUpdatedBetween } from "@/lib/data/intelligence-service";
import {
  listPricedOrderLines,
  loadQuantityEvents,
  type PricedOrderLine,
} from "@/lib/data/pricing-intelligence-service";
import type { ConversationCorpus } from "@/modules/customer-intelligence/aggregate";
import type { Period } from "@/modules/customer-intelligence/period";
import type { Product } from "@/types/commerce";
import { pricingRatio, type PricingRatio } from "./funnel";
import { bandForQuantity, bandsForCatalog, type QuantityBand } from "./tiers";

/**
 * QUANTITY-TIER PERFORMANCE (spec §10).
 *
 * One row per configured pricing tier, counted over real rows. Nothing here
 * is causal: a tier with more purchases has not been shown to convert
 * BECAUSE of its price. The rows describe what happened at each price point
 * and stop there.
 *
 * Honest gaps, stated rather than filled:
 *  - `checkoutSessions` is UNAVAILABLE per tier. `checkout_started` carries
 *    a cart value, not a product and quantity, so attributing it to a tier
 *    would require a guess. It is reported as null, not as zero.
 *  - The displayed unit price is the TIER price, before per-unit option
 *    deltas (material, printing). Stated on the surface that renders it.
 *
 * CONVERSATION ATTRIBUTION (used for the per-tier question/objection rates):
 * a conversation is attributed to the band of its session's CONFIGURED
 * quantity when one exists, otherwise to the band of a USER_STATED requested
 * quantity. Conversations with neither are `unattributed` and counted
 * separately — never spread across bands.
 */

export type TierPerformanceRow = {
  bandKey: string;
  productId: string;
  productTitle: string;
  tierMinQty: number | null;
  label: string;
  belowMoq: boolean;
  unitPriceCents: number | null;
  currency: string;
  /** Distinct sessions that selected a quantity in this band (configurator). */
  quantitySelectedSessions: number;
  /** Live configurator rows whose quantity sits in this band. */
  configuredConfigurations: number;
  /** Distinct sessions that added a cart line with a quantity in this band. */
  cartSessions: number;
  /** Deliberately null — checkout events carry no product/quantity. */
  checkoutSessions: null;
  /** Order lines purchased in this band. */
  purchasedLines: number;
  unitsPurchased: number;
  revenueCents: number;
  /** Conversations attributed to this band (see the rule above). */
  conversations: number;
  priceQuestionConversations: number;
  priceObjectionConversations: number;
  moqObjectionConversations: number;
  priceQuestionRate: PricingRatio;
  priceObjectionRate: PricingRatio;
  moqObjectionRate: PricingRatio;
};

export type TierPerformance = {
  rows: TierPerformanceRow[];
  /** Conversations that could not be attributed to any band. */
  unattributedConversations: number;
  /** Currencies present in purchases — a headline is single-currency only. */
  currencies: string[];
  notes: string[];
};

export const TIER_PERFORMANCE_NOTES = [
  "The unit price shown is the tier price before per-unit option costs (material, printing) — the configurator adds those per configuration.",
  "Checkout is not attributable to a tier: the checkout event records a cart value, not a product and quantity. It is shown as unavailable, never as zero.",
  "These rows are descriptive. A tier converting better has NOT been shown to convert because of its price — the customers in each band differ in many ways at once.",
  "A conversation is attributed to the band of its session's configured quantity, or its stated requested quantity when no configuration exists. Conversations with neither are counted as unattributed.",
];

export async function loadTierPerformance(
  period: Period,
  products: Product[],
  corpus: ConversationCorpus,
): Promise<TierPerformance> {
  const bands = bandsForCatalog(products);
  const [quantityEvents, configurations, orderLines] = await Promise.all([
    loadQuantityEvents(period.start, period.end),
    listConfigurationsUpdatedBetween(period.start, period.end),
    listPricedOrderLines(period.start, period.end),
  ]);

  const rows = new Map<string, TierPerformanceRow>();
  for (const band of bands) rows.set(band.key, emptyRow(band));

  /* --- Configurator quantity selections (distinct sessions per band) --- */
  const seenSelect = new Set<string>();
  const seenCart = new Set<string>();
  for (const event of quantityEvents) {
    const band = bandForQuantity(bands, event.productId, event.quantity);
    if (!band) continue;
    const dedupKey = `${band.key}:${event.sessionId}`;
    if (event.name === "quantity_selected") {
      if (seenSelect.has(dedupKey)) continue;
      seenSelect.add(dedupKey);
      rows.get(band.key)!.quantitySelectedSessions += 1;
    } else if (event.name === "add_to_cart") {
      if (seenCart.has(dedupKey)) continue;
      seenCart.add(dedupKey);
      rows.get(band.key)!.cartSessions += 1;
    }
  }

  /* --- Live configurator rows, and the session → band map for conversations --- */
  const bandBySessionFromConfig = new Map<string, QuantityBand>();
  for (const config of configurations) {
    const quantity = config.configJson?.quantity;
    if (typeof quantity !== "number") continue;
    const band = bandForQuantity(bands, config.productId, quantity);
    if (!band) continue;
    rows.get(band.key)!.configuredConfigurations += 1;
    if (!bandBySessionFromConfig.has(config.sessionId)) bandBySessionFromConfig.set(config.sessionId, band);
  }

  /* --- Purchases (immutable order-line snapshots) --- */
  const currencies = new Set<string>();
  for (const line of orderLines) {
    if (!isCountedLine(line)) continue;
    currencies.add(line.currency);
    const band = bandForQuantity(bands, line.productId, line.quantity);
    if (!band) continue;
    const row = rows.get(band.key)!;
    row.purchasedLines += 1;
    row.unitsPurchased += line.quantity;
    row.revenueCents += line.totalCents;
  }

  /* --- Conversation attribution --- */
  let unattributed = 0;
  for (const fact of corpus.facts) {
    if (!fact.classification) continue;
    const band = attributeConversation(fact, bands, bandBySessionFromConfig);
    if (!band) {
      unattributed += 1;
      continue;
    }
    const row = rows.get(band.key)!;
    row.conversations += 1;
    if (fact.classification.questionsJson.some((q) => q.theme === "PRICE")) row.priceQuestionConversations += 1;
    if (fact.classification.objectionsJson.some((o) => o.type === "PRICE_TOO_HIGH")) row.priceObjectionConversations += 1;
    if (fact.classification.objectionsJson.some((o) => o.type === "MOQ_TOO_HIGH")) row.moqObjectionConversations += 1;
  }

  const finished = [...rows.values()].map((row) => ({
    ...row,
    priceQuestionRate: pricingRatio(row.priceQuestionConversations, row.conversations),
    priceObjectionRate: pricingRatio(row.priceObjectionConversations, row.conversations),
    moqObjectionRate: pricingRatio(row.moqObjectionConversations, row.conversations),
  }));

  return {
    rows: finished,
    unattributedConversations: unattributed,
    currencies: [...currencies].sort(),
    notes: TIER_PERFORMANCE_NOTES,
  };
}

/** Cancelled / refunded orders are excluded from revenue, exactly as in S09. */
function isCountedLine(line: PricedOrderLine): boolean {
  return line.orderStatus !== "cancelled" && line.orderStatus !== "refunded";
}

function attributeConversation(
  fact: ConversationCorpus["facts"][number],
  bands: QuantityBand[],
  bandBySession: Map<string, QuantityBand>,
): QuantityBand | null {
  const fromConfig = bandBySession.get(fact.conversation.sessionId);
  if (fromConfig) return fromConfig;
  const profile = fact.needProfile;
  if (!profile || profile.quantity === null) return null;
  if (profile.fieldSourcesJson?.quantity?.source !== "USER_STATED") return null;
  // A requested quantity names no product, so it attributes to the band of
  // the product the session showed interest in — or, failing that, to no band.
  const productId = profile.productInterest;
  if (typeof productId !== "string") return null;
  return bandForQuantity(bands, productId, profile.quantity);
}

function emptyRow(band: QuantityBand): TierPerformanceRow {
  return {
    bandKey: band.key,
    productId: band.productId,
    productTitle: band.productTitle,
    tierMinQty: band.tierMinQty,
    label: band.label,
    belowMoq: band.belowMoq,
    unitPriceCents: band.unitPriceCents,
    currency: band.currency,
    quantitySelectedSessions: 0,
    configuredConfigurations: 0,
    cartSessions: 0,
    checkoutSessions: null,
    purchasedLines: 0,
    unitsPurchased: 0,
    revenueCents: 0,
    conversations: 0,
    priceQuestionConversations: 0,
    priceObjectionConversations: 0,
    moqObjectionConversations: 0,
    priceQuestionRate: pricingRatio(0, 0),
    priceObjectionRate: pricingRatio(0, 0),
    moqObjectionRate: pricingRatio(0, 0),
  };
}

/** Rows worth rendering: any activity at all, capped for the dashboard. */
export function topTierRows(performance: TierPerformance): TierPerformanceRow[] {
  return performance.rows
    .filter(
      (r) =>
        r.quantitySelectedSessions > 0 ||
        r.configuredConfigurations > 0 ||
        r.cartSessions > 0 ||
        r.purchasedLines > 0 ||
        r.conversations > 0,
    )
    .slice(0, PRICING_INTELLIGENCE.MAX_BREAKDOWN_ROWS);
}
