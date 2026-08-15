import { z } from "zod";
import { allocationEntrySchema, validateAllocation, variantKeySchema } from "./allocation";
import { audienceSchema } from "./eligibility";
import { validateVariantConfig } from "./targets";
import {
  DEFAULT_VARIANT_KEY,
  EXPERIMENT_TYPES,
  GUARDRAIL_METRICS,
  PRIMARY_METRICS,
  SECONDARY_METRICS,
  CONTROL_VARIANT_KEY,
} from "./types";
import { safeText } from "./variants";

/**
 * Experiment DESIGN (Session 11 spec §5, §22) — the fully-specified,
 * server-validatable description of an experiment.
 *
 * This one schema is shared by three places on purpose, so there is exactly
 * one definition of "a valid experiment design":
 *   1. the CRO agent's structured output (untrusted model text),
 *   2. the `CRO_EXPERIMENT_PROPOSAL` guardrail payload (what a human
 *      approves in the Action Center),
 *   3. the draft experiment materialized from an approved proposal.
 *
 * FAIL CLOSED: unknown target, unknown experiment type, a variant config
 * that does not satisfy the target's strict schema, a metric outside the
 * closed lists, or an allocation that does not total 100 are all validation
 * failures — never silently repaired, never partially accepted.
 */

export const experimentDesignSchema = z
  .object({
    /** Must exist in the target registry — the closed allow-list of surfaces. */
    targetKey: z.string().min(1).max(120),
    experimentType: z.enum(EXPERIMENT_TYPES),
    variantKey: variantKeySchema.default(DEFAULT_VARIANT_KEY),
    /**
     * Typed presentation values validated against the target's schema. Never
     * markup, script, or a component path.
     */
    variantConfig: z.record(z.string().max(60), z.unknown()),
    primaryMetric: z.enum(PRIMARY_METRICS),
    secondaryMetrics: z.array(z.enum(SECONDARY_METRICS)).max(5).default([]),
    guardrailMetrics: z.array(z.enum(GUARDRAIL_METRICS)).max(5).default([]),
    audience: audienceSchema.default({
      routes: [],
      trafficSources: [],
      campaigns: [],
      device: "any",
      visitor: "any",
    }),
    allocation: z.array(allocationEntrySchema).min(2).max(8),
    /** May raise the documented floor; can never lower it (results.ts). */
    minimumSampleSize: z.number().int().min(1).max(10_000_000).nullable().default(null),
  })
  .strict()
  .superRefine((design, ctx) => {
    if (design.variantKey === CONTROL_VARIANT_KEY) {
      ctx.addIssue({ code: "custom", path: ["variantKey"], message: '"control" is a reserved arm key' });
    }
    const variant = validateVariantConfig(design.targetKey, design.experimentType, design.variantConfig);
    if (!variant.ok) {
      ctx.addIssue({ code: "custom", path: ["variantConfig"], message: variant.reason });
    }
    const allocation = validateAllocation(design.allocation);
    if (!allocation.ok) {
      for (const message of allocation.errors) ctx.addIssue({ code: "custom", path: ["allocation"], message });
    } else if (!allocation.allocation.some((a) => a.variant === design.variantKey)) {
      ctx.addIssue({
        code: "custom",
        path: ["allocation"],
        message: `Allocation must contain the variant arm "${design.variantKey}"`,
      });
    }
  });

export type ExperimentDesign = z.infer<typeof experimentDesignSchema>;

/**
 * The human-readable proposal wrapper the Action Center shows. The design is
 * OPTIONAL: a CRO proposal without one is a design-less "here is a friction
 * point worth testing" note, which a human may approve as a direction. Only
 * a proposal WITH a validated design can be materialized into a draft
 * experiment (spec §25 — approval is not launch).
 */
export const experimentProposalSchema = z
  .object({
    name: safeText(3, 120),
    hypothesis: z.string().min(1).max(2000),
    observation: z.string().min(1).max(2000),
    design: experimentDesignSchema.nullable().default(null),
  })
  .strict();

export type ExperimentProposal = z.infer<typeof experimentProposalSchema>;

export type DesignValidation =
  | { ok: true; design: ExperimentDesign }
  | { ok: false; reason: string };

/**
 * Parse an untrusted design (model output, request body, stored payload)
 * with the traffic ceiling applied. Returns ONE readable reason on failure —
 * callers log it and drop the proposal rather than repairing it.
 */
export function parseExperimentDesign(input: unknown, opts: { maxNonControlPct?: number } = {}): DesignValidation {
  const parsed = experimentDesignSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 4)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, reason: issues };
  }
  if (opts.maxNonControlPct !== undefined) {
    const allocation = validateAllocation(parsed.data.allocation, { maxNonControlPct: opts.maxNonControlPct });
    if (!allocation.ok) return { ok: false, reason: allocation.errors.join("; ") };
  }
  return { ok: true, design: parsed.data };
}
