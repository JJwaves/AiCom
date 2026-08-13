/**
 * Business Intelligence policy configuration (Session 09).
 *
 * Same doctrine as config/customer-intelligence.ts: these are
 * PROCESSING-POLICY defaults documented in code, not invented business
 * data. They gate when the system SPEAKS (percentages, trends, segment
 * rows, CEO recommendations), never what it claims. Deterministic
 * aggregation always runs regardless of these values.
 *
 * The owner may tune them — BUSINESS_CONFIG_TODO.md "Business
 * intelligence".
 */
export const BUSINESS_INTELLIGENCE = {
  /**
   * Minimum eligible population before any percentage/conversion rate is
   * displayed. Below this, raw counts render instead ("2 of 4").
   */
  MIN_DENOMINATOR_FOR_PERCENTAGE: 5,

  /**
   * Minimum previous-period count before a trend % is labeled. Below it,
   * explicit states (NEW_ACTIVITY / LOW_BASELINE) render instead — a move
   * from 1 → 3 orders is never "+200%".
   */
  MIN_TREND_BASE: 5,

  /**
   * Minimum qualified conversations OR orders before a business-segment
   * row is reported (mirrors CUSTOMER_INTELLIGENCE.MIN_SEGMENT_SAMPLE).
   */
  MIN_SEGMENT_SAMPLE: 5,

  /** Minimum sessions per attribution row before it is reported. */
  MIN_ATTRIBUTION_SAMPLE: 5,

  /** Rows shown per breakdown table (products, sources, segments…). */
  MAX_BREAKDOWN_ROWS: 10,

  /** Hard cap on recommendations accepted from one CEO review. */
  MAX_RECOMMENDATIONS_PER_REVIEW: 10,

  /** Character budget for the CEO agent's structured context. */
  CEO_CONTEXT_MAX_CHARS: 16_000,

  /** Bounded corpus loads (same posture as S08 — revisit at real volume). */
  MAX_ROWS_PER_QUERY: 5_000,
} as const;

/** Reporting periods offered by /admin/business-intelligence (days). */
export const BI_PERIOD_DAYS = [1, 7, 30, 90] as const;
