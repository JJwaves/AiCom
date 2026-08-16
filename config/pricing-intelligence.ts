/**
 * Pricing Intelligence policy configuration (Session 12).
 *
 * Same doctrine as config/customer-intelligence.ts, config/business-
 * intelligence.ts and config/experiments.ts: these are PROCESSING-POLICY
 * defaults documented in code, not invented business data. They decide when
 * the system is allowed to SPEAK about a pricing pattern — never what the
 * pattern is, and never what a price should be.
 *
 * Deterministic pricing analytics ALWAYS run regardless of these values;
 * thresholds gate signal strength, displayed percentages and
 * recommendation eligibility only.
 *
 * Real business limits deliberately do NOT live here. Margin floors stay in
 * `config/costs.ts → marginPolicy`, price-movement ceilings stay in
 * `config/guardrails.ts → GUARDRAIL_LIMITS`. One number, one home.
 */

export const PRICING_INTELLIGENCE = {
  /**
   * Minimum eligible population before any percentage is displayed.
   * Below it, raw counts render ("2 of 4") — same value as S08/S09 so the
   * three intelligence layers never disagree about when a % is honest.
   */
  MIN_DENOMINATOR_FOR_PERCENTAGE: 5,

  /** Minimum previous-period count before a trend % is labeled (S09 parity). */
  MIN_TREND_BASE: 5,

  /** Minimum rows per cell before a segment / attribution breakdown reports. */
  MIN_SEGMENT_SAMPLE: 5,

  /**
   * Minimum distinct conversations carrying EXPLICIT evidence before a
   * price-friction signal may be emitted at all. Below it, the counts still
   * render on the dashboard; no signal is created and nothing is
   * recommendation-eligible.
   */
  MIN_EVIDENCE_FOR_SIGNAL: 3,

  /**
   * Explicit-evidence count at which a signal may reach MEDIUM strength
   * (given a documented denominator).
   */
  MEDIUM_STRENGTH_EVIDENCE: 5,

  /**
   * Explicit-evidence count at which a signal may reach HIGH strength. HIGH
   * additionally requires MORE THAN ONE evidence type (see signals.ts) —
   * volume alone never earns it.
   */
  HIGH_STRENGTH_EVIDENCE: 10,

  /**
   * Minimum distinct sessions that viewed a price before the "price view →
   * no downstream action" observation is reported. This is a BEHAVIORAL
   * observation and can never, on its own, become price friction (spec §20).
   */
  MIN_PRICE_VIEW_SESSIONS_FOR_OBSERVATION: 20,

  /** Rows shown per breakdown table (tiers, products, buckets, segments). */
  MAX_BREAKDOWN_ROWS: 12,

  /** Hard cap on recommendations accepted from one Pricing Agent review. */
  MAX_RECOMMENDATIONS_PER_REVIEW: 8,

  /** Hard cap on narrative signal notes accepted from one review. */
  MAX_SIGNAL_NOTES_PER_REVIEW: 8,

  /** Character budget for the Pricing Agent's structured context. */
  PRICING_CONTEXT_MAX_CHARS: 16_000,

  /** Bounded corpus loads (same posture as S08–S11 — revisit at real volume). */
  MAX_ROWS_PER_QUERY: 5_000,

  /** Bounded (session, event-name) pairs loaded for the pricing funnel. */
  MAX_SESSION_EVENT_PAIRS: 20_000,
} as const;

/** Reporting periods offered by /admin/pricing-intelligence (days). */
export const PRICING_PERIOD_DAYS = [7, 30, 90] as const;

/**
 * Controlled recommendation types the Pricing Agent may emit (spec §25).
 *
 * CLOSED on purpose. There is deliberately no "SET_PRICE", no
 * "APPLY_DISCOUNT" and no numeric price field anywhere in the agent's
 * schema: a specific price proposal is not merely blocked at evaluation
 * time, it is UNREPRESENTABLE (spec §26).
 */
export const PRICING_RECOMMENDATION_TYPES = [
  /** Look at a price level / a product's pricing as a whole. */
  "PRICING_REVIEW",
  /** Look at the minimum order quantity. Never a price recommendation (spec §45). */
  "MOQ_REVIEW",
  /** Look at the SHAPE of the quantity-tier ladder (breakpoints, spacing). */
  "TIER_STRUCTURE_REVIEW",
  /** Look at how an identical price is PRESENTED (spec §32). Never the number. */
  "PRICE_PRESENTATION_REVIEW",
  /** Consider designing a future price experiment. Launches nothing (spec §30). */
  "PRICE_EXPERIMENT_REVIEW",
  /** A pricing question we cannot answer because data or configuration is missing. */
  "DATA_QUALITY",
] as const;

export type PricingRecommendationType = (typeof PRICING_RECOMMENDATION_TYPES)[number];

/**
 * Recommendation type → the CLOSED Session-10 action taxonomy.
 *
 * Every entry is a REVIEW-ONLY action type: approving one records "yes,
 * investigate this" and mutates nothing (docs/AI_ACTION_CENTER.md). The
 * executable types `PRICE_CHANGE` / `PRICE_EXPERIMENT` are deliberately
 * ABSENT from this table — the Pricing Agent cannot reach them by any
 * mapping, whatever it writes.
 *
 * Presentation and tier-structure reviews map to `PRICING_REVIEW` rather
 * than `CRO_REVIEW` because the subject is the price ladder, and because
 * widening the Pricing Agent's source permissions to make a demo neater is
 * exactly what spec §27 forbids.
 */
export const PRICING_RECOMMENDATION_ACTION_TYPE: Record<PricingRecommendationType, string> = {
  PRICING_REVIEW: "PRICING_REVIEW",
  MOQ_REVIEW: "MOQ_REVIEW",
  TIER_STRUCTURE_REVIEW: "PRICING_REVIEW",
  PRICE_PRESENTATION_REVIEW: "PRICING_REVIEW",
  PRICE_EXPERIMENT_REVIEW: "PRICING_REVIEW",
  DATA_QUALITY: "DATA_QUALITY_REVIEW",
};
