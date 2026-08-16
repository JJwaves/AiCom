/**
 * `lib/google-ads` — the Google Ads READ-ONLY adapter (Session 13).
 *
 * This is the platform's ONLY door to Google Ads, and it opens one way.
 *
 *   READ  → GoogleAdsService `:search` with GAQL SELECTs, nothing else.
 *   WRITE → does not exist. Not "is blocked", not "is guarded": there is no
 *           method on the provider interface, no URL builder that can
 *           address a `:mutate` endpoint, and no query language reachable
 *           from here that has a mutation verb.
 *
 * Layering (docs/GOOGLE_ADS_INTELLIGENCE.md is authoritative):
 *
 *   lib/google-ads          fetch + normalize + sync        (talks to Google)
 *   lib/data/google-ads-*   persist daily snapshots         (talks to Postgres)
 *   modules/google-ads-*    deterministic analytics         (talks to neither)
 *   lib/ai/agents/google-ads  interpretation only           (talks to the model)
 *
 * Raw API response objects never cross the first boundary; credentials never
 * cross it either, in any direction.
 */

export {
  credentialStatus,
  resolveApiVersion,
  resolveCredentials,
  clearAccessTokenCache,
  type GoogleAdsCredentials,
  type GoogleAdsCredentialStatus,
} from "./auth";
export {
  GoogleAdsError,
  isGoogleAdsError,
  redact,
  GOOGLE_ADS_ERROR_CODES,
  GOOGLE_ADS_ERROR_EXPLANATION,
  type GoogleAdsErrorCode,
} from "./errors";
export {
  ACCOUNT_INFO_QUERY,
  assertDateRange,
  assertReportDate,
  buildCampaignDailyQuery,
  QUERY_NAMES,
  type QueryName,
} from "./queries";
export {
  FakeGoogleAdsReportingProvider,
  LiveGoogleAdsReportingProvider,
  mapCampaignDayRow,
  reportingProviderStatus,
  resolveReportingProvider,
  type FakeProviderConfig,
  type GoogleAdsReportingProvider,
} from "./reporting-provider";
export {
  runGoogleAdsSync,
  testGoogleAdsConnection,
  type ConnectionTestResult,
  type SyncOptions,
  type SyncOutcome,
} from "./sync";
export {
  isReportDate,
  microsToCents,
  normalizeCustomerId,
  type GoogleAdsAccountInfo,
  type GoogleAdsCampaignDay,
  type GoogleAdsReport,
} from "./types";
