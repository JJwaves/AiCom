/**
 * modules/customer-intelligence — the DETERMINISTIC customer-intelligence
 * authority (Session 08; docs/CUSTOMER_INTELLIGENCE.md is authoritative).
 *
 * This module owns taxonomies, the qualified-conversation rule, catalog
 * support verdicts, aggregation, and insight/opportunity generation. It
 * deliberately has NO lib/ai import: nothing in here can call a model, so
 * counts, percentages, funnels, and trends are structurally incapable of
 * being fabricated. AI classification lives in
 * lib/ai/agents/customer-intelligence and only LABELS messages; those
 * labels are validated + persisted before this module ever reads them.
 */

export * from "./taxonomy";
export * from "./period";
export * from "./qualified";
export * from "./catalog-support";
export * from "./aggregate";
export { buildInsightCandidates, persistInsights, generateInsightsForPeriod, type GenerationSummary, type InsightCandidate } from "./insights";
export {
  buildOpportunityCandidates,
  persistOpportunities,
  type OpportunityCandidate,
  type OpportunityGeneration,
} from "./opportunities";
export { buildCustomerIntelligenceReport, type CustomerIntelligenceReport } from "./report";
