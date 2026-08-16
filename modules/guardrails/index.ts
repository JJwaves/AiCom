/**
 * modules/guardrails — the ONE authoritative safety/approval layer every
 * financially or operationally meaningful AI action must pass through
 * (docs/GUARDRAILS.md, docs/AI_ACTION_CENTER.md).
 *
 * Structural invariants, asserted by tests:
 *  - No `lib/ai` import anywhere in this module. Deterministic authority
 *    cannot depend on the model layer.
 *  - `evaluateAgentAction` is pure: no I/O, no clock, no randomness.
 *  - The executor registry is empty — approving an action records a human
 *    decision, it does not mutate prices, ads, products, or payments.
 *
 * Future agents must never call a pricing/ads/catalog mutation directly:
 *   Agent → ProposedAction → evaluateAgentAction → Approval → Executor.
 */

export {
  ACTION_TYPES,
  ACTION_TYPE_REGISTRY,
  SOURCE_PERMITTED_ACTION_TYPES,
  getActionTypeSpec,
  isKnownActionType,
  isReviewOnlyActionType,
  reviewActionPayloadSchema,
  adBudgetChangePayloadSchema,
  adCreativeTestPayloadSchema,
  adStatusChangePayloadSchema,
  aiCostChangePayloadSchema,
  croExperimentLaunchPayloadSchema,
  croExperimentProposalPayloadSchema,
  manufacturingChangePayloadSchema,
  moqChangePayloadSchema,
  priceChangePayloadSchema,
  priceExperimentPayloadSchema,
  refundPayloadSchema,
  type ActionTypeSpec,
  type ReviewActionPayload,
} from "./actions";

export {
  evaluateAgentAction,
  policyDefaultAutonomy,
  policyMaxAutonomy,
  type EvaluateAgentActionInput,
  type EvaluateAgentActionResult,
  type PriceContext,
} from "./evaluate";

export { executionSupportFor, executorRegistry, initialExecutionState, type ActionExecutor } from "./executors";

export {
  CEO_CATEGORY_TO_ACTION_TYPE,
  PRICING_RECOMMENDATION_TO_ACTION_TYPE,
  mapAgentDecisionToAction,
  mapCroDecisionToAction,
  mapDecisionToAction,
  mapGoogleAdsDecisionToAction,
  mapPricingDecisionToAction,
  GOOGLE_ADS_RECOMMENDATION_TO_ACTION_TYPE,
  type MappableDecision,
  type MappedAction,
} from "./decision-mapping";

export {
  ACTION_SOURCES,
  ACTION_STATUSES,
  AUTONOMY_MODES,
  EXECUTION_STATES,
  RISK_LEVELS,
  autonomyAtLeast,
  isActionSource,
  isAutonomyMode,
  isRiskLevel,
  maxRisk,
  minAutonomy,
  riskAtMost,
  type ActionSource,
  type ActionStatus,
  type AutonomyMode,
  type ExecutionState,
  type ExecutionSupport,
  type GuardrailDecision,
  type RiskLevel,
  type RuleBlocks,
  type RuleSeverity,
  type ViolatedRule,
} from "./types";
