import { EXPERIMENTS, resolveTrafficCap } from "@/config/experiments";
import { isFlagEnabled } from "@/config/flags";
import {
  listDecisions,
  recordDecision,
  updateDecisionRecommendation,
  type DecisionRow,
} from "@/lib/data/agent-service";
import { listExperiments } from "@/lib/data/experiment-service";
import { buildExperimentSummary } from "@/lib/experiments/readout";
import {
  buildBusinessHealthSnapshot,
  loadFunnelDropOff,
  periodFromDays,
  type Period,
} from "@/modules/business-intelligence";
import {
  effectiveMinimumSample,
  evenAllocation,
  getExperimentTarget,
  parseExperimentDesign,
  CONTROL_VARIANT_KEY,
  DEFAULT_VARIANT_KEY,
} from "@/modules/experiments";
import { isAiError } from "../../errors";
import { aiLog } from "../../log";
import { AiRuntime, isAiRuntimeAvailable } from "../../runtime";
import { buildCroContext } from "./context";
import {
  croReviewSchema,
  CRO_CONFIDENCE_ORDINAL,
  CRO_RISK_TO_DECISION_RISK,
  type CroProposal,
  type CroReview,
} from "./schema";

/**
 * CRO Agent (Session 11) — RECOMMEND mode.
 *
 * Boundaries, structural rather than prompted (spec §20–§21, §24):
 *  - NO tools. One REASONING `generateStructuredObject` call over the
 *    deterministic context, exactly like the S09 CEO agent.
 *  - It writes AgentDecision AUDIT rows and NOTHING else. It does not
 *    import the action service, cannot create or launch an experiment,
 *    cannot approve anything, and cannot touch pricing, checkout or the
 *    catalog. Proposals reach the Action Center only through the
 *    deterministic sync a human triggers there.
 *  - Untrusted output: target keys are checked against the CLOSED registry,
 *    variant configs against that target's strict schema, metric/evidence
 *    references against exactly what the context printed, traffic against
 *    the effective ceiling, and the minimum sample against the documented
 *    floor (raise only). Anything that fails is DROPPED and logged — never
 *    repaired into something plausible.
 *  - Provider or budget failure persists NOTHING and leaves running
 *    experiments, assignments, measurement and the admin dashboard fully
 *    functional (spec §47–§48).
 */

export type CroReviewRunResult =
  | {
      status: "completed";
      review: CroReview;
      decisions: DecisionRow[];
      created: number;
      updated: number;
      /** Proposals dropped by server-side validation (bad target/config/refs). */
      droppedInvalid: number;
      /** Proposals whose identity a human has already reviewed. */
      skippedReviewed: number;
      dropReasons: string[];
    }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; errorCode: string };

export function isCroAgentEnabled(): boolean {
  return isFlagEnabled("AI_RUNTIME") && isFlagEnabled("AI_CRO_AGENT") && isAiRuntimeAvailable();
}

/** Stable identity for dedup: kind + target/refs signature + period. */
export function croProposalIdentityKey(proposal: CroProposal, periodDays: number): string {
  const signature = [...proposal.supportingMetricRefs, ...proposal.evidenceRefs].sort().join("|");
  return `CRO:${proposal.kind}:${proposal.targetKey ?? "none"}:${signature}:${periodDays}d`;
}

const identityOf = (row: DecisionRow): string | null => {
  const params = (row.proposedActionJson as { params?: Record<string, unknown> } | null)?.params;
  return typeof params?.identityKey === "string" ? params.identityKey : null;
};

export async function generateCroReview(
  opts: { runtime?: AiRuntime; periodDays?: number; period?: Period } = {},
): Promise<CroReviewRunResult> {
  if (!isFlagEnabled("AI_CRO_AGENT") || (!opts.runtime && !isCroAgentEnabled())) {
    return { status: "unavailable", reason: "AI_DISABLED" };
  }
  let runtime: AiRuntime;
  try {
    runtime = opts.runtime ?? new AiRuntime();
  } catch (err) {
    return { status: "unavailable", reason: isAiError(err) ? err.code : "AI_CONFIGURATION_ERROR" };
  }

  const period = opts.period ?? periodFromDays(opts.periodDays ?? 30);
  const [snapshot, dropOff, experimentRows] = await Promise.all([
    buildBusinessHealthSnapshot(period),
    loadFunnelDropOff(period),
    listExperiments({ limit: 25 }),
  ]);
  const experiments = await Promise.all(experimentRows.map((row) => buildExperimentSummary(row)));
  const context = buildCroContext({ snapshot, dropOff, experiments });

  let review: CroReview;
  try {
    review = await runtime.generateStructuredObject({
      workload: "REASONING",
      prompt: { id: "ai_cro_experiment_review", vars: { context: context.text } },
      messages: [
        {
          role: "user",
          content: "Review the conversion data in the context and propose experiments or reviews where the evidence supports them.",
        },
      ],
      schema: croReviewSchema,
      agentType: "cro",
    });
  } catch (err) {
    const code = isAiError(err) ? err.code : "UNKNOWN";
    aiLog("cro_review_failed", { periodDays: period.days, code });
    // Fail SAFELY: nothing persisted; running experiments, assignment,
    // exposure and measurement are entirely unaffected.
    return { status: "failed", errorCode: code };
  }

  const cap = resolveTrafficCap();
  const validated: { proposal: CroProposal; design: Record<string, unknown> | null }[] = [];
  const dropReasons: string[] = [];
  let droppedInvalid = 0;

  for (const raw of review.proposals) {
    const metricRefs = raw.supportingMetricRefs.filter((r) => context.validMetricRefs.has(r));
    const evidenceRefs = raw.evidenceRefs.filter((r) => context.validEvidenceRefs.has(r));
    if (metricRefs.length === 0) {
      droppedInvalid += 1;
      dropReasons.push(`"${raw.title.slice(0, 60)}": no valid metric reference`);
      aiLog("cro_proposal_dropped", { title: raw.title.slice(0, 80), reason: "no_valid_metric_refs" });
      continue;
    }
    const proposal: CroProposal = { ...raw, supportingMetricRefs: metricRefs, evidenceRefs };

    if (proposal.kind === "REVIEW") {
      validated.push({ proposal, design: null });
      continue;
    }

    const built = buildDesign(proposal, cap.ok ? cap.capPct : null);
    if (!built.ok) {
      droppedInvalid += 1;
      dropReasons.push(`"${raw.title.slice(0, 60)}": ${built.reason}`);
      aiLog("cro_proposal_dropped", { title: raw.title.slice(0, 80), reason: built.reason.slice(0, 120) });
      continue;
    }
    validated.push({ proposal, design: built.design });
  }

  /* Persist as AgentDecision rows with stable-identity dedup: pending rows
   * refresh in place, human-reviewed identities are frozen (S09 semantics). */
  const existing = await listDecisions("cro", 500);
  const byIdentity = new Map<string, DecisionRow>();
  for (const row of existing) {
    const key = identityOf(row);
    if (key && !byIdentity.has(key)) byIdentity.set(key, row);
  }

  const decisions: DecisionRow[] = [];
  let created = 0;
  let updated = 0;
  let skippedReviewed = 0;

  for (const { proposal, design } of validated) {
    const identityKey = croProposalIdentityKey(proposal, period.days);
    const target = proposal.targetKey ? getExperimentTarget(proposal.targetKey) : null;
    const supportingData = {
      proposalKind: proposal.kind,
      title: proposal.title,
      hypothesis: proposal.hypothesis,
      targetKey: proposal.kind === "EXPERIMENT" ? proposal.targetKey : null,
      experimentType: proposal.kind === "EXPERIMENT" ? proposal.experimentType : null,
      controlSummary: target ? target.describeControl().summary : null,
      variantSummary: proposal.variantSummary,
      primaryMetric: proposal.primaryMetric,
      proposedTrafficPct: design ? nonControlPctOf(design) : null,
      design,
      supportingMetricRefs: proposal.supportingMetricRefs,
      evidenceRefs: proposal.evidenceRefs,
      expectedImpact: proposal.expectedImpact,
      confidence: proposal.confidence,
      limitations: proposal.limitations,
      periodDays: period.days,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    };

    const decisionFields = {
      observation: proposal.observation,
      reasoningSummary: proposal.hypothesis,
      supportingData,
      confidence: CRO_CONFIDENCE_ORDINAL[proposal.confidence],
      riskLevel: CRO_RISK_TO_DECISION_RISK[proposal.riskLevel],
      proposedAction: {
        agentType: "cro" as const,
        actionType: proposal.kind === "EXPERIMENT" ? "propose_cro_experiment" : "propose_cro_review",
        params: {
          identityKey,
          title: proposal.title,
          proposalKind: proposal.kind,
          targetKey: proposal.targetKey,
          design,
          supportingMetricRefs: proposal.supportingMetricRefs,
          evidenceRefs: proposal.evidenceRefs,
          periodDays: period.days,
        },
        expectedEffect: proposal.expectedImpact ?? undefined,
      },
    };

    const current = byIdentity.get(identityKey);
    if (!current) {
      const { decision } = await recordDecision({
        agentType: "cro",
        decisionType: proposal.kind === "EXPERIMENT" ? "cro_experiment_proposal" : "cro_review",
        approvalRequired: true,
        ...decisionFields,
      });
      decisions.push(decision);
      created += 1;
      continue;
    }
    if (current.approvalStatus === "pending" && current.executionStatus === "none") {
      const ok = await updateDecisionRecommendation(current.id, decisionFields);
      if (ok) {
        decisions.push(current);
        updated += 1;
        continue;
      }
    }
    skippedReviewed += 1;
    decisions.push(current);
  }

  aiLog("cro_review_completed", {
    periodDays: period.days,
    proposals: validated.length,
    created,
    updated,
    droppedInvalid,
    skippedReviewed,
  });

  return {
    status: "completed",
    review: { ...review, proposals: validated.map((v) => v.proposal) },
    decisions,
    created,
    updated,
    droppedInvalid,
    skippedReviewed,
    dropReasons,
  };
}

/**
 * Turn a model proposal into a fully-validated experiment design, or refuse.
 *
 * Everything consequential is decided HERE, not by the model: the audience
 * comes from the target's own routes, the allocation is server-built and
 * capped, and the minimum sample can only be raised.
 */
function buildDesign(
  proposal: CroProposal,
  capPct: number | null,
): { ok: true; design: Record<string, unknown> } | { ok: false; reason: string } {
  if (!proposal.targetKey) return { ok: false, reason: "no target key supplied" };
  const target = getExperimentTarget(proposal.targetKey);
  if (!target) return { ok: false, reason: `unknown experiment target "${proposal.targetKey}"` };
  if (!proposal.experimentType) return { ok: false, reason: "no experiment type supplied" };
  if (!proposal.primaryMetric) return { ok: false, reason: "no primary metric supplied" };
  if (!proposal.variantConfig) return { ok: false, reason: "no variant config supplied" };

  // The agent never chooses how much traffic it gets: it may ASK, and the
  // server takes the smaller of its request and the effective ceiling.
  const effectiveCap = capPct ?? EXPERIMENTS.DEV_ONLY_MAX_TRAFFIC_PCT;
  const requested = proposal.proposedTrafficPct ?? 50;
  const variantPct = Math.max(1, Math.min(requested, effectiveCap, 50));

  const design = {
    targetKey: proposal.targetKey,
    experimentType: proposal.experimentType,
    variantKey: DEFAULT_VARIANT_KEY,
    variantConfig: stripNulls(proposal.variantConfig),
    primaryMetric: proposal.primaryMetric,
    secondaryMetrics: proposal.secondaryMetrics,
    guardrailMetrics: proposal.guardrailMetrics,
    // Audience comes from the TARGET, not from the model.
    audience: { routes: [...target.routes], trafficSources: [], campaigns: [], device: "any", visitor: "any" },
    allocation: evenAllocation(DEFAULT_VARIANT_KEY, variantPct),
    minimumSampleSize: effectiveMinimumSample(proposal.minimumSampleSize),
  };

  const parsed = parseExperimentDesign(design, capPct === null ? {} : { maxNonControlPct: capPct });
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  return { ok: true, design: JSON.parse(JSON.stringify(parsed.design)) as Record<string, unknown> };
}

/** Optional variant fields arrive as null; strict schemas accept null, not undefined. */
function stripNulls(config: Record<string, string | null>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(config)) out[key] = value === "" ? null : value;
  return out;
}

function nonControlPctOf(design: Record<string, unknown>): number | null {
  const allocation = design.allocation;
  if (!Array.isArray(allocation)) return null;
  return allocation
    .filter((a) => (a as { variant?: string }).variant !== CONTROL_VARIANT_KEY)
    .reduce((sum, a) => sum + (Number((a as { pct?: number }).pct) || 0), 0);
}
