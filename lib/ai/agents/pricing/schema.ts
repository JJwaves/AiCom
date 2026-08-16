import { z } from "zod";
import { PRICING_INTELLIGENCE, PRICING_RECOMMENDATION_TYPES } from "@/config/pricing-intelligence";

/**
 * Pricing Agent structured output (Session 12 spec §25–§26).
 *
 * The model's output is UNTRUSTED. This schema bounds shape and size and
 * restricts every consequential field to a CLOSED enum. On top of it the
 * server validates metric/evidence references against exactly what the
 * context printed, `productId` against the real catalog, `quantityTier`
 * against that product's real tier ladder, and OVERRIDES
 * `requiresCostConfiguration` / `requiresExperiment` with its own
 * deterministic answers.
 *
 * WHAT THIS SCHEMA CANNOT EXPRESS — the strongest guarantee in the session:
 *
 *   there is no `proposedUnitPriceCents`, no `newPrice`, no `discountPct`,
 *   no `proposedMoq`, no `elasticity`, no `optimalPrice`, and no
 *   free-text action category.
 *
 * A specific price change is therefore not "blocked" — it is
 * UNREPRESENTABLE. The model cannot write one, so no downstream layer has
 * to be trusted to refuse it. Recommendations are reviews: they ask a human
 * to look at something.
 */

export const PRICING_CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export const PRICING_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

export const pricingRecommendationSchema = z.object({
  title: z.string().min(1).max(200),
  /** What the deterministic data shows. Must use the numbers it was given. */
  observation: z.string().min(1).max(1500),
  /** What a human should look into. REVIEW language only — never an instruction. */
  recommendation: z.string().min(1).max(1500),
  recommendationType: z.enum(PRICING_RECOMMENDATION_TYPES),
  /** Catalog product id, validated server-side; unknown ids become null. */
  productId: z.string().max(100).nullable().default(null),
  /** A tier's minimum quantity, validated against that product's real tiers. */
  quantityTier: z.number().int().min(1).max(10_000_000).nullable().default(null),
  /** At least one [key] copied from the context. Filtered server-side. */
  metricRefs: z.array(z.string().min(1).max(120)).min(1).max(12),
  /** Signal / insight / opportunity ids from the context. Filtered server-side. */
  evidenceRefs: z.array(z.string().min(1).max(64)).max(12).default([]),
  confidence: z.enum(PRICING_CONFIDENCE_LEVELS),
  risk: z.enum(PRICING_RISK_LEVELS),
  /** What most weakens this recommendation. At least one is required. */
  limitations: z.array(z.string().min(1).max(300)).min(1).max(8),
  /**
   * The model's own view. Both are OVERWRITTEN server-side with the
   * deterministic answer — they exist so a disagreement is visible in logs,
   * never so the model can grant itself a readiness it does not have.
   */
  requiresCostConfiguration: z.boolean().default(true),
  requiresExperiment: z.boolean().default(false),
});

export type PricingRecommendation = z.infer<typeof pricingRecommendationSchema>;

/**
 * A narrative note about ONE deterministic signal. The signal, its strength
 * and its numbers come from `modules/pricing-intelligence`; this is only the
 * model's plain-language explanation of it (spec §37).
 */
export const pricingSignalNoteSchema = z.object({
  /** Must match a signal id printed in the context; unknown ids are dropped. */
  signalId: z.string().min(1).max(120),
  note: z.string().min(1).max(600),
});

export type PricingSignalNote = z.infer<typeof pricingSignalNoteSchema>;

export const pricingReviewSchema = z.object({
  executiveSummary: z.string().min(1).max(3000),
  signals: z.array(pricingSignalNoteSchema).max(PRICING_INTELLIGENCE.MAX_SIGNAL_NOTES_PER_REVIEW).default([]),
  recommendations: z
    .array(pricingRecommendationSchema)
    .max(PRICING_INTELLIGENCE.MAX_RECOMMENDATIONS_PER_REVIEW)
    .default([]),
  /**
   * Pricing questions the model believes it cannot answer with the data it
   * was given. Narrative only — the deterministic data-quality warnings are
   * computed independently and are the authoritative list.
   */
  openQuestions: z.array(z.string().min(1).max(400)).max(8).default([]),
});

export type PricingReview = z.infer<typeof pricingReviewSchema>;

/** Coarse ordinal for agent_decisions.confidence (0–1). Labels stay authoritative. */
export const PRICING_CONFIDENCE_ORDINAL: Record<(typeof PRICING_CONFIDENCE_LEVELS)[number], number> = {
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.75,
};

export const PRICING_RISK_TO_DECISION_RISK: Record<(typeof PRICING_RISK_LEVELS)[number], "low" | "medium" | "high"> = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};
