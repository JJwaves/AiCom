/**
 * CEO Recommendation Agent (Session 09) — recommendation-only business
 * review over the deterministic BusinessHealthSnapshot. NO tools, NO
 * execution paths, NO customer-facing surface; writes are limited to
 * AgentDecision + ceo_reports audit rows. docs/BUSINESS_INTELLIGENCE.md
 * is authoritative.
 */
export { generateCeoReview, isBusinessIntelligenceAiEnabled, recommendationIdentityKey, type CeoReviewRunResult } from "./agent";
export { buildCeoContext, type CeoContext } from "./context";
export {
  CEO_ACTION_CATEGORIES,
  CEO_CONFIDENCE_LEVELS,
  CEO_RISK_LEVELS,
  ceoRecommendationSchema,
  ceoReviewSchema,
  type CeoActionCategory,
  type CeoConfidence,
  type CeoRecommendation,
  type CeoReview,
  type CeoRisk,
} from "./schema";
