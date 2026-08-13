/**
 * Guardrail vocabulary (Session 10).
 *
 * Everything here is deterministic data. This module never imports lib/ai —
 * the same structural rule that keeps modules/customer-intelligence and
 * modules/business-intelligence honest: authority code cannot depend on the
 * model layer, so a model can never influence a verdict.
 */

/** Who proposed an action. The source NEVER grants authority (spec §5, §43). */
export const ACTION_SOURCES = [
  "CEO_AGENT",
  "PRICING_AGENT",
  "CRO_AGENT",
  "GOOGLE_ADS_AGENT",
  "META_ADS_AGENT",
  "HUMAN_ADMIN",
] as const;
export type ActionSource = (typeof ACTION_SOURCES)[number];

export function isActionSource(value: unknown): value is ActionSource {
  return typeof value === "string" && (ACTION_SOURCES as readonly string[]).includes(value);
}

/**
 * Autonomy modes, ordered. The Sales agent is deliberately NOT in this
 * space: its customer-facing tools are governed by the tool permission
 * tiers + customer confirmation (docs/AI_AGENT_ARCHITECTURE.md), not by the
 * business-action guardrail engine (spec §32).
 */
export const AUTONOMY_MODES = ["OBSERVE", "RECOMMEND", "GUARDED_AUTO", "AUTONOMOUS"] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

const AUTONOMY_RANK: Record<AutonomyMode, number> = {
  OBSERVE: 0,
  RECOMMEND: 1,
  GUARDED_AUTO: 2,
  AUTONOMOUS: 3,
};

export function isAutonomyMode(value: unknown): value is AutonomyMode {
  return typeof value === "string" && (AUTONOMY_MODES as readonly string[]).includes(value);
}

/** The lower of two modes — used to clamp a stored mode to its policy ceiling. */
export function minAutonomy(a: AutonomyMode, b: AutonomyMode): AutonomyMode {
  return AUTONOMY_RANK[a] <= AUTONOMY_RANK[b] ? a : b;
}

export function autonomyAtLeast(mode: AutonomyMode, floor: AutonomyMode): boolean {
  return AUTONOMY_RANK[mode] >= AUTONOMY_RANK[floor];
}

/** Deterministic, policy-derived risk. An LLM's opinion is metadata only (spec §8). */
export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

const RISK_RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === "string" && (RISK_LEVELS as readonly string[]).includes(value);
}

/** Risk only ever moves UP through escalation — never down (spec §8). */
export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

export function riskAtMost(risk: RiskLevel, ceiling: RiskLevel): boolean {
  return RISK_RANK[risk] <= RISK_RANK[ceiling];
}

/**
 * HARD rules cannot be waived by a normal approval; SOFT rules are exactly
 * what human approval is FOR (spec §10). There is no bypass semantic in
 * Session 10 — a super-admin override is deliberately deferred.
 */
export type RuleSeverity = "HARD" | "SOFT";

/**
 * What a violated rule prevents:
 *  - PROPOSAL: the action may not even be recorded as reviewable
 *    (unknown agent/type, malformed payload, OBSERVE mode…). It is stored
 *    as GUARDRAIL_BLOCKED so the owner can still see what was attempted.
 *  - EXECUTION: the action is a legitimate proposal a human may approve,
 *    but no automated execution may follow (price floor unverifiable,
 *    never-automated categories…).
 */
export type RuleBlocks = "PROPOSAL" | "EXECUTION";

export type ViolatedRule = {
  id: string;
  severity: RuleSeverity;
  blocks: RuleBlocks;
  message: string;
};

/** Whether an executor exists for this action type at all (spec §22–§23). */
export type ExecutionSupport =
  /** Approving means "yes, investigate" — there is nothing to execute, ever. */
  | "REVIEW_ONLY"
  /** A real business change is representable, but no executor is implemented. */
  | "NOT_IMPLEMENTED"
  /** An executor is registered (no action type reaches this in Session 10). */
  | "AVAILABLE";

/** Execution lifecycle, deliberately separate from approval (spec §16, §42). */
export const EXECUTION_STATES = [
  "NOT_APPLICABLE",
  "NOT_SUPPORTED",
  "READY",
  "EXECUTING",
  "EXECUTED",
  "FAILED",
  "ROLLED_BACK",
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

/** Approval/lifecycle status of a proposed action (spec §42). */
export const ACTION_STATUSES = [
  "PROPOSED",
  "GUARDRAIL_BLOCKED",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "SUPERSEDED",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/**
 * The deterministic verdict. Reproducible from (input, policyVersion) —
 * there is no clock, no randomness and no I/O inside the evaluator, so the
 * caller stamps `evaluatedAt` when it persists.
 */
export type GuardrailDecision = {
  policyVersion: string;
  source: ActionSource | null;
  actionType: string | null;
  /** The mode actually applied after clamping to the policy ceiling. */
  autonomyMode: AutonomyMode;
  /** May this proposal be recorded and put in front of a human at all? */
  allowed: boolean;
  /** May the system execute it with no further human decision? */
  executionEligible: boolean;
  /** Does a human have to approve before anything may happen? */
  approvalRequired: boolean;
  /** Policy-derived. Never taken from the model. */
  riskLevel: RiskLevel;
  /** What the model claimed, kept for comparison only. */
  modelSuggestedRiskLevel: RiskLevel | null;
  violatedRules: ViolatedRule[];
  /** Config keys that must be provided before this could ever auto-execute. */
  missingConfiguration: string[];
  reason: string;
  executionSupport: ExecutionSupport;
  /** The execution state to record now — never EXECUTED (spec §16). */
  executionState: ExecutionState;
  /** The limits actually consulted, as they were at evaluation time (spec §12). */
  limitsSnapshot: Record<string, number | null>;
};
