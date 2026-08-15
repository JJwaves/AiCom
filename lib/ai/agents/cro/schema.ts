import { z } from "zod";
import { EXPERIMENTS } from "@/config/experiments";
import { EXPERIMENT_TYPES, GUARDRAIL_METRICS, PRIMARY_METRICS, SECONDARY_METRICS } from "@/modules/experiments";

/**
 * CRO agent structured output (Session 11 spec §21–§23).
 *
 * The model's output is UNTRUSTED. This schema bounds shape and size and
 * restricts every consequential field to a CLOSED enum; the server then
 * validates, on top of that:
 *   - `targetKey` against the experiment target registry (unknown ⇒ dropped),
 *   - `variantConfig` against that target's strict variant schema
 *     (markup, script, unknown keys ⇒ dropped),
 *   - every metric/evidence reference against the exact context that was
 *     sent (fabricated references ⇒ dropped, ref-less proposals ⇒ dropped),
 *   - `proposedTrafficPct` against the effective traffic ceiling,
 *   - `minimumSampleSize` against the documented floor (raise only).
 *
 * The model cannot express: a component path, HTML/CSS/JS, a price, an
 * audience of its own invention, a statistical claim, or a launch.
 */

export const CRO_CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export const CRO_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

/**
 * The two shapes a CRO finding may take (spec §38).
 *  EXPERIMENT — a presentation/clarity question a controlled test can answer.
 *  REVIEW     — a business/product question a test would only paper over
 *               (e.g. "MOQ is too high"). Routed to CRO_REVIEW, never to a
 *               "hide the objection" experiment.
 */
export const CRO_PROPOSAL_KINDS = ["EXPERIMENT", "REVIEW"] as const;
export type CroProposalKind = (typeof CRO_PROPOSAL_KINDS)[number];

/** Free-text values inside a variant config, one level deep, bounded. */
const variantConfigSchema = z
  .record(z.string().max(60), z.union([z.string().max(400), z.null()]))
  .refine((v) => Object.keys(v).length <= 8, "A variant config has at most 8 fields");

export const croProposalSchema = z.object({
  kind: z.enum(CRO_PROPOSAL_KINDS),
  title: z.string().min(1).max(200),
  /** What the deterministic data shows. Must cite the numbers it was given. */
  observation: z.string().min(1).max(1500),
  /** Why the observation might have the proposed cause, in test language. */
  hypothesis: z.string().min(1).max(1500),

  /* --- EXPERIMENT-only fields (ignored, and required to be absent-safe, for REVIEW) --- */
  targetKey: z.string().max(120).nullable().default(null),
  experimentType: z.enum(EXPERIMENT_TYPES).nullable().default(null),
  variantSummary: z.string().max(600).nullable().default(null),
  variantConfig: variantConfigSchema.nullable().default(null),
  primaryMetric: z.enum(PRIMARY_METRICS).nullable().default(null),
  secondaryMetrics: z.array(z.enum(SECONDARY_METRICS)).max(4).default([]),
  guardrailMetrics: z.array(z.enum(GUARDRAIL_METRICS)).max(4).default([]),
  /** Non-control traffic share. Clamped server-side to the effective ceiling. */
  proposedTrafficPct: z.number().int().min(1).max(100).nullable().default(null),
  /** May only RAISE the documented floor (config/experiments.ts). */
  minimumSampleSize: z.number().int().min(1).max(10_000_000).nullable().default(null),

  /* --- Evidence, confidence, caveats (both kinds) --- */
  supportingMetricRefs: z.array(z.string().min(1).max(120)).min(1).max(12),
  evidenceRefs: z.array(z.string().min(1).max(64)).max(12).default([]),
  expectedImpact: z.string().max(600).nullable().default(null),
  confidence: z.enum(CRO_CONFIDENCE_LEVELS),
  riskLevel: z.enum(CRO_RISK_LEVELS),
  limitations: z.array(z.string().min(1).max(300)).max(8).default([]),
});

export type CroProposal = z.infer<typeof croProposalSchema>;

export const croReviewSchema = z.object({
  summary: z.string().min(1).max(3000),
  /** Where the funnel appears to lose the most sessions, in the model's words. */
  frictionObservations: z.array(z.string().min(1).max(400)).max(10).default([]),
  proposals: z.array(croProposalSchema).max(EXPERIMENTS.MAX_PROPOSALS_PER_REVIEW),
  /**
   * Completed experiments the model was shown and is willing to describe.
   * Purely narrative — the STATE and the numbers come from the deterministic
   * engine, never from here (spec §35).
   */
  experimentNotes: z.array(z.string().min(1).max(400)).max(10).default([]),
});

export type CroReview = z.infer<typeof croReviewSchema>;

/** Coarse ordinal for agent_decisions.confidence (0–1). Labels stay authoritative. */
export const CRO_CONFIDENCE_ORDINAL: Record<(typeof CRO_CONFIDENCE_LEVELS)[number], number> = {
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.75,
};

export const CRO_RISK_TO_DECISION_RISK: Record<(typeof CRO_RISK_LEVELS)[number], "low" | "medium" | "high"> = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};
