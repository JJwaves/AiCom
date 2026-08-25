import { BUSINESS_INTELLIGENCE } from "@/config/business-intelligence";
import { isDemoPricing } from "@/config/business";
import { listAllCatalogProducts } from "@/lib/commerce/catalog";
import { listInsights, listOpportunities } from "@/lib/data/insight-service";
import { listConversationsNeedingClassification } from "@/lib/data/intelligence-service";
import {
  aggregateObjections,
  aggregateQuestions,
  aggregateRequests,
  loadConversationCorpus,
  productGaps,
} from "@/modules/customer-intelligence/aggregate";
import { previousPeriod, type Period } from "@/modules/customer-intelligence/period";
import { loadAdSpendSummary, type AdSpendSummary } from "@/modules/google-ads-intelligence/spend";
import { CLASSIFIER_VERSION } from "@/modules/customer-intelligence/taxonomy";
import { loadAiSalesMetrics, type AiCostMetrics, type AiSalesMetrics } from "./ai-metrics";
import { computeAttributionBreakdowns, type AttributionBreakdowns } from "./attribution";
import { loadBusinessFunnel, type BusinessFunnel } from "./funnel";
import { computeProductPerformance, type ProductPerformance } from "./products";
import { computeProfitability, isCostModelFullyConfigured, type ProfitabilityMetrics } from "./profitability";
import { computeRevenueMetrics, loadPeriodOrders, type RevenueMetrics } from "./revenue";
import { computeSegmentMetrics, type SegmentMetrics } from "./segments";
import { compareTrend, type Trend } from "./trend";

/**
 * BusinessHealthSnapshot (Session 09 spec §17) — the ONE deterministic
 * structure everything downstream consumes: the admin dashboard renders
 * it, and the CEO agent receives it (with explicit metric availability)
 * as its ONLY quantitative input. No LLM touches anything in this file.
 */

export type CustomerSignals = {
  topQuestions: { theme: string; conversations: number; qualifiedConversations: number }[];
  topObjections: { type: string; conversations: number; qualifiedConversations: number; purchased: number }[];
  productGaps: { normalized: string; kind: string; conversations: number; qualifiedConversations: number }[];
  insights: {
    id: string;
    insightType: string;
    title: string;
    summary: string | null;
    evidenceCount: number;
    status: string;
  }[];
  opportunities: {
    id: string;
    opportunityType: string | null;
    title: string;
    description: string;
    evidenceCount: number;
    status: string;
    humanValidationRequired: boolean;
  }[];
  pendingClassification: number;
};

export type DataQualityWarning = { code: string; message: string };

export type TrendLine = { name: string; label: string; trend: Trend };

export type BusinessHealthSnapshot = {
  generatedAt: Date;
  period: { start: Date; end: Date; days: number; label: string };
  previous: { start: Date; end: Date; days: number; label: string };
  commerce: {
    revenue: RevenueMetrics;
    funnel: BusinessFunnel;
  };
  aiSales: AiSalesMetrics;
  aiCost: AiCostMetrics;
  customerSignals: CustomerSignals;
  products: ProductPerformance[];
  segments: SegmentMetrics[];
  attribution: AttributionBreakdowns;
  /**
   * Google Ads spend (Session 13).
   *
   * A SEPARATE section, deliberately: Session 09's revenue, funnel,
   * profitability and attribution semantics are unchanged by S13, and
   * `attribution.adSpendIntegrated` stays `false` because that breakdown
   * still contains no ad spend and still computes no CAC or ROAS. Spend
   * carries its own availability state, so a missing integration reads as
   * UNAVAILABLE and never as zero.
   */
  adSpend: AdSpendSummary;
  profitability: ProfitabilityMetrics;
  trends: TrendLine[];
  dataQuality: DataQualityWarning[];
};

const top = <T>(rows: T[]): T[] => rows.slice(0, BUSINESS_INTELLIGENCE.MAX_BREAKDOWN_ROWS);

export async function buildBusinessHealthSnapshot(period: Period): Promise<BusinessHealthSnapshot> {
  const prev = previousPeriod(period);

  const [current, previousOrders, corpus, prevCorpus, funnel, prevFunnel, products, insights, opportunities, pending] =
    await Promise.all([
      loadPeriodOrders(period),
      loadPeriodOrders(prev),
      loadConversationCorpus(period),
      loadConversationCorpus(prev),
      loadBusinessFunnel(period),
      loadBusinessFunnel(prev),
      listAllCatalogProducts(),
      listInsights(100),
      listOpportunities(100),
      listConversationsNeedingClassification(CLASSIFIER_VERSION, 1000),
    ]);

  const revenue = computeRevenueMetrics(current.orders, current.lines);
  const prevRevenue = computeRevenueMetrics(previousOrders.orders, previousOrders.lines);
  const profitability = computeProfitability(current.orders, current.lines, products);
  const productPerformance = computeProductPerformance(current.orders, current.lines, products);
  const [segments, attribution, adSpend, ai] = await Promise.all([
    computeSegmentMetrics(corpus, current.orders),
    computeAttributionBreakdowns(period, current.orders),
    loadAdSpendSummary(period),
    loadAiSalesMetrics(
      period,
      corpus,
      revenue.aiAssistedOrders.status === "UNAVAILABLE" ? 0 : revenue.aiAssistedOrders.value,
    ),
  ]);

  const questions = aggregateQuestions(corpus);
  const objections = aggregateObjections(corpus);
  const gaps = productGaps(aggregateRequests(corpus));

  /* Trends — counts always; revenue only when both periods share ONE currency. */
  const trends: TrendLine[] = [
    { name: "orders", label: "Orders", trend: compareTrend(countOf(revenue.orders), countOf(prevRevenue.orders)) },
    {
      name: "sessions",
      label: "Sessions",
      trend: compareTrend(funnel.sessionsStarted, prevFunnel.sessionsStarted),
    },
    {
      name: "qualified_conversations",
      label: "Qualified conversations",
      trend: compareTrend(corpus.totals.qualified, prevCorpus.totals.qualified),
    },
    {
      name: "ai_assisted_orders",
      label: "AI-assisted orders",
      trend: compareTrend(countOf(revenue.aiAssistedOrders), countOf(prevRevenue.aiAssistedOrders)),
    },
    {
      name: "cart_sessions",
      label: "Add-to-cart sessions",
      trend: compareTrend(stageSessions(funnel, "add_to_cart"), stageSessions(prevFunnel, "add_to_cart")),
    },
    {
      name: "checkout_sessions",
      label: "Checkout sessions",
      trend: compareTrend(stageSessions(funnel, "checkout_started"), stageSessions(prevFunnel, "checkout_started")),
    },
  ];
  if (
    revenue.revenueCents.status === "AVAILABLE" &&
    prevRevenue.revenueCents.status === "AVAILABLE" &&
    (revenue.currency === null || prevRevenue.currency === null || revenue.currency === prevRevenue.currency)
  ) {
    trends.unshift({
      name: "revenue",
      label: `Revenue${revenue.currency ? ` (${revenue.currency})` : ""}`,
      trend: compareTrend(revenue.revenueCents.value, prevRevenue.revenueCents.value),
    });
  }

  /* Data-quality warnings — deterministic, honest, owner-actionable. */
  const dataQuality: DataQualityWarning[] = [];
  if (!isCostModelFullyConfigured()) {
    dataQuality.push({
      code: "COST_MODEL_UNCONFIGURED",
      message:
        "Factory cost model is not (fully) configured in config/costs.ts — profitability metrics are unavailable or partial. Missing inputs are listed with the metric; they are never assumed to be zero.",
    });
  }
  if (ai.cost.unpricedCalls > 0) {
    dataQuality.push({
      code: "AI_PRICING_UNCONFIGURED",
      message: `${ai.cost.unpricedCalls} AI calls in this period have no recorded cost because model pricing is not configured (config/ai-pricing.ts). AI spend is shown as partial/unavailable, never zero.`,
    });
  }
  if (pending.length > 0) {
    dataQuality.push({
      code: "CLASSIFICATIONS_PENDING",
      message: `${pending.length} conversations still need classification — customer-signal counts may under-report until “Process new conversations” runs on the Customer Intelligence page.`,
    });
  }
  if (isDemoPricing()) {
    dataQuality.push({
      code: "DEMO_PRICING_ACTIVE",
      message: "Demo pricing is still active — revenue figures reflect demo prices, not confirmed price lists.",
    });
  }
  dataQuality.push({
    code: "NO_AD_SPEND_DATA",
    message:
      "Advertising spend is not integrated (Google/Meta APIs are a later session) — CAC and ROAS are not computed; attribution shows first-party revenue/conversion only.",
  });
  dataQuality.push({
    code: "PROVIDER_WEBHOOKS_INCOMPLETE",
    message:
      "Only mock-provider orders persist order rows today; Shopify order webhooks are a later session. Revenue reflects recorded orders only.",
  });
  if (countOf(revenue.orders) > 0 && countOf(revenue.orders) < BUSINESS_INTELLIGENCE.MIN_DENOMINATOR_FOR_PERCENTAGE) {
    dataQuality.push({
      code: "LOW_SAMPLE",
      message: `Only ${countOf(revenue.orders)} orders in this period — percentages below the minimum denominator (${BUSINESS_INTELLIGENCE.MIN_DENOMINATOR_FOR_PERCENTAGE}) are suppressed and small differences are not meaningful.`,
    });
  }

  return {
    generatedAt: new Date(),
    period: { start: period.start, end: period.end, days: period.days, label: period.label },
    previous: { start: prev.start, end: prev.end, days: prev.days, label: prev.label },
    commerce: { revenue, funnel },
    aiSales: ai.sales,
    aiCost: ai.cost,
    customerSignals: {
      topQuestions: top(questions).map((q) => ({
        theme: q.theme,
        conversations: q.conversations,
        qualifiedConversations: q.qualifiedConversations,
      })),
      topObjections: top(objections).map((o) => ({
        type: o.type,
        conversations: o.conversations,
        qualifiedConversations: o.qualifiedConversations,
        purchased: o.purchased,
      })),
      productGaps: top(gaps).map((g) => ({
        normalized: g.normalized,
        kind: g.kind,
        conversations: g.conversations,
        qualifiedConversations: g.qualifiedConversations,
      })),
      insights: insights.slice(0, 25).map((i) => ({
        id: i.id,
        insightType: i.insightType,
        title: i.title,
        summary: i.summary,
        evidenceCount: i.evidenceCount,
        status: i.status,
      })),
      opportunities: opportunities.slice(0, 25).map((o) => ({
        id: o.id,
        opportunityType: o.opportunityType,
        title: o.title,
        description: o.description,
        evidenceCount: o.evidenceCount,
        status: o.status,
        humanValidationRequired: o.humanValidationRequired,
      })),
      pendingClassification: pending.length,
    },
    products: top(productPerformance),
    segments: top(segments),
    attribution,
    adSpend,
    profitability,
    trends,
    dataQuality,
  };
}

const countOf = (m: { status: string; value?: number }): number =>
  m.status === "UNAVAILABLE" || m.value === undefined ? 0 : m.value;

const stageSessions = (funnel: BusinessFunnel, name: string): number =>
  funnel.stages.find((s) => s.name === name)?.sessions ?? 0;
