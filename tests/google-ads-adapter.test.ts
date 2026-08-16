import { beforeEach, describe, expect, it } from "vitest";
import {
  ACCOUNT_INFO_QUERY,
  assertDateRange,
  buildCampaignDailyQuery,
  clearAccessTokenCache,
  credentialStatus,
  FakeGoogleAdsReportingProvider,
  GoogleAdsError,
  LiveGoogleAdsReportingProvider,
  mapCampaignDayRow,
  microsToCents,
  normalizeCustomerId,
  redact,
  resolveApiVersion,
  resolveCredentials,
  resolveReportingProvider,
} from "@/lib/google-ads";
import { accountDayRangeForPeriod, addDays, dateInTimeZone, defaultSyncRange, timeZoneDiffersFromUtc } from "@/modules/google-ads-intelligence/dates";
import { day } from "./gads-helpers";

/**
 * Session 13 — adapter tests (spec §61).
 *
 * ZERO NETWORK. Every test either uses `FakeGoogleAdsReportingProvider` or
 * injects a stub `fetch`; no test constructs a live client against a real
 * host, and `tests/setup.ts` deletes every `GOOGLE_ADS_*` env var so a
 * developer's real credentials cannot leak into a run.
 */

const ENV = {
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token",
  GOOGLE_ADS_CLIENT_ID: "client-id",
  GOOGLE_ADS_CLIENT_SECRET: "client-secret",
  GOOGLE_ADS_REFRESH_TOKEN: "1//refresh",
  GOOGLE_ADS_CUSTOMER_ID: "123-456-7890",
} as unknown as NodeJS.ProcessEnv;

beforeEach(() => clearAccessTokenCache());

/* ------------------------------------------------------------------ */
/* Credentials                                                         */
/* ------------------------------------------------------------------ */

describe("credential configuration", () => {
  it("reports NOT configured when nothing is set, and names the missing vars", () => {
    const status = credentialStatus({} as unknown as NodeJS.ProcessEnv);
    expect(status.configured).toBe(false);
    if (status.configured) throw new Error("unreachable");
    expect(status.missing).toContain("GOOGLE_ADS_DEVELOPER_TOKEN");
    expect(status.missing).toContain("GOOGLE_ADS_CUSTOMER_ID");
  });

  it("never returns a credential VALUE in the status", () => {
    const status = credentialStatus(ENV);
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("dev-token");
    expect(serialized).not.toContain("client-secret");
    expect(serialized).not.toContain("1//refresh");
    // The customer id IS present — it is an account identifier, not a secret.
    expect(serialized).toContain("1234567890");
  });

  it("normalizes a dashed customer id to digits", () => {
    expect(normalizeCustomerId("123-456-7890")).toBe("1234567890");
    const creds = resolveCredentials(ENV);
    expect(creds?.customerId).toBe("1234567890");
  });

  it("carries the manager login-customer-id when one is configured", () => {
    const creds = resolveCredentials({ ...ENV, GOOGLE_ADS_LOGIN_CUSTOMER_ID: "999-888-7777" });
    expect(creds?.loginCustomerId).toBe("9998887777");
  });

  it("leaves login-customer-id null when no manager account is configured", () => {
    expect(resolveCredentials(ENV)?.loginCustomerId).toBeNull();
  });

  it("returns null (not an error) when credentials are absent — missing ≠ broken", () => {
    expect(resolveCredentials({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(resolveReportingProvider({} as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* API version                                                         */
/* ------------------------------------------------------------------ */

describe("API version is centralized and fails loudly", () => {
  it("defaults to the supported version", () => {
    expect(resolveApiVersion({} as unknown as NodeJS.ProcessEnv)).toBe("v25");
  });

  it("accepts an explicitly pinned supported version", () => {
    expect(resolveApiVersion({ GOOGLE_ADS_API_VERSION: "v25" } as unknown as NodeJS.ProcessEnv)).toBe("v25");
  });

  it("REFUSES an unsupported version instead of silently falling back", () => {
    expect(() => resolveApiVersion({ GOOGLE_ADS_API_VERSION: "v19" } as unknown as NodeJS.ProcessEnv)).toThrow(GoogleAdsError);
    try {
      resolveApiVersion({ GOOGLE_ADS_API_VERSION: "v19" } as unknown as NodeJS.ProcessEnv);
    } catch (err) {
      expect((err as GoogleAdsError).code).toBe("API_VERSION_UNSUPPORTED");
    }
    const status = credentialStatus({ ...ENV, GOOGLE_ADS_API_VERSION: "v19" });
    expect(status.configured).toBe(false);
  });

  it("does not scatter the version through business code", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const repo = process.cwd();
    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, acc);
        else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
      }
      return acc;
    };
    const offenders: string[] = [];
    for (const dir of ["modules/google-ads-intelligence", "lib/ai/agents/google-ads", "app/admin/google-ads-intelligence"]) {
      for (const file of walk(path.join(repo, dir))) {
        const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        if (/["'`]v2[0-9]["'`]/.test(source)) offenders.push(path.relative(repo, file));
      }
    }
    expect(offenders, "the API version literal belongs only in config/google-ads.ts").toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Money, dates, normalization                                         */
/* ------------------------------------------------------------------ */

describe("cost micros conversion", () => {
  it("converts micros to integer cents exactly", () => {
    expect(microsToCents(1_000_000)).toBe(100); // 1 unit = 100 cents
    expect(microsToCents(12_500_000)).toBe(1_250);
    expect(microsToCents(0)).toBe(0);
  });

  it("accepts the STRING form Google returns for int64 fields", () => {
    expect(microsToCents("12500000")).toBe(1_250);
  });

  it("rounds sub-cent spend instead of truncating it away", () => {
    // 15,000 micros = 1.5 cents. Truncation would hide a long tail of spend.
    expect(microsToCents(15_000)).toBe(2);
    expect(microsToCents(4_000)).toBe(0);
    expect(microsToCents(5_000)).toBe(1);
  });

  it("treats missing or unparseable values as 0 rather than NaN", () => {
    expect(microsToCents(null)).toBe(0);
    expect(microsToCents(undefined)).toBe(0);
    expect(microsToCents("not-a-number")).toBe(0);
  });
});

describe("report response normalization", () => {
  it("maps a Google row into the internal type with cents and the account currency", () => {
    const mapped = mapCampaignDayRow(
      {
        campaign: { id: "111", name: "Restaurant Bags", status: "ENABLED", advertisingChannelType: "SEARCH" },
        segments: { date: "2026-08-10" },
        metrics: {
          impressions: "1000",
          clicks: "50",
          costMicros: "125000000",
          conversions: 2.5,
          conversionsValue: 2100.5,
        },
      },
      "1234567890",
      "EUR",
    );
    expect(mapped).toEqual({
      customerId: "1234567890",
      campaignId: "111",
      campaignName: "Restaurant Bags",
      campaignStatus: "ENABLED",
      advertisingChannelType: "SEARCH",
      date: "2026-08-10",
      impressions: 1_000,
      clicks: 50,
      costCents: 12_500,
      currencyCode: "EUR",
      googleConversions: 2.5,
      googleConversionValueCents: 210_050,
    });
  });

  it("keeps FRACTIONAL Google conversions — data-driven attribution is not integral", () => {
    const mapped = mapCampaignDayRow(
      { campaign: { id: "1" }, segments: { date: "2026-08-10" }, metrics: { conversions: 0.33 } },
      "1",
      "USD",
    );
    expect(mapped?.googleConversions).toBeCloseTo(0.33);
  });

  it("DROPS a row with no campaign id or no date rather than defaulting one", () => {
    expect(mapCampaignDayRow({ segments: { date: "2026-08-10" } }, "1", "USD")).toBeNull();
    expect(mapCampaignDayRow({ campaign: { id: "1" }, segments: {} }, "1", "USD")).toBeNull();
    expect(mapCampaignDayRow({ campaign: { id: "1" }, segments: { date: "10/08/2026" } }, "1", "USD")).toBeNull();
    expect(mapCampaignDayRow(undefined, "1", "USD")).toBeNull();
  });

  it("does not leak raw API objects — the mapped row has exactly the internal keys", () => {
    const mapped = mapCampaignDayRow(
      { campaign: { id: "1", resourceName: "customers/1/campaigns/1" }, segments: { date: "2026-08-10" }, metrics: {} },
      "1",
      "USD",
    );
    expect(Object.keys(mapped ?? {}).sort()).toEqual([
      "advertisingChannelType",
      "campaignId",
      "campaignName",
      "campaignStatus",
      "clicks",
      "costCents",
      "currencyCode",
      "customerId",
      "date",
      "googleConversionValueCents",
      "googleConversions",
      "impressions",
    ]);
  });
});

describe("reporting date arithmetic and time zones", () => {
  it("reads the account's calendar day, not the server's", () => {
    // 2026-08-11T03:00Z is still 2026-08-10 in New York.
    const instant = new Date("2026-08-11T03:00:00Z");
    expect(dateInTimeZone("UTC", instant)).toBe("2026-08-11");
    expect(dateInTimeZone("America/New_York", instant)).toBe("2026-08-10");
  });

  it("falls back to UTC for an unknown zone rather than throwing", () => {
    expect(dateInTimeZone("Not/AZone", new Date("2026-08-11T03:00:00Z"))).toBe("2026-08-11");
  });

  it("shifts calendar days across month boundaries", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("builds the default lookback ending TODAY in the account's zone", () => {
    const range = defaultSyncRange("America/New_York", 7, new Date("2026-08-11T03:00:00Z"));
    expect(range).toEqual({ startDate: "2026-08-04", endDate: "2026-08-10" });
  });

  it("maps a UTC period to the account-calendar days it overlaps", () => {
    const range = accountDayRangeForPeriod("America/Los_Angeles", {
      start: new Date("2026-08-01T00:00:00Z"),
      end: new Date("2026-08-31T23:59:59Z"),
    });
    // LA is behind UTC, so the period BEGINS on the previous LA calendar day.
    expect(range.startDate).toBe("2026-07-31");
    expect(range.endDate).toBe("2026-08-31");
  });

  it("flags any non-UTC zone as capable of disagreeing with UTC", () => {
    expect(timeZoneDiffersFromUtc("UTC")).toBe(false);
    expect(timeZoneDiffersFromUtc("Etc/UTC")).toBe(false);
    // London sits at UTC+0 in winter and UTC+1 in summer — still flagged.
    expect(timeZoneDiffersFromUtc("Europe/London")).toBe(true);
    expect(timeZoneDiffersFromUtc("America/New_York")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

describe("the query set is closed and read-only", () => {
  it("builds only SELECT queries", () => {
    expect(ACCOUNT_INFO_QUERY.trim().startsWith("SELECT")).toBe(true);
    expect(buildCampaignDailyQuery("2026-08-01", "2026-08-07").trim().startsWith("SELECT")).toBe(true);
  });

  it("requests only the fields the business questions need — no user identifiers", () => {
    const query = buildCampaignDailyQuery("2026-08-01", "2026-08-07");
    for (const forbidden of ["click_view", "gclid", "user_", "audience", "customer.id AS"]) {
      expect(query).not.toContain(forbidden);
    }
    expect(query).toContain("metrics.cost_micros");
    expect(query).toContain("segments.date");
  });

  it("refuses a malformed date instead of interpolating it", () => {
    expect(() => buildCampaignDailyQuery("2026-8-1", "2026-08-07")).toThrow(GoogleAdsError);
    expect(() => buildCampaignDailyQuery("2026-02-30", "2026-03-01")).toThrow(GoogleAdsError);
    // The injection case: nothing but ten digits-and-dashes can reach GAQL.
    expect(() => buildCampaignDailyQuery("2026-08-01' OR '1'='1", "2026-08-07")).toThrow(GoogleAdsError);
  });

  it("refuses a backwards or oversized range", () => {
    expect(() => assertDateRange("2026-08-07", "2026-08-01")).toThrow(GoogleAdsError);
    expect(() => assertDateRange("2020-01-01", "2026-08-01")).toThrow(GoogleAdsError);
  });
});

/* ------------------------------------------------------------------ */
/* Transport: pagination + normalized errors (stub fetch)              */
/* ------------------------------------------------------------------ */

const jsonResponse = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });

const tokenResponse = () => jsonResponse({ access_token: "ya29.fake", expires_in: 3600 });

function stubFetch(handlers: { token?: () => Response; search: (call: number) => Response }) {
  let searchCalls = 0;
  const seen: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    seen.push({ url: href, init });
    if (href.includes("oauth2")) return (handlers.token ?? tokenResponse)();
    return handlers.search(searchCalls++);
  }) as unknown as typeof fetch;
  return { impl, seen };
}

describe("transport", () => {
  const credentials = resolveCredentials(ENV)!;

  it("addresses ONLY the googleAds:search endpoint", async () => {
    const { impl, seen } = stubFetch({
      search: () => jsonResponse({ results: [{ customer: { id: "1234567890", currencyCode: "USD", timeZone: "UTC" } }] }),
    });
    const provider = new LiveGoogleAdsReportingProvider(credentials, { fetchImpl: impl });
    await provider.getAccountInfo();
    const searchCalls = seen.filter((c) => !c.url.includes("oauth2"));
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0].url).toBe("https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search");
    expect(searchCalls[0].url).not.toContain("mutate");
  });

  it("sends the developer token and login-customer-id as headers, never in the URL", async () => {
    const { impl, seen } = stubFetch({
      search: () => jsonResponse({ results: [{ customer: { id: "1", currencyCode: "USD", timeZone: "UTC" } }] }),
    });
    const withManager = resolveCredentials({ ...ENV, GOOGLE_ADS_LOGIN_CUSTOMER_ID: "9998887777" })!;
    await new LiveGoogleAdsReportingProvider(withManager, { fetchImpl: impl }).getAccountInfo();
    const call = seen.find((c) => !c.url.includes("oauth2"))!;
    const headers = call.init!.headers as Record<string, string>;
    expect(headers["developer-token"]).toBe("dev-token");
    expect(headers["login-customer-id"]).toBe("9998887777");
    expect(call.url).not.toContain("dev-token");
  });

  it("follows pagination and returns every page's rows", async () => {
    const { impl } = stubFetch({
      search: (call) =>
        call === 0
          ? jsonResponse({ results: [{ customer: { id: "1", currencyCode: "USD", timeZone: "UTC" } }] })
          : call === 1
            ? jsonResponse({
                results: [{ campaign: { id: "1", name: "A" }, segments: { date: "2026-08-01" }, metrics: {} }],
                nextPageToken: "page-2",
              })
            : jsonResponse({
                results: [{ campaign: { id: "2", name: "B" }, segments: { date: "2026-08-02" }, metrics: {} }],
              }),
    });
    const report = await new LiveGoogleAdsReportingProvider(credentials, { fetchImpl: impl }).getCampaignDailyMetrics(
      "2026-08-01",
      "2026-08-02",
    );
    expect(report.rows.map((r) => r.campaignId)).toEqual(["1", "2"]);
    expect(report.pagesFetched).toBe(2);
    expect(report.truncated).toBe(false);
  });

  it("fails when the account reports no currency or time zone — neither may be guessed", async () => {
    const { impl } = stubFetch({ search: () => jsonResponse({ results: [{ customer: { id: "1" } }] }) });
    await expect(new LiveGoogleAdsReportingProvider(credentials, { fetchImpl: impl }).getAccountInfo()).rejects.toThrow(
      GoogleAdsError,
    );
  });

  it.each([
    [401, "", "AUTHENTICATION_FAILED"],
    [403, "", "AUTHORIZATION_FAILED"],
    [403, '{"error":{"details":[{"errors":[{"errorCode":{"quotaError":"RESOURCE_EXHAUSTED"}}]}]}}', "QUOTA_EXCEEDED"],
    [429, "", "RATE_LIMITED"],
    [500, "", "NETWORK_ERROR"],
    [400, "", "REPORTING_ERROR"],
    [404, "", "API_VERSION_UNSUPPORTED"],
    [404, '{"error":{"message":"customer not found"}}', "INVALID_CUSTOMER"],
    [400, '{"error":{"message":"developer_token is invalid"}}', "DEVELOPER_TOKEN_ERROR"],
  ])("normalizes HTTP %i into %s", async (status, body, expected) => {
    const { impl } = stubFetch({
      search: () => new Response(body, { status, headers: { "request-id": "req-123" } }),
    });
    const provider = new LiveGoogleAdsReportingProvider(credentials, { fetchImpl: impl });
    await expect(provider.getAccountInfo()).rejects.toMatchObject({ code: expected });
  });

  it("preserves Google's request id for support, and no credential", async () => {
    const { impl } = stubFetch({
      search: () => new Response("", { status: 401, headers: { "request-id": "req-abc" } }),
    });
    try {
      await new LiveGoogleAdsReportingProvider(credentials, { fetchImpl: impl }).getAccountInfo();
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as GoogleAdsError;
      expect(e.requestId).toBe("req-abc");
      expect(e.message).not.toContain("dev-token");
      expect(e.message).not.toContain("ya29");
    }
  });

  it("turns an OAuth refresh failure into AUTHENTICATION_FAILED without echoing the body", async () => {
    const { impl } = stubFetch({
      token: () => jsonResponse({ error: "invalid_grant", client_id: "client-id" }, { status: 400 }),
      search: () => jsonResponse({}),
    });
    try {
      await new LiveGoogleAdsReportingProvider(credentials, { fetchImpl: impl }).getAccountInfo();
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as GoogleAdsError;
      expect(e.code).toBe("AUTHENTICATION_FAILED");
      expect(e.message).not.toContain("client-id");
      expect(e.message).not.toContain("invalid_grant");
    }
  });

  it("refuses to send anything that is not a SELECT, even if one reached the transport", async () => {
    const { impl } = stubFetch({ search: () => jsonResponse({ results: [] }) });
    const { searchGoogleAds } = await import("@/lib/google-ads/client");
    await expect(
      searchGoogleAds(credentials, "1234567890", "UPDATE campaign SET status = 'PAUSED'", { fetchImpl: impl }),
    ).rejects.toMatchObject({ code: "REPORTING_ERROR" });
  });
});

describe("error redaction", () => {
  it("strips tokens from any message that could be persisted or displayed", () => {
    expect(redact("Bearer ya29.abcdef")).not.toContain("ya29.abcdef");
    expect(redact('{"refresh_token":"1//0gSecret"}')).not.toContain("0gSecret");
    expect(redact("developer-token: abc123")).not.toContain("abc123");
  });
});

/* ------------------------------------------------------------------ */
/* Fake provider                                                       */
/* ------------------------------------------------------------------ */

describe("FakeGoogleAdsReportingProvider", () => {
  it("returns only rows inside the requested range", async () => {
    const provider = new FakeGoogleAdsReportingProvider({
      days: [day({ date: "2026-08-01" }), day({ date: "2026-08-05" }), day({ date: "2026-08-20" })],
    });
    const report = await provider.getCampaignDailyMetrics("2026-08-01", "2026-08-10");
    expect(report.rows.map((r) => r.date)).toEqual(["2026-08-01", "2026-08-05"]);
  });

  it("exposes the same READ-ONLY surface as the live provider", () => {
    const fake = new FakeGoogleAdsReportingProvider();
    const live = new LiveGoogleAdsReportingProvider(resolveCredentials(ENV)!);
    const surfaceOf = (o: object) =>
      Object.getOwnPropertyNames(Object.getPrototypeOf(o)).filter((n) => n !== "constructor").sort();
    expect(surfaceOf(fake)).toEqual(surfaceOf(live));
    expect(surfaceOf(live)).toEqual(["getAccountInfo", "getCampaignDailyMetrics", "status"]);
  });
});
