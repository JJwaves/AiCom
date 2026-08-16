import { GOOGLE_ADS } from "@/config/google-ads";
import {
  finishSyncRun,
  getConnectedAdAccount,
  GOOGLE_ADS_PLATFORM,
  markAccountSynced,
  startSyncRun,
  upsertAdAccount,
  upsertCampaignDailyMetrics,
  type SyncRunRow,
} from "@/lib/data/google-ads-service";
import { defaultSyncRange } from "@/modules/google-ads-intelligence/dates";
import { GoogleAdsError, isGoogleAdsError, redact } from "./errors";
import { assertDateRange } from "./queries";
import { resolveReportingProvider, type GoogleAdsReportingProvider } from "./reporting-provider";

/**
 * Explicit Google Ads sync (Session 13 spec §11, §12, §46).
 *
 * Runs ONLY from the authenticated admin action. There is no scheduler, no
 * cron, and no page render that triggers it (spec §10, §11) — a dashboard
 * load reads persisted rows and never the API.
 *
 * Failure semantics, deliberately three-valued:
 *
 *   SUCCESS  — the account read and the full report both succeeded. This is
 *              the ONLY outcome that advances `lastSuccessfulSyncAt`.
 *   PARTIAL  — the account identity was read but the report was truncated
 *              by a row/page cap, so the window is knowingly incomplete.
 *              Data is kept; freshness is NOT advanced (spec §46).
 *   FAILED   — nothing usable arrived. PREVIOUSLY SYNCED DATA IS UNTOUCHED
 *              and keeps its original timestamp; the failure is recorded so
 *              the dashboard can say "stale, and here is why" instead of
 *              showing zeros (spec §18).
 *
 * A failed or partial sync never deletes a row and never writes a zero.
 */

export type SyncOutcome =
  | {
      status: "success" | "partial";
      run: SyncRunRow;
      startDate: string;
      endDate: string;
      rowsFetched: number;
      rowsInserted: number;
      rowsUpdated: number;
      truncated: boolean;
      account: { customerId: string; currencyCode: string; timeZone: string; isTestAccount: boolean };
    }
  | { status: "not_connected"; reason: string }
  | { status: "failed"; run: SyncRunRow | null; errorCode: string; message: string };

export type SyncOptions = {
  /** Injected in tests and by the dev fake provider. Never a live client. */
  provider?: GoogleAdsReportingProvider | null;
  /** Explicit range; omitted ⇒ the documented default lookback. */
  startDate?: string;
  endDate?: string;
  lookbackDays?: number;
  /** Server-derived actor, e.g. "admin:owner". Never client-supplied. */
  triggeredBy: string;
  /** Injected clock for deterministic tests. */
  now?: Date;
};

export async function runGoogleAdsSync(options: SyncOptions): Promise<SyncOutcome> {
  const now = options.now ?? new Date();
  const provider = options.provider !== undefined ? options.provider : resolveReportingProvider();
  if (!provider) {
    // NOT CONNECTED is not a failure and is never recorded as one — there is
    // nothing to be stale about, and it must never read as zero spend.
    return {
      status: "not_connected",
      reason: "Google Ads credentials are not configured, so there is nothing to sync.",
    };
  }

  /* ---- Account identity first: it supplies the time zone the range is
   * expressed in, and the currency every stored figure is denominated in.
   * Doing it first also means a credential problem fails before any
   * reporting quota is consumed. ---- */
  let account;
  try {
    account = await provider.getAccountInfo();
  } catch (err) {
    return failWithoutRun(err, options, now);
  }

  const range = resolveRange(options, account.timeZone, now);
  try {
    assertDateRange(range.startDate, range.endDate);
  } catch (err) {
    return failWithoutRun(err, options, now);
  }

  const status = provider.status();
  const apiVersion = status.configured ? status.apiVersion : null;

  const accountRow = await upsertAdAccount({
    platform: GOOGLE_ADS_PLATFORM,
    externalAccountId: account.customerId,
    descriptiveName: account.descriptiveName,
    currencyCode: account.currencyCode,
    timeZone: account.timeZone,
    isManager: account.isManager,
    isTestAccount: account.isTestAccount,
    loginCustomerId: account.loginCustomerId,
    apiVersion,
  });

  const run = await startSyncRun({
    adAccountId: accountRow.id,
    externalAccountId: account.customerId,
    apiVersion,
    requestedStartDate: range.startDate,
    requestedEndDate: range.endDate,
    triggeredBy: options.triggeredBy,
  });

  let report;
  try {
    report = await provider.getCampaignDailyMetrics(range.startDate, range.endDate);
  } catch (err) {
    const normalized = normalize(err);
    const finished = await finishSyncRun(run.id, {
      status: "failed",
      adAccountId: accountRow.id,
      errorCode: normalized.code,
      errorMessage: normalized.message,
      providerRequestId: normalized.requestId,
    });
    // Deliberately NOT calling markAccountSynced: previously stored metrics
    // stay exactly as they were, with their original timestamp.
    return { status: "failed", run: finished, errorCode: normalized.code, message: normalized.message };
  }

  const { inserted, updated } = await upsertCampaignDailyMetrics(
    accountRow.id,
    report.rows.map((r) => ({
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      campaignStatus: r.campaignStatus,
      advertisingChannelType: r.advertisingChannelType,
      date: r.date,
      impressions: r.impressions,
      clicks: r.clicks,
      costCents: r.costCents,
      currencyCode: r.currencyCode,
      googleConversions: r.googleConversions,
      googleConversionValueCents: r.googleConversionValueCents,
    })),
    run.id,
  );

  const outcomeStatus: "success" | "partial" = report.truncated ? "partial" : "success";
  const finished = await finishSyncRun(run.id, {
    status: outcomeStatus,
    adAccountId: accountRow.id,
    rowsFetched: report.rows.length,
    rowsInserted: inserted,
    rowsUpdated: updated,
    truncated: report.truncated,
  });

  // Only a COMPLETE sync advances freshness (spec §46).
  if (outcomeStatus === "success") await markAccountSynced(accountRow.id, now);

  return {
    status: outcomeStatus,
    run: finished ?? run,
    startDate: range.startDate,
    endDate: range.endDate,
    rowsFetched: report.rows.length,
    rowsInserted: inserted,
    rowsUpdated: updated,
    truncated: report.truncated,
    account: {
      customerId: account.customerId,
      currencyCode: account.currencyCode,
      timeZone: account.timeZone,
      isTestAccount: account.isTestAccount,
    },
  };
}

function resolveRange(options: SyncOptions, timeZone: string, now: Date): { startDate: string; endDate: string } {
  if (options.startDate && options.endDate) {
    return { startDate: options.startDate, endDate: options.endDate };
  }
  return defaultSyncRange(timeZone, options.lookbackDays ?? GOOGLE_ADS.DEFAULT_SYNC_LOOKBACK_DAYS, now);
}

/**
 * A failure before the account was resolved.
 *
 * A run row is still written when we know enough to write one, so a failing
 * credential shows up in the sync history instead of vanishing — "I pressed
 * sync and nothing happened" must always have an answer.
 */
async function failWithoutRun(err: unknown, options: SyncOptions, now: Date): Promise<SyncOutcome> {
  const normalized = normalize(err);
  const existing = await getConnectedAdAccount();
  const timeZone = existing?.timeZone ?? "UTC";
  const range = resolveRange(options, timeZone, now);
  let run: SyncRunRow | null = null;
  try {
    const started = await startSyncRun({
      adAccountId: existing?.id ?? null,
      externalAccountId: existing?.externalAccountId ?? null,
      apiVersion: null,
      requestedStartDate: range.startDate,
      requestedEndDate: range.endDate,
      triggeredBy: options.triggeredBy,
    });
    run = await finishSyncRun(started.id, {
      status: "failed",
      errorCode: normalized.code,
      errorMessage: normalized.message,
      providerRequestId: normalized.requestId,
    });
  } catch {
    /* audit persistence must never mask the original failure */
  }
  return { status: "failed", run, errorCode: normalized.code, message: normalized.message };
}

function normalize(err: unknown): { code: string; message: string; requestId: string | null } {
  if (isGoogleAdsError(err)) return { code: err.code, message: err.message, requestId: err.requestId };
  if (err instanceof GoogleAdsError) return { code: err.code, message: err.message, requestId: null };
  return {
    code: "REPORTING_ERROR",
    message: redact(err instanceof Error ? err.message : "Unknown Google Ads failure."),
    requestId: null,
  };
}

/* ------------------------------------------------------------------ */
/* Connection test (spec §47)                                          */
/* ------------------------------------------------------------------ */

export type ConnectionTestResult =
  | {
      status: "connected";
      customerId: string;
      descriptiveName: string | null;
      currencyCode: string;
      timeZone: string;
      isManager: boolean;
      isTestAccount: boolean;
      loginCustomerId: string | null;
      apiVersion: string | null;
    }
  | { status: "not_configured"; missing: string[]; invalid: string[] }
  | { status: "failed"; errorCode: string; message: string };

/**
 * "Test Google Ads Connection" — the SMALLEST read-only call that proves the
 * credentials work: one `customer` row.
 *
 * It performs no mutation, fetches no metrics, and consumes essentially no
 * quota. It also PERSISTS the account row, because the currency and time
 * zone it returns are exactly what the rest of the system needs before any
 * metric can be interpreted.
 */
export async function testGoogleAdsConnection(
  opts: { provider?: GoogleAdsReportingProvider | null } = {},
): Promise<ConnectionTestResult> {
  const provider = opts.provider !== undefined ? opts.provider : resolveReportingProvider();
  if (!provider) {
    const { reportingProviderStatus } = await import("./reporting-provider");
    const status = reportingProviderStatus();
    return {
      status: "not_configured",
      missing: status.configured ? [] : status.missing,
      invalid: status.configured ? [] : status.invalid,
    };
  }

  try {
    const account = await provider.getAccountInfo();
    const status = provider.status();
    const apiVersion = status.configured ? status.apiVersion : null;
    await upsertAdAccount({
      platform: GOOGLE_ADS_PLATFORM,
      externalAccountId: account.customerId,
      descriptiveName: account.descriptiveName,
      currencyCode: account.currencyCode,
      timeZone: account.timeZone,
      isManager: account.isManager,
      isTestAccount: account.isTestAccount,
      loginCustomerId: account.loginCustomerId,
      apiVersion,
    });
    return {
      status: "connected",
      customerId: account.customerId,
      descriptiveName: account.descriptiveName,
      currencyCode: account.currencyCode,
      timeZone: account.timeZone,
      isManager: account.isManager,
      isTestAccount: account.isTestAccount,
      loginCustomerId: account.loginCustomerId,
      apiVersion,
    };
  } catch (err) {
    const normalized = normalize(err);
    return { status: "failed", errorCode: normalized.code, message: normalized.message };
  }
}
