/**
 * Pricing Intelligence Agent (Session 12) — RECOMMEND only.
 *
 * READ the deterministic PricingIntelligenceSnapshot → INTERPRET it →
 * raise pricing REVIEWS a human decides on in the AI Action Center.
 *
 * It never sets a price, never computes an "optimal" one, never estimates
 * elasticity, and never launches a price experiment. The deterministic
 * Pricing Engine (`modules/pricing`) remains the sole pricing authority.
 * docs/PRICING_INTELLIGENCE.md is authoritative.
 */

export {
  generatePricingReview,
  isPricingAgentEnabled,
  pricingRecommendationIdentityKey,
  type PricingReviewRunResult,
} from "./agent";
export {
  pricingRecommendationSchema,
  pricingReviewSchema,
  pricingSignalNoteSchema,
  PRICING_CONFIDENCE_LEVELS,
  PRICING_RISK_LEVELS,
  type PricingRecommendation,
  type PricingReview,
  type PricingSignalNote,
} from "./schema";
export { buildPricingContext, type PricingContext } from "./context";
