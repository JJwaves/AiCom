import { z } from "zod";
import { BUSINESS_INTELLIGENCE } from "@/config/business-intelligence";

/**
 * CEO review structured output (Session 09 spec §20–§21, §25).
 *
 * The model's output is UNTRUSTED: this schema bounds shape/size, and the
 * server additionally validates every supportingMetricRef and evidenceRef
 * against what the context actually contained before anything persists
 * (lib/ai/agents/ceo/agent.ts). Confidence and risk are controlled
 * three-level enums — no pseudo-scientific 0.873 precision.
 */

export const CEO_CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type CeoConfidence = (typeof CEO_CONFIDENCE_LEVELS)[number];

export const CEO_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type CeoRisk = (typeof CEO_RISK_LEVELS)[number];

/** Controlled recommendation taxonomy (spec §21). A category grants ZERO execution authority. */
export const CEO_ACTION_CATEGORIES = [
  "CUSTOMER_EXPERIENCE",
  "PRODUCT",
  "PRICING_REVIEW",
  "MARKETING_REVIEW",
  "SALES",
  "OPERATIONS",
  "AI_COST",
  "DATA_QUALITY",
  "CRO_REVIEW",
] as const;
export type CeoActionCategory = (typeof CEO_ACTION_CATEGORIES)[number];

export const ceoRecommendationSchema = z.object({
  title: z.string().min(1).max(200),
  /** What the data shows — must reference provided metrics, never new numbers. */
  observation: z.string().min(1).max(1500),
  /** The proposed action, in consider/review/test/investigate language. */
  recommendation: z.string().min(1).max(1500),
  /** Metric reference keys copied exactly from the context's list. */
  supportingMetricRefs: z.array(z.string().min(1).max(120)).min(1).max(12),
  /** Insight/opportunity ids copied exactly from the context (optional). */
  evidenceRefs: z.array(z.string().min(1).max(64)).max(12).default([]),
  expectedImpact: z.string().max(600).optional(),
  confidence: z.enum(CEO_CONFIDENCE_LEVELS),
  riskLevel: z.enum(CEO_RISK_LEVELS),
  actionCategory: z.enum(CEO_ACTION_CATEGORIES),
  /** Data-quality / sample-size caveats that limit this recommendation. */
  limitations: z.array(z.string().min(1).max(300)).max(8).default([]),
});

export type CeoRecommendation = z.infer<typeof ceoRecommendationSchema>;

export const ceoReviewSchema = z.object({
  executiveSummary: z.string().min(1).max(3000),
  highlights: z.array(z.string().min(1).max(400)).max(10),
  concerns: z.array(z.string().min(1).max(400)).max(10),
  opportunities: z.array(z.string().min(1).max(400)).max(10),
  recommendations: z.array(ceoRecommendationSchema).max(BUSINESS_INTELLIGENCE.MAX_RECOMMENDATIONS_PER_REVIEW),
});

export type CeoReview = z.infer<typeof ceoReviewSchema>;

/**
 * Ordinal encoding for agent_decisions.confidence (double 0–1). This is a
 * COARSE mapping of the controlled levels for sorting only — the label in
 * supportingDataJson stays authoritative (spec §25: no fake precision).
 */
export const CEO_CONFIDENCE_ORDINAL: Record<CeoConfidence, number> = {
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.75,
};

export const CEO_RISK_TO_DECISION_RISK: Record<CeoRisk, "low" | "medium" | "high"> = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};
