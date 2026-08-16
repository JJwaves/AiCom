/**
 * Google Ads Intelligence vocabulary (Session 13).
 *
 * Deterministic data only. This module never imports `lib/ai` and never
 * imports `lib/google-ads` — the same structural rule that keeps
 * modules/customer-intelligence, modules/business-intelligence,
 * modules/guardrails, modules/experiments and modules/pricing-intelligence
 * honest, plus one more this session adds:
 *
 *   NO EXTERNAL API ACCESS. The analytics authority reads PERSISTED daily
 *   snapshots (`lib/data/google-ads-service`). It cannot call Google, so a
 *   dashboard render is never an API call (spec §10), an outage cannot
 *   change a number, and no analytics code path could ever reach a mutation
 *   endpoint even if one existed.
 *
 * The vocabulary itself encodes the session's central distinction: every
 * Google-reported quantity is named `google…`, every BagDirect quantity is
 * named `firstParty…`, and no type has a field where one could be mistaken
 * for the other (spec §14, §34, §64).
 */

/* ------------------------------------------------------------------ */
/* Connection & freshness (spec §6, §28)                               */
/* ------------------------------------------------------------------ */

/**
 * Whether Google Ads is connected at all.
 *
 * `NOT_CONNECTED` is a first-class state, never rendered as zero spend
 * (spec §6, §18). `CONFIGURATION_INVALID` separates "you have not connected
 * it" from "you connected it wrong", because those need different actions.
 */
export const CONNECTION_STATES = ["CONNECTED", "NOT_CONNECTED", "CONFIGURATION_INVALID", "NEVER_SYNCED"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export type ConnectionStatus = {
  state: ConnectionState;
  /** Owner-language explanation. Always populated, never a bare enum. */
  reason: string;
  /** Env var names that are missing or unusable. NEVER their values. */
  missingConfiguration: string[];
  /** Connected account facts, when an account row exists. */
  account: {
    customerId: string;
    descriptiveName: string | null;
    currencyCode: string;
    timeZone: string;
    isManager: boolean;
    isTestAccount: boolean;
    loginCustomerId: string | null;
  } | null;
  /** API version the last successful read used. */
  apiVersion: string | null;
};

/**
 * Data freshness (spec §28). Deterministic thresholds from
 * `config/google-ads.ts`; nothing here guesses.
 *
 *  FRESH        — a COMPLETE sync inside the fresh window.
 *  STALE        — the last complete sync is older than the stale threshold.
 *  PARTIAL      — the most recent sync was truncated, so the window is
 *                 knowingly incomplete. Data is shown; freshness is not
 *                 claimed.
 *  SYNC_FAILED  — the most recent attempt failed. THE PREVIOUS DATA IS
 *                 STILL SHOWN, with its own timestamp, and is never zeroed.
 *  NOT_CONNECTED— no credentials.
 */
export const FRESHNESS_STATES = ["FRESH", "STALE", "PARTIAL", "SYNC_FAILED", "NOT_CONNECTED"] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

export type SyncFreshness = {
  state: FreshnessState;
  reason: string;
  /** Last COMPLETE sync. Partial and failed runs never advance this. */
  lastSuccessfulSyncAt: Date | null;
  /** Last attempt of any outcome. */
  lastAttemptAt: Date | null;
  lastAttemptStatus: string | null;
  /** Normalized failure code from the last attempt, when it failed. */
  lastErrorCode: string | null;
  /** Display-safe failure message. Never contains credentials. */
  lastErrorMessage: string | null;
  /** Most recent reporting day we hold data for (account calendar). */
  latestMetricDate: string | null;
  /** Hours since the last complete sync, or null when there has never been one. */
  ageHours: number | null;
  /**
   * Reporting days at the end of the window whose numbers Google may still
   * revise. Shown as provisional; never presented as final (spec §45).
   */
  provisionalFromDate: string | null;
};

/* ------------------------------------------------------------------ */
/* Attribution matching (spec §16, §17)                                */
/* ------------------------------------------------------------------ */

/**
 * How a first-party session was tied to a Google Ads campaign.
 *
 *  EXACT     — the session's `utm_campaign` IS the Google campaign id. This
 *              happens when tracking templates use `{campaignid}`, and it is
 *              the only match with no naming assumption in it.
 *  MAPPED    — the session's `utm_campaign` matches the campaign NAME after
 *              case/whitespace normalization. Deterministic, but it depends
 *              on a naming convention the owner controls and can break.
 *  UNMATCHED — the session is demonstrably Google Ads paid traffic (it
 *              carries a click id, or google/cpc parameters) but names no
 *              campaign we hold. Its revenue is real and is REPORTED — it
 *              simply cannot be assigned to a campaign.
 *
 * There is deliberately no FUZZY tier. Approximate string matching would
 * make revenue attribution a guess wearing a number (spec §17).
 */
export const MATCH_QUALITIES = ["EXACT", "MAPPED", "UNMATCHED"] as const;
export type MatchQuality = (typeof MATCH_QUALITIES)[number];

export type AttributionCoverage = {
  /** Sessions identified as Google Ads paid traffic in the period. */
  googleAdsSessions: number;
  exactSessions: number;
  mappedSessions: number;
  unmatchedSessions: number;
  /** Percent of Google Ads sessions tied to a campaign, or null (small n). */
  matchedPct: number | null;
  /** Google Ads campaigns with spend but no first-party session at all. */
  campaignsWithNoSessions: number;
  /**
   * Clicks Google reported, vs sessions we saw. Not expected to be equal —
   * bounces before the tag fires, blocked scripts, and consent choices all
   * make our count lower. Reported, never reconciled (spec §33).
   */
  googleClicks: number;
  /** clicks → session coverage percent, or null when clicks are too few. */
  clickToSessionPct: number | null;
  /** Owner-language statement of what this coverage does and does not permit. */
  interpretation: string;
};

/* ------------------------------------------------------------------ */
/* Data quality (spec §56)                                             */
/* ------------------------------------------------------------------ */

export const GOOGLE_ADS_SIGNAL_KINDS = [
  "NO_SUCCESSFUL_SYNC",
  "SYNC_STALE",
  "SYNC_FAILED",
  "SYNC_PARTIAL",
  "TEST_ACCOUNT",
  "CURRENCY_MISMATCH",
  "CONVERSION_DISCREPANCY",
  "GOOGLE_CONVERSIONS_NO_FIRST_PARTY_ORDERS",
  "FIRST_PARTY_ORDERS_NO_GOOGLE_CONVERSIONS",
  "LOW_ATTRIBUTION_COVERAGE",
  "COST_WITHOUT_CLICKS",
  "SPEND_WITHOUT_SESSIONS",
  "PROFIT_UNAVAILABLE",
  "SEARCH_TERMS_NOT_INGESTED",
] as const;
export type GoogleAdsSignalKind = (typeof GOOGLE_ADS_SIGNAL_KINDS)[number];

/** Where a signal should be investigated. Review routes only. */
export const GOOGLE_ADS_SIGNAL_ROUTES = ["MARKETING_REVIEW", "ATTRIBUTION_REVIEW", "DATA_QUALITY"] as const;
export type GoogleAdsSignalRoute = (typeof GOOGLE_ADS_SIGNAL_ROUTES)[number];

export type GoogleAdsSignalEvidence = { metricRef: string; label: string; value: string };

export type GoogleAdsSignal = {
  /** Stable within a period: kind + dimension. Citable by the agent. */
  id: string;
  kind: GoogleAdsSignalKind;
  title: string;
  /** Owner-language description built from real counts. */
  description: string;
  route: GoogleAdsSignalRoute;
  /** Campaign this concerns, when campaign-scoped. */
  campaignId: string | null;
  evidence: GoogleAdsSignalEvidence[];
  /**
   * What this signal does NOT prove. Always at least one entry — a
   * discrepancy between Google and us is usually configuration, not a bug
   * (spec §55–§56).
   */
  limitations: string[];
};
