import { CUSTOMER_INTELLIGENCE } from "@/config/customer-intelligence";
import {
  createInsight,
  insightInputSchema,
  listInsights,
  updateInsightMetrics,
  type InsightRow,
} from "@/lib/data/insight-service";
import type { z } from "zod";
import {
  aggregateObjections,
  aggregateQuestions,
  aggregateRequests,
  attributionSegments,
  businessTypeSegments,
  conversionAssociations,
  loadDemandSignals,
  productGaps,
  type ConversationCorpus,
} from "./aggregate";
import { safePercentage, type Period } from "./period";

/**
 * DETERMINISTIC insight generation (Session 08 spec §12, §15, §18, §35).
 *
 * Every persisted CustomerInsight is assembled from counts computed in
 * aggregate.ts over real rows — no model writes, no fabricated numbers,
 * and no percentage without its denominator. Titles and summaries are
 * TEMPLATES filled with those counts.
 *
 * Stable identity: valueJson.identityKey = TYPE:dimension:periodDays.
 * One row per identity, forever:
 *  - candidate/validated rows are UPDATED in place on regeneration;
 *  - dismissed/archived rows are skipped unless evidence GREW past what
 *    the admin saw (then resurrected to candidate) — a dismissed insight
 *    never reappears identically (§35);
 *  - below MIN_EVIDENCE_FOR_INSIGHT nothing is persisted at all (the raw
 *    metric still renders on the dashboard).
 */

export type InsightCandidate = z.input<typeof insightInputSchema> & { identityKey: string };

export type GenerationSummary = { created: number; updated: number; resurrected: number; skipped: number };

const dims = (period: Period) => `${period.days}d`;

function pct(numerator: number, denominator: number): string {
  const p = safePercentage(numerator, denominator);
  return p === null ? "" : ` (${p}%)`;
}

/** Build the deterministic candidate list for one period. Pure given its inputs. */
export function buildInsightCandidates(
  corpus: ConversationCorpus,
  demand: Awaited<ReturnType<typeof loadDemandSignals>>,
): InsightCandidate[] {
  const period = corpus.period;
  const MIN = CUSTOMER_INTELLIGENCE.MIN_EVIDENCE_FOR_INSIGHT;
  const out: InsightCandidate[] = [];
  const { qualifiedClassified } = corpus.totals;
  const periodFields = { periodStart: period.start, periodEnd: period.end };
  const convRefs = (ids: string[]) =>
    ids.slice(0, CUSTOMER_INTELLIGENCE.MAX_SOURCE_REFS).map((id) => ({ table: "conversations", id }));

  const questions = aggregateQuestions(corpus);
  for (const q of questions) {
    if (q.qualifiedConversations < MIN) continue;
    out.push({
      identityKey: `CUSTOMER_QUESTION:${q.theme}:${dims(period)}`,
      insightType: "CUSTOMER_QUESTION",
      title: `${q.theme} questions in ${q.qualifiedConversations} qualified conversations (${period.label})`,
      summary:
        `${q.qualifiedConversations} of ${qualifiedClassified} qualified conversations` +
        `${pct(q.qualifiedConversations, qualifiedClassified)} included a ${q.theme} question. ` +
        `Message-level mentions: ${q.mentions}.`,
      value: {
        identityKey: `CUSTOMER_QUESTION:${q.theme}:${dims(period)}`,
        theme: q.theme,
        conversations: q.conversations,
        qualifiedConversations: q.qualifiedConversations,
        eligiblePopulation: qualifiedClassified,
        percentage: safePercentage(q.qualifiedConversations, qualifiedClassified),
        mentions: q.mentions,
        periodDays: period.days,
      },
      evidenceCount: q.qualifiedConversations,
      sourceRefs: convRefs(q.conversationIds),
      ...periodFields,
    });
  }

  const objections = aggregateObjections(corpus);
  for (const o of objections) {
    if (o.qualifiedConversations < MIN) continue;
    out.push({
      identityKey: `OBJECTION_PATTERN:${o.type}:${dims(period)}`,
      insightType: "OBJECTION_PATTERN",
      title: `${o.type} objection in ${o.qualifiedConversations} qualified conversations (${period.label})`,
      summary:
        `${o.qualifiedConversations} of ${qualifiedClassified} qualified conversations` +
        `${pct(o.qualifiedConversations, qualifiedClassified)} raised ${o.type}. ` +
        `${o.purchased} of the ${o.conversations} conversations with this objection ended in a purchase.`,
      value: {
        identityKey: `OBJECTION_PATTERN:${o.type}:${dims(period)}`,
        objection: o.type,
        conversations: o.conversations,
        qualifiedConversations: o.qualifiedConversations,
        eligiblePopulation: qualifiedClassified,
        percentage: safePercentage(o.qualifiedConversations, qualifiedClassified),
        purchased: o.purchased,
        mentions: o.mentions,
        periodDays: period.days,
      },
      evidenceCount: o.qualifiedConversations,
      sourceRefs: convRefs(o.conversationIds),
      ...periodFields,
    });
  }

  const requests = aggregateRequests(corpus);
  for (const gap of productGaps(requests)) {
    if (gap.conversations < MIN) continue;
    const key = `PRODUCT_GAP:${gap.kind}:${gap.normalized}:${dims(period)}`;
    // Refs mix messages (drill-down excerpts) and conversations, capped at
    // evidenceCount so traceability (evidenceCount ≥ refs) always holds.
    const refs = [
      ...gap.messageIds.map((id) => ({ table: "messages", id })),
      ...gap.conversationIds.map((id) => ({ table: "conversations", id })),
    ].slice(0, Math.min(CUSTOMER_INTELLIGENCE.MAX_SOURCE_REFS, gap.mentions + gap.conversations));
    out.push({
      identityKey: key,
      insightType: "PRODUCT_GAP",
      title: `Unsupported request: "${gap.normalized}" (${gap.conversations} conversations, ${period.label})`,
      summary:
        `${gap.conversations} conversations (${gap.mentions} explicit mentions) requested "${gap.normalized}" ` +
        `(${gap.kind}); the current catalog does not support it. ${gap.qualifiedConversations} were qualified conversations.`,
      value: {
        identityKey: key,
        kind: gap.kind,
        normalized: gap.normalized,
        conversations: gap.conversations,
        qualifiedConversations: gap.qualifiedConversations,
        mentions: gap.mentions,
        periodDays: period.days,
      },
      evidenceCount: gap.mentions + gap.conversations,
      sourceRefs: refs,
      ...periodFields,
    });
  }

  // Combined MOQ / shipping / pricing signals — distinct-conversation dedup
  // across questions and objections so one conversation never counts twice.
  const signal = (
    type: "MOQ_SIGNAL" | "SHIPPING_SIGNAL" | "PRICING_SIGNAL",
    themes: string[],
    objectionTypes: string[],
    extraRefs: { table: string; id: string }[] = [],
    extraCount = 0,
    extraNote = "",
  ) => {
    const convIds = new Set<string>();
    for (const q of questions) if (themes.includes(q.theme)) q.conversationIds.forEach((id) => convIds.add(id));
    for (const o of objections) if (objectionTypes.includes(o.type)) o.conversationIds.forEach((id) => convIds.add(id));
    const evidenceCount = convIds.size + extraCount;
    if (evidenceCount < MIN) return;
    const key = `${type}:combined:${dims(period)}`;
    const refs = [...convRefs([...convIds]), ...extraRefs].slice(0, CUSTOMER_INTELLIGENCE.MAX_SOURCE_REFS);
    out.push({
      identityKey: key,
      insightType: type,
      title: `${type.replace("_SIGNAL", "").toLowerCase()} concerns in ${convIds.size} conversations (${period.label})`,
      summary:
        `${convIds.size} distinct conversations asked about or objected to ${type.replace("_SIGNAL", "").toLowerCase()} ` +
        `topics (themes: ${themes.join(", ")}; objections: ${objectionTypes.join(", ")}).${extraNote}`,
      value: {
        identityKey: key,
        conversations: convIds.size,
        eligiblePopulation: qualifiedClassified,
        percentage: safePercentage(convIds.size, qualifiedClassified),
        extraCount,
        periodDays: period.days,
      },
      evidenceCount,
      sourceRefs: refs,
      ...periodFields,
    });
  };
  signal(
    "MOQ_SIGNAL",
    ["MOQ"],
    ["MOQ_TOO_HIGH"],
    demand.requested.belowMoq.refs,
    demand.requested.belowMoq.stated,
    demand.requested.belowMoq.stated > 0
      ? ` ${demand.requested.belowMoq.stated} need profiles stated a below-MOQ quantity.`
      : "",
  );
  signal("SHIPPING_SIGNAL", ["SHIPPING", "DELIVERY_TIME"], ["SHIPPING_COST", "DELIVERY_TOO_LONG"]);
  signal("PRICING_SIGNAL", ["PRICE"], ["PRICE_TOO_HIGH"]);

  // Requested-demand patterns — USER_STATED counts only gate persistence
  // (AI_INFERRED is reported alongside, never merged into the gate).
  const demandDims: [string, { value: string; stated: number; inferred: number; refs: { table: string; id: string }[] }[]][] = [
    ["volume", demand.requested.volumeGroups],
    ["color", demand.requested.colors],
    ["printing", demand.requested.printing],
    ["business_type", demand.requested.businessTypes],
  ];
  for (const [dimension, values] of demandDims) {
    for (const v of values) {
      if (v.stated < MIN) continue;
      const key = `DEMAND_PATTERN:${dimension}:${v.value}:${dims(period)}`;
      out.push({
        identityKey: key,
        insightType: "DEMAND_PATTERN",
        title: `Requested ${dimension.replace("_", " ")} "${v.value}": ${v.stated} customer-stated (${period.label})`,
        summary:
          `${v.stated} need profiles carry a customer-stated ${dimension.replace("_", " ")} of "${v.value}"` +
          (v.inferred > 0 ? ` (a further ${v.inferred} are AI-inferred and counted separately).` : "."),
        value: {
          identityKey: key,
          dimension,
          value: v.value,
          statedCount: v.stated,
          inferredCount: v.inferred,
          eligiblePopulation: demand.requested.profiles,
          percentage: safePercentage(v.stated, demand.requested.profiles),
          periodDays: period.days,
        },
        evidenceCount: v.stated,
        sourceRefs: v.refs.slice(0, Math.min(v.stated, CUSTOMER_INTELLIGENCE.MAX_SOURCE_REFS)),
        ...periodFields,
      });
    }
  }

  for (const seg of businessTypeSegments(corpus)) {
    if (seg.key === "unknown" || seg.conversations < CUSTOMER_INTELLIGENCE.MIN_SEGMENT_SAMPLE) continue;
    const key = `SEGMENT_PATTERN:business_type:${seg.key}:${dims(period)}`;
    const ids = corpus.facts
      .filter((f) => f.qualified && (f.needProfile?.businessType ?? "").toLowerCase().slice(0, 60) === seg.key)
      .map((f) => f.conversation.id);
    out.push({
      identityKey: key,
      insightType: "SEGMENT_PATTERN",
      title: `Segment "${seg.key}": ${seg.conversations} qualified conversations (${period.label})`,
      summary:
        `${seg.conversations} qualified conversations came from "${seg.key}" businesses; ` +
        `${seg.purchased} purchased${pct(seg.purchased, seg.conversations)}.`,
      value: {
        identityKey: key,
        segment: seg.key,
        conversations: seg.conversations,
        purchased: seg.purchased,
        eligiblePopulation: corpus.totals.qualified,
        percentage: safePercentage(seg.conversations, corpus.totals.qualified),
        periodDays: period.days,
      },
      evidenceCount: seg.conversations,
      sourceRefs: convRefs(ids),
      ...periodFields,
    });
  }

  for (const assoc of conversionAssociations(corpus)) {
    const rateWith = safePercentage(assoc.with.purchased, assoc.with.conversations);
    const rateWithout = safePercentage(assoc.without.purchased, assoc.without.conversations);
    if (rateWith === null || rateWithout === null) continue;
    if (Math.abs(rateWith - rateWithout) < CUSTOMER_INTELLIGENCE.MIN_ASSOCIATION_DELTA_PP) continue;
    const key = `CONVERSION_PATTERN:${assoc.dimension}:${assoc.key}:${dims(period)}`;
    const ids = corpus.facts
      .filter((f) => {
        if (!f.qualified || !f.classification) return false;
        const labels =
          assoc.dimension === "question"
            ? f.classification.questionsJson.map((q) => q.theme)
            : f.classification.objectionsJson.map((o) => o.type);
        return labels.includes(assoc.key);
      })
      .map((f) => f.conversation.id);
    out.push({
      identityKey: key,
      insightType: "CONVERSION_PATTERN",
      // Descriptive association only — never causal language (§24).
      title: `Observed purchase rate differs with ${assoc.dimension} "${assoc.key}" (${period.label})`,
      summary:
        `Observed purchase rate was ${rateWith}% among ${assoc.with.conversations} qualified conversations with ` +
        `${assoc.dimension} "${assoc.key}" vs ${rateWithout}% among ${assoc.without.conversations} without it. ` +
        `This is an observed association, not a causal claim.`,
      value: {
        identityKey: key,
        dimension: assoc.dimension,
        label: assoc.key,
        withConversations: assoc.with.conversations,
        withPurchased: assoc.with.purchased,
        withoutConversations: assoc.without.conversations,
        withoutPurchased: assoc.without.purchased,
        periodDays: period.days,
      },
      evidenceCount: assoc.with.conversations,
      sourceRefs: convRefs(ids),
      ...periodFields,
    });
  }

  return out;
}

/** Attribution segments are display-only in v1 (no persisted insight) — exported for the report. */
export { attributionSegments };

const identityOf = (row: InsightRow): string | null => {
  const v = row.valueJson as Record<string, unknown> | null;
  return typeof v?.identityKey === "string" ? v.identityKey : null;
};

/** Persist candidates under the stable-identity rules. */
export async function persistInsights(candidates: InsightCandidate[]): Promise<GenerationSummary> {
  const existing = await listInsights(1000);
  const byIdentity = new Map<string, InsightRow>();
  for (const row of existing) {
    const key = identityOf(row);
    if (key && !byIdentity.has(key)) byIdentity.set(key, row);
  }

  const summary: GenerationSummary = { created: 0, updated: 0, resurrected: 0, skipped: 0 };
  for (const candidate of candidates) {
    const { identityKey, ...input } = candidate;
    const current = byIdentity.get(identityKey);
    if (!current) {
      await createInsight(input);
      summary.created += 1;
      continue;
    }
    if (current.status === "candidate" || current.status === "validated") {
      await updateInsightMetrics(current.id, input);
      summary.updated += 1;
      continue;
    }
    // dismissed | archived: regenerate ONLY on materially new evidence.
    if (candidate.evidenceCount > current.evidenceCount) {
      await updateInsightMetrics(current.id, input, "candidate");
      summary.resurrected += 1;
    } else {
      summary.skipped += 1;
    }
  }
  return summary;
}

export async function generateInsightsForPeriod(corpus: ConversationCorpus): Promise<GenerationSummary> {
  const demand = await loadDemandSignals(corpus.period);
  const candidates = buildInsightCandidates(corpus, demand);
  return persistInsights(candidates);
}
