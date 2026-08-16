import { isFlagEnabled } from "@/config/flags";
import {
  PRICING_RECOMMENDATION_ACTION_TYPE,
  type PricingRecommendationType,
} from "@/config/pricing-intelligence";
import {
  listDecisions,
  recordDecision,
  updateDecisionRecommendation,
  type DecisionRow,
} from "@/lib/data/agent-service";
import { createPricingReport, type PricingReportRow } from "@/lib/data/pricing-report-service";
import {
  buildPricingIntelligenceSnapshot,
  periodFromDays,
  type Period,
  type PricingIntelligenceSnapshot,
} from "@/modules/pricing-intelligence";
import { getAiConfig } from "../../config";
import { isAiError } from "../../errors";
import { aiLog } from "../../log";
import { getPrompt } from "../../prompts/registry";
import { selectModel } from "../../router";
import { AiRuntime, isAiRuntimeAvailable } from "../../runtime";
import { buildPricingContext } from "./context";
import {
  PRICING_CONFIDENCE_ORDINAL,
  PRICING_RISK_TO_DECISION_RISK,
  pricingReviewSchema,
  type PricingRecommendation,
  type PricingReview,
} from "./schema";

/**
 * Pricing Intelligence Agent (Session 12) — RECOMMEND mode.
 *
 * Boundaries, structural rather than prompted:
 *
 *  - NO tools. One REASONING `generateStructuredObject` call over the
 *    deterministic PricingIntelligenceSnapshot, exactly like the S09 CEO and
 *    S11 CRO agents.
 *  - NO price authority. `modules/pricing` is untouched. This file imports
 *    no pricing mutation path, no catalog writer, no checkout, no cart. Its
 *    only writes are AgentDecision + pricing_reports AUDIT rows.
 *  - The output schema cannot EXPRESS a price (see schema.ts), so "propose
 *    $0.37" is not refused — it is unwritable.
 *  - Untrusted output: metric/evidence/signal references are validated
 *    against exactly what the context printed; `productId` against the real
 *    catalog and `quantityTier` against that product's real tier ladder;
 *    `requiresCostConfiguration` / `requiresExperiment` are OVERWRITTEN with
 *    the deterministic answers. Anything that fails is DROPPED and logged,
 *    never repaired into something plausible.
 *  - Provider or budget failure persists NOTHING. Deterministic pricing
 *    analytics, the dashboard, and the previously persisted review all keep
 *    working (spec §42).
 */

export type PricingReviewRunResult =
  | {
      status: "completed";
      report: PricingReportRow;
      review: PricingReview;
      decisions: DecisionRow[];
      created: number;
      updated: number;
      /** Recommendations dropped by server-side validation. */
      droppedInvalid: number;
      /** Recommendations whose identity a human has already reviewed. */
      skippedReviewed: number;
      /** References the model invented and the server removed. */
      droppedReferences: number;
      dropReasons: string[];
    }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; errorCode: string };

export function isPricingAgentEnabled(): boolean {
  return isFlagEnabled("AI_RUNTIME") && isFlagEnabled("AI_PRICING_AGENT") && isAiRuntimeAvailable();
}

/** Stable identity for dedup: type + scope + evidence signature + period. */
export function pricingRecommendationIdentityKey(rec: PricingRecommendation, periodDays: number): string {
  const signature = [...rec.metricRefs, ...rec.evidenceRefs].sort().join("|");
  return `PRICING:${rec.recommendationType}:${rec.productId ?? "all"}:${rec.quantityTier ?? "all"}:${signature}:${periodDays}d`;
}

const identityOf = (row: DecisionRow): string | null => {
  const params = (row.proposedActionJson as { params?: Record<string, unknown> } | null)?.params;
  return typeof params?.identityKey === "string" ? params.identityKey : null;
};

/**
 * The DETERMINISTIC answer to "does this recommendation depend on cost
 * configuration?" — computed from the snapshot, never taken from the model.
 *
 * Anything that could move a price depends on cost configuration while
 * `config/costs.ts` holds placeholders, because without costs we cannot say
 * whether there is room to move at all.
 */
function derivePrerequisites(
  type: PricingRecommendationType,
  snapshot: PricingIntelligenceSnapshot,
): { requiresCostConfiguration: boolean; requiresExperiment: boolean } {
  const costsMissing = !snapshot.costs.costModelConfigured || !snapshot.costs.marginPolicyConfigured;
  switch (type) {
    case "PRICING_REVIEW":
    case "TIER_STRUCTURE_REVIEW":
      return { requiresCostConfiguration: costsMissing, requiresExperiment: false };
    case "PRICE_EXPERIMENT_REVIEW":
      return { requiresCostConfiguration: costsMissing, requiresExperiment: true };
    case "MOQ_REVIEW":
      // MOQ feasibility is a factory question, not a margin question — but a
      // smaller run changes unit economics, so costs still gate any number.
      return { requiresCostConfiguration: costsMissing, requiresExperiment: false };
    case "PRICE_PRESENTATION_REVIEW":
      // Presentation keeps the monetary price identical, so it needs no cost
      // data — and it is the one class a CRO experiment could ever carry.
      return { requiresCostConfiguration: false, requiresExperiment: false };
    case "DATA_QUALITY":
      return { requiresCostConfiguration: false, requiresExperiment: false };
  }
}

export async function generatePricingReview(
  opts: { runtime?: AiRuntime; periodDays?: number; period?: Period } = {},
): Promise<PricingReviewRunResult> {
  if (!isFlagEnabled("AI_PRICING_AGENT") || (!opts.runtime && !isPricingAgentEnabled())) {
    return { status: "unavailable", reason: "AI_DISABLED" };
  }
  let runtime: AiRuntime;
  try {
    runtime = opts.runtime ?? new AiRuntime();
  } catch (err) {
    return { status: "unavailable", reason: isAiError(err) ? err.code : "AI_CONFIGURATION_ERROR" };
  }

  const period = opts.period ?? periodFromDays(opts.periodDays ?? 30);
  const snapshot = await buildPricingIntelligenceSnapshot(period);
  const context = buildPricingContext(snapshot);
  const prompt = getPrompt("ai_pricing_intelligence_review");

  let model: string | null = null;
  let provider: string | null = null;
  try {
    const config = getAiConfig();
    model = selectModel(config, "REASONING");
    provider = config.provider;
  } catch {
    model = null;
  }

  let review: PricingReview;
  try {
    review = await runtime.generateStructuredObject({
      workload: "REASONING",
      prompt: { id: "ai_pricing_intelligence_review", vars: { context: context.text } },
      messages: [
        {
          role: "user",
          content:
            "Review the pricing data in the context and raise pricing reviews where the evidence supports them. Propose no prices.",
        },
      ],
      schema: pricingReviewSchema,
      agentType: "pricing",
    });
  } catch (err) {
    const code = isAiError(err) ? err.code : "UNKNOWN";
    aiLog("pricing_review_failed", { periodDays: period.days, code });
    // Fail SAFELY: nothing persisted; deterministic pricing analytics and
    // any previously generated review are entirely unaffected.
    return { status: "failed", errorCode: code };
  }

  /* ---------------- Server-side validation (spec §40) ---------------- */
  const validated: PricingRecommendation[] = [];
  const dropReasons: string[] = [];
  let droppedInvalid = 0;
  let droppedReferences = 0;

  for (const raw of review.recommendations) {
    const metricRefs = raw.metricRefs.filter((r) => context.validMetricRefs.has(r));
    const evidenceRefs = raw.evidenceRefs.filter((r) => context.validEvidenceRefs.has(r));
    droppedReferences += raw.metricRefs.length - metricRefs.length + (raw.evidenceRefs.length - evidenceRefs.length);

    if (metricRefs.length === 0) {
      droppedInvalid += 1;
      dropReasons.push(`"${raw.title.slice(0, 60)}": no valid metric reference`);
      aiLog("pricing_recommendation_dropped", { title: raw.title.slice(0, 80), reason: "no_valid_metric_refs" });
      continue;
    }

    // productId must be a real catalog product; quantityTier must be a real
    // tier OF THAT PRODUCT. A plausible-looking pair is still dropped to null.
    const tiers = raw.productId ? context.validTiersByProduct.get(raw.productId) : undefined;
    const productId = tiers ? raw.productId : null;
    const quantityTier = productId && raw.quantityTier !== null && tiers?.has(raw.quantityTier) ? raw.quantityTier : null;
    if (raw.productId && !productId) {
      dropReasons.push(`"${raw.title.slice(0, 60)}": unknown productId "${raw.productId}" removed`);
      aiLog("pricing_recommendation_scope_dropped", { title: raw.title.slice(0, 80), productId: raw.productId });
    }
    if (raw.quantityTier !== null && quantityTier === null) {
      dropReasons.push(`"${raw.title.slice(0, 60)}": quantityTier ${raw.quantityTier} is not a tier of that product; removed`);
    }

    const prerequisites = derivePrerequisites(raw.recommendationType, snapshot);
    if (
      raw.requiresCostConfiguration !== prerequisites.requiresCostConfiguration ||
      raw.requiresExperiment !== prerequisites.requiresExperiment
    ) {
      aiLog("pricing_prerequisites_overridden", {
        title: raw.title.slice(0, 80),
        modelSaid: `${raw.requiresCostConfiguration}/${raw.requiresExperiment}`,
        server: `${prerequisites.requiresCostConfiguration}/${prerequisites.requiresExperiment}`,
      });
    }

    validated.push({ ...raw, metricRefs, evidenceRefs, productId, quantityTier, ...prerequisites });
  }

  /* Signal notes may only annotate signals the context actually printed. */
  const signals = review.signals.filter((note) => context.validSignalIds.has(note.signalId));
  droppedReferences += review.signals.length - signals.length;

  /* ---------------- Persist recommendations ---------------- */
  const existing = await listDecisions("pricing", 500);
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
    const identityKey = pricingRecommendationIdentityKey(rec, period.days);
    const decisionFields = {
      observation: rec.observation,
      reasoningSummary: rec.recommendation,
      supportingData: {
        title: rec.title,
        recommendationType: rec.recommendationType,
        /** The CLOSED Session-10 action type this maps to. Review-only, always. */
        actionType: PRICING_RECOMMENDATION_ACTION_TYPE[rec.recommendationType],
        productId: rec.productId,
        quantityTier: rec.quantityTier,
        supportingMetricRefs: rec.metricRefs,
        evidenceRefs: rec.evidenceRefs,
        confidence: rec.confidence,
        limitations: rec.limitations,
        requiresCostConfiguration: rec.requiresCostConfiguration,
        requiresExperiment: rec.requiresExperiment,
        periodDays: period.days,
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
      },
      confidence: PRICING_CONFIDENCE_ORDINAL[rec.confidence],
      riskLevel: PRICING_RISK_TO_DECISION_RISK[rec.risk],
      proposedAction: {
        agentType: "pricing" as const,
        actionType: `recommend_${rec.recommendationType.toLowerCase()}`,
        params: {
          identityKey,
          title: rec.title,
          recommendationType: rec.recommendationType,
          recommendation: rec.recommendation,
          productId: rec.productId,
          quantityTier: rec.quantityTier,
          supportingMetricRefs: rec.metricRefs,
          evidenceRefs: rec.evidenceRefs,
          periodDays: period.days,
        },
      },
    };

    const current = byIdentity.get(identityKey);
    if (!current) {
      const { decision } = await recordDecision({
        agentType: "pricing",
        decisionType: "pricing_recommendation",
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
    // A human already decided on this identity — never overwrite a verdict.
    skippedReviewed += 1;
    decisions.push(current);
  }

  const validatedReview: PricingReview = { ...review, signals, recommendations: validated };
  const report = await createPricingReport({
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

  aiLog("pricing_review_completed", {
    periodDays: period.days,
    recommendations: validated.length,
    created,
    updated,
    droppedInvalid,
    droppedReferences,
    skippedReviewed,
  });

  return {
    status: "completed",
    report,
    review: validatedReview,
    decisions,
    created,
    updated,
    droppedInvalid,
    skippedReviewed,
    droppedReferences,
    dropReasons,
  };
}
