import { isFlagEnabled } from "@/config/flags";
import {
  listDecisions,
  recordDecision,
  updateDecisionRecommendation,
  type DecisionRow,
} from "@/lib/data/agent-service";
import { createCeoReport, type CeoReportRow } from "@/lib/data/ceo-report-service";
import { buildBusinessHealthSnapshot, periodFromDays, type Period } from "@/modules/business-intelligence";
import { getAiConfig } from "../../config";
import { isAiError } from "../../errors";
import { aiLog } from "../../log";
import { getPrompt } from "../../prompts/registry";
import { selectModel } from "../../router";
import { AiRuntime, isAiRuntimeAvailable } from "../../runtime";
import { buildCeoContext } from "./context";
import {
  CEO_CONFIDENCE_ORDINAL,
  CEO_RISK_TO_DECISION_RISK,
  ceoReviewSchema,
  type CeoRecommendation,
  type CeoReview,
} from "./schema";

/**
 * CEO Recommendation Agent (Session 09) — RECOMMEND mode, permanently.
 *
 * Boundaries (structural, spec §18–§24):
 *  - NO tools: the one model call is generateStructuredObject over the
 *    deterministic snapshot context. There is no registry, no execute
 *    path, and nothing here mutates prices, products, orders, budgets, or
 *    pages. The only writes are AgentDecision/ceo_reports AUDIT rows.
 *  - Untrusted output: metric references and evidence references are
 *    validated against exactly what the context offered; recommendations
 *    whose references don't survive are DROPPED (logged), never repaired.
 *  - Explicit trigger only: an admin action generates a review. Budget or
 *    provider failures fail SAFELY — deterministic BI keeps working and
 *    the previously persisted report stays visible.
 */

export type CeoReviewRunResult =
  | {
      status: "completed";
      report: CeoReportRow;
      decisions: DecisionRow[];
      created: number;
      updated: number;
      /** Recommendations dropped by server-side reference validation. */
      droppedInvalid: number;
      /** Recommendations skipped because a human already reviewed that identity. */
      skippedReviewed: number;
    }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; errorCode: string };

export function isBusinessIntelligenceAiEnabled(): boolean {
  return isFlagEnabled("AI_RUNTIME") && isFlagEnabled("AI_BUSINESS_INTELLIGENCE") && isAiRuntimeAvailable();
}

/** Stable identity for dedup (spec §24): category + evidence signature + period. */
export function recommendationIdentityKey(rec: CeoRecommendation, periodDays: number): string {
  const signature = [...rec.supportingMetricRefs, ...rec.evidenceRefs].sort().join("|");
  return `${rec.actionCategory}:${signature}:${periodDays}d`;
}

const identityOf = (row: DecisionRow): string | null => {
  const params = (row.proposedActionJson as { params?: Record<string, unknown> } | null)?.params;
  return typeof params?.identityKey === "string" ? params.identityKey : null;
};

export async function generateCeoReview(
  opts: { runtime?: AiRuntime; periodDays?: number; period?: Period } = {},
): Promise<CeoReviewRunResult> {
  if (!isFlagEnabled("AI_BUSINESS_INTELLIGENCE") || (!opts.runtime && !isBusinessIntelligenceAiEnabled())) {
    return { status: "unavailable", reason: "AI_DISABLED" };
  }
  let runtime: AiRuntime;
  try {
    runtime = opts.runtime ?? new AiRuntime();
  } catch (err) {
    return { status: "unavailable", reason: isAiError(err) ? err.code : "AI_CONFIGURATION_ERROR" };
  }

  const period = opts.period ?? periodFromDays(opts.periodDays ?? 7);
  const snapshot = await buildBusinessHealthSnapshot(period);
  const context = buildCeoContext(snapshot);
  const prompt = getPrompt("ai_ceo_business_review");
  let model: string | null = null;
  let provider: string | null = null;
  try {
    const config = getAiConfig();
    model = selectModel(config, "REASONING");
    provider = config.provider;
  } catch {
    model = null;
  }

  let review: CeoReview;
  try {
    review = await runtime.generateStructuredObject({
      workload: "REASONING",
      prompt: { id: "ai_ceo_business_review", vars: { context: context.text } },
      messages: [{ role: "user", content: "Produce the business review for the period in the context." }],
      schema: ceoReviewSchema,
      agentType: "ceo",
    });
  } catch (err) {
    const code = isAiError(err) ? err.code : "UNKNOWN";
    aiLog("ceo_review_failed", { periodDays: period.days, code });
    // Fail SAFELY: nothing persisted, deterministic BI untouched, any
    // previously generated report remains the visible one.
    return { status: "failed", errorCode: code };
  }

  /* Server-side reference validation (spec §36) — refs the context never
   * offered are removed; a recommendation left without any valid metric
   * reference is dropped entirely. */
  let droppedInvalid = 0;
  const validated: CeoRecommendation[] = [];
  for (const rec of review.recommendations) {
    const metricRefs = rec.supportingMetricRefs.filter((r) => context.validMetricRefs.has(r));
    const evidenceRefs = rec.evidenceRefs.filter((r) => context.validEvidenceRefs.has(r));
    const droppedRefs = rec.supportingMetricRefs.length - metricRefs.length + (rec.evidenceRefs.length - evidenceRefs.length);
    if (metricRefs.length === 0) {
      droppedInvalid += 1;
      aiLog("ceo_recommendation_dropped", { title: rec.title.slice(0, 80), reason: "no_valid_metric_refs" });
      continue;
    }
    if (droppedRefs > 0) {
      aiLog("ceo_recommendation_refs_filtered", { title: rec.title.slice(0, 80), droppedRefs });
    }
    validated.push({ ...rec, supportingMetricRefs: metricRefs, evidenceRefs });
  }

  /* Persist recommendations as AgentDecision rows with stable-identity
   * dedup: pending rows update in place; human-reviewed rows are frozen. */
  const existing = await listDecisions("ceo", 500);
  const byIdentity = new Map<string, DecisionRow>();
  for (const row of existing) {
    const key = identityOf(row);
    if (key && !byIdentity.has(key)) byIdentity.set(key, row);
  }

  const decisions: DecisionRow[] = [];
  let created = 0;
  let updated = 0;
  let skippedReviewed = 0;
  for (const rec of validated) {
    const identityKey = recommendationIdentityKey(rec, period.days);
    const decisionFields = {
      observation: rec.observation,
      reasoningSummary: rec.recommendation,
      supportingData: {
        title: rec.title,
        confidence: rec.confidence,
        actionCategory: rec.actionCategory,
        supportingMetricRefs: rec.supportingMetricRefs,
        evidenceRefs: rec.evidenceRefs,
        expectedImpact: rec.expectedImpact ?? null,
        limitations: rec.limitations,
        periodDays: period.days,
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
      },
      confidence: CEO_CONFIDENCE_ORDINAL[rec.confidence],
      riskLevel: CEO_RISK_TO_DECISION_RISK[rec.riskLevel],
      proposedAction: {
        agentType: "ceo" as const,
        // Future Action Center compatibility (spec §39): a structured,
        // category-scoped proposal — recommendation-only today.
        actionType: `recommend_${rec.actionCategory.toLowerCase()}`,
        params: {
          identityKey,
          title: rec.title,
          recommendation: rec.recommendation,
          actionCategory: rec.actionCategory,
          supportingMetricRefs: rec.supportingMetricRefs,
          evidenceRefs: rec.evidenceRefs,
          periodDays: period.days,
        },
        expectedEffect: rec.expectedImpact,
      },
    };

    const current = byIdentity.get(identityKey);
    if (!current) {
      // Every CEO recommendation requires human review — always.
      const { decision } = await recordDecision({ agentType: "ceo", decisionType: "ceo_recommendation", approvalRequired: true, ...decisionFields });
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
    // A human already approved/rejected/modified this identity and the
    // evidence signature is unchanged — never overwrite their verdict.
    skippedReviewed += 1;
    decisions.push(current);
  }

  const validatedReview: CeoReview = { ...review, recommendations: validated };
  const report = await createCeoReport({
    periodStart: period.start,
    periodEnd: period.end,
    periodDays: period.days,
    promptId: prompt.id,
    promptVersion: prompt.version,
    model: model ?? undefined,
    provider: provider ?? undefined,
    snapshot: JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>,
    review: JSON.parse(JSON.stringify(validatedReview)) as Record<string, unknown>,
    decisionIds: decisions.map((d) => d.id),
  });

  aiLog("ceo_review_completed", {
    periodDays: period.days,
    recommendations: validated.length,
    created,
    updated,
    droppedInvalid,
    skippedReviewed,
  });
  return { status: "completed", report, decisions, created, updated, droppedInvalid, skippedReviewed };
}
