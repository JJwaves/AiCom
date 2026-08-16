import { isFlagEnabled } from "@/config/flags";
import { GOOGLE_ADS_RECOMMENDATION_ACTION_TYPE } from "@/config/google-ads";
import {
  listDecisions,
  recordDecision,
  updateDecisionRecommendation,
  type DecisionRow,
} from "@/lib/data/agent-service";
import { createGoogleAdsReport, type GoogleAdsReportRow } from "@/lib/data/google-ads-report-service";
import {
  buildGoogleAdsIntelligenceSnapshot,
  periodFromDays,
  type GoogleAdsIntelligenceSnapshot,
  type Period,
} from "@/modules/google-ads-intelligence";
import type { CredentialSnapshot } from "@/modules/google-ads-intelligence/connection";
import { getAiConfig } from "../../config";
import { isAiError } from "../../errors";
import { aiLog } from "../../log";
import { getPrompt } from "../../prompts/registry";
import { selectModel } from "../../router";
import { AiRuntime, isAiRuntimeAvailable } from "../../runtime";
import { buildGoogleAdsContext } from "./context";
import {
  GOOGLE_ADS_CONFIDENCE_ORDINAL,
  GOOGLE_ADS_RISK_TO_DECISION_RISK,
  googleAdsReviewSchema,
  type GoogleAdsRecommendation,
  type GoogleAdsReview,
} from "./schema";

/**
 * Google Ads Intelligence Agent (Session 13 spec §35–§40) — RECOMMEND mode.
 *
 * Boundaries, structural rather than prompted:
 *
 *  - NO tools. One REASONING `generateStructuredObject` call over the
 *    deterministic GoogleAdsIntelligenceSnapshot, exactly like the S09 CEO,
 *    S11 CRO and S12 Pricing agents.
 *  - NO Google Ads access. This file imports no `lib/google-ads` module. The
 *    agent cannot call Google, cannot sync, cannot test the connection, and
 *    could not reach a mutation endpoint even if one existed (spec §36).
 *  - NO campaign authority. Its only writes are AgentDecision + an audit
 *    `google_ads_reports` row.
 *  - The output schema cannot EXPRESS a budget, a pause, a bid, a keyword or
 *    an ad (see schema.ts), so "raise Campaign X to $500/day" is not refused —
 *    it is unwritable.
 *  - Untrusted output: metric/evidence/signal references are validated
 *    against exactly what the context printed; `campaignId` against the
 *    campaigns the snapshot actually contained. Anything that fails is
 *    DROPPED and logged, never repaired into something plausible.
 *  - Provider or budget failure persists NOTHING. Deterministic analytics,
 *    the dashboard, and the previously persisted review keep working.
 */

export type GoogleAdsReviewRunResult =
  | {
      status: "completed";
      report: GoogleAdsReportRow;
      review: GoogleAdsReview;
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

export function isGoogleAdsAgentEnabled(): boolean {
  return isFlagEnabled("AI_RUNTIME") && isFlagEnabled("AI_GOOGLE_ADS_AGENT") && isAiRuntimeAvailable();
}

/** Stable identity for dedup: type + scope + evidence signature + period. */
export function googleAdsRecommendationIdentityKey(rec: GoogleAdsRecommendation, periodDays: number): string {
  const signature = [...rec.metricRefs, ...rec.evidenceRefs].sort().join("|");
  return `GOOGLE_ADS:${rec.recommendationType}:${rec.campaignId ?? "account"}:${signature}:${periodDays}d`;
}

const identityOf = (row: DecisionRow): string | null => {
  const params = (row.proposedActionJson as { params?: Record<string, unknown> } | null)?.params;
  return typeof params?.identityKey === "string" ? params.identityKey : null;
};

export async function generateGoogleAdsReview(
  opts: {
    runtime?: AiRuntime;
    periodDays?: number;
    period?: Period;
    /** Credential picture; the agent never reads env itself. */
    credentials: CredentialSnapshot;
    now?: Date;
  },
): Promise<GoogleAdsReviewRunResult> {
  if (!isFlagEnabled("AI_GOOGLE_ADS_AGENT") || (!opts.runtime && !isGoogleAdsAgentEnabled())) {
    return { status: "unavailable", reason: "AI_DISABLED" };
  }
  let runtime: AiRuntime;
  try {
    runtime = opts.runtime ?? new AiRuntime();
  } catch (err) {
    return { status: "unavailable", reason: isAiError(err) ? err.code : "AI_CONFIGURATION_ERROR" };
  }

  const period = opts.period ?? periodFromDays(opts.periodDays ?? 30);
  const snapshot = await buildGoogleAdsIntelligenceSnapshot(period, opts.credentials, opts.now ?? new Date());
  const context = buildGoogleAdsContext(snapshot);
  const prompt = getPrompt("ai_google_ads_review");

  let model: string | null = null;
  let provider: string | null = null;
  try {
    const config = getAiConfig();
    model = selectModel(config, "REASONING");
    provider = config.provider;
  } catch {
    model = null;
  }

  let review: GoogleAdsReview;
  try {
    review = await runtime.generateStructuredObject({
      workload: "REASONING",
      prompt: { id: "ai_google_ads_review", vars: { context: context.text } },
      messages: [
        {
          role: "user",
          content:
            "Review the Google Ads data in the context and raise advertising REVIEWS where the evidence supports them. Change nothing.",
        },
      ],
      schema: googleAdsReviewSchema,
      agentType: "google_ads",
    });
  } catch (err) {
    const code = isAiError(err) ? err.code : "UNKNOWN";
    aiLog("google_ads_review_failed", { periodDays: period.days, code });
    // Fail SAFELY: nothing persisted; the deterministic dashboard and any
    // previously generated review are entirely unaffected.
    return { status: "failed", errorCode: code };
  }

  /* ---------------- Server-side validation (spec §66) ---------------- */
  const validated: GoogleAdsRecommendation[] = [];
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
      aiLog("google_ads_recommendation_dropped", { title: raw.title.slice(0, 80), reason: "no_valid_metric_refs" });
      continue;
    }

    // campaignId must be a campaign the snapshot actually printed. A
    // plausible-looking id is still dropped to null.
    const campaignId = raw.campaignId && context.validCampaignIds.has(raw.campaignId) ? raw.campaignId : null;
    if (raw.campaignId && !campaignId) {
      dropReasons.push(`"${raw.title.slice(0, 60)}": unknown campaignId "${raw.campaignId}" removed`);
      aiLog("google_ads_recommendation_scope_dropped", {
        title: raw.title.slice(0, 80),
        campaignId: raw.campaignId.slice(0, 40),
      });
    }

    validated.push({ ...raw, metricRefs, evidenceRefs, campaignId });
  }

  /* Signal notes may only annotate signals the context actually printed. */
  const signals = review.signals.filter((note) => context.validSignalIds.has(note.signalId));
  droppedReferences += review.signals.length - signals.length;

  /* ---------------- Persist recommendations ---------------- */
  const existing = await listDecisions("google_ads", 500);
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
    const identityKey = googleAdsRecommendationIdentityKey(rec, period.days);
    const decisionFields = {
      observation: rec.observation,
      reasoningSummary: rec.recommendation,
      supportingData: {
        title: rec.title,
        recommendationType: rec.recommendationType,
        /** The CLOSED Session-10 action type this maps to. Review-only, always. */
        actionType: GOOGLE_ADS_RECOMMENDATION_ACTION_TYPE[rec.recommendationType],
        campaignId: rec.campaignId,
        supportingMetricRefs: rec.metricRefs,
        evidenceRefs: rec.evidenceRefs,
        confidence: rec.confidence,
        limitations: rec.limitations,
        periodDays: period.days,
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
      },
      confidence: GOOGLE_ADS_CONFIDENCE_ORDINAL[rec.confidence],
      riskLevel: GOOGLE_ADS_RISK_TO_DECISION_RISK[rec.risk],
      proposedAction: {
        agentType: "google_ads" as const,
        actionType: `recommend_${rec.recommendationType.toLowerCase()}`,
        params: {
          identityKey,
          title: rec.title,
          recommendationType: rec.recommendationType,
          recommendation: rec.recommendation,
          campaignId: rec.campaignId,
          supportingMetricRefs: rec.metricRefs,
          evidenceRefs: rec.evidenceRefs,
          periodDays: period.days,
        },
      },
    };

    const current = byIdentity.get(identityKey);
    if (!current) {
      const { decision } = await recordDecision({
        agentType: "google_ads",
        decisionType: "google_ads_recommendation",
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

  const validatedReview: GoogleAdsReview = { ...review, signals, recommendations: validated };
  const report = await createGoogleAdsReport({
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

  aiLog("google_ads_review_completed", {
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

/** Re-exported for tests that assert the snapshot never carries credentials. */
export type { GoogleAdsIntelligenceSnapshot };
