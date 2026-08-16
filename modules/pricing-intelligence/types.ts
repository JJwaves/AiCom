/**
 * Pricing Intelligence vocabulary (Session 12).
 *
 * Deterministic data only. This module never imports `lib/ai` — the same
 * structural rule that keeps modules/customer-intelligence,
 * modules/business-intelligence, modules/guardrails and modules/experiments
 * honest: analytics authority cannot depend on the model layer, so no
 * pricing number can be fabricated.
 *
 * It also never imports a pricing MUTATION path. `modules/pricing` remains
 * the sole pricing authority; this module READS the engine (to recompute
 * what a configuration would cost today) and writes nothing.
 */

/**
 * Evidence strength for a pricing signal (spec §21). Deliberately three
 * ordinal labels and NOT a probability: the platform has no basis for
 * "0.42 confidence", and inventing one would be exactly the false precision
 * this session exists to avoid.
 */
export const SIGNAL_STRENGTHS = ["LOW", "MEDIUM", "HIGH"] as const;
export type SignalStrength = (typeof SIGNAL_STRENGTHS)[number];

/**
 * How a signal is evidenced (spec §20). The distinction is load-bearing:
 *
 *  EXPLICIT   — a customer SAID something ("that's too expensive", a repeated
 *               price question, a handoff or quote request after seeing a price).
 *  BEHAVIORAL — only an absence of a downstream action. A non-purchase alone
 *               is NOT price friction; a BEHAVIORAL-only signal is reported
 *               as an observation and is never `isPriceFriction`.
 *  MIXED      — both.
 */
export const EVIDENCE_KINDS = ["EXPLICIT", "BEHAVIORAL", "MIXED"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Closed set of deterministic pricing-signal kinds. */
export const PRICING_SIGNAL_KINDS = [
  /** Explicit PRICE_TOO_HIGH objections in qualified conversations. */
  "PRICE_OBJECTION",
  /** The same conversation asked about price repeatedly. */
  "REPEATED_PRICE_QUESTION",
  /** A human handoff happened after a price was seen or asked about. */
  "HANDOFF_AFTER_PRICE",
  /** A custom-quote request happened after a price was seen. */
  "QUOTE_AFTER_PRICE",
  /** Sessions saw a price and took no downstream action. BEHAVIORAL ONLY. */
  "PRICE_VIEW_NO_ACTION",
  /** Demand below the catalog MOQ, and/or explicit MOQ_TOO_HIGH objections. */
  "MOQ_FRICTION",
  /** Friction concentrated in one quantity band of the tier ladder. */
  "TIER_FRICTION",
  /** A pricing question the data or configuration cannot currently answer. */
  "DATA_GAP",
] as const;
export type PricingSignalKind = (typeof PRICING_SIGNAL_KINDS)[number];

/** Where a signal should be investigated. Keeps MOQ/product out of "price". */
export const SIGNAL_ROUTES = [
  "PRICING_REVIEW",
  "MOQ_REVIEW",
  "TIER_STRUCTURE_REVIEW",
  "PRODUCT_OR_MOQ_REVIEW",
  "DATA_QUALITY",
] as const;
export type SignalRoute = (typeof SIGNAL_ROUTES)[number];

export type SignalEvidence = {
  /** Metric key printed in the snapshot — the model may only cite these. */
  metricRef: string;
  label: string;
  value: string;
};

export type PricingSignal = {
  /** Stable within a period: kind + dimension. Used as a citable reference. */
  id: string;
  kind: PricingSignalKind;
  title: string;
  /** Owner-language description built from real counts (spec §37). */
  description: string;
  strength: SignalStrength;
  evidenceKind: EvidenceKind;
  /**
   * TRUE only when EXPLICIT evidence exists. A behavioral-only pattern is
   * reported honestly and never called price friction (spec §20).
   */
  isPriceFriction: boolean;
  route: SignalRoute;
  /** Product this concerns, when the evidence is product-scoped. */
  productId: string | null;
  /** Tier band (the tier's minQty) this concerns, when band-scoped. */
  quantityTier: number | null;
  evidence: SignalEvidence[];
  /** Insight / opportunity row ids backing this signal, if any. */
  evidenceRefs: string[];
  /** What most weakens this signal. Always at least one entry. */
  limitations: string[];
};

/** Availability of a class of pricing recommendation (spec §22). */
export type ReadinessState = "AVAILABLE" | "BLOCKED" | "NOT_SUPPORTED";

export type ReadinessEntry = {
  state: ReadinessState;
  /** Owner-language explanation — always populated, never a bare enum. */
  reason: string;
  /** Exact config paths / data gaps that must be resolved first. */
  blockers: string[];
};

export type PricingReadiness = {
  /** Behavioral evidence is enough to ask a human to look at pricing. */
  PRICING_REVIEW: ReadinessEntry;
  /** A specific numeric price change. Needs cost + margin + movement limits. */
  SPECIFIC_PRICE_CHANGE: ReadinessEntry;
  /** A controlled price test. Needs everything above plus engine support. */
  PRICE_EXPERIMENT: ReadinessEntry;
  /** Software changing a price by itself. Permanently NOT_SUPPORTED. */
  AUTOMATED_PRICE_CHANGE: ReadinessEntry;
};

/**
 * Price elasticity (spec §3). The platform has no controlled price
 * variation, so this is never a number — it is a refusal plus the exact
 * conditions under which it could stop being one.
 */
export type ElasticityAssessment = {
  estimable: false;
  /** Owner-language: WHY, not just "unavailable" (spec §37). */
  reason: string;
  /** Deterministically counted sources of controlled price variation. */
  controlledPriceVariationSources: number;
  /** What would have to exist before an estimate could be attempted. */
  requirements: string[];
};
