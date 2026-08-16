import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeGoogleAdsReportingProvider,
  GoogleAdsError,
  runGoogleAdsSync,
  testGoogleAdsConnection,
} from "@/lib/google-ads";
import {
  getConnectedAdAccount,
  getLastSuccessfulSyncRun,
  getLastSyncRun,
  latestMetricDate,
  listCampaignDailyMetrics,
  listSyncRuns,
} from "@/lib/data/google-ads-service";
import { deriveFreshness } from "@/modules/google-ads-intelligence";
import { resetDb } from "./db-helpers";
import { day } from "./gads-helpers";

/**
 * Session 13 — sync tests (spec §62).
 *
 * IDEMPOTENCY AND RESTATEMENT ARE THE POINT. A sync that ran twice must not
 * double spend, and Google's revision of a recent day must UPDATE that day
 * rather than append a second copy of it. Both are asserted against the real
 * database through the real service.
 */

const NOW = new Date("2026-08-15T12:00:00Z");
const totalSpend = async (accountId: string, from = "2026-08-01", to = "2026-08-31") =>
  (await listCampaignDailyMetrics(accountId, from, to)).reduce((sum, r) => sum + r.costCents, 0);

beforeEach(async () => {
  await resetDb();
});

describe("first sync", () => {
  it("persists the account, its currency and its time zone, then the rows", async () => {
    const provider = new FakeGoogleAdsReportingProvider({
      account: { currencyCode: "CAD", timeZone: "America/Toronto" },
      days: [day({ date: "2026-08-14" }), day({ date: "2026-08-15", campaignId: "222", campaignName: "Cafe Bags" })],
    });

    const result = await runGoogleAdsSync({ provider, triggeredBy: "admin:test", now: NOW, lookbackDays: 7 });
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("unreachable");
    expect(result.rowsInserted).toBe(2);
    expect(result.rowsUpdated).toBe(0);

    const account = await getConnectedAdAccount();
    expect(account?.currencyCode).toBe("CAD");
    expect(account?.timeZone).toBe("America/Toronto");
    expect(account?.lastSuccessfulSyncAt?.toISOString()).toBe(NOW.toISOString());
    expect(await latestMetricDate(account!.id)).toBe("2026-08-15");
  });

  it("uses the ACCOUNT's calendar for the default lookback window", async () => {
    const provider = new FakeGoogleAdsReportingProvider({
      account: { timeZone: "America/Los_Angeles" },
      days: [],
    });
    // 2026-08-15T12:00Z is 05:00 on 2026-08-15 in Los Angeles.
    const result = await runGoogleAdsSync({ provider, triggeredBy: "admin:test", now: NOW, lookbackDays: 7 });
    if (result.status !== "success") throw new Error("unreachable");
    expect(result.endDate).toBe("2026-08-15");
    expect(result.startDate).toBe("2026-08-09");
  });

  it("keeps ZERO-SPEND campaigns — no spend is a finding, not an absence", async () => {
    const provider = new FakeGoogleAdsReportingProvider({
      days: [day({ campaignId: "333", campaignName: "Paused Test", costCents: 0, clicks: 0, impressions: 0 })],
    });
    const result = await runGoogleAdsSync({ provider, triggeredBy: "admin:test", now: NOW });
    if (result.status !== "success") throw new Error("unreachable");
    const account = await getConnectedAdAccount();
    const rows = await listCampaignDailyMetrics(account!.id, "2026-07-01", "2026-08-31");
    expect(rows).toHaveLength(1);
    expect(rows[0].costCents).toBe(0);
  });
});

describe("idempotency and restatement", () => {
  it("running the same sync twice does NOT double spend", async () => {
    const provider = new FakeGoogleAdsReportingProvider({ days: [day({ date: "2026-08-14", costCents: 12_500 })] });

    const first = await runGoogleAdsSync({ provider, triggeredBy: "admin:test", now: NOW });
    const second = await runGoogleAdsSync({ provider, triggeredBy: "admin:test", now: NOW });
    if (first.status !== "success" || second.status !== "success") throw new Error("unreachable");

    expect(first.rowsInserted).toBe(1);
    expect(second.rowsInserted).toBe(0);
    expect(second.rowsUpdated).toBe(1);

    const account = await getConnectedAdAccount();
    expect(await totalSpend(account!.id)).toBe(12_500);
    expect(await listCampaignDailyMetrics(account!.id, "2026-08-01", "2026-08-31")).toHaveLength(1);
  });

  it("a RESTATED day overwrites in place — the period total moves, it does not accumulate", async () => {
    const account0 = new FakeGoogleAdsReportingProvider({
      days: [day({ date: "2026-08-14", costCents: 12_500, googleConversions: 2 })],
    });
    await runGoogleAdsSync({ provider: account0, triggeredBy: "admin:test", now: NOW });

    // Google revises the same day upward as delayed conversions arrive.
    const restated = new FakeGoogleAdsReportingProvider({
      days: [day({ date: "2026-08-14", costCents: 12_900, googleConversions: 3.5 })],
    });
    const second = await runGoogleAdsSync({ provider: restated, triggeredBy: "admin:test", now: NOW });
    if (second.status !== "success") throw new Error("unreachable");
    expect(second.rowsUpdated).toBe(1);
    expect(second.rowsInserted).toBe(0);

    const account = await getConnectedAdAccount();
    const rows = await listCampaignDailyMetrics(account!.id, "2026-08-01", "2026-08-31");
    expect(rows).toHaveLength(1);
    expect(rows[0].costCents).toBe(12_900);
    expect(rows[0].googleConversions).toBeCloseTo(3.5);
  });

  it("keeps separate rows per campaign AND per day", async () => {
    const provider = new FakeGoogleAdsReportingProvider({
      days: [
        day({ campaignId: "111", date: "2026-08-13", costCents: 100 }),
        day({ campaignId: "111", date: "2026-08-14", costCents: 200 }),
        day({ campaignId: "222", date: "2026-08-13", costCents: 400 }),
      ],
    });
    await runGoogleAdsSync({ provider, triggeredBy: "admin:test", now: NOW });
    const account = await getConnectedAdAccount();
    expect(await listCampaignDailyMetrics(account!.id, "2026-08-01", "2026-08-31")).toHaveLength(3);
    expect(await totalSpend(account!.id)).toBe(700);
  });

  it("only returns rows inside the requested reporting window", async () => {
    const provider = new FakeGoogleAdsReportingProvider({
      days: [day({ date: "2026-08-14" }), day({ date: "2026-08-15", campaignId: "222" })],
    });
    await runGoogleAdsSync({
      provider,
      startDate: "2026-08-14",
      endDate: "2026-08-14",
      triggeredBy: "admin:test",
      now: NOW,
    });
    const account = await getConnectedAdAccount();
    const rows = await listCampaignDailyMetrics(account!.id, "2026-08-01", "2026-08-31");
    expect(rows.map((r) => r.date)).toEqual(["2026-08-14"]);
  });
});

describe("failure isolation", () => {
  it("a FAILED sync leaves previously synced data and its timestamp untouched", async () => {
    const good = new FakeGoogleAdsReportingProvider({ days: [day({ date: "2026-08-14", costCents: 12_500 })] });
    await runGoogleAdsSync({ provider: good, triggeredBy: "admin:test", now: NOW });
    const before = await getConnectedAdAccount();

    const failing = new FakeGoogleAdsReportingProvider({
      days: [day({ date: "2026-08-14", costCents: 12_500 })],
      failReportsWith: new GoogleAdsError("RATE_LIMITED", "Google Ads returned HTTP 429 (RATE_LIMITED)."),
    });
    const later = new Date("2026-08-16T12:00:00Z");
    const result = await runGoogleAdsSync({ provider: failing, triggeredBy: "admin:test", now: later });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.errorCode).toBe("RATE_LIMITED");

    const after = await getConnectedAdAccount();
    // Data intact, and freshness NOT advanced.
    expect(await totalSpend(after!.id)).toBe(12_500);
    expect(after?.lastSuccessfulSyncAt?.toISOString()).toBe(before?.lastSuccessfulSyncAt?.toISOString());
  });

  it("records a failed run in the audit trail with a normalized, credential-free message", async () => {
    const failing = new FakeGoogleAdsReportingProvider({
      failWith: new GoogleAdsError("AUTHENTICATION_FAILED", "Google rejected the OAuth refresh token (HTTP 400)."),
    });
    await runGoogleAdsSync({ provider: failing, triggeredBy: "admin:owner", now: NOW });

    const runs = await listSyncRuns(5);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].errorCode).toBe("AUTHENTICATION_FAILED");
    expect(runs[0].triggeredBy).toBe("admin:owner");
    expect(runs[0].errorMessage).not.toMatch(/ya29|refresh_token|client_secret/);
    expect(await getLastSuccessfulSyncRun()).toBeNull();
  });

  it("a TRUNCATED report is PARTIAL — data is kept, freshness is not claimed", async () => {
    const provider = new FakeGoogleAdsReportingProvider({
      days: [day({ date: "2026-08-14", costCents: 900 })],
      truncated: true,
    });
    const result = await runGoogleAdsSync({ provider, triggeredBy: "admin:test", now: NOW });
    expect(result.status).toBe("partial");

    const account = await getConnectedAdAccount();
    expect(await totalSpend(account!.id)).toBe(900); // rows kept
    expect(account?.lastSuccessfulSyncAt).toBeNull(); // freshness NOT advanced
    expect((await getLastSyncRun())?.status).toBe("partial");
  });

  it("NOT CONNECTED is not a failure and writes no run row", async () => {
    const result = await runGoogleAdsSync({ provider: null, triggeredBy: "admin:test", now: NOW });
    expect(result.status).toBe("not_connected");
    expect(await listSyncRuns(5)).toEqual([]);
    expect(await getConnectedAdAccount()).toBeNull();
  });

  it("refuses an oversized range before consuming any quota", async () => {
    const provider = new FakeGoogleAdsReportingProvider({ days: [] });
    const result = await runGoogleAdsSync({
      provider,
      startDate: "2020-01-01",
      endDate: "2026-08-15",
      triggeredBy: "admin:test",
      now: NOW,
    });
    expect(result.status).toBe("failed");
    expect(provider.calls.campaignDaily).toBe(0);
  });
});

describe("freshness derivation", () => {
  const base = { connected: true, latestMetricDate: "2026-08-15", now: NOW };

  it("is FRESH just after a complete sync", async () => {
    const provider = new FakeGoogleAdsReportingProvider({ days: [day({ date: "2026-08-15" })] });
    await runGoogleAdsSync({ provider, triggeredBy: "admin:test", now: NOW });
    const freshness = deriveFreshness({
      ...base,
      account: await getConnectedAdAccount(),
      lastSuccessfulRun: await getLastSuccessfulSyncRun(),
      lastRun: await getLastSyncRun(),
    });
    expect(freshness.state).toBe("FRESH");
    expect(freshness.provisionalFromDate).toBe("2026-08-13");
  });

  it("is STALE once the last complete sync ages past the threshold", async () => {
    const provider = new FakeGoogleAdsReportingProvider({ days: [day({ date: "2026-08-15" })] });
    await runGoogleAdsSync({ provider, triggeredBy: "admin:test", now: NOW });
    const freshness = deriveFreshness({
      ...base,
      now: new Date("2026-08-20T12:00:00Z"),
      account: await getConnectedAdAccount(),
      lastSuccessfulRun: await getLastSuccessfulSyncRun(),
      lastRun: await getLastSyncRun(),
    });
    expect(freshness.state).toBe("STALE");
    expect(freshness.reason).toMatch(/not "today"|freshness/i);
  });

  it("SYNC_FAILED outranks age, and says the shown data is the last good copy", async () => {
    const good = new FakeGoogleAdsReportingProvider({ days: [day({ date: "2026-08-15" })] });
    await runGoogleAdsSync({ provider: good, triggeredBy: "admin:test", now: NOW });
    const failing = new FakeGoogleAdsReportingProvider({
      failReportsWith: new GoogleAdsError("QUOTA_EXCEEDED", "quota"),
    });
    await runGoogleAdsSync({ provider: failing, triggeredBy: "admin:test", now: NOW });

    const freshness = deriveFreshness({
      ...base,
      account: await getConnectedAdAccount(),
      lastSuccessfulRun: await getLastSuccessfulSyncRun(),
      lastRun: await getLastSyncRun(),
    });
    expect(freshness.state).toBe("SYNC_FAILED");
    expect(freshness.reason).toMatch(/NOT been replaced by zeros/);
    expect(freshness.lastSuccessfulSyncAt).not.toBeNull();
  });

  it("NOT_CONNECTED never reports an age or implies zero", () => {
    const freshness = deriveFreshness({
      connected: false,
      account: null,
      lastSuccessfulRun: null,
      lastRun: null,
      latestMetricDate: null,
      now: NOW,
    });
    expect(freshness.state).toBe("NOT_CONNECTED");
    expect(freshness.ageHours).toBeNull();
    expect(freshness.reason).toMatch(/nothing to be fresh or stale/);
  });
});

describe("connection test", () => {
  it("performs the smallest read and persists the account identity", async () => {
    const provider = new FakeGoogleAdsReportingProvider({
      account: { descriptiveName: "BagDirect Ads", currencyCode: "USD", timeZone: "America/New_York" },
    });
    const result = await testGoogleAdsConnection({ provider });
    expect(result.status).toBe("connected");
    if (result.status !== "connected") throw new Error("unreachable");
    expect(result.currencyCode).toBe("USD");
    expect(provider.calls.campaignDaily).toBe(0); // no metrics were fetched
    expect((await getConnectedAdAccount())?.descriptiveName).toBe("BagDirect Ads");
  });

  it("reports NOT CONFIGURED (not an error) when there are no credentials", async () => {
    const result = await testGoogleAdsConnection({ provider: null });
    expect(result.status).toBe("not_configured");
    if (result.status !== "not_configured") throw new Error("unreachable");
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it("returns a normalized failure without leaking provider internals", async () => {
    const provider = new FakeGoogleAdsReportingProvider({
      failWith: new GoogleAdsError("DEVELOPER_TOKEN_ERROR", "Google Ads returned HTTP 400 (DEVELOPER_TOKEN_ERROR)."),
    });
    const result = await testGoogleAdsConnection({ provider });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.errorCode).toBe("DEVELOPER_TOKEN_ERROR");
    expect(result.message).not.toMatch(/ya29|secret|token=/i);
  });

  it("surfaces a TEST account so no one reads its figures as real", async () => {
    const provider = new FakeGoogleAdsReportingProvider({ account: { isTestAccount: true } });
    const result = await testGoogleAdsConnection({ provider });
    if (result.status !== "connected") throw new Error("unreachable");
    expect(result.isTestAccount).toBe(true);
    expect((await getConnectedAdAccount())?.isTestAccount).toBe(true);
  });
});
