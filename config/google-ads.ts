/**
 * Google Ads integration policy configuration (Session 13).
 *
 * Same doctrine as config/customer-intelligence.ts, config/business-
 * intelligence.ts, config/experiments.ts and config/pricing-intelligence.ts:
 * these are PROCESSING-POLICY defaults documented in code, not invented
 * business data. Nothing here is a spend figure, a budget, or a performance
 * claim — every one of those comes from the Google Ads API and is persisted
 * verbatim.
 *
 * Real business limits deliberately do NOT live here. Ad-spend ceilings and
 * budget-movement caps stay in `config/guardrails.ts → GUARDRAIL_LIMITS`
 * (`maximumDailyAdSpendCents`, `maximumCampaignBudgetChangePct`), still
 * `null`, still blocking. One number, one home.
 */

/* ------------------------------------------------------------------ */
/* API version — ONE place (spec §2, §49)                              */
/* ------------------------------------------------------------------ */

/**
 * The Google Ads API version this integration speaks.
 *
 * It appears in exactly one place in business code: here. `lib/google-ads`
 * builds every URL from this constant, the version is recorded on every sync
 * run, and the admin page displays it. Upgrading is a one-line change plus
 * the checklist in docs/GOOGLE_ADS_INTELLIGENCE.md.
 *
 * Overridable with `GOOGLE_ADS_API_VERSION` so a version can be pinned or
 * tested without a deploy — but ONLY to a version in `SUPPORTED_API_VERSIONS`.
 * An unsupported value fails loudly (spec §49); it never silently falls back
 * to an older version, because a silent downgrade would change field
 * semantics under the same code.
 */
export const DEFAULT_GOOGLE_ADS_API_VERSION = "v25";

/**
 * Versions this adapter's GAQL queries and response mapping are known to
 * work against. Verified against the official reference at implementation
 * time (v25 was current). Add a version here only after running the upgrade
 * checklist — presence in this list is a claim that the field names in
 * `queries.ts` still exist and still mean the same thing.
 */
export const SUPPORTED_API_VERSIONS = ["v25"] as const;

export type GoogleAdsApiVersion = (typeof SUPPORTED_API_VERSIONS)[number];

/** Google Ads API host. Constant — there is no alternate/mutating host. */
export const GOOGLE_ADS_API_HOST = "https://googleads.googleapis.com";

/** OAuth 2.0 token endpoint used to exchange the refresh token. */
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GOOGLE_ADS = {
  /* ---------------- Sync policy (spec §11, §43, §45) ---------------- */

  /**
   * Default lookback for a sync, in days, ending today (account time).
   *
   * 30 days is a deliberate compromise: long enough that a restatement of a
   * recent conversion lands (Google revises recent days as delayed
   * conversions arrive — spec §45), short enough that a routine sync never
   * re-fetches account history. It is NOT "all time" and never becomes so.
   */
  DEFAULT_SYNC_LOOKBACK_DAYS: 30,

  /**
   * Hard ceiling on a single sync's date range. A larger request is rejected
   * before any API call — an accidental "sync everything" is a quota
   * incident, not a feature (spec §43).
   */
  MAX_SYNC_RANGE_DAYS: 180,

  /**
   * Rows accepted from one report query. Bounded like every other analytics
   * read in this codebase; a report that would exceed it is reported as
   * TRUNCATED rather than silently cut (spec §43).
   */
  MAX_REPORT_ROWS: 10_000,

  /** Pages fetched per report before giving up — a runaway-pagination stop. */
  MAX_REPORT_PAGES: 50,

  /** Per-request timeout, milliseconds. Ads latency never blocks commerce. */
  REQUEST_TIMEOUT_MS: 30_000,

  /* ---------------- Freshness (spec §28) ---------------- */

  /**
   * A successful sync newer than this is FRESH. Google Ads reporting is
   * itself intraday-lagged, so "fresh" means "we asked recently", never
   * "these numbers are final".
   */
  FRESH_MAX_AGE_HOURS: 26,

  /** Beyond this, the dashboard says STALE and names the last sync time. */
  STALE_MAX_AGE_HOURS: 72,

  /**
   * Reporting days at the end of the window whose metrics are still
   * expected to move. Displayed as provisional; never presented as final.
   */
  PROVISIONAL_TRAILING_DAYS: 3,

  /* ---------------- Reporting thresholds ---------------- */

  /** Minimum denominator before a rate (CTR, CVR, coverage %) is displayed. */
  MIN_DENOMINATOR_FOR_PERCENTAGE: 5,

  /** Minimum clicks before a campaign-level CPC is treated as meaningful. */
  MIN_CLICKS_FOR_CPC: 5,

  /** Rows per breakdown table on the admin surface. */
  MAX_BREAKDOWN_ROWS: 25,

  /**
   * Discrepancy (Google-reported conversions vs first-party attributed
   * orders) at or above which a data-quality signal is raised, as a percent
   * of the larger side. A difference is NOT automatically a bug (spec §55) —
   * this only decides when it is worth a human's attention.
   */
  CONVERSION_DISCREPANCY_PCT: 30,

  /**
   * Minimum share of Google Ads clicks that must resolve to a first-party
   * session before first-party campaign economics are called anything but
   * PARTIAL. Below it, first-party CAC/ROAS report PARTIAL with the
   * coverage stated (spec §17, §20).
   */
  MIN_ATTRIBUTION_COVERAGE_PCT: 50,

  /* ---------------- Agent ---------------- */

  /** Character budget for the Google Ads agent's structured context. */
  ADS_CONTEXT_MAX_CHARS: 16_000,

  /** Hard cap on recommendations accepted from one review. */
  MAX_RECOMMENDATIONS_PER_REVIEW: 8,

  /** Hard cap on narrative signal notes accepted from one review. */
  MAX_SIGNAL_NOTES_PER_REVIEW: 8,

  /** Bounded reads (same posture as S08–S12). */
  MAX_ROWS_PER_QUERY: 5_000,
} as const;

/** Reporting periods offered by /admin/google-ads-intelligence (days). */
export const GOOGLE_ADS_PERIOD_DAYS = [7, 30, 90] as const;

/* ------------------------------------------------------------------ */
/* Recommendation taxonomy (spec §37, §39)                             */
/* ------------------------------------------------------------------ */

/**
 * Controlled recommendation types the Google Ads Intelligence Agent may
 * emit. CLOSED on purpose, and every one of them is a REVIEW.
 *
 * There is deliberately no "SET_BUDGET", no "PAUSE_CAMPAIGN", no
 * "ADJUST_BID" and no numeric budget field anywhere in the agent's schema:
 * a campaign mutation is not merely blocked at evaluation time, it is
 * UNREPRESENTABLE.
 */
export const GOOGLE_ADS_RECOMMENDATION_TYPES = [
  /** A campaign's performance deserves human attention. */
  "CAMPAIGN_REVIEW",
  /** Whether a campaign's budget is right deserves human attention. Sets nothing. */
  "BUDGET_REVIEW",
  /** Look at what people actually searched. (Search-term data is not ingested yet.) */
  "SEARCH_TERM_REVIEW",
  /** Look at keyword-level performance. (Keyword data is not ingested yet.) */
  "KEYWORD_REVIEW",
  /** Paid traffic arrives somewhere that may not serve it well. */
  "LANDING_PAGE_REVIEW",
  /** Google's numbers and ours disagree in a way worth understanding. */
  "ATTRIBUTION_REVIEW",
  /** A question the data or configuration cannot currently answer. */
  "DATA_QUALITY_REVIEW",
] as const;

export type GoogleAdsRecommendationType = (typeof GOOGLE_ADS_RECOMMENDATION_TYPES)[number];

/**
 * Recommendation type → the CLOSED Session-10 action taxonomy (spec §39).
 *
 * EVERY entry is a REVIEW-ONLY action type. `AD_BUDGET_CHANGE`, `AD_PAUSE`,
 * `AD_RESUME` and `AD_CREATIVE_TEST` are deliberately ABSENT: a Google Ads
 * recommendation cannot become an executable ad action by any mapping,
 * whatever the model wrote — and the agent's output schema has no budget,
 * campaign-status or bid field to carry one anyway.
 *
 * Those four types stay registered in the guardrail taxonomy (Session 10)
 * because a LATER session will implement them under approval. Registered,
 * unmapped, executor-less and limit-blocked is exactly the state this
 * session intends.
 */
export const GOOGLE_ADS_RECOMMENDATION_ACTION_TYPE: Record<GoogleAdsRecommendationType, string> = {
  CAMPAIGN_REVIEW: "MARKETING_REVIEW",
  BUDGET_REVIEW: "MARKETING_REVIEW",
  SEARCH_TERM_REVIEW: "MARKETING_REVIEW",
  KEYWORD_REVIEW: "MARKETING_REVIEW",
  LANDING_PAGE_REVIEW: "MARKETING_REVIEW",
  ATTRIBUTION_REVIEW: "MARKETING_REVIEW",
  DATA_QUALITY_REVIEW: "DATA_QUALITY_REVIEW",
};

/* ------------------------------------------------------------------ */
/* Deferred ingestion (spec §24–§25)                                   */
/* ------------------------------------------------------------------ */

/**
 * Search-term and keyword reporting are NOT ingested in Session 13.
 *
 * Campaign-level economics are the priority (spec §25), and search terms
 * carry their own semantics — Google omits low-volume queries for privacy,
 * so the table is knowingly incomplete and must never be presented as "what
 * people searched". These constants exist so the snapshot and the admin
 * surface can state the fact rather than render an empty table that reads
 * as "nobody searched anything".
 */
export const SEARCH_TERMS_INGESTED = false;
export const KEYWORDS_INGESTED = false;
