import {
  AGENT_AUTONOMY_POLICY,
  GUARDED_AUTO_ALLOWED_ACTION_TYPES,
  GUARDRAIL_LIMITS,
  GUARDRAIL_POLICY_VERSION,
  MAX_UNATTENDED_RISK_LEVEL,
  type GuardrailLimitKey,
} from "@/config/guardrails";
import { COST_MODEL } from "@/config/costs";
import { evaluatePriceFloor } from "@/modules/pricing";
import type { Product, ProductConfiguration } from "@/types/commerce";
import { getActionTypeSpec, isKnownActionType, SOURCE_PERMITTED_ACTION_TYPES } from "./actions";
import { executionSupportFor, initialExecutionState } from "./executors";
import {
  isActionSource,
  isAutonomyMode,
  isRiskLevel,
  maxRisk,
  minAutonomy,
  riskAtMost,
  type ActionSource,
  type AutonomyMode,
  type GuardrailDecision,
  type RiskLevel,
  type ViolatedRule,
} from "./types";

/**
 * evaluateAgentAction — THE central deterministic authority (spec §1, §11).
 *
 * Properties this function guarantees, and tests assert:
 *  - PURE. No LLM call, no database, no network, no clock, no randomness.
 *    Same input + same policy version ⇒ byte-identical verdict.
 *  - FAIL CLOSED. Unknown source, unknown action type, malformed payload,
 *    unknown/absent autonomy mode, missing configuration and evaluator
 *    errors all deny. No code path treats "no policy" as "no limit".
 *  - AUTHORITY IS NEVER INHERITED. The proposing agent's identity does not
 *    widen what it may propose, and an LLM-suggested risk level is stored
 *    as metadata that can never lower the policy-derived risk.
 *
 * Callers persist the verdict; this function deliberately does not know how
 * to write anything.
 */

export type PriceContext = {
  product: Product;
  configuration: Pick<ProductConfiguration, "sizeId" | "materialId" | "printOptionId" | "quantity">;
  /** The total the proposal would charge for that configuration, in cents. */
  proposedTotalCents: number;
};

export type EvaluateAgentActionInput = {
  /** Untrusted: validated against ACTION_SOURCES. */
  source: unknown;
  /** Untrusted: validated against the closed action registry. */
  actionType: unknown;
  /** Untrusted: validated against the action type's strict schema. */
  payload: unknown;
  /** Untrusted: the mode resolved from AgentConfig/policy by the caller. */
  autonomyMode: unknown;
  /** The model's own risk opinion, if any. Metadata only (spec §8). */
  modelSuggestedRiskLevel?: unknown;
  /**
   * Optional real pricing state. When supplied for a price-affecting
   * action the deterministic price floor (modules/pricing) runs for real;
   * when absent the floor is reported as unverifiable — never as passing.
   */
  priceContext?: PriceContext;
};

export type EvaluateAgentActionResult = {
  decision: GuardrailDecision;
  /** The schema-validated payload — only present when the action is allowed. */
  validatedPayload: Record<string, unknown> | null;
};

const deny = (
  rules: ViolatedRule[],
  reason: string,
  partial: Partial<GuardrailDecision> = {},
): EvaluateAgentActionResult => ({
  validatedPayload: null,
  decision: {
    policyVersion: GUARDRAIL_POLICY_VERSION,
    source: null,
    actionType: null,
    autonomyMode: "OBSERVE",
    allowed: false,
    executionEligible: false,
    approvalRequired: false,
    riskLevel: "CRITICAL",
    modelSuggestedRiskLevel: null,
    violatedRules: rules,
    missingConfiguration: [],
    reason,
    executionSupport: "NOT_IMPLEMENTED",
    executionState: "NOT_SUPPORTED",
    limitsSnapshot: {},
    ...partial,
  },
});

const hard = (id: string, message: string, blocks: ViolatedRule["blocks"] = "PROPOSAL"): ViolatedRule => ({
  id,
  severity: "HARD",
  blocks,
  message,
});

const soft = (id: string, message: string): ViolatedRule => ({
  id,
  severity: "SOFT",
  blocks: "EXECUTION",
  message,
});

/** The configured value of each limit a type depends on (spec §12 snapshot). */
function limitsSnapshotFor(keys: readonly string[]): Record<string, number | null> {
  const snapshot: Record<string, number | null> = {};
  for (const key of keys) {
    snapshot[key] = (GUARDRAIL_LIMITS as Record<string, number | null>)[key] ?? null;
  }
  return snapshot;
}

/** Default mode for a source when no agent_configs row exists. */
export function policyDefaultAutonomy(source: ActionSource): AutonomyMode {
  return AGENT_AUTONOMY_POLICY[source].defaultMode;
}

/** Policy ceiling — a stored mode is clamped to this, always. */
export function policyMaxAutonomy(source: ActionSource): AutonomyMode {
  return AGENT_AUTONOMY_POLICY[source].maxMode;
}

export function evaluateAgentAction(input: EvaluateAgentActionInput): EvaluateAgentActionResult {
  try {
    return evaluateInner(input);
  } catch (err) {
    // Spec §7: evaluator failure denies. An exception must never read as
    // "no rule matched, therefore fine".
    return deny(
      [hard("guardrail_evaluation_failed", "The guardrail evaluator failed; failing closed.")],
      `Guardrail evaluation failed: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }
}

function evaluateInner(input: EvaluateAgentActionInput): EvaluateAgentActionResult {
  /* 1 — Unknown agent ⇒ DENY. */
  if (!isActionSource(input.source)) {
    return deny(
      [hard("unknown_agent", "The proposing agent is not a known action source.")],
      "Unknown proposing agent — denied.",
    );
  }
  const source = input.source;

  /* 2 — Unknown action type ⇒ DENY (a model inventing a type gets nothing). */
  if (!isKnownActionType(input.actionType)) {
    return deny(
      [hard("unknown_action_type", "The action type is not in the closed action registry.")],
      "Unknown action type — denied.",
      { source },
    );
  }
  const actionType = input.actionType;
  const spec = getActionTypeSpec(actionType)!;

  /* 3 — Autonomy mode: unknown ⇒ DENY, then clamp to the policy ceiling. */
  if (!isAutonomyMode(input.autonomyMode)) {
    return deny(
      [hard("unknown_autonomy_mode", "The agent's autonomy mode is missing or unrecognized.")],
      "Unknown autonomy mode — denied.",
      { source, actionType },
    );
  }
  const requestedMode = input.autonomyMode;
  const ceiling = policyMaxAutonomy(source);
  const autonomyMode = minAutonomy(requestedMode, ceiling);
  const clampedRules: ViolatedRule[] =
    autonomyMode !== requestedMode
      ? [
          soft(
            "autonomy_clamped_by_policy",
            `Stored autonomy ${requestedMode} exceeds the policy ceiling ${ceiling} for ${source}; evaluated as ${autonomyMode}.`,
          ),
        ]
      : [];

  const limitsSnapshot = limitsSnapshotFor(spec.requiredLimits);

  /* 4 — OBSERVE may analyze only: it cannot create a proposed action. */
  if (autonomyMode === "OBSERVE") {
    return deny(
      [
        ...clampedRules,
        hard("autonomy_observe_cannot_propose", `${source} is in OBSERVE mode and may analyze only.`),
      ],
      `${source} is in OBSERVE mode — proposed actions are not permitted.`,
      { source, actionType, autonomyMode, limitsSnapshot },
    );
  }

  /* 5 — Source permission. Authority never comes from seniority (spec §5). */
  const permitted = SOURCE_PERMITTED_ACTION_TYPES[source] ?? [];
  if (!permitted.includes(actionType)) {
    return deny(
      [
        ...clampedRules,
        hard(
          "source_not_permitted_for_action_type",
          `${source} may not propose ${actionType}; permitted: ${permitted.join(", ") || "none"}.`,
        ),
      ],
      `${source} is not permitted to propose ${actionType} — denied.`,
      { source, actionType, autonomyMode, limitsSnapshot },
    );
  }

  /* 6 — Payload must satisfy the type's strict schema (no extra fields:
   *     an LLM cannot smuggle riskLevel/approvalStatus/authorization in). */
  const parsed = spec.schema.safeParse(input.payload);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return deny(
      [...clampedRules, hard("malformed_action_payload", `Payload failed validation — ${issues}`)],
      "Malformed action payload — denied.",
      { source, actionType, autonomyMode, limitsSnapshot },
    );
  }
  const validatedPayload = parsed.data as Record<string, unknown>;

  /* ---- The action is well-formed and permitted. Now grade it. ---- */

  const violatedRules: ViolatedRule[] = [...clampedRules];
  const missingConfiguration: string[] = [];

  /* 7 — Deterministic risk. The model's suggestion is recorded, never used. */
  const modelSuggestedRiskLevel: RiskLevel | null = isRiskLevel(input.modelSuggestedRiskLevel)
    ? input.modelSuggestedRiskLevel
    : null;
  let riskLevel: RiskLevel = spec.baseRisk;
  if (spec.neverAutomated) riskLevel = maxRisk(riskLevel, "CRITICAL");

  /* 8 — Never-automated categories (refunds, factory commitments). */
  if (spec.neverAutomated) {
    violatedRules.push(
      hard(
        "never_automated_action_type",
        `${actionType} is permanently human-only: no automated execution path may ever exist.`,
        "EXECUTION",
      ),
    );
  }

  /* 9 — Missing hard limits. A null limit is missing configuration, not
   *     permission (spec §41): it blocks automated execution and is shown
   *     verbatim to the owner. It never blocks a human REVIEW. */
  for (const key of spec.requiredLimits) {
    if ((GUARDRAIL_LIMITS as Record<string, number | null>)[key as GuardrailLimitKey] === null) {
      missingConfiguration.push(`config/guardrails.ts → GUARDRAIL_LIMITS.${key}`);
    }
  }

  /* 10 — Price-affecting actions: the deterministic price floor is the
   *      authority (modules/pricing), and it fails closed while
   *      config/costs.ts holds null placeholders (spec §33). */
  if (spec.priceAffecting) {
    const policy = COST_MODEL.marginPolicy;
    if (policy.minimumGrossMarginBps === null) {
      missingConfiguration.push("config/costs.ts → marginPolicy.minimumGrossMarginBps");
    }
    if (policy.minimumContributionMarginBps === null) {
      missingConfiguration.push("config/costs.ts → marginPolicy.minimumContributionMarginBps");
    }

    if (input.priceContext) {
      const verdict = evaluatePriceFloor(
        input.priceContext.proposedTotalCents,
        input.priceContext.product,
        input.priceContext.configuration,
        COST_MODEL,
      );
      if (!verdict.allowed) {
        for (const ruleId of verdict.violatedRules) {
          violatedRules.push(hard(`price_floor:${ruleId}`, verdict.reason, "EXECUTION"));
        }
      }
    } else {
      violatedRules.push(
        hard(
          "price_floor_unverified",
          "No pricing state was supplied, so the margin floor could not be checked; execution stays blocked.",
          "EXECUTION",
        ),
      );
    }
  }

  /* 11 — Execution capability. No executor ⇒ nothing can run, whatever the
   *      human decides (spec §16, §23). */
  const executionSupport = executionSupportFor(actionType);
  if (executionSupport === "NOT_IMPLEMENTED") {
    violatedRules.push(
      soft("executor_not_implemented", `No executor exists for ${actionType} — approval records intent only.`),
    );
  }

  /* 12 — Risk ceiling: HIGH and CRITICAL always need a human, in every
   *      autonomy mode, forever. */
  if (!riskAtMost(riskLevel, MAX_UNATTENDED_RISK_LEVEL)) {
    violatedRules.push(
      hard(
        "risk_above_unattended_ceiling",
        `${riskLevel} risk always requires a human decision (unattended ceiling: ${MAX_UNATTENDED_RISK_LEVEL}).`,
        "EXECUTION",
      ),
    );
  }

  /* 13 — Automated-execution eligibility. EVERY condition must hold; there
   *      is no "default allow" branch anywhere in this chain. In Session 10
   *      the first condition alone is already false for every action type. */
  const executionBlockers = violatedRules.filter((r) => r.severity === "HARD");
  const executionEligible =
    executionSupport === "AVAILABLE" &&
    (autonomyMode === "GUARDED_AUTO" || autonomyMode === "AUTONOMOUS") &&
    GUARDED_AUTO_ALLOWED_ACTION_TYPES.includes(actionType) &&
    !spec.neverAutomated &&
    missingConfiguration.length === 0 &&
    executionBlockers.length === 0 &&
    riskAtMost(riskLevel, MAX_UNATTENDED_RISK_LEVEL);

  const approvalRequired = !executionEligible;

  const reasonParts: string[] = [
    `${actionType} proposed by ${source} (${autonomyMode})`,
    `risk ${riskLevel}`,
    executionSupport === "REVIEW_ONLY"
      ? "review-only: approving records a decision to investigate"
      : executionSupport === "NOT_IMPLEMENTED"
        ? "no executor implemented"
        : "executor available",
  ];
  if (missingConfiguration.length > 0) {
    reasonParts.push(`missing configuration: ${missingConfiguration.length} value(s)`);
  }
  reasonParts.push(approvalRequired ? "human approval required" : "eligible for automated execution");

  return {
    validatedPayload,
    decision: {
      policyVersion: GUARDRAIL_POLICY_VERSION,
      source,
      actionType,
      autonomyMode,
      allowed: true,
      executionEligible,
      approvalRequired,
      riskLevel,
      modelSuggestedRiskLevel,
      violatedRules,
      missingConfiguration,
      reason: reasonParts.join(" · "),
      executionSupport,
      executionState: initialExecutionState(executionSupport),
      limitsSnapshot,
    },
  };
}
