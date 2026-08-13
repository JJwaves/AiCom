import { CUSTOMER_INTELLIGENCE } from "@/config/customer-intelligence";
import {
  createOpportunity,
  listOpportunities,
  opportunityInputSchema,
  updateOpportunityMetrics,
  type OpportunityRow,
} from "@/lib/data/insight-service";
import type { z } from "zod";
import { aggregateObjections, aggregateRequests, productGaps, type ConversationCorpus } from "./aggregate";
import type { loadDemandSignals } from "./aggregate";
import type { Period } from "./period";

/**
 * ProductOpportunity generation (Session 08 spec §21–§23).
 *
 * Deterministic, conservative, and permanently gated on humans:
 * generation only ever CREATES `proposed` rows or refreshes metrics on
 * rows still in `proposed`/`under_review`. Rows a human moved to
 * validated/rejected/archived are never touched — manufacturing
 * feasibility can only be validated by a human, and
 * humanValidationRequired is hard-coded true at the service layer.
 *
 * estimatedDemand stays a sentence built from real counts — never a
 * revenue projection or invented volume.
 */

export type OpportunityCandidate = z.input<typeof opportunityInputSchema> & { identityKey: string };

export type OpportunityGeneration = { created: number; updated: number; skipped: number };

const dims = (period: Period) => `${period.days}d`;

export function buildOpportunityCandidates(
  corpus: ConversationCorpus,
  demand: Awaited<ReturnType<typeof loadDemandSignals>>,
): OpportunityCandidate[] {
  const period = corpus.period;
  const MIN = CUSTOMER_INTELLIGENCE.MIN_EVIDENCE_FOR_INSIGHT;
  const out: OpportunityCandidate[] = [];

  // Lower-MOQ starter product — customer-STATED below-MOQ demand plus
  // explicit MOQ objections, distinct evidence records only.
  const moqObjections = aggregateObjections(corpus).find((o) => o.type === "MOQ_TOO_HIGH");
  const statedBelowMoq = demand.requested.belowMoq.stated;
  const objectionConversations = moqObjections?.conversations ?? 0;
  const lowerMoqEvidence = statedBelowMoq + objectionConversations;
  if (lowerMoqEvidence >= MIN) {
    const refs = [
      ...demand.requested.belowMoq.refs,
      ...(moqObjections?.conversationIds ?? []).map((id) => ({ table: "conversations", id })),
    ].slice(0, Math.min(lowerMoqEvidence, CUSTOMER_INTELLIGENCE.MAX_SOURCE_REFS));
    const key = `OPP:lower_moq:${dims(period)}`;
    out.push({
      identityKey: key,
      title: "Lower-MOQ starter option",
      opportunityType: "lower_moq",
      description:
        `${statedBelowMoq} need profiles carry a customer-stated quantity below the current 500 MOQ and ` +
        `${objectionConversations} conversations objected that the MOQ is too high (${period.label}). ` +
        `Customers with below-MOQ needs currently route to the custom-quote flow.`,
      value: { identityKey: key, statedBelowMoq, objectionConversations, periodDays: period.days },
      evidenceCount: lowerMoqEvidence,
      sourceRefs: refs,
      estimatedDemand: `${lowerMoqEvidence} below-MOQ signals in ${period.label}`,
      periodStart: period.start,
      periodEnd: period.end,
    });
  }

  // One opportunity per catalog-unsupported request that clears the floor.
  for (const gap of productGaps(aggregateRequests(corpus))) {
    if (gap.conversations < MIN) continue;
    const key = `OPP:unsupported_product:${gap.kind}:${gap.normalized}:${dims(period)}`;
    const evidenceCount = gap.mentions + gap.conversations;
    const refs = [
      ...gap.messageIds.map((id) => ({ table: "messages", id })),
      ...gap.conversationIds.map((id) => ({ table: "conversations", id })),
    ].slice(0, Math.min(evidenceCount, CUSTOMER_INTELLIGENCE.MAX_SOURCE_REFS));
    out.push({
      identityKey: key,
      title: `Requested but unsupported: ${gap.normalized}`,
      opportunityType: "unsupported_product",
      description:
        `${gap.conversations} conversations (${gap.mentions} explicit mentions, ${gap.qualifiedConversations} qualified) ` +
        `requested "${gap.normalized}" (${gap.kind}) in ${period.label}; the current catalog does not support it. ` +
        `Factory feasibility requires human validation before any action.`,
      value: {
        identityKey: key,
        kind: gap.kind,
        normalized: gap.normalized,
        conversations: gap.conversations,
        qualifiedConversations: gap.qualifiedConversations,
        mentions: gap.mentions,
        periodDays: period.days,
      },
      evidenceCount,
      sourceRefs: refs,
      estimatedDemand: `${gap.conversations} conversations in ${period.label}`,
      periodStart: period.start,
      periodEnd: period.end,
    });
  }

  return out;
}

const identityOf = (row: OpportunityRow): string | null => {
  const v = row.valueJson as Record<string, unknown> | null;
  return typeof v?.identityKey === "string" ? v.identityKey : null;
};

export async function persistOpportunities(candidates: OpportunityCandidate[]): Promise<OpportunityGeneration> {
  const existing = await listOpportunities(1000);
  const byIdentity = new Map<string, OpportunityRow>();
  for (const row of existing) {
    const key = identityOf(row);
    if (key && !byIdentity.has(key)) byIdentity.set(key, row);
  }

  const summary: OpportunityGeneration = { created: 0, updated: 0, skipped: 0 };
  for (const candidate of candidates) {
    const { identityKey, ...input } = candidate;
    const current = byIdentity.get(identityKey);
    if (!current) {
      await createOpportunity(input);
      summary.created += 1;
      continue;
    }
    if (current.status === "proposed" || current.status === "under_review") {
      await updateOpportunityMetrics(current.id, input);
      summary.updated += 1;
    } else {
      // validated / rejected / archived — a human decided; generation never overrides.
      summary.skipped += 1;
    }
  }
  return summary;
}
