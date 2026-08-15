import { croExperimentProposalPayloadSchema, reviewActionPayloadSchema } from "./actions";
import { isRiskLevel, type RiskLevel } from "./types";

/**
 * AgentDecision → ProposedAction mapping (spec §20).
 *
 * Session 09's CEO agent already writes STRUCTURED, category-scoped
 * recommendations. This turns one into a typed, review-only proposed action
 * so it can enter the Action Center — without inventing anything:
 *
 *  - Only the nine controlled CEO categories map. An unmapped/absent
 *    category yields null (no action is fabricated from prose).
 *  - Every CEO category maps to a *_REVIEW type: approving means "yes,
 *    investigate this". A CEO recommendation can never become an
 *    executable business change by being re-labelled (spec §43).
 *  - Metric/evidence references are copied verbatim from the decision; the
 *    caller re-validates them against real rows before persisting (§19).
 *
 * Category keys are plain strings on purpose: this module is deterministic
 * authority and must not import lib/ai. A test asserts the table covers
 * every CEO_ACTION_CATEGORY, so drift is caught immediately.
 */

export const CEO_CATEGORY_TO_ACTION_TYPE: Record<string, string> = {
  CUSTOMER_EXPERIENCE: "CUSTOMER_EXPERIENCE_REVIEW",
  PRODUCT: "PRODUCT_REVIEW",
  PRICING_REVIEW: "PRICING_REVIEW",
  MARKETING_REVIEW: "MARKETING_REVIEW",
  SALES: "SALES_REVIEW",
  OPERATIONS: "OPERATIONS_REVIEW",
  AI_COST: "AI_COST_REVIEW",
  DATA_QUALITY: "DATA_QUALITY_REVIEW",
  CRO_REVIEW: "CRO_REVIEW",
};

/** The decision fields this mapping reads — structurally, not by import. */
export type MappableDecision = {
  id: string;
  agentType: string;
  observation: string;
  reasoningSummary: string;
  riskLevel: string;
  supportingDataJson: Record<string, unknown> | null;
  proposedActionJson: Record<string, unknown> | null;
};

export type MappedAction = {
  actionType: string;
  title: string;
  identityKey: string | null;
  payload: Record<string, unknown>;
  modelSuggestedRiskLevel: RiskLevel | null;
};

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.slice(0, max) : null;

const strArray = (v: unknown, max: number, itemMax: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, max).map((x) => x.slice(0, itemMax)) : [];

/** low|medium|high (decision row) → the guardrail's four-level scale. */
const DECISION_RISK_TO_LEVEL: Record<string, RiskLevel> = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
  critical: "CRITICAL",
};

/**
 * Map one decision to a proposed action, or null when it carries no
 * structured category (purely informational — spec §20).
 */
export function mapDecisionToAction(decision: MappableDecision): MappedAction | null {
  const params = (decision.proposedActionJson?.params ?? {}) as Record<string, unknown>;
  const support = decision.supportingDataJson ?? {};

  const category = str(support.actionCategory, 64) ?? str(params.actionCategory, 64);
  if (!category) return null;
  const actionType = CEO_CATEGORY_TO_ACTION_TYPE[category];
  if (!actionType) return null;

  const title = str(support.title, 200) ?? str(params.title, 200) ?? `${category} recommendation`;
  const periodDaysRaw = support.periodDays ?? params.periodDays;
  const periodDays =
    typeof periodDaysRaw === "number" && Number.isInteger(periodDaysRaw) && periodDaysRaw >= 1 && periodDaysRaw <= 365
      ? periodDaysRaw
      : null;

  const payloadCandidate = {
    title,
    observation: decision.observation.slice(0, 2000),
    question: (str(params.recommendation, 2000) ?? decision.reasoningSummary).slice(0, 2000),
    expectedImpact: str(support.expectedImpact, 600),
    limitations: strArray(support.limitations, 8, 300),
    periodDays,
    metricRefs: strArray(support.supportingMetricRefs ?? params.supportingMetricRefs, 16, 120),
    evidenceRefs: strArray(support.evidenceRefs ?? params.evidenceRefs, 16, 64),
  };

  // Validate here too: a decision row written by an older version must not
  // become a malformed action silently.
  const parsed = reviewActionPayloadSchema.safeParse(payloadCandidate);
  if (!parsed.success) return null;

  const modelRisk = DECISION_RISK_TO_LEVEL[decision.riskLevel] ?? null;

  return {
    actionType,
    title,
    identityKey: str(params.identityKey, 200),
    payload: parsed.data as unknown as Record<string, unknown>,
    modelSuggestedRiskLevel: isRiskLevel(modelRisk) ? modelRisk : null,
  };
}

/* ------------------------------------------------------------------ */
/* Session 11 — CRO decisions                                          */
/* ------------------------------------------------------------------ */

/**
 * CRO decision → proposed action (Session 11 spec §24).
 *
 * Two shapes only, both review-shaped by policy:
 *  - `EXPERIMENT` ⇒ `CRO_EXPERIMENT_PROPOSAL`, carrying the design the CRO
 *    agent produced (already server-validated when it was persisted; it is
 *    re-validated HERE too, so a decision row written by an older version
 *    can never become a malformed action silently).
 *  - `REVIEW` ⇒ `CRO_REVIEW`, for friction that is a business/product
 *    question rather than a copy test (spec §38). Approving it means "yes,
 *    look into this" — it can never become an experiment by relabelling.
 *
 * A decision with neither shape maps to null: no action is invented from
 * prose, exactly as for CEO recommendations.
 */
export function mapCroDecisionToAction(decision: MappableDecision): MappedAction | null {
  const params = (decision.proposedActionJson?.params ?? {}) as Record<string, unknown>;
  const support = decision.supportingDataJson ?? {};
  const kind = str(support.proposalKind, 20) ?? str(params.proposalKind, 20);
  const title = str(support.title, 200) ?? str(params.title, 200) ?? "CRO proposal";
  const identityKey = str(params.identityKey, 200);
  const modelRisk = DECISION_RISK_TO_LEVEL[decision.riskLevel] ?? null;
  const metricRefs = strArray(support.supportingMetricRefs ?? params.supportingMetricRefs, 16, 120);
  const evidenceRefs = strArray(support.evidenceRefs ?? params.evidenceRefs, 16, 64);

  if (kind === "EXPERIMENT") {
    const payloadCandidate = {
      page: str(support.targetKey, 200) ?? str(params.targetKey, 200) ?? "",
      hypothesis: (str(support.hypothesis, 2000) ?? decision.reasoningSummary).slice(0, 2000),
      control: str(support.controlSummary, 1000) ?? "Current experience, unchanged",
      variant: str(support.variantSummary, 1000) ?? title,
      primaryMetric: str(support.primaryMetric, 120) ?? "",
      proposedTrafficPct: numberOrNull(support.proposedTrafficPct ?? params.proposedTrafficPct),
      design: (support.design ?? params.design) ?? null,
      metricRefs,
      evidenceRefs,
    };
    const parsed = croExperimentProposalPayloadSchema.safeParse(payloadCandidate);
    if (!parsed.success) return null;
    return {
      actionType: "CRO_EXPERIMENT_PROPOSAL",
      title,
      identityKey,
      payload: parsed.data as unknown as Record<string, unknown>,
      modelSuggestedRiskLevel: isRiskLevel(modelRisk) ? modelRisk : null,
    };
  }

  if (kind === "REVIEW") {
    const payloadCandidate = {
      title,
      observation: decision.observation.slice(0, 2000),
      question: (str(support.hypothesis, 2000) ?? decision.reasoningSummary).slice(0, 2000),
      expectedImpact: str(support.expectedImpact, 600),
      limitations: strArray(support.limitations, 8, 300),
      periodDays: numberOrNull(support.periodDays ?? params.periodDays),
      metricRefs,
      evidenceRefs,
    };
    const parsed = reviewActionPayloadSchema.safeParse(payloadCandidate);
    if (!parsed.success) return null;
    return {
      actionType: "CRO_REVIEW",
      title,
      identityKey,
      payload: parsed.data as unknown as Record<string, unknown>,
      modelSuggestedRiskLevel: isRiskLevel(modelRisk) ? modelRisk : null,
    };
  }

  return null;
}

const numberOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Dispatch by agent type. Unknown agent types map to null — a new agent
 * gets no action taxonomy by accident.
 */
export function mapAgentDecisionToAction(decision: MappableDecision): MappedAction | null {
  if (decision.agentType === "ceo") return mapDecisionToAction(decision);
  if (decision.agentType === "cro") return mapCroDecisionToAction(decision);
  return null;
}
