import { z } from "zod";
import { GOOGLE_ADS, GOOGLE_ADS_RECOMMENDATION_TYPES } from "@/config/google-ads";

/**
 * Google Ads Intelligence Agent structured output (Session 13 spec §37–§38).
 *
 * The model's output is UNTRUSTED. This schema bounds shape and size and
 * restricts every consequential field to a CLOSED enum. On top of it the
 * server validates metric/evidence/signal references against exactly what
 * the context printed, and `campaignId` against the campaigns actually
 * present in the snapshot.
 *
 * WHAT THIS SCHEMA CANNOT EXPRESS — the strongest guarantee in the session:
 *
 *   there is no `proposedDailyBudgetCents`, no `budgetChangePct`, no
 *   `newStatus`, no `pause`, no `bidCents`, no `targetCpaCents`, no
 *   `keywordText`, no `adCopy`, and no free-text action category.
 *
 * A budget change, a pause and a bid adjustment are therefore not "blocked" —
 * they are UNREPRESENTABLE. The model cannot write one, so no downstream
 * layer has to be trusted to refuse it. Recommendations are REVIEWS: they
 * ask a human to go and look at something in Google Ads.
 *
 * Session 13 spec §38 is explicit that even a NUMBER in prose stays
 * non-authoritative — nothing maps a narrative figure into an executable
 * action, because the recommendation→action table (config/google-ads.ts)
 * contains review types only.
 */

export const GOOGLE_ADS_CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export const GOOGLE_ADS_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

export const googleAdsRecommendationSchema = z.object({
  title: z.string().min(1).max(200),
  /** What the deterministic data shows. Must use the numbers it was given. */
  observation: z.string().min(1).max(1500),
  /** What a human should look into. REVIEW language only — never an instruction. */
  recommendation: z.string().min(1).max(1500),
  recommendationType: z.enum(GOOGLE_ADS_RECOMMENDATION_TYPES),
  /** Campaign id, validated server-side against the snapshot; unknown ⇒ null. */
  campaignId: z.string().max(120).nullable().default(null),
  /** At least one [key] copied from the context. Filtered server-side. */
  metricRefs: z.array(z.string().min(1).max(120)).min(1).max(12),
  /** Signal ids from the context. Filtered server-side. */
  evidenceRefs: z.array(z.string().min(1).max(120)).max(12).default([]),
  confidence: z.enum(GOOGLE_ADS_CONFIDENCE_LEVELS),
  risk: z.enum(GOOGLE_ADS_RISK_LEVELS),
  /** What most weakens this recommendation. At least one is required. */
  limitations: z.array(z.string().min(1).max(300)).min(1).max(8),
});

export type GoogleAdsRecommendation = z.infer<typeof googleAdsRecommendationSchema>;

/**
 * A narrative note about ONE deterministic signal. The signal, its route and
 * its numbers come from `modules/google-ads-intelligence`; this is only the
 * model's plain-language explanation of it.
 */
export const googleAdsSignalNoteSchema = z.object({
  /** Must match a signal id printed in the context; unknown ids are dropped. */
  signalId: z.string().min(1).max(120),
  note: z.string().min(1).max(600),
});

export type GoogleAdsSignalNote = z.infer<typeof googleAdsSignalNoteSchema>;

export const googleAdsReviewSchema = z.object({
  executiveSummary: z.string().min(1).max(3000),
  signals: z.array(googleAdsSignalNoteSchema).max(GOOGLE_ADS.MAX_SIGNAL_NOTES_PER_REVIEW).default([]),
  recommendations: z
    .array(googleAdsRecommendationSchema)
    .max(GOOGLE_ADS.MAX_RECOMMENDATIONS_PER_REVIEW)
    .default([]),
  /**
   * Advertising questions the model believes it cannot answer with the data
   * it was given. Narrative only — the deterministic data-quality warnings
   * are computed independently and are the authoritative list.
   */
  openQuestions: z.array(z.string().min(1).max(400)).max(8).default([]),
});

export type GoogleAdsReview = z.infer<typeof googleAdsReviewSchema>;

/** Coarse ordinal for agent_decisions.confidence (0–1). Labels stay authoritative. */
export const GOOGLE_ADS_CONFIDENCE_ORDINAL: Record<(typeof GOOGLE_ADS_CONFIDENCE_LEVELS)[number], number> = {
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.75,
};

export const GOOGLE_ADS_RISK_TO_DECISION_RISK: Record<
  (typeof GOOGLE_ADS_RISK_LEVELS)[number],
  "low" | "medium" | "high"
> = { LOW: "low", MEDIUM: "medium", HIGH: "high" };
