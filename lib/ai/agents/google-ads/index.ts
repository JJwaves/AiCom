/**
 * Google Ads Intelligence Agent (Session 13) — RECOMMEND only.
 *
 * READ the deterministic GoogleAdsIntelligenceSnapshot → INTERPRET it →
 * raise advertising REVIEWS a human decides on in the AI Action Center.
 *
 * It never changes a budget, never pauses or resumes a campaign, never
 * creates a campaign, keyword or ad, never changes a bid, and never uploads
 * a conversion. It has no Google Ads access at all: it cannot even READ from
 * Google, because it reads only the persisted snapshot.
 * docs/GOOGLE_ADS_INTELLIGENCE.md is authoritative.
 */

export {
  generateGoogleAdsReview,
  isGoogleAdsAgentEnabled,
  googleAdsRecommendationIdentityKey,
  type GoogleAdsReviewRunResult,
} from "./agent";
export {
  googleAdsRecommendationSchema,
  googleAdsReviewSchema,
  googleAdsSignalNoteSchema,
  GOOGLE_ADS_CONFIDENCE_LEVELS,
  GOOGLE_ADS_RISK_LEVELS,
  type GoogleAdsRecommendation,
  type GoogleAdsReview,
  type GoogleAdsSignalNote,
} from "./schema";
export { buildGoogleAdsContext, type GoogleAdsContext } from "./context";
