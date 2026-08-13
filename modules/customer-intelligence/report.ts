import { CUSTOMER_INTELLIGENCE } from "@/config/customer-intelligence";
import { listInsights, listOpportunities, type InsightRow, type OpportunityRow } from "@/lib/data/insight-service";
import { listConversationsNeedingClassification } from "@/lib/data/intelligence-service";
import {
  aggregateObjections,
  aggregateQuestions,
  aggregateRequests,
  attributionSegments,
  businessTypeSegments,
  conversionAssociations,
  loadConversationCorpus,
  loadDemandSignals,
  loadFunnelMetrics,
  outcomeFunnel,
  productGaps,
  type AttributionSegment,
  type ConversationCorpus,
  type ConversionAssociation,
  type DemandSignals,
  type FunnelMetrics,
  type ObjectionAggregate,
  type QuestionAggregate,
  type RequestAggregate,
  type SegmentCount,
} from "./aggregate";
import { previousPeriod, safePercentage, safeTrendPct, type Period } from "./period";
import { CLASSIFIER_VERSION, type OutcomeGroup } from "./taxonomy";

/**
 * Admin report assembly (Session 08 spec §29) — every number deterministic,
 * every percentage paired with its denominator, trends only when the
 * previous-period base is meaningful. The report never triggers AI work:
 * classification coverage is whatever the last explicit processing run
 * left behind, and the pending count is surfaced honestly.
 */

export type ThemeWithTrend = QuestionAggregate & {
  percentage: number | null;
  trendPct: number | null;
  previousConversations: number | null;
};

export type ObjectionWithTrend = ObjectionAggregate & {
  percentage: number | null;
  purchaseRatePct: number | null;
  trendPct: number | null;
};

export type CustomerIntelligenceReport = {
  period: Period;
  previous: Period;
  generatedAt: Date;
  overview: {
    totalConversations: number;
    qualifiedConversations: number;
    classifiedConversations: number;
    qualifiedClassified: number;
    aiAssistedPurchases: number;
    totalOrders: number;
    humanHandoffs: number;
    purchaseRate: { numerator: number; denominator: number; percentage: number | null };
  };
  questions: ThemeWithTrend[];
  objections: ObjectionWithTrend[];
  gaps: RequestAggregate[];
  customQuoteRequests: RequestAggregate[];
  demand: DemandSignals;
  funnel: FunnelMetrics;
  outcomeGroups: Record<OutcomeGroup, number>;
  associations: ConversionAssociation[];
  businessSegments: SegmentCount[];
  attribution: AttributionSegment[];
  /**
   * Conservative lost-opportunity signals (spec §23) — a non-purchase is
   * never labeled "lost revenue"; only commercially meaningful unmet
   * demand appears here, each with its caveat rendered by the UI.
   */
  lostOpportunities: {
    /** Catalog-unsupported requests inside QUALIFIED conversations. */
    unsupportedQualified: { normalized: string; kind: string; qualifiedConversations: number }[];
    /** Customer-STATED below-MOQ quantities (need profiles, USER_STATED only). */
    belowMoqStated: number;
    /** Escalated conversations in period (a human follow-up exists; purchase state unknown at conversation level). */
    escalatedConversations: number;
  };
  insights: InsightRow[];
  opportunities: OpportunityRow[];
  processing: {
    classifierVersion: string;
    pendingClassification: number;
    failedClassifications: number;
  };
  thresholds: typeof CUSTOMER_INTELLIGENCE;
};

export async function buildCustomerIntelligenceReport(period: Period): Promise<CustomerIntelligenceReport> {
  const prev = previousPeriod(period);
  const [corpus, prevCorpus, demand, funnel, insights, opportunities, pending] = await Promise.all([
    loadConversationCorpus(period),
    loadConversationCorpus(prev),
    loadDemandSignals(period),
    loadFunnelMetrics(period),
    listInsights(100),
    listOpportunities(100),
    listConversationsNeedingClassification(CLASSIFIER_VERSION, 1000),
  ]);

  const questions = aggregateQuestions(corpus);
  const prevQuestions = new Map(aggregateQuestions(prevCorpus).map((q) => [q.theme, q]));
  const objections = aggregateObjections(corpus);
  const prevObjections = new Map(aggregateObjections(prevCorpus).map((o) => [o.type, o]));
  const requests = aggregateRequests(corpus);

  const purchased = corpus.facts.filter((f) => f.qualified && f.purchased).length;

  return {
    period,
    previous: prev,
    generatedAt: new Date(),
    overview: {
      totalConversations: corpus.totals.conversations,
      qualifiedConversations: corpus.totals.qualified,
      classifiedConversations: corpus.totals.classified,
      qualifiedClassified: corpus.totals.qualifiedClassified,
      aiAssistedPurchases: funnel.purchases.aiAssisted,
      totalOrders: funnel.purchases.total,
      humanHandoffs: outcomeFunnel(corpus).human_handoff,
      purchaseRate: {
        numerator: purchased,
        denominator: corpus.totals.qualified,
        percentage: safePercentage(purchased, corpus.totals.qualified),
      },
    },
    questions: questions.map((q) => {
      const prevAgg = prevQuestions.get(q.theme);
      return {
        ...q,
        percentage: safePercentage(q.qualifiedConversations, corpus.totals.qualifiedClassified),
        trendPct: safeTrendPct(q.conversations, prevAgg?.conversations ?? 0),
        previousConversations: prevAgg?.conversations ?? null,
      };
    }),
    objections: objections.map((o) => ({
      ...o,
      percentage: safePercentage(o.qualifiedConversations, corpus.totals.qualifiedClassified),
      purchaseRatePct: safePercentage(o.purchased, o.conversations),
      trendPct: safeTrendPct(o.conversations, prevObjections.get(o.type)?.conversations ?? 0),
    })),
    gaps: productGaps(requests),
    customQuoteRequests: requests.filter((r) => r.support === "custom_quote_path"),
    lostOpportunities: {
      unsupportedQualified: productGaps(requests)
        .filter((g) => g.qualifiedConversations > 0)
        .map((g) => ({ normalized: g.normalized, kind: g.kind, qualifiedConversations: g.qualifiedConversations })),
      belowMoqStated: demand.requested.belowMoq.stated,
      escalatedConversations: outcomeFunnel(corpus).human_handoff,
    },
    demand,
    funnel,
    outcomeGroups: outcomeFunnel(corpus),
    associations: conversionAssociations(corpus),
    businessSegments: businessTypeSegments(corpus),
    attribution: attributionSegments(corpus),
    insights,
    opportunities,
    processing: {
      classifierVersion: CLASSIFIER_VERSION,
      pendingClassification: pending.length,
      failedClassifications: corpus.totals.failedClassifications,
    },
    thresholds: CUSTOMER_INTELLIGENCE,
  };
}

export type { ConversationCorpus };
