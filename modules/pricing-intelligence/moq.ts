import { PRICING_INTELLIGENCE } from "@/config/pricing-intelligence";
import type { OpportunityRow } from "@/lib/data/insight-service";
import type { ConversationCorpus } from "@/modules/customer-intelligence/aggregate";
import { pricingRatio, type PricingRatio } from "./funnel";
import type { QuantityDemand } from "./demand";

/**
 * MOQ INTELLIGENCE (spec §13, §45).
 *
 * This exists as its OWN section, separate from price, because the two are
 * routinely confused and the confusion is expensive. A customer who wants
 * 200 bags is not telling us the unit price is too high — they are telling
 * us the minimum order quantity does not fit their business. Lowering the
 * unit price would not sell them anything.
 *
 * The question this answers is: **are customers asking for quantities we do
 * not currently serve?** It is NOT "we should lower the MOQ" — feasibility
 * at a lower MOQ is factory knowledge, and every ProductOpportunity carries
 * `humanValidationRequired: true` for exactly that reason.
 */

export type MoqSegmentRow = { segment: string; conversations: number; belowMoqSignals: number };

export type MoqIntelligence = {
  /** The strictest catalog MOQ (the boundary everything below refers to). */
  moq: number;
  /** Prospects who NAMED a quantity below the MOQ, provenance-split. */
  requestedBelowMoqStated: number;
  requestedBelowMoqInferred: number;
  /** Configurator sessions that set a below-MOQ quantity. */
  configuredBelowMoq: number;
  /**
   * Purchased order lines below MOQ. Expected to be ZERO — the engine
   * refuses to price below MOQ and routes to a custom quote. A non-zero
   * value is a real integrity finding, surfaced rather than smoothed.
   */
  purchasedBelowMoqLines: number;
  /** Conversations that ASKED what the MOQ is. Not resistance. */
  moqQuestionConversations: number;
  /** Conversations that SAID the MOQ is too high. Resistance. */
  moqObjectionConversations: number;
  /** Below-MOQ demand that ended in a human handoff. */
  belowMoqHandoffs: number;
  /** Qualified, classified conversations — the denominator for MOQ rates. */
  qualifiedClassifiedConversations: number;
  moqQuestionRate: PricingRatio;
  moqObjectionRate: PricingRatio;
  /** Open `lower_moq` opportunities (S08) backing this — cited by id. */
  opportunityRefs: { id: string; title: string; status: string; evidenceCount: number }[];
  segments: MoqSegmentRow[];
  notes: string[];
};

export const MOQ_NOTES = [
  "Asking “what is your minimum?” is a question, not an objection. The two are counted separately and never summed.",
  "Wanting fewer bags than our minimum is a quantity problem, not a price problem. It is never used as evidence that the unit price is too high.",
  "Whether the factory can produce a smaller run is human knowledge — every MOQ opportunity requires human validation before it means anything.",
];

export function buildMoqIntelligence(input: {
  demand: QuantityDemand;
  corpus: ConversationCorpus;
  opportunities: OpportunityRow[];
}): MoqIntelligence {
  const { demand, corpus, opportunities } = input;

  let moqQuestion = 0;
  let moqObjection = 0;
  let belowMoqHandoffs = 0;
  let qualifiedClassified = 0;
  const segments = new Map<string, MoqSegmentRow>();

  for (const fact of corpus.facts) {
    if (!fact.classification) continue;
    if (fact.qualified) qualifiedClassified += 1;

    const askedMoq = fact.classification.questionsJson.some((q) => q.theme === "MOQ");
    const objectedMoq = fact.classification.objectionsJson.some((o) => o.type === "MOQ_TOO_HIGH");
    const requestedBelowMoq =
      fact.needProfile?.quantity !== null &&
      fact.needProfile?.quantity !== undefined &&
      fact.needProfile.quantity < demand.moq;

    if (askedMoq) moqQuestion += 1;
    if (objectedMoq) moqObjection += 1;
    if ((objectedMoq || requestedBelowMoq) && fact.outcomeGroup === "human_handoff") belowMoqHandoffs += 1;

    if (objectedMoq || requestedBelowMoq) {
      const key = (fact.needProfile?.businessType ?? "unknown").toLowerCase().slice(0, 60);
      const row = segments.get(key) ?? { segment: key, conversations: 0, belowMoqSignals: 0 };
      row.belowMoqSignals += 1;
      segments.set(key, row);
    }
    const key = (fact.needProfile?.businessType ?? "unknown").toLowerCase().slice(0, 60);
    const row = segments.get(key) ?? { segment: key, conversations: 0, belowMoqSignals: 0 };
    row.conversations += 1;
    segments.set(key, row);
  }

  const opportunityRefs = opportunities
    .filter((o) => o.opportunityType === "lower_moq")
    .slice(0, PRICING_INTELLIGENCE.MAX_BREAKDOWN_ROWS)
    .map((o) => ({ id: o.id, title: o.title, status: o.status, evidenceCount: o.evidenceCount }));

  return {
    moq: demand.moq,
    requestedBelowMoqStated: demand.requested.belowMoqStated,
    requestedBelowMoqInferred: demand.requested.belowMoqInferred,
    configuredBelowMoq: demand.configured.belowMoq,
    purchasedBelowMoqLines: demand.purchased.belowMoqLines,
    moqQuestionConversations: moqQuestion,
    moqObjectionConversations: moqObjection,
    belowMoqHandoffs,
    qualifiedClassifiedConversations: qualifiedClassified,
    moqQuestionRate: pricingRatio(moqQuestion, qualifiedClassified),
    moqObjectionRate: pricingRatio(moqObjection, qualifiedClassified),
    opportunityRefs,
    segments: [...segments.values()]
      .filter((s) => s.conversations >= PRICING_INTELLIGENCE.MIN_SEGMENT_SAMPLE)
      .sort((a, b) => b.belowMoqSignals - a.belowMoqSignals)
      .slice(0, PRICING_INTELLIGENCE.MAX_BREAKDOWN_ROWS),
    notes: MOQ_NOTES,
  };
}
