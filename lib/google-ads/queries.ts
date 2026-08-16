import { GOOGLE_ADS } from "@/config/google-ads";
import { GoogleAdsError } from "./errors";

/**
 * The CLOSED set of GAQL queries this integration can issue (spec §3, §43).
 *
 * Every query is built HERE, from a template plus a validated date range.
 * There is no exported "run arbitrary GAQL" function and no place a caller
 * can inject a clause — `buildCampaignDailyQuery` takes two dates and
 * nothing else. Combined with `client.ts` (which can only ever address the
 * `:search` endpoint), that is what makes mutation structurally absent
 * rather than merely avoided:
 *
 *   GAQL has no INSERT, UPDATE or DELETE. Mutations in the Google Ads API
 *   are separate `*Service:mutate` endpoints, and no code path in this
 *   repository can construct one of those URLs.
 *
 * Field selection is deliberately narrow (spec §43, §59): we ask for the
 * campaign identity, the day, and the five metrics the business questions
 * need. We do NOT request user identifiers, click ids, audience membership,
 * or any per-person field.
 */

/** Maximum page size the Google Ads API accepts for `search`. */
export const MAX_PAGE_SIZE = 10_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a `YYYY-MM-DD` literal before it reaches a query string.
 *
 * The regex is the injection guard: the only values that ever reach GAQL
 * are ten characters of digits and dashes. There is no other interpolation
 * point in any query in this file.
 */
export function assertReportDate(value: string, label: string): string {
  if (!DATE_RE.test(value)) {
    throw new GoogleAdsError("REPORTING_ERROR", `${label} must be a YYYY-MM-DD date.`);
  }
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
    throw new GoogleAdsError("REPORTING_ERROR", `${label} is not a real calendar date.`);
  }
  return value;
}

/** Reject a range that is backwards or wider than the configured ceiling. */
export function assertDateRange(startDate: string, endDate: string): void {
  assertReportDate(startDate, "startDate");
  assertReportDate(endDate, "endDate");
  if (startDate > endDate) {
    throw new GoogleAdsError("REPORTING_ERROR", "The report start date is after its end date.");
  }
  const spanDays = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
  if (spanDays > GOOGLE_ADS.MAX_SYNC_RANGE_DAYS) {
    throw new GoogleAdsError(
      "REPORTING_ERROR",
      `A single sync may cover at most ${GOOGLE_ADS.MAX_SYNC_RANGE_DAYS} days; ${spanDays} were requested.`,
    );
  }
}

/**
 * Account identity + settings (spec §29–§30, §47–§48).
 *
 * The smallest read that proves the connection works AND returns the two
 * facts every downstream calculation depends on: the account's currency and
 * its reporting time zone. Neither is ever assumed.
 */
export const ACCOUNT_INFO_QUERY = `
  SELECT
    customer.id,
    customer.descriptive_name,
    customer.currency_code,
    customer.time_zone,
    customer.manager,
    customer.test_account
  FROM customer
  LIMIT 1
`.trim();

/**
 * Campaign × day performance (spec §13).
 *
 * `segments.date` makes each row one account-calendar DAY, which is what
 * makes the persisted table idempotent: (customer, campaign, date) is the
 * natural key, and a re-sync of the same day UPDATES rather than adds
 * (spec §44–§45).
 *
 * Metrics requested, and why each one:
 *   impressions / clicks   — traffic, and the denominators for CTR and CPC
 *   cost_micros            — the authoritative spend figure (spec §18)
 *   conversions            — GOOGLE's conversion count, never our orders
 *   conversions_value      — GOOGLE's conversion value, never our revenue
 *
 * Zero-spend campaigns are included on purpose: a campaign that spent
 * nothing is a real finding, and filtering it out would make "no data" and
 * "no spend" indistinguishable.
 */
export function buildCampaignDailyQuery(startDate: string, endDate: string): string {
  assertDateRange(startDate, endDate);
  return `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY segments.date ASC
  `.trim();
}

/**
 * The complete list of queries this integration can send.
 *
 * A structural test asserts that every GAQL string in `lib/google-ads`
 * starts with SELECT and that no file here contains "mutate". This constant
 * is what that test enumerates against, so a future query added outside the
 * closed set is a test failure rather than a quiet capability.
 */
export const QUERY_NAMES = ["account_info", "campaign_daily"] as const;
export type QueryName = (typeof QUERY_NAMES)[number];
