/**
 * Customer Intelligence policy configuration (Session 08).
 *
 * These are PROCESSING-POLICY defaults, deliberately documented in code
 * (house convention: business thresholds live in TS config, not env).
 * They are conservative floors that keep the system from claiming
 * patterns off one or two observations — the owner may tune them
 * (BUSINESS_CONFIG_TODO.md "Customer intelligence"). None of them are
 * invented business data: they gate when we SPEAK, not what we claim.
 *
 * Deterministic aggregation always runs regardless of these values —
 * thresholds only gate persisted strategic insights, displayed
 * percentages, trends, and segment breakdowns.
 */
export const CUSTOMER_INTELLIGENCE = {
  /**
   * Minimum distinct conversations (post-dedup) behind a metric before a
   * persistent CustomerInsight / ProductOpportunity may be generated.
   */
  MIN_EVIDENCE_FOR_INSIGHT: 3,

  /**
   * Minimum eligible population before any percentage is displayed or
   * persisted. Below this, raw counts are still shown ("2 of 4") but no
   * percentage is derived from them.
   */
  MIN_DENOMINATOR_FOR_PERCENTAGE: 5,

  /**
   * Minimum conversations per cell before a segment/attribution breakdown
   * row or a conversion-association comparison is reported.
   */
  MIN_SEGMENT_SAMPLE: 5,

  /**
   * Minimum previous-period count before a trend (± %) is labeled.
   * A move from 1 → 3 conversations is noise, not "+200%".
   */
  MIN_TREND_BASE: 5,

  /**
   * Minimum percentage-point gap between observed purchase rates before a
   * CONVERSION_PATTERN insight is persisted (descriptive association only —
   * causal language is never used regardless of the gap).
   */
  MIN_ASSOCIATION_DELTA_PP: 10,

  /** Max conversations classified per explicit processing run (AI cost control). */
  CLASSIFICATION_BATCH_LIMIT: 25,

  /** Max customer messages sent to the classifier per conversation. */
  MAX_USER_MESSAGES_PER_CLASSIFICATION: 30,

  /** Per-message character cap in classifier input (long messages truncate). */
  MAX_MESSAGE_CHARS: 500,

  /** Message-excerpt cap in the admin evidence drill-down. */
  EVIDENCE_EXCERPT_CHARS: 240,

  /** Hard cap on source refs persisted per insight/opportunity (schema max 500). */
  MAX_SOURCE_REFS: 100,
} as const;

/**
 * Requested-quantity volume groups, derived from the ACTUAL catalog rules:
 * every product's minQuantity is 500 (below it = custom-quote routing) and
 * the shared quantity presets step 500 → 25,000. Bounds are half-open:
 * min ≤ q < max.
 */
export const VOLUME_GROUPS = [
  { id: "below_moq", label: "Below MOQ (<500)", min: 0, max: 500 },
  { id: "standard_small", label: "Standard small (500–2,499)", min: 500, max: 2500 },
  { id: "standard_medium", label: "Standard medium (2,500–9,999)", min: 2500, max: 10000 },
  { id: "high_volume", label: "High volume (10,000+)", min: 10000, max: Number.POSITIVE_INFINITY },
] as const;

export type VolumeGroupId = (typeof VOLUME_GROUPS)[number]["id"];

export function volumeGroupFor(quantity: number): VolumeGroupId {
  for (const g of VOLUME_GROUPS) {
    if (quantity >= g.min && quantity < g.max) return g.id;
  }
  return "high_volume";
}
