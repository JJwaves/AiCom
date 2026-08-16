import { PRICING_INTELLIGENCE } from "@/config/pricing-intelligence";
import { loadSessionEventFacts, type SessionEventFact } from "@/lib/data/pricing-intelligence-service";
import type { Period } from "@/modules/customer-intelligence/period";
import type { ConversationCorpus } from "@/modules/customer-intelligence/aggregate";

/**
 * DETERMINISTIC pricing funnel (spec §9).
 *
 * Two things make these numbers different from the Session 09 business
 * funnel, and both are deliberate:
 *
 *  1. CO-OCCURRENCE, not stage totals. "Price view → add to cart" counts
 *     sessions that did BOTH, over sessions that viewed a price. The S09
 *     funnel divides two independent stage counts, which is fine as a
 *     funnel shape but would overstate a pricing conversion.
 *  2. ORDERING. "Handoff after price" and "quote after price" require the
 *     later event's first occurrence to be at or after the price view.
 *     Without that, a handoff that happened BEFORE any price was shown
 *     would be counted as evidence about price.
 *
 * Every rate carries its denominator definition, and percentages are
 * suppressed below the documented minimum denominator instead of rendering
 * a misleading number.
 */

/** The bounded event list this module reads. */
export const PRICING_FUNNEL_EVENTS = [
  "product_viewed",
  "configurator_started",
  "quantity_selected",
  "price_viewed",
  "add_to_cart",
  "checkout_started",
  "purchase_completed",
  "quote_started",
  "human_handoff_requested",
  "ai_chat_started",
] as const;

export type PricingRatio = {
  numerator: number;
  denominator: number;
  /** Whole-number percent, or null when the denominator is below the floor. */
  percentage: number | null;
};

export function pricingRatio(numerator: number, denominator: number): PricingRatio {
  const percentage =
    denominator < PRICING_INTELLIGENCE.MIN_DENOMINATOR_FOR_PERCENTAGE || numerator < 0 || denominator <= 0
      ? null
      : Math.round((numerator / denominator) * 100);
  return { numerator, denominator, percentage };
}

export type PricingFunnelRate = {
  name: string;
  label: string;
  denominatorDefinition: string;
  ratio: PricingRatio;
};

export type PricingFunnel = {
  /** Distinct sessions that viewed a product page. */
  productSessions: number;
  /** Distinct sessions that saw a computed price (the pricing denominator). */
  priceViewSessions: number;
  priceViewAndCart: number;
  priceViewAndCheckout: number;
  priceViewAndPurchase: number;
  /** Saw a price, then requested a custom quote (in that order). */
  quoteAfterPrice: number;
  /** Saw a price, then asked for a human (in that order). */
  handoffAfterPrice: number;
  /**
   * Saw a price and did NOTHING downstream — no cart, no checkout, no
   * quote, no handoff. BEHAVIORAL only; on its own this is not friction.
   */
  priceViewNoAction: number;
  rates: PricingFunnelRate[];
  /** Conversation-level pricing signals (S08 classification labels). */
  conversations: PricingConversationCounts;
};

export type PricingConversationCounts = {
  /** Classified conversations in the period (the honest denominator). */
  classified: number;
  qualifiedClassified: number;
  /** Conversations that ASKED about price. Never treated as resistance. */
  priceQuestion: number;
  /** … of which asked more than once. */
  repeatedPriceQuestion: number;
  /** Conversations that SAID the price was too high. Resistance. */
  priceObjection: number;
  /** Conversations that ASKED about MOQ. Never treated as resistance. */
  moqQuestion: number;
  /** Conversations that SAID the MOQ was too high. */
  moqObjection: number;
  /** Conversations with a price question or objection that ended in a handoff. */
  handoffWithPriceTopic: number;
  /** Conversations carrying a price objection that purchased anyway (descriptive). */
  priceObjectionPurchased: number;
  /** Conversation ids per bucket, bounded — evidence drill-down. */
  refs: {
    priceQuestion: string[];
    priceObjection: string[];
    moqQuestion: string[];
    moqObjection: string[];
  };
};

type SessionIndex = Map<string, Map<string, SessionEventFact>>;

function indexBySession(facts: SessionEventFact[]): SessionIndex {
  const index: SessionIndex = new Map();
  for (const fact of facts) {
    const byName = index.get(fact.sessionId) ?? new Map<string, SessionEventFact>();
    byName.set(fact.name, fact);
    index.set(fact.sessionId, byName);
  }
  return index;
}

const MAX_REFS = 50;

/**
 * Conversation-level price/MOQ counts.
 *
 * The QUESTION vs OBJECTION distinction (spec §8) is preserved end to end:
 * questions come from `questionsJson` themes, objections from
 * `objectionsJson` types. They are never summed, and a price inquiry never
 * increments an objection counter.
 */
export function countPricingConversations(corpus: ConversationCorpus): PricingConversationCounts {
  const counts: PricingConversationCounts = {
    classified: 0,
    qualifiedClassified: 0,
    priceQuestion: 0,
    repeatedPriceQuestion: 0,
    priceObjection: 0,
    moqQuestion: 0,
    moqObjection: 0,
    handoffWithPriceTopic: 0,
    priceObjectionPurchased: 0,
    refs: { priceQuestion: [], priceObjection: [], moqQuestion: [], moqObjection: [] },
  };

  for (const fact of corpus.facts) {
    const classification = fact.classification;
    if (!classification) continue;
    counts.classified += 1;
    if (fact.qualified) counts.qualifiedClassified += 1;

    const priceQuestionMentions = classification.questionsJson.filter((q) => q.theme === "PRICE").length;
    const moqQuestionMentions = classification.questionsJson.filter((q) => q.theme === "MOQ").length;
    const hasPriceObjection = classification.objectionsJson.some((o) => o.type === "PRICE_TOO_HIGH");
    const hasMoqObjection = classification.objectionsJson.some((o) => o.type === "MOQ_TOO_HIGH");

    if (priceQuestionMentions > 0) {
      counts.priceQuestion += 1;
      if (counts.refs.priceQuestion.length < MAX_REFS) counts.refs.priceQuestion.push(fact.conversation.id);
      if (priceQuestionMentions > 1) counts.repeatedPriceQuestion += 1;
    }
    if (moqQuestionMentions > 0) {
      counts.moqQuestion += 1;
      if (counts.refs.moqQuestion.length < MAX_REFS) counts.refs.moqQuestion.push(fact.conversation.id);
    }
    if (hasPriceObjection) {
      counts.priceObjection += 1;
      if (counts.refs.priceObjection.length < MAX_REFS) counts.refs.priceObjection.push(fact.conversation.id);
      if (fact.purchased) counts.priceObjectionPurchased += 1;
    }
    if (hasMoqObjection) {
      counts.moqObjection += 1;
      if (counts.refs.moqObjection.length < MAX_REFS) counts.refs.moqObjection.push(fact.conversation.id);
    }
    if ((priceQuestionMentions > 0 || hasPriceObjection) && fact.outcomeGroup === "human_handoff") {
      counts.handoffWithPriceTopic += 1;
    }
  }

  return counts;
}

export async function loadPricingFunnel(period: Period, corpus: ConversationCorpus): Promise<PricingFunnel> {
  const facts = await loadSessionEventFacts(period.start, period.end, PRICING_FUNNEL_EVENTS);
  const index = indexBySession(facts);

  const distinct = (name: string) => new Set(facts.filter((f) => f.name === name).map((f) => f.sessionId)).size;

  let priceViewSessions = 0;
  let priceViewAndCart = 0;
  let priceViewAndCheckout = 0;
  let priceViewAndPurchase = 0;
  let quoteAfterPrice = 0;
  let handoffAfterPrice = 0;
  let priceViewNoAction = 0;

  for (const byName of index.values()) {
    const price = byName.get("price_viewed");
    if (!price) continue;
    priceViewSessions += 1;

    const cart = byName.get("add_to_cart");
    const checkout = byName.get("checkout_started");
    const purchase = byName.get("purchase_completed");
    const quote = byName.get("quote_started");
    const handoff = byName.get("human_handoff_requested");

    if (cart) priceViewAndCart += 1;
    if (checkout) priceViewAndCheckout += 1;
    if (purchase) priceViewAndPurchase += 1;
    // "After" is a real ordering check, not a co-occurrence rename.
    if (quote && quote.lastAt.getTime() >= price.firstAt.getTime()) quoteAfterPrice += 1;
    if (handoff && handoff.lastAt.getTime() >= price.firstAt.getTime()) handoffAfterPrice += 1;
    if (!cart && !checkout && !purchase && !quote && !handoff) priceViewNoAction += 1;
  }

  const productSessions = distinct("product_viewed");

  const rates: PricingFunnelRate[] = [
    {
      name: "product_to_price_view",
      label: "Product view → price view",
      denominatorDefinition: "distinct sessions that viewed a product page in the period",
      ratio: pricingRatio(priceViewSessions, productSessions),
    },
    {
      name: "price_view_to_cart",
      label: "Price view → add to cart",
      denominatorDefinition: "distinct sessions that saw a price (numerator: the same sessions that also added to cart)",
      ratio: pricingRatio(priceViewAndCart, priceViewSessions),
    },
    {
      name: "price_view_to_checkout",
      label: "Price view → checkout started",
      denominatorDefinition: "distinct sessions that saw a price (numerator: the same sessions that also started checkout)",
      ratio: pricingRatio(priceViewAndCheckout, priceViewSessions),
    },
    {
      name: "price_view_to_purchase",
      label: "Price view → purchase",
      denominatorDefinition: "distinct sessions that saw a price (numerator: the same sessions that also completed a purchase)",
      ratio: pricingRatio(priceViewAndPurchase, priceViewSessions),
    },
    {
      name: "price_view_to_quote",
      label: "Price view → custom quote request",
      denominatorDefinition: "distinct sessions that saw a price (numerator: those that requested a quote at or after the price view)",
      ratio: pricingRatio(quoteAfterPrice, priceViewSessions),
    },
    {
      name: "price_view_to_handoff",
      label: "Price view → asked for a human",
      denominatorDefinition: "distinct sessions that saw a price (numerator: those that asked for a human at or after the price view)",
      ratio: pricingRatio(handoffAfterPrice, priceViewSessions),
    },
    {
      name: "price_view_no_action",
      label: "Price view → no further action",
      denominatorDefinition: "distinct sessions that saw a price (numerator: those with no cart, checkout, purchase, quote or handoff)",
      ratio: pricingRatio(priceViewNoAction, priceViewSessions),
    },
  ];

  return {
    productSessions,
    priceViewSessions,
    priceViewAndCart,
    priceViewAndCheckout,
    priceViewAndPurchase,
    quoteAfterPrice,
    handoffAfterPrice,
    priceViewNoAction,
    rates,
    conversations: countPricingConversations(corpus),
  };
}
