import { GOOGLE_ADS } from "@/config/google-ads";
import { getLatestGoogleAdsReport, type GoogleAdsReportRow } from "@/lib/data/google-ads-report-service";
import type { Period } from "@/modules/customer-intelligence/period";
import type { CredentialSnapshot } from "./connection";
import { buildGoogleAdsIntelligenceSnapshot, type GoogleAdsIntelligenceSnapshot } from "./snapshot";

/**
 * Admin report assembly (Session 13 spec §10, §31, §54).
 *
 * Deterministic Google Ads analytics load with NO model call AND NO Google
 * Ads API call. The agent narrative is whatever the last explicit "Generate
 * Google Ads review" action persisted (or null), so a provider outage, an
 * exhausted AI budget, a disabled flag or an expired Google credential never
 * darkens the dashboard — it only changes which honest state it shows.
 *
 * Syncing deliberately does NOT trigger an AI review (spec §54): the owner
 * decides when to spend tokens, and deterministic figures update the moment
 * the sync finishes.
 */

export type GoogleAdsIntelligenceReport = {
  snapshot: GoogleAdsIntelligenceSnapshot;
  /** Latest persisted review for this period length; null = never generated. */
  adsReport: GoogleAdsReportRow | null;
  /** True when the persisted review covers an older window than the snapshot. */
  adsReportStale: boolean;
  thresholds: typeof GOOGLE_ADS;
};

export async function buildGoogleAdsIntelligenceReport(
  period: Period,
  credentials: CredentialSnapshot,
  now: Date = new Date(),
): Promise<GoogleAdsIntelligenceReport> {
  const [snapshot, adsReport] = await Promise.all([
    buildGoogleAdsIntelligenceSnapshot(period, credentials, now),
    getLatestGoogleAdsReport(period.days),
  ]);
  const adsReportStale =
    adsReport !== null && period.end.getTime() - adsReport.periodEnd.getTime() > 24 * 60 * 60 * 1000;
  return { snapshot, adsReport, adsReportStale, thresholds: GOOGLE_ADS };
}
