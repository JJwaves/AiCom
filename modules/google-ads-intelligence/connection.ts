import { GOOGLE_ADS } from "@/config/google-ads";
import type { AdAccountRow, SyncRunRow } from "@/lib/data/google-ads-service";
import { addDays } from "./dates";
import type { ConnectionStatus, SyncFreshness } from "./types";

/**
 * Connection and freshness derivation (Session 13 spec §6, §28, §46).
 *
 * Pure functions over rows the caller already loaded. The deterministic
 * module never reads the environment and never imports `lib/google-ads`, so
 * the credential picture arrives as a plain input — which also makes every
 * state in this file trivially testable without touching a real credential.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE (spec §6, §18):
 *
 *   NOT CONNECTED ≠ ZERO SPEND.
 *   SYNC FAILED   ≠ ZERO SPEND.
 *   STALE         ≠ ZERO SPEND.
 *
 * Each is a distinct state with its own explanation, and none of them
 * produces a number. A caller that wants "how much did we spend?" must go
 * through the metrics, which only exist when data was actually synced.
 */

/**
 * The credential picture, as the deterministic module accepts it.
 *
 * Deliberately structural rather than an import of `GoogleAdsCredentialStatus`:
 * this module must not depend on the adapter. The caller maps
 * `reportingProviderStatus()` into this shape.
 */
export type CredentialSnapshot = {
  configured: boolean;
  /** Env var NAMES that are absent. Never values. */
  missing: string[];
  /** Env var NAMES whose value is unusable. Never values. */
  invalid: string[];
  customerId: string | null;
  apiVersion: string | null;
};

export function deriveConnectionStatus(
  credentials: CredentialSnapshot,
  account: AdAccountRow | null,
): ConnectionStatus {
  const accountInfo = account
    ? {
        customerId: account.externalAccountId,
        descriptiveName: account.descriptiveName,
        currencyCode: account.currencyCode,
        timeZone: account.timeZone,
        isManager: account.isManager,
        isTestAccount: account.isTestAccount,
        loginCustomerId: account.loginCustomerId,
      }
    : null;

  if (!credentials.configured) {
    const blockers = [...credentials.missing, ...credentials.invalid];
    const state = credentials.invalid.length > 0 ? "CONFIGURATION_INVALID" : "NOT_CONNECTED";
    return {
      state,
      reason:
        state === "CONFIGURATION_INVALID"
          ? `Google Ads is configured but not usable: ${credentials.invalid.join(", ")} ${credentials.invalid.length === 1 ? "is" : "are"} set to a value this integration cannot use. Until it is fixed, the platform has NO visibility into advertising — this is not zero spend.`
          : `Google Ads is not connected (${blockers.join(", ")} not set). The platform has NO visibility into advertising: it does not know whether you are spending anything, and every advertising figure on this page is absent rather than zero.`,
      missingConfiguration: blockers,
      account: accountInfo,
      apiVersion: account?.apiVersion ?? credentials.apiVersion,
    };
  }

  if (!account) {
    return {
      state: "NEVER_SYNCED",
      reason:
        "Google Ads credentials are configured, but the connection has never been tested and no data has been synced. Press “Test connection”, then “Sync Google Ads”.",
      missingConfiguration: [],
      account: null,
      apiVersion: credentials.apiVersion,
    };
  }

  return {
    state: "CONNECTED",
    reason: account.isTestAccount
      ? `Connected to Google Ads test account ${account.externalAccountId}. Test accounts serve no real traffic, so any spend and performance figures here are structural, not real.`
      : `Connected to Google Ads account ${account.externalAccountId}${account.descriptiveName ? ` (${account.descriptiveName})` : ""}, reporting in ${account.currencyCode}, ${account.timeZone} time.`,
    missingConfiguration: [],
    account: accountInfo,
    apiVersion: account.apiVersion ?? credentials.apiVersion,
  };
}

export function deriveFreshness(input: {
  connected: boolean;
  account: AdAccountRow | null;
  lastSuccessfulRun: SyncRunRow | null;
  lastRun: SyncRunRow | null;
  latestMetricDate: string | null;
  now: Date;
}): SyncFreshness {
  const { connected, account, lastSuccessfulRun, lastRun, latestMetricDate, now } = input;

  const lastSuccessfulSyncAt = account?.lastSuccessfulSyncAt ?? lastSuccessfulRun?.completedAt ?? null;
  const lastAttemptAt = lastRun?.startedAt ?? null;
  const ageHours =
    lastSuccessfulSyncAt === null
      ? null
      : Math.max(0, Math.round(((now.getTime() - lastSuccessfulSyncAt.getTime()) / 3_600_000) * 10) / 10);

  const provisionalFromDate = latestMetricDate
    ? addDays(latestMetricDate, -(GOOGLE_ADS.PROVISIONAL_TRAILING_DAYS - 1))
    : null;

  const base = {
    lastSuccessfulSyncAt,
    lastAttemptAt,
    lastAttemptStatus: lastRun?.status ?? null,
    lastErrorCode: lastRun?.errorCode ?? null,
    lastErrorMessage: lastRun?.errorMessage ?? null,
    latestMetricDate,
    ageHours,
    provisionalFromDate,
  };

  if (!connected) {
    return {
      ...base,
      state: "NOT_CONNECTED",
      reason: latestMetricDate
        ? `Google Ads credentials are no longer configured, so nothing can be synced. The figures shown are DATA WE PREVIOUSLY SYNCED, covering reporting days up to ${latestMetricDate}${lastSuccessfulSyncAt ? ` and last refreshed ${formatWhen(lastSuccessfulSyncAt)}` : ""} — they are real, but they stopped updating when the credentials went away.`
        : "Google Ads is not connected and nothing has ever been synced, so there is nothing to be fresh or stale. No advertising figure on this page is a measurement — and none of them is zero.",
    };
  }

  if (!lastSuccessfulSyncAt) {
    return {
      ...base,
      state: lastRun?.status === "failed" ? "SYNC_FAILED" : "STALE",
      reason:
        lastRun?.status === "failed"
          ? `No sync has ever completed successfully. The last attempt failed (${lastRun.errorCode ?? "unknown"}). There is no advertising data — not zero spend, no data.`
          : "Google Ads has never been synced, so no advertising data exists for any period yet.",
    };
  }

  /* A FAILED most-recent attempt outranks age: the owner needs to know the
   * data they are looking at is the last good copy, and why it stopped
   * updating (spec §18, §46). */
  if (lastRun?.status === "failed") {
    return {
      ...base,
      state: "SYNC_FAILED",
      reason: `The most recent sync failed (${lastRun.errorCode ?? "unknown"}). Everything below is the last successfully synced data, from ${formatWhen(lastSuccessfulSyncAt)} — it has NOT been replaced by zeros.`,
    };
  }

  if (lastRun?.status === "partial" || lastRun?.truncated) {
    return {
      ...base,
      state: "PARTIAL",
      reason: `The most recent sync returned more rows than it could fetch in one run, so this window is incomplete. The figures below understate the period, and freshness has deliberately not been advanced.`,
    };
  }

  if (ageHours !== null && ageHours > GOOGLE_ADS.STALE_MAX_AGE_HOURS) {
    return {
      ...base,
      state: "STALE",
      reason: `The last successful sync was ${formatWhen(lastSuccessfulSyncAt)} (${ageHours} hours ago), beyond the ${GOOGLE_ADS.STALE_MAX_AGE_HOURS}-hour freshness threshold. Recent spend is missing from these figures — they are not "today".`,
    };
  }

  if (ageHours !== null && ageHours > GOOGLE_ADS.FRESH_MAX_AGE_HOURS) {
    return {
      ...base,
      state: "STALE",
      reason: `The last successful sync was ${ageHours} hours ago, past the ${GOOGLE_ADS.FRESH_MAX_AGE_HOURS}-hour freshness window. Sync again before acting on today's numbers.`,
    };
  }

  return {
    ...base,
    state: "FRESH",
    reason: `Last synced ${formatWhen(lastSuccessfulSyncAt)}. Google revises the most recent ${GOOGLE_ADS.PROVISIONAL_TRAILING_DAYS} days as delayed conversions arrive, so those days are provisional even when the sync is fresh.`,
  };
}

const formatWhen = (d: Date): string => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
