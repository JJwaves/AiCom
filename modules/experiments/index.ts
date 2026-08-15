/**
 * modules/experiments — the DETERMINISTIC experiment authority
 * (docs/EXPERIMENTATION.md is authoritative).
 *
 * Structural invariants, asserted by tests:
 *  - No `lib/ai` import anywhere in this module, and no `db/` import.
 *    Eligibility, assignment, exposure semantics, metric definitions,
 *    sample thresholds and statistical results are computed by software; a
 *    model can propose an experiment but can never influence a number.
 *  - Assignment is a pure function of (experimentId, salt, sessionId).
 *  - Variants are CLOSED typed records — never HTML, JS, CSS or React.
 *  - Targets are a CLOSED registry — an unknown target fails closed.
 *
 * The LLM may: read these numbers, form a hypothesis, propose an
 * experiment, and explain a finished result in words. It may not launch,
 * allocate, measure, or declare anything.
 */

export {
  EXPERIMENT_TYPES,
  DEFERRED_EXPERIMENT_TYPES,
  EXPERIMENT_STATUSES,
  EXPERIMENT_RESULT_STATES,
  ENROLLING_STATUSES,
  PROTECTED_SURFACES,
  PRIMARY_METRICS,
  SECONDARY_METRICS,
  GUARDRAIL_METRICS,
  CONTROL_VARIANT_KEY,
  DEFAULT_VARIANT_KEY,
  isExperimentStatus,
  isExperimentType,
  isPrimaryMetric,
  type ArmCounts,
  type ExperimentResultState,
  type ExperimentStatus,
  type ExperimentType,
  type GuardrailMetric,
  type PrimaryMetric,
  type SecondaryMetric,
} from "./types";

export {
  heroCopyVariantSchema,
  ctaCopyVariantSchema,
  shippingMessageVariantSchema,
  safeText,
  unsafeTextReason,
  VARIANT_SCHEMAS,
  type CtaCopyVariant,
  type HeroCopyVariant,
  type ShippingMessageVariant,
  type VariantConfig,
} from "./variants";

export {
  EXPERIMENT_TARGETS,
  EXPERIMENT_TARGET_KEYS,
  getExperimentTarget,
  isExperimentTargetKey,
  targetRendersOnPath,
  validateVariantConfig,
  type ExperimentTargetSpec,
} from "./targets";

export {
  allocationSchema,
  allocationEntrySchema,
  evenAllocation,
  normalizeAllocation,
  validateAllocation,
  variantKeyOf,
  variantKeySchema,
  type Allocation,
  type AllocationEntry,
} from "./allocation";

export { assignVariant, assignmentBucket, defaultSaltFor, fnv1a32, variantForBucket } from "./assignment";

export {
  audienceSchema,
  classifyDevice,
  DEFAULT_AUDIENCE,
  isAdminPath,
  isBotUserAgent,
  isEligible,
  matchRoute,
  type Audience,
  type EligibilityContext,
  type EligibilityResult,
} from "./eligibility";

export { normalCdf, twoProportionZTest, type TwoProportionResult } from "./statistics";

export { computeReadout, effectiveMinimumSample, isDecisive, type ExperimentReadout, type ReadoutInput } from "./results";

export {
  experimentDesignSchema,
  experimentProposalSchema,
  parseExperimentDesign,
  type DesignValidation,
  type ExperimentDesign,
  type ExperimentProposal,
} from "./proposal";

export { canTransition, enrollsTraffic, STOP_SEMANTICS, type TransitionCheck } from "./lifecycle";
