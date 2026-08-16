import { PRICING_INTELLIGENCE } from "@/config/pricing-intelligence";
import { isDemoPricing } from "@/config/business";
import { listCatalogProducts } from "@/lib/commerce/catalog";
import { listInsights, listOpportunities } from "@/lib/data/insight-service";
import { loadSessionEventFacts } from "@/lib/data/pricing-intelligence-service";
import { loadConversationCorpus } from "@/modules/customer-intelligence/aggregate";
import { previousPeriod, type Period } from "@/modules/customer-intelligence/period";
import { compareTrend, type Trend } from "@/modules/business-intelligence/trend";
import {
  buildAiSalesPricingMetrics,
  buildPricingAttribution,
  buildPricingSegments,
  type AiSalesPricingMetrics,
  type PricingAttributionRow,
  type PricingSegmentRow,
} from "./breakdowns";
import { loadQuantityDemand, type QuantityDemand } from "./demand";
import { countPricingConversations, loadPricingFunnel, type PricingFunnel } from "./funnel";
import { buildMoqIntelligence, type MoqIntelligence } from "./moq";
import { loadProductPricingPerformance, type ProductPricingPerformance } from "./products";
import {
  assessCostReadiness,
  assessElasticity,
  assessPriceLimits,
  assessPricingReadiness,
  type CostReadiness,
  type PriceLimitStatus,
} from "./readiness";
import { loadPriceRealization, type PriceRealization } from "./realization";
import { buildPricingSignals, hasExplicitEvidence } from "./signals";
import { loadTierPerformance, type TierPerformance } from "./tier-performance";
import type { ElasticityAssessment, PricingReadiness, PricingSignal } from "./types";

/**
 * PricingIntelligenceSnapshot (spec §33) — the ONE deterministic structure
 * everything downstream consumes. The admin dashboard renders it; the
 * Pricing Agent receives a bounded, PII-free rendering of it as its ONLY
 * quantitative input.
 *
 * No LLM touches anything in this file, and nothing in this module can call
 * one: `modules/pricing-intelligence` has no `lib/ai` import (asserted
 * structurally, like S08–S11).
 *
 * The deterministic Pricing Engine (`modules/pricing`) remains the sole
 * pricing authority. This snapshot READS it — catalog tier prices, and a
 * re-quote of stored order configurations — and writes nothing.
 */

export type PricingTrendLine = { name: string; label: string; trend: Trend };

export type PricingDataQualityWarning = { code: string; message: string };

export type PricingIntelligenceSnapshot = {
  generatedAt: Date;
  period: { start: Date; end: Date; days: number; label: string };
  previous: { start: Date; end: Date; days: number; label: string };
  funnel: PricingFunnel;
  demand: QuantityDemand;
  tiers: TierPerformance;
  moq: MoqIntelligence;
  realization: PriceRealization;
  products: ProductPricingPerformance;
  segments: PricingSegmentRow[];
  attribution: PricingAttributionRow[];
  aiSales: AiSalesPricingMetrics;
  signals: PricingSignal[];
  costs: CostReadiness;
  priceLimits: PriceLimitStatus[];
  readiness: PricingReadiness;
  elasticity: ElasticityAssessment;
  trends: PricingTrendLine[];
  dataQuality: PricingDataQualityWarning[];
};

/**
 * Whether the Session 11 experiment engine supports a REAL price variant.
 *
 * It deliberately does not, and Session 12 preserves that (spec §30–§31):
 * the target registry contains only presentation surfaces, and a price test
 * would change cart totals, checkout and what a returning customer sees.
 * This constant exists so the readiness model states the fact rather than
 * a code path pretending to check for it.
 */
export const PRICE_EXPERIMENT_SUPPORTED = false;

export async function buildPricingIntelligenceSnapshot(period: Period): Promise<PricingIntelligenceSnapshot> {
  const prev = previousPeriod(period);

  const [products, corpus, prevCorpus, opportunities, insights] = await Promise.all([
    listCatalogProducts(),
    loadConversationCorpus(period),
    loadConversationCorpus(prev),
    listOpportunities(100),
    listInsights(100),
  ]);

  const [funnel, demand, tiers, realization] = await Promise.all([
    loadPricingFunnel(period, corpus),
    loadQuantityDemand(period, products),
    loadTierPerformance(period, products, corpus),
    loadPriceRealization(period, products),
  ]);

  const costs = assessCostReadiness();
  const priceLimits = assessPriceLimits();
  const moq = buildMoqIntelligence({ demand, corpus, opportunities });
  const productPerformance = await loadProductPricingPerformance(period, products, tiers, costs);

  /* Session sets for the AI-sales pricing metrics — deterministic events. */
  const conversionFacts = await loadSessionEventFacts(period.start, period.end, ["add_to_cart", "purchase_completed"]);
  const cartSessionIds = new Set(conversionFacts.filter((f) => f.name === "add_to_cart").map((f) => f.sessionId));
  const purchaseSessionIds = new Set(
    conversionFacts.filter((f) => f.name === "purchase_completed").map((f) => f.sessionId),
  );

  const signals = buildPricingSignals({
    funnel,
    tiers,
    moq,
    realization,
    costs,
    pricingInsightRefs: insights.map((i) => ({ id: i.id, insightType: i.insightType, title: i.title })),
  });

  const readiness = assessPricingReadiness({
    costs,
    limits: priceLimits,
    hasBehavioralEvidence: funnel.priceViewSessions > 0 || funnel.conversations.classified > 0,
    priceExperimentSupported: PRICE_EXPERIMENT_SUPPORTED,
  });

  /* Trends — counts only, with S09's explicit states (never +∞%). */
  const prevConversations = countPricingConversations(prevCorpus);
  const prevFunnelFacts = await loadSessionEventFacts(prev.start, prev.end, ["price_viewed"]);
  const prevPriceViewSessions = new Set(prevFunnelFacts.map((f) => f.sessionId)).size;

  const trends: PricingTrendLine[] = [
    {
      name: "price_view_sessions",
      label: "Sessions that saw a price",
      trend: compareTrend(funnel.priceViewSessions, prevPriceViewSessions),
    },
    {
      name: "price_questions",
      label: "Conversations asking about price",
      trend: compareTrend(funnel.conversations.priceQuestion, prevConversations.priceQuestion),
    },
    {
      name: "price_objections",
      label: "Conversations saying the price is too high",
      trend: compareTrend(funnel.conversations.priceObjection, prevConversations.priceObjection),
    },
    {
      name: "moq_objections",
      label: "Conversations saying the minimum is too high",
      trend: compareTrend(funnel.conversations.moqObjection, prevConversations.moqObjection),
    },
    {
      name: "below_moq_requests",
      label: "Prospects stating a below-minimum quantity",
      trend: compareTrend(demand.requested.belowMoqStated, 0),
    },
  ];

  const dataQuality = buildDataQuality({ costs, funnel, tiers, realization, demand });

  return {
    generatedAt: new Date(),
    period: { start: period.start, end: period.end, days: period.days, label: period.label },
    previous: { start: prev.start, end: prev.end, days: prev.days, label: prev.label },
    funnel,
    demand,
    tiers,
    moq,
    realization,
    products: productPerformance,
    segments: buildPricingSegments(corpus),
    attribution: buildPricingAttribution(corpus),
    aiSales: buildAiSalesPricingMetrics({ corpus, cartSessionIds, purchaseSessionIds }),
    signals,
    costs,
    priceLimits,
    readiness,
    elasticity: assessElasticity(0),
    trends,
    dataQuality,
  };
}

function buildDataQuality(input: {
  costs: CostReadiness;
  funnel: PricingFunnel;
  tiers: TierPerformance;
  realization: PriceRealization;
  demand: QuantityDemand;
}): PricingDataQualityWarning[] {
  const warnings: PricingDataQualityWarning[] = [];

  if (!input.costs.costModelConfigured) {
    warnings.push({
      code: "COST_MODEL_UNCONFIGURED",
      message:
        "Manufacturing costs are not configured (config/costs.ts), so margin, profit impact and the minimum safe price are unavailable. They are never assumed to be zero, and no specific price change can be shown to be safe.",
    });
  }
  if (!input.costs.marginPolicyConfigured) {
    warnings.push({
      code: "MARGIN_POLICY_UNCONFIGURED",
      message:
        "No minimum margin policy exists (config/costs.ts → marginPolicy), so the deterministic price floor fails closed. Any price-affecting action is refused as unverifiable.",
    });
  }
  warnings.push({
    code: "NO_CONTROLLED_PRICE_VARIATION",
    message:
      "The same bag has never been offered at two different prices to comparable customers, so price elasticity cannot be estimated. No elasticity figure is produced anywhere in this system.",
  });
  if (!input.realization.repricing.instrumented) {
    warnings.push({ code: "REPRICING_NOT_INSTRUMENTED", message: input.realization.repricing.reason });
  }
  warnings.push({
    code: "CHECKOUT_NOT_TIER_ATTRIBUTABLE",
    message:
      "Checkout events record a cart value, not a product and quantity, so checkout cannot be broken down by quantity tier. That column is shown as unavailable rather than zero.",
  });
  if (input.tiers.unattributedConversations > 0) {
    warnings.push({
      code: "UNATTRIBUTED_CONVERSATIONS",
      message: `${input.tiers.unattributedConversations} classified conversations have no configured or stated quantity, so per-tier question and objection rates under-report by that many.`,
    });
  }
  if (
    input.funnel.priceViewSessions > 0 &&
    input.funnel.priceViewSessions < PRICING_INTELLIGENCE.MIN_DENOMINATOR_FOR_PERCENTAGE
  ) {
    warnings.push({
      code: "LOW_SAMPLE",
      message: `Only ${input.funnel.priceViewSessions} sessions saw a price in this period — percentages below the minimum denominator (${PRICING_INTELLIGENCE.MIN_DENOMINATOR_FOR_PERCENTAGE}) are suppressed and small differences are not meaningful.`,
    });
  }
  if (isDemoPricing()) {
    warnings.push({
      code: "DEMO_PRICING_ACTIVE",
      message:
        "Demo pricing is still active — every tier price on this page is a placeholder, not a confirmed price list. Pricing conclusions drawn from it are about the placeholder.",
    });
  }
  if (input.demand.purchased.belowMoqLines > 0) {
    warnings.push({
      code: "BELOW_MOQ_PURCHASE_RECORDED",
      message: `${input.demand.purchased.belowMoqLines} purchased order lines are below the catalog minimum, which the pricing engine should refuse to price. Investigate before drawing any pricing conclusion from this period.`,
    });
  }
  return warnings;
}

/** Behavioural + explicit evidence exists at all — used by the admin surface. */
export const snapshotHasPriceFriction = (snapshot: PricingIntelligenceSnapshot): boolean =>
  hasExplicitEvidence(snapshot.signals);
