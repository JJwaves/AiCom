import { PRICING_INTELLIGENCE } from "@/config/pricing-intelligence";
import type { ConversationCorpus } from "@/modules/customer-intelligence/aggregate";
import { pricingRatio, type PricingRatio } from "./funnel";

/**
 * DESCRIPTIVE breakdowns (spec §16, §18, §19).
 *
 * Segment and traffic-source rows describe OBSERVED behaviour. They are not
 * a licence to price differently:
 *
 *  - §17 NO PERSONALIZED PRICING. Nothing in this file (or anywhere in this
 *    module) feeds a price. There is no per-customer, per-segment,
 *    per-device, per-geo or per-source price, and no willingness-to-pay
 *    inference exists to build one from.
 *  - A paid-search visitor asking about price more often is a fact about
 *    who clicks an ad, not a reason to show them a different number.
 *
 * Every row is gated by MIN_SEGMENT_SAMPLE so a single conversation never
 * becomes a "segment pattern".
 */

export type PricingSegmentRow = {
  segment: string;
  conversations: number;
  priceQuestionConversations: number;
  priceObjectionConversations: number;
  moqObjectionConversations: number;
  purchased: number;
  /** Median-free: the requested quantities actually stated by this segment. */
  statedQuantities: number[];
  priceQuestionRate: PricingRatio;
  priceObjectionRate: PricingRatio;
};

export type PricingAttributionRow = {
  key: string;
  conversations: number;
  priceQuestionConversations: number;
  priceObjectionConversations: number;
  purchased: number;
  priceQuestionRate: PricingRatio;
};

export type AiSalesPricingMetrics = {
  /** Classified conversations where pricing came up at all (question or objection). */
  conversationsReachingPricing: number;
  priceQuestions: number;
  priceObjections: number;
  /** Price conversations whose session went on to add to cart. */
  priceConversationsWithCartAdd: number;
  /** Price conversations whose session went on to purchase. */
  priceConversationsWithPurchase: number;
  /** Price conversations that ended with a human handoff. */
  priceConversationsHandedOff: number;
  /** Price objections in conversations that purchased anyway (descriptive). */
  objectionsThatPurchasedAnyway: number;
  notes: string[];
};

export const AI_SALES_PRICING_NOTES = [
  "The AI sales agent explains prices computed by the pricing engine. It has no discount tool, no price tool, and no way to promise a negotiated price.",
  "These counts cover conversations only — customers who never opened the chat are not represented anywhere in this section.",
];

const isPriceQuestion = (fact: ConversationCorpus["facts"][number]): boolean =>
  fact.classification?.questionsJson.some((q) => q.theme === "PRICE") ?? false;
const isPriceObjection = (fact: ConversationCorpus["facts"][number]): boolean =>
  fact.classification?.objectionsJson.some((o) => o.type === "PRICE_TOO_HIGH") ?? false;
const isMoqObjection = (fact: ConversationCorpus["facts"][number]): boolean =>
  fact.classification?.objectionsJson.some((o) => o.type === "MOQ_TOO_HIGH") ?? false;

export function buildPricingSegments(corpus: ConversationCorpus): PricingSegmentRow[] {
  const bySegment = new Map<string, PricingSegmentRow>();
  for (const fact of corpus.facts) {
    if (!fact.classification || !fact.qualified) continue;
    const key = (fact.needProfile?.businessType ?? "unknown").toLowerCase().trim().slice(0, 60) || "unknown";
    const row =
      bySegment.get(key) ??
      ({
        segment: key,
        conversations: 0,
        priceQuestionConversations: 0,
        priceObjectionConversations: 0,
        moqObjectionConversations: 0,
        purchased: 0,
        statedQuantities: [],
        priceQuestionRate: pricingRatio(0, 0),
        priceObjectionRate: pricingRatio(0, 0),
      } satisfies PricingSegmentRow);
    row.conversations += 1;
    if (isPriceQuestion(fact)) row.priceQuestionConversations += 1;
    if (isPriceObjection(fact)) row.priceObjectionConversations += 1;
    if (isMoqObjection(fact)) row.moqObjectionConversations += 1;
    if (fact.purchased) row.purchased += 1;
    const quantity = fact.needProfile?.quantity;
    if (
      typeof quantity === "number" &&
      fact.needProfile?.fieldSourcesJson?.quantity?.source === "USER_STATED" &&
      row.statedQuantities.length < 200
    ) {
      row.statedQuantities.push(quantity);
    }
    bySegment.set(key, row);
  }

  return [...bySegment.values()]
    .filter((r) => r.conversations >= PRICING_INTELLIGENCE.MIN_SEGMENT_SAMPLE)
    .map((r) => ({
      ...r,
      priceQuestionRate: pricingRatio(r.priceQuestionConversations, r.conversations),
      priceObjectionRate: pricingRatio(r.priceObjectionConversations, r.conversations),
    }))
    .sort((a, b) => b.conversations - a.conversations)
    .slice(0, PRICING_INTELLIGENCE.MAX_BREAKDOWN_ROWS);
}

export function buildPricingAttribution(corpus: ConversationCorpus): PricingAttributionRow[] {
  const bySource = new Map<string, PricingAttributionRow>();
  for (const fact of corpus.facts) {
    if (!fact.classification || !fact.qualified) continue;
    // Click ids are NEVER surfaced (S08/S09 rule) — source/medium only.
    const params = fact.session?.firstTouchJson?.params ?? {};
    const source = (params.utm_source ?? "direct/none").slice(0, 60);
    const medium = params.utm_medium ? ` / ${params.utm_medium.slice(0, 40)}` : "";
    const key = `${source}${medium}`;
    const row =
      bySource.get(key) ??
      ({
        key,
        conversations: 0,
        priceQuestionConversations: 0,
        priceObjectionConversations: 0,
        purchased: 0,
        priceQuestionRate: pricingRatio(0, 0),
      } satisfies PricingAttributionRow);
    row.conversations += 1;
    if (isPriceQuestion(fact)) row.priceQuestionConversations += 1;
    if (isPriceObjection(fact)) row.priceObjectionConversations += 1;
    if (fact.purchased) row.purchased += 1;
    bySource.set(key, row);
  }

  return [...bySource.values()]
    .filter((r) => r.conversations >= PRICING_INTELLIGENCE.MIN_SEGMENT_SAMPLE)
    .map((r) => ({ ...r, priceQuestionRate: pricingRatio(r.priceQuestionConversations, r.conversations) }))
    .sort((a, b) => b.conversations - a.conversations)
    .slice(0, PRICING_INTELLIGENCE.MAX_BREAKDOWN_ROWS);
}

/**
 * How AI Sales interacts with pricing (spec §19). `cartSessionIds` /
 * `purchaseSessionIds` come from the deterministic pricing funnel, so a
 * "price conversation that converted" means the SESSION recorded the event —
 * never a model claim about its own effectiveness.
 */
export function buildAiSalesPricingMetrics(input: {
  corpus: ConversationCorpus;
  cartSessionIds: Set<string>;
  purchaseSessionIds: Set<string>;
}): AiSalesPricingMetrics {
  let reaching = 0;
  let questions = 0;
  let objections = 0;
  let withCart = 0;
  let withPurchase = 0;
  let handedOff = 0;
  let purchasedAnyway = 0;

  for (const fact of input.corpus.facts) {
    if (!fact.classification) continue;
    const question = isPriceQuestion(fact);
    const objection = isPriceObjection(fact);
    if (!question && !objection) continue;
    reaching += 1;
    if (question) questions += 1;
    if (objection) {
      objections += 1;
      if (fact.purchased) purchasedAnyway += 1;
    }
    if (input.cartSessionIds.has(fact.conversation.sessionId)) withCart += 1;
    if (input.purchaseSessionIds.has(fact.conversation.sessionId)) withPurchase += 1;
    if (fact.outcomeGroup === "human_handoff") handedOff += 1;
  }

  return {
    conversationsReachingPricing: reaching,
    priceQuestions: questions,
    priceObjections: objections,
    priceConversationsWithCartAdd: withCart,
    priceConversationsWithPurchase: withPurchase,
    priceConversationsHandedOff: handedOff,
    objectionsThatPurchasedAnyway: purchasedAnyway,
    notes: AI_SALES_PRICING_NOTES,
  };
}
