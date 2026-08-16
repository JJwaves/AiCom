import { PRICING_INTELLIGENCE } from "@/config/pricing-intelligence";
import type { PricingFunnel } from "./funnel";
import type { MoqIntelligence } from "./moq";
import type { CostReadiness } from "./readiness";
import type { PriceRealization } from "./realization";
import type { TierPerformance } from "./tier-performance";
import type { EvidenceKind, PricingSignal, SignalStrength } from "./types";

/**
 * DETERMINISTIC pricing signals (spec §20–§21).
 *
 * The two rules that shape this whole file:
 *
 *  1. **A non-purchase alone is NOT price friction.** People leave for
 *     dozens of reasons. A signal may only be `isPriceFriction` when at
 *     least one EXPLICIT piece of evidence exists — a customer said the
 *     price was too high, asked about price repeatedly, asked for a human
 *     after seeing a price, or requested a custom quote after seeing one.
 *     Behavioral-only patterns are still reported, labelled as behavioral,
 *     and routed as observations.
 *
 *  2. **Strength is a rule, not a probability.** LOW / MEDIUM / HIGH come
 *     from counted evidence and evidence DIVERSITY. There is no
 *     "0.42 price-sensitivity index" anywhere, because there is nothing to
 *     compute one from.
 *
 * Strength rules (all deterministic, all tested):
 *   HIGH   — ≥ HIGH_STRENGTH_EVIDENCE explicit conversations AND ≥ 2
 *            distinct evidence types.
 *   MEDIUM — ≥ MEDIUM_STRENGTH_EVIDENCE explicit conversations, or
 *            ≥ MIN_EVIDENCE_FOR_SIGNAL with ≥ 2 distinct evidence types.
 *   LOW    — at or above MIN_EVIDENCE_FOR_SIGNAL, otherwise no signal.
 */

export type SignalInput = {
  funnel: PricingFunnel;
  tiers: TierPerformance;
  moq: MoqIntelligence;
  realization: PriceRealization;
  costs: CostReadiness;
  /** Insight rows that may back a pricing signal (cited by id). */
  pricingInsightRefs: { id: string; insightType: string; title: string }[];
};

function strengthFor(evidenceCount: number, evidenceTypes: number): SignalStrength | null {
  if (evidenceCount < PRICING_INTELLIGENCE.MIN_EVIDENCE_FOR_SIGNAL) return null;
  if (evidenceCount >= PRICING_INTELLIGENCE.HIGH_STRENGTH_EVIDENCE && evidenceTypes >= 2) return "HIGH";
  if (evidenceCount >= PRICING_INTELLIGENCE.MEDIUM_STRENGTH_EVIDENCE) return "MEDIUM";
  if (evidenceTypes >= 2) return "MEDIUM";
  return "LOW";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildPricingSignals(input: SignalInput): PricingSignal[] {
  const { funnel, tiers, moq, realization, costs } = input;
  const conv = funnel.conversations;
  const signals: PricingSignal[] = [];

  /* How many DISTINCT explicit evidence types exist for "price is a problem". */
  const explicitTypes = [
    conv.priceObjection > 0,
    conv.repeatedPriceQuestion > 0,
    conv.handoffWithPriceTopic > 0,
    funnel.quoteAfterPrice > 0,
  ].filter(Boolean).length;

  const pricingInsightRefs = input.pricingInsightRefs
    .filter((i) => i.insightType === "PRICING_SIGNAL" || i.insightType === "OBJECTION_PATTERN")
    .map((i) => i.id)
    .slice(0, 8);

  /* ---------------------------------------------------------------- */
  /* 1 — Explicit price objections                                     */
  /* ---------------------------------------------------------------- */
  const objectionStrength = strengthFor(conv.priceObjection, explicitTypes);
  if (objectionStrength) {
    signals.push({
      id: "PRICE_OBJECTION:all",
      kind: "PRICE_OBJECTION",
      title: "Customers said the price was too high",
      description:
        `${plural(conv.priceObjection, "qualified conversation", "qualified conversations")} explicitly said the price was too high` +
        (conv.classified > 0 ? `, out of ${conv.classified} classified conversations.` : ".") +
        (conv.priceObjectionPurchased > 0
          ? ` ${plural(conv.priceObjectionPurchased, "of them", "of them")} bought anyway.`
          : ""),
      strength: objectionStrength,
      evidenceKind: "EXPLICIT",
      isPriceFriction: true,
      route: "PRICING_REVIEW",
      productId: null,
      quantityTier: null,
      evidence: [
        { metricRef: "pricing.conversations.priceObjection", label: "Price-too-high objections", value: String(conv.priceObjection) },
        { metricRef: "pricing.conversations.classified", label: "Classified conversations", value: String(conv.classified) },
      ],
      evidenceRefs: pricingInsightRefs,
      limitations: [
        "These are conversations with the AI sales agent only — customers who never opened the chat are not represented.",
        "An objection is what someone said, not proof that the price is wrong for the market.",
        ...(costs.costModelConfigured ? [] : ["Manufacturing costs are not configured, so we cannot tell whether there is room to move the price at all."]),
      ],
    });
  }

  /* ---------------------------------------------------------------- */
  /* 2 — Repeated price questions                                      */
  /* ---------------------------------------------------------------- */
  const repeatStrength = strengthFor(conv.repeatedPriceQuestion, explicitTypes);
  if (repeatStrength) {
    signals.push({
      id: "REPEATED_PRICE_QUESTION:all",
      kind: "REPEATED_PRICE_QUESTION",
      title: "Price came up more than once in the same conversation",
      description:
        `${plural(conv.repeatedPriceQuestion, "conversation", "conversations")} asked about price more than once ` +
        `(out of ${conv.priceQuestion} that asked at all). Asking is not the same as objecting — it can mean the answer was not clear the first time.`,
      strength: repeatStrength,
      evidenceKind: "EXPLICIT",
      isPriceFriction: true,
      route: "PRICING_REVIEW",
      productId: null,
      quantityTier: null,
      evidence: [
        {
          metricRef: "pricing.conversations.repeatedPriceQuestion",
          label: "Conversations asking about price more than once",
          value: String(conv.repeatedPriceQuestion),
        },
        { metricRef: "pricing.conversations.priceQuestion", label: "Conversations asking about price", value: String(conv.priceQuestion) },
      ],
      evidenceRefs: [],
      limitations: [
        "A repeated question may mean the price is unclear rather than too high — this signal cannot tell the two apart.",
      ],
    });
  }

  /* ---------------------------------------------------------------- */
  /* 3 — Handoff after price                                           */
  /* ---------------------------------------------------------------- */
  const handoffStrength = strengthFor(conv.handoffWithPriceTopic, explicitTypes);
  if (handoffStrength) {
    signals.push({
      id: "HANDOFF_AFTER_PRICE:all",
      kind: "HANDOFF_AFTER_PRICE",
      title: "Price conversations ended with a request for a human",
      description:
        `${plural(conv.handoffWithPriceTopic, "conversation", "conversations")} that raised price ended with the customer asking for a person. ` +
        `Across sessions, ${funnel.handoffAfterPrice} asked for a human at or after seeing a price.`,
      strength: handoffStrength,
      evidenceKind: "EXPLICIT",
      isPriceFriction: true,
      route: "PRICING_REVIEW",
      productId: null,
      quantityTier: null,
      evidence: [
        {
          metricRef: "pricing.conversations.handoffWithPriceTopic",
          label: "Price conversations ending in a handoff",
          value: String(conv.handoffWithPriceTopic),
        },
        { metricRef: "pricing.funnel.handoffAfterPrice", label: "Sessions asking for a human after a price view", value: String(funnel.handoffAfterPrice) },
      ],
      evidenceRefs: [],
      limitations: [
        "A handoff after a price view is not proof the price caused it — the same conversation may have raised several topics.",
      ],
    });
  }

  /* ---------------------------------------------------------------- */
  /* 4 — Quote requests after price                                    */
  /* ---------------------------------------------------------------- */
  const quoteStrength = strengthFor(funnel.quoteAfterPrice, explicitTypes);
  if (quoteStrength) {
    signals.push({
      id: "QUOTE_AFTER_PRICE:all",
      kind: "QUOTE_AFTER_PRICE",
      title: "Sessions asked for a custom quote after seeing a price",
      description:
        `${plural(funnel.quoteAfterPrice, "session", "sessions")} requested custom pricing at or after seeing a computed price, ` +
        `out of ${funnel.priceViewSessions} that saw one.`,
      strength: quoteStrength,
      evidenceKind: "EXPLICIT",
      isPriceFriction: true,
      route: "PRICING_REVIEW",
      productId: null,
      quantityTier: null,
      evidence: [
        { metricRef: "pricing.funnel.quoteAfterPrice", label: "Quote requests after a price view", value: String(funnel.quoteAfterPrice) },
        { metricRef: "pricing.funnel.priceViewSessions", label: "Sessions that saw a price", value: String(funnel.priceViewSessions) },
      ],
      evidenceRefs: [],
      limitations: [
        "A custom-quote request can mean the standard configuration did not fit (custom colour, custom size, below MOQ) rather than that the price was wrong.",
      ],
    });
  }

  /* ---------------------------------------------------------------- */
  /* 5 — Price view with no downstream action. BEHAVIORAL ONLY.        */
  /* ---------------------------------------------------------------- */
  if (funnel.priceViewSessions >= PRICING_INTELLIGENCE.MIN_PRICE_VIEW_SESSIONS_FOR_OBSERVATION && funnel.priceViewNoAction > 0) {
    const rate = funnel.rates.find((r) => r.name === "price_view_no_action")?.ratio ?? null;
    signals.push({
      id: "PRICE_VIEW_NO_ACTION:all",
      kind: "PRICE_VIEW_NO_ACTION",
      title: "Sessions saw a price and did nothing else",
      description:
        `${funnel.priceViewNoAction} of ${funnel.priceViewSessions} sessions that saw a price took no further action` +
        (rate?.percentage !== null && rate?.percentage !== undefined ? ` (${rate.percentage}%).` : ".") +
        " This is a behavioural observation, not evidence about price: people leave for many reasons, and nobody in this group told us why.",
      // Behavioral-only evidence is capped at LOW by construction.
      strength: "LOW",
      evidenceKind: "BEHAVIORAL",
      isPriceFriction: false,
      route: "PRICING_REVIEW",
      productId: null,
      quantityTier: null,
      evidence: [
        { metricRef: "pricing.funnel.priceViewNoAction", label: "Price views with no further action", value: String(funnel.priceViewNoAction) },
        { metricRef: "pricing.funnel.priceViewSessions", label: "Sessions that saw a price", value: String(funnel.priceViewSessions) },
      ],
      evidenceRefs: [],
      limitations: [
        "A non-purchase on its own is not price friction. Nobody in this group said anything about price.",
        "Sessions can end for reasons the platform cannot see at all (a closed tab, a phone call, a different supplier).",
      ],
    });
  }

  /* ---------------------------------------------------------------- */
  /* 6 — MOQ friction. Never a price signal (spec §45).                */
  /* ---------------------------------------------------------------- */
  const moqEvidence = moq.moqObjectionConversations + moq.requestedBelowMoqStated;
  const moqTypes = [
    moq.moqObjectionConversations > 0,
    moq.requestedBelowMoqStated > 0,
    moq.configuredBelowMoq > 0,
    moq.belowMoqHandoffs > 0,
  ].filter(Boolean).length;
  const moqStrength = strengthFor(moqEvidence, moqTypes);
  if (moqStrength) {
    signals.push({
      id: "MOQ_FRICTION:all",
      kind: "MOQ_FRICTION",
      title: "Customers asked for quantities below our minimum",
      description:
        `${plural(moq.requestedBelowMoqStated, "prospect", "prospects")} stated a quantity below our ${moq.moq}-bag minimum, and ` +
        `${plural(moq.moqObjectionConversations, "conversation", "conversations")} said the minimum was too high. ` +
        "This is a quantity question, not a price question: lowering the unit price would not serve these customers.",
      strength: moqStrength,
      evidenceKind: "EXPLICIT",
      // MOQ friction is real friction, but it is NOT price friction.
      isPriceFriction: false,
      route: "MOQ_REVIEW",
      productId: null,
      quantityTier: null,
      evidence: [
        { metricRef: "pricing.moq.requestedBelowMoqStated", label: "Prospects stating a below-minimum quantity", value: String(moq.requestedBelowMoqStated) },
        { metricRef: "pricing.moq.moqObjectionConversations", label: "Conversations objecting to the minimum", value: String(moq.moqObjectionConversations) },
        { metricRef: "pricing.moq.moqQuestionConversations", label: "Conversations asking what the minimum is", value: String(moq.moqQuestionConversations) },
      ],
      evidenceRefs: moq.opportunityRefs.map((o) => o.id),
      limitations: [
        "Whether a smaller production run is even possible is factory knowledge — this signal cannot answer it.",
        "Asking what the minimum is (a question) is counted separately from saying it is too high (an objection).",
      ],
    });
  }

  /* ---------------------------------------------------------------- */
  /* 7 — Friction concentrated in one quantity band                    */
  /* ---------------------------------------------------------------- */
  for (const row of tiers.rows) {
    if (row.priceObjectionConversations < PRICING_INTELLIGENCE.MIN_EVIDENCE_FOR_SIGNAL) continue;
    const typesHere = [row.priceObjectionConversations > 0, row.priceQuestionConversations > 0].filter(Boolean).length;
    const strength = strengthFor(row.priceObjectionConversations, typesHere);
    if (!strength) continue;
    signals.push({
      id: `TIER_FRICTION:${row.bandKey}`,
      kind: "TIER_FRICTION",
      title: `Price objections concentrate in the ${row.label} band`,
      description:
        `${plural(row.priceObjectionConversations, "conversation", "conversations")} attributed to the ${row.label} band of ` +
        `${row.productTitle} said the price was too high, out of ${row.conversations} attributed to that band.`,
      strength,
      evidenceKind: "EXPLICIT",
      isPriceFriction: true,
      route: "TIER_STRUCTURE_REVIEW",
      productId: row.productId,
      quantityTier: row.tierMinQty,
      evidence: [
        {
          metricRef: `pricing.tier.${row.bandKey}.priceObjectionConversations`,
          label: `Price objections in ${row.label}`,
          value: String(row.priceObjectionConversations),
        },
        { metricRef: `pricing.tier.${row.bandKey}.conversations`, label: `Conversations attributed to ${row.label}`, value: String(row.conversations) },
      ],
      evidenceRefs: [],
      limitations: [
        "Band attribution uses the session's configured or stated quantity; conversations with neither are not counted anywhere.",
        "A band with more objections has not been shown to be mispriced — the customers in each band differ in many ways.",
      ],
    });
  }

  /* ---------------------------------------------------------------- */
  /* 8 — Data gaps that block pricing decisions (spec §4, §12, §36)    */
  /* ---------------------------------------------------------------- */
  if (!costs.costModelConfigured) {
    signals.push({
      id: "DATA_GAP:cost_model",
      kind: "DATA_GAP",
      title: "We cannot tell whether any price is profitable",
      description:
        "Manufacturing, printing, packaging, freight and payment costs have not been provided, so margin and profit impact cannot be computed for any product or tier. " +
        "They are reported as unavailable — never as zero, and never estimated.",
      strength: "HIGH",
      evidenceKind: "EXPLICIT",
      isPriceFriction: false,
      route: "DATA_QUALITY",
      productId: null,
      quantityTier: null,
      evidence: [
        {
          metricRef: "pricing.costs.missingConfiguration",
          label: "Unfilled cost inputs",
          value: String(costs.missingConfiguration.length),
        },
      ],
      evidenceRefs: [],
      limitations: ["Until these are provided, revenue is not a proxy for profit and no specific price change can be shown to be safe."],
    });
  }

  if (!realization.repricing.instrumented) {
    signals.push({
      id: "DATA_GAP:repricing",
      kind: "DATA_GAP",
      title: "Repricing at checkout is not measured",
      description: realization.repricing.reason,
      strength: "LOW",
      evidenceKind: "EXPLICIT",
      isPriceFriction: false,
      route: "DATA_QUALITY",
      productId: null,
      quantityTier: null,
      evidence: [{ metricRef: "pricing.realization.repricingInstrumented", label: "Repricing instrumented", value: "no" }],
      evidenceRefs: [],
      limitations: ["No repricing figure is derived from anything else — the number simply does not exist yet."],
    });
  }

  if (tiers.unattributedConversations > 0 && tiers.unattributedConversations >= PRICING_INTELLIGENCE.MIN_EVIDENCE_FOR_SIGNAL) {
    signals.push({
      id: "DATA_GAP:unattributed_conversations",
      kind: "DATA_GAP",
      title: "Some conversations cannot be tied to a quantity",
      description:
        `${tiers.unattributedConversations} classified conversations have neither a configured quantity nor a stated one, so they are absent from every per-tier rate. ` +
        "They are counted here rather than spread across bands.",
      strength: "LOW",
      evidenceKind: "EXPLICIT",
      isPriceFriction: false,
      route: "DATA_QUALITY",
      productId: null,
      quantityTier: null,
      evidence: [
        {
          metricRef: "pricing.tier.unattributedConversations",
          label: "Conversations with no quantity",
          value: String(tiers.unattributedConversations),
        },
      ],
      evidenceRefs: [],
      limitations: ["Per-tier question and objection rates under-report by exactly this many conversations."],
    });
  }

  return signals;
}

/** Signals that are genuinely about PRICE (spec §20). */
export const priceFrictionSignals = (signals: PricingSignal[]): PricingSignal[] => signals.filter((s) => s.isPriceFriction);

/** Every distinct evidence kind present — used by the readiness gate. */
export const hasExplicitEvidence = (signals: PricingSignal[]): boolean =>
  signals.some((s) => s.isPriceFriction && (s.evidenceKind as EvidenceKind) !== "BEHAVIORAL");
