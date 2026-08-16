import { GOOGLE_ADS } from "@/config/google-ads";
import { credentialStatus, resolveCredentials, type GoogleAdsCredentialStatus, type GoogleAdsCredentials } from "./auth";
import { searchGoogleAds, type SearchOptions } from "./client";
import { GoogleAdsError } from "./errors";
import { ACCOUNT_INFO_QUERY, buildCampaignDailyQuery } from "./queries";
import {
  isReportDate,
  microsToCents,
  type GoogleAdsAccountInfo,
  type GoogleAdsCampaignDay,
  type GoogleAdsReport,
} from "./types";

/**
 * `GoogleAdsReportingProvider` — the ONLY Google Ads surface the rest of the
 * platform can see (Session 13 spec §3, §4).
 *
 * READ METHODS ONLY, and that is the point. This interface has:
 *   - no createCampaign / updateCampaign / pauseCampaign / enableCampaign
 *   - no setBudget / updateBudget
 *   - no createKeyword / removeKeyword / setBid
 *   - no createAd / updateAd / createAudience / updateAsset / setTargeting
 *   - no uploadConversion
 *   - and no generic `request(method, path, body)` escape hatch
 *
 * Because the interface is the type every consumer holds, a future developer
 * cannot "just add a mutation call" at a call site: there is no method to
 * call, the transport cannot build a mutating URL (client.ts), and GAQL —
 * the only query language reachable — has no mutation verb. A structural
 * test (tests/google-ads-readonly.test.ts) asserts all three.
 */
export interface GoogleAdsReportingProvider {
  /** Whether credentials exist. Never a spend figure (spec §6). */
  status(): GoogleAdsCredentialStatus;
  /** Smallest possible read: who are we connected to? (spec §47) */
  getAccountInfo(): Promise<GoogleAdsAccountInfo>;
  /** Campaign × account-calendar-day performance over a bounded range. */
  getCampaignDailyMetrics(startDate: string, endDate: string): Promise<GoogleAdsReport<GoogleAdsCampaignDay>>;
}

/* ------------------------------------------------------------------ */
/* Live provider                                                       */
/* ------------------------------------------------------------------ */

export class LiveGoogleAdsReportingProvider implements GoogleAdsReportingProvider {
  private readonly credentials: GoogleAdsCredentials;
  private readonly searchOptions: SearchOptions;

  constructor(credentials: GoogleAdsCredentials, searchOptions: SearchOptions = {}) {
    this.credentials = credentials;
    this.searchOptions = searchOptions;
  }

  status(): GoogleAdsCredentialStatus {
    return {
      configured: true,
      customerId: this.credentials.customerId,
      loginCustomerId: this.credentials.loginCustomerId,
      apiVersion: this.credentials.apiVersion,
    };
  }

  /**
   * Account identity, currency and time zone (spec §29–§30, §47–§48).
   *
   * The customer id comes from SERVER CONFIGURATION and is never accepted
   * from a request (spec §48) — `resolveCredentials()` is the only source,
   * and this method takes no arguments.
   */
  async getAccountInfo(): Promise<GoogleAdsAccountInfo> {
    const result = await searchGoogleAds(this.credentials, this.credentials.customerId, ACCOUNT_INFO_QUERY, {
      ...this.searchOptions,
      maxRows: 1,
      pageSize: 1,
    });
    const row = result.rows[0] as { customer?: Record<string, unknown> } | undefined;
    const customer = row?.customer;
    if (!customer) {
      throw new GoogleAdsError("INVALID_CUSTOMER", "Google Ads returned no account for the configured customer id.", {
        requestId: result.requestId,
      });
    }

    const currencyCode = typeof customer.currencyCode === "string" ? customer.currencyCode : null;
    const timeZone = typeof customer.timeZone === "string" ? customer.timeZone : null;
    if (!currencyCode || !timeZone) {
      // Both are load-bearing: currency gates every financial comparison
      // (spec §30) and the time zone defines what a reporting "day" is
      // (spec §29). Guessing either would corrupt every number downstream.
      throw new GoogleAdsError(
        "REPORTING_ERROR",
        "The Google Ads account did not report a currency and time zone, so spend cannot be interpreted.",
        { requestId: result.requestId },
      );
    }

    return {
      customerId: String(customer.id ?? this.credentials.customerId),
      descriptiveName: typeof customer.descriptiveName === "string" ? customer.descriptiveName : null,
      currencyCode,
      timeZone,
      isManager: customer.manager === true,
      isTestAccount: customer.testAccount === true,
      loginCustomerId: this.credentials.loginCustomerId,
    };
  }

  async getCampaignDailyMetrics(
    startDate: string,
    endDate: string,
  ): Promise<GoogleAdsReport<GoogleAdsCampaignDay>> {
    const account = await this.getAccountInfo();
    const query = buildCampaignDailyQuery(startDate, endDate);
    const result = await searchGoogleAds(this.credentials, this.credentials.customerId, query, {
      ...this.searchOptions,
      maxRows: GOOGLE_ADS.MAX_REPORT_ROWS,
    });

    const rows: GoogleAdsCampaignDay[] = [];
    for (const raw of result.rows) {
      const mapped = mapCampaignDayRow(raw, this.credentials.customerId, account.currencyCode);
      if (mapped) rows.push(mapped);
    }
    return { rows, truncated: result.truncated, pagesFetched: result.pagesFetched };
  }
}

/**
 * Map one raw Google Ads row.
 *
 * A row missing its campaign id or its date is DROPPED, not defaulted:
 * a spend figure with no day to attach it to would either double-count or
 * land on the wrong day, and both are worse than a missing row. Money
 * converts from micros to integer cents exactly once, here (spec §13).
 */
export function mapCampaignDayRow(
  raw: unknown,
  customerId: string,
  currencyCode: string,
): GoogleAdsCampaignDay | null {
  const row = raw as
    | {
        campaign?: Record<string, unknown>;
        segments?: Record<string, unknown>;
        metrics?: Record<string, unknown>;
      }
    | undefined;
  const campaign = row?.campaign;
  const segments = row?.segments;
  const metrics = row?.metrics ?? {};
  if (!campaign || !segments) return null;

  const campaignId = campaign.id === undefined || campaign.id === null ? null : String(campaign.id);
  const date = segments.date;
  if (!campaignId || campaignId.length === 0 || !isReportDate(date)) return null;

  return {
    customerId,
    campaignId,
    campaignName: typeof campaign.name === "string" ? campaign.name.slice(0, 300) : `Campaign ${campaignId}`,
    campaignStatus: typeof campaign.status === "string" ? campaign.status : "UNKNOWN",
    advertisingChannelType:
      typeof campaign.advertisingChannelType === "string" ? campaign.advertisingChannelType : null,
    date,
    impressions: intOf(metrics.impressions),
    clicks: intOf(metrics.clicks),
    costCents: microsToCents(metrics.costMicros as number | string | undefined),
    currencyCode,
    googleConversions: floatOf(metrics.conversions),
    googleConversionValueCents: valueToCents(metrics.conversionsValue),
  };
}

/** Google returns int64 metrics as strings in JSON. */
const intOf = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

/** Conversions are genuinely fractional under data-driven attribution. */
const floatOf = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * `metrics.conversions_value` is a DOUBLE in account currency units (not
 * micros — unlike cost). Converting to integer cents here keeps the
 * project's money convention intact and keeps a float out of the database.
 */
const valueToCents = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
};

/* ------------------------------------------------------------------ */
/* Fake provider (tests + local development)                           */
/* ------------------------------------------------------------------ */

export type FakeProviderConfig = {
  account?: Partial<GoogleAdsAccountInfo>;
  days?: GoogleAdsCampaignDay[];
  truncated?: boolean;
  /** Throw this on every call — for exercising the error paths. */
  failWith?: GoogleAdsError;
  /** Fail only `getCampaignDailyMetrics` — the partial-sync case (spec §46). */
  failReportsWith?: GoogleAdsError;
};

/**
 * `FakeGoogleAdsReportingProvider` (spec §8, §61, §65).
 *
 * Every automated test uses this. No test in this repository performs a real
 * Google Ads call, needs a Google Ads account, or reads a credential — and a
 * structural test asserts that the test suite contains no live provider
 * construction and no `googleads.googleapis.com` string.
 */
export class FakeGoogleAdsReportingProvider implements GoogleAdsReportingProvider {
  private readonly config: FakeProviderConfig;
  /** Call counts, so tests can assert idempotency and quota behaviour. */
  readonly calls = { account: 0, campaignDaily: 0 };

  constructor(config: FakeProviderConfig = {}) {
    this.config = config;
  }

  status(): GoogleAdsCredentialStatus {
    return {
      configured: true,
      customerId: this.config.account?.customerId ?? "1234567890",
      loginCustomerId: this.config.account?.loginCustomerId ?? null,
      apiVersion: "v25",
    };
  }

  async getAccountInfo(): Promise<GoogleAdsAccountInfo> {
    this.calls.account += 1;
    if (this.config.failWith) throw this.config.failWith;
    return {
      customerId: "1234567890",
      descriptiveName: "BagDirect (fake)",
      currencyCode: "USD",
      timeZone: "America/New_York",
      isManager: false,
      isTestAccount: false,
      loginCustomerId: null,
      ...this.config.account,
    };
  }

  async getCampaignDailyMetrics(
    startDate: string,
    endDate: string,
  ): Promise<GoogleAdsReport<GoogleAdsCampaignDay>> {
    this.calls.campaignDaily += 1;
    if (this.config.failWith) throw this.config.failWith;
    if (this.config.failReportsWith) throw this.config.failReportsWith;
    const rows = (this.config.days ?? []).filter((d) => d.date >= startDate && d.date <= endDate);
    return { rows, truncated: this.config.truncated ?? false, pagesFetched: rows.length > 0 ? 1 : 0 };
  }
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

/**
 * The provider for the current environment, or `null` when Google Ads is
 * not connected.
 *
 * `null` means NOT CONNECTED and is never turned into zero spend anywhere
 * downstream (spec §6, §18). Callers that want a specific provider (tests,
 * the fake dev provider) inject it instead of calling this.
 */
export function resolveReportingProvider(
  env: NodeJS.ProcessEnv = process.env,
  searchOptions: SearchOptions = {},
): GoogleAdsReportingProvider | null {
  const credentials = resolveCredentials(env);
  if (!credentials) return null;
  return new LiveGoogleAdsReportingProvider(credentials, searchOptions);
}

/** Credential status without constructing a provider or touching the network. */
export function reportingProviderStatus(env: NodeJS.ProcessEnv = process.env): GoogleAdsCredentialStatus {
  try {
    return credentialStatus(env);
  } catch {
    return { configured: false, missing: [], invalid: ["GOOGLE_ADS_API_VERSION"] };
  }
}
