import { GOOGLE_ADS, KEYWORDS_INGESTED, SEARCH_TERMS_INGESTED } from "@/config/google-ads";
import {
  getConnectedAdAccount,
  getLastSuccessfulSyncRun,
  getLastSyncRun,
  latestMetricDate as loadLatestMetricDate,
  listCampaignDailyMetrics,
  listMetricCurrencies,
  listSyncRuns,
  type AdAccountRow,
  type SyncRunRow,
} from "@/lib/data/google-ads-service";
import { loadConversationCorpus } from "@/modules/customer-intelligence/aggregate";
import { previousPeriod, type Period } from "@/modules/customer-intelligence/period";
import { compareTrend, type Trend } from "@/modules/business-intelligence/trend";
import { buildCampaignRows, type CampaignRow } from "./campaigns";
import { deriveConnectionStatus, deriveFreshness, type CredentialSnapshot } from "./connection";
import { accountDayRangeForPeriod, timeZoneDiffersFromUtc } from "./dates";
import { computeDiscrepancy, type ConversionDiscrepancy } from "./discrepancy";
import { computeEfficiency, type AdEfficiency } from "./efficiency";
import {
  buildCustomerSignals,
  loadFirstPartyGoogleAds,
  type GoogleAdsCustomerSignals,
  type GoogleAdsFunnel,
} from "./firstparty";
import { aggregateByCampaign, aggregateNative, rate, spendByDay, type DailySpend, type GoogleNativeTotals } from "./native";
import { buildGoogleAdsSignals } from "./signals";
import { describeCoverage } from "./attribution";
import type { AttributionCoverage, ConnectionStatus, GoogleAdsSignal, SyncFreshness } from "./types";

/**
 * `GoogleAdsIntelligenceSnapshot` (Session 13 spec §27) — the ONE
 * deterministic structure everything downstream consumes. The admin
 * dashboard renders it; the Google Ads agent receives a bounded, PII-free
 * rendering of it as its ONLY quantitative input.
 *
 * NO LLM touches anything in this file, and nothing in this module can call
 * one: `modules/google-ads-intelligence` has no `lib/ai` import (asserted
 * structurally, like S08–S12).
 *
 * NO GOOGLE API CALL HAPPENS HERE EITHER. Building this snapshot reads
 * PERSISTED daily rows, so rendering the dashboard is never an API call
 * (spec §10), an outage cannot change a number, and there is no path from
 * analytics code to any Google endpoint at all.
 *
 * The snapshot keeps the two lenses structurally separate: `google` holds
 * Google's own numbers, `firstParty` holds ours, and `discrepancy` reports
 * where they disagree. Nothing merges them (spec §15, §34, §55).
 */

export type GoogleAdsTrendLine = { name: string; label: string; trend: Trend };

export type GoogleAdsDataQualityWarning = { code: string; message: string };

export type GoogleAdsIntelligenceSnapshot = {
  generatedAt: Date;
  period: { start: Date; end: Date; days: number; label: string };
  previous: { start: Date; end: Date; days: number; label: string };

  connection: ConnectionStatus;
  freshness: SyncFreshness;

  /** The ACCOUNT-CALENDAR day range this period maps to (spec §29). */
  reportingWindow: {
    startDate: string;
    endDate: string;
    timeZone: string | null;
    /** True when the account calendar can disagree with the UTC period. */
    timeZoneDiffersFromUtc: boolean;
    explanation: string;
  };

  /** GOOGLE'S LENS. Never BagDirect orders or revenue. */
  google: GoogleNativeTotals;
  dailySpend: DailySpend[];

  /** BAGDIRECT'S LENS. Never Google conversions or conversion value. */
  firstParty: GoogleAdsFunnel;

  campaigns: CampaignRow[];
  coverage: AttributionCoverage;
  efficiency: AdEfficiency;
  discrepancy: ConversionDiscrepancy;
  customerSignals: GoogleAdsCustomerSignals;
  signals: GoogleAdsSignal[];
  trends: GoogleAdsTrendLine[];
  dataQuality: GoogleAdsDataQualityWarning[];

  /** What this session deliberately does not ingest (spec §24–§25). */
  notIngested: { searchTerms: boolean; keywords: boolean; reason: string };

  /** Recent sync attempts, for the admin surface. */
  recentSyncRuns: SyncRunRow[];
};

export async function buildGoogleAdsIntelligenceSnapshot(
  period: Period,
  credentials: CredentialSnapshot,
  now: Date = new Date(),
): Promise<GoogleAdsIntelligenceSnapshot> {
  const prev = previousPeriod(period);

  const [account, lastSuccessfulRun, lastRun, recentSyncRuns] = await Promise.all([
    getConnectedAdAccount(),
    getLastSuccessfulSyncRun(),
    getLastSyncRun(),
    listSyncRuns(10),
  ]);

  const connection = deriveConnectionStatus(credentials, account);
  const timeZone = account?.timeZone ?? null;
  const window = accountDayRangeForPeriod(timeZone ?? "UTC", period);
  const prevWindow = accountDayRangeForPeriod(timeZone ?? "UTC", prev);

  const [rows, prevRows, latestMetricDate, metricCurrencies] = account
    ? await Promise.all([
        listCampaignDailyMetrics(account.id, window.startDate, window.endDate),
        listCampaignDailyMetrics(account.id, prevWindow.startDate, prevWindow.endDate),
        loadLatestMetricDate(account.id),
        listMetricCurrencies(account.id),
      ])
    : [[], [], null, []];

  const google = aggregateNative(rows);
  const prevGoogle = aggregateNative(prevRows);
  const campaignNative = aggregateByCampaign(rows);

  /* First-party lens. Loaded even when Google Ads is not connected: sessions
   * carrying a gclid are Google Ads traffic whether or not we ever synced
   * the account, and hiding them would understate what we DO know. */
  const corpus = await loadConversationCorpus(period);
  const firstPartyData = await loadFirstPartyGoogleAds(
    period,
    campaignNative.map((c) => ({ campaignId: c.campaignId, campaignName: c.campaignName })),
    corpus,
  );
  const firstParty = firstPartyData.overall;

  const coverage = buildCoverage(firstPartyData.matchCounts, google.clicks, campaignNative.length, firstPartyData);

  const efficiency = computeEfficiency({
    costCents: google.costCents,
    adCurrency: google.currencyCode,
    googleConversions: google.googleConversions,
    googleConversionValueCents: google.googleConversionValueCents,
    firstPartyOrders: firstParty.orders,
    firstPartyRevenueCents: firstParty.revenueCents,
    revenueCurrencies: firstParty.revenueCurrencies,
    attributionMatchedPct: coverage.matchedPct,
    noAdData: rows.length === 0,
    contributionBeforePaidMediaCents: firstParty.contributionBeforePaidMediaCents,
    ordersWithContribution: firstParty.ordersWithContribution,
  });

  const discrepancy = computeDiscrepancy({
    googleConversions: google.googleConversions,
    googleConversionValueCents: google.googleConversionValueCents,
    firstPartyOrders: firstParty.orders,
    firstPartyRevenueCents: firstParty.revenueCents,
    currencyCompatible: efficiency.currency.compatible,
  });

  const campaigns = buildCampaignRows(campaignNative, firstPartyData.byCampaign, coverage.matchedPct);
  const customerSignals = buildCustomerSignals(corpus, firstPartyData.googleAdsSessionIds);
  const freshness = deriveFreshness({
    connected: connection.state === "CONNECTED",
    account,
    lastSuccessfulRun,
    lastRun,
    latestMetricDate,
    now,
  });

  const signals = buildGoogleAdsSignals({
    connection,
    freshness,
    native: google,
    firstParty,
    coverage,
    efficiency,
    discrepancy,
    campaigns,
    isTestAccount: account?.isTestAccount ?? false,
    metricCurrencies,
  });

  const trends: GoogleAdsTrendLine[] = [
    { name: "ad_spend", label: "Google Ads spend", trend: compareTrend(google.costCents, prevGoogle.costCents) },
    { name: "ad_clicks", label: "Google Ads clicks", trend: compareTrend(google.clicks, prevGoogle.clicks) },
    {
      name: "google_conversions",
      label: "Google-reported conversions",
      trend: compareTrend(google.googleConversions, prevGoogle.googleConversions),
    },
    {
      name: "first_party_orders",
      label: "Orders attributed to Google Ads (first-party)",
      trend: compareTrend(firstParty.orders, 0),
    },
  ];

  return {
    generatedAt: now,
    period: { start: period.start, end: period.end, days: period.days, label: period.label },
    previous: { start: prev.start, end: prev.end, days: prev.days, label: prev.label },
    connection,
    freshness,
    reportingWindow: {
      startDate: window.startDate,
      endDate: window.endDate,
      timeZone,
      timeZoneDiffersFromUtc: timeZone !== null && timeZoneDiffersFromUtc(timeZone),
      explanation: explainWindow(timeZone, window),
    },
    google,
    dailySpend: spendByDay(rows),
    firstParty,
    campaigns,
    coverage,
    efficiency,
    discrepancy,
    customerSignals,
    signals,
    trends,
    dataQuality: buildDataQuality({ account, connection, freshness, google, firstParty, coverage, efficiency, rows: rows.length }),
    notIngested: {
      searchTerms: !SEARCH_TERMS_INGESTED,
      keywords: !KEYWORDS_INGESTED,
      reason:
        "Session 13 ingests campaign-level performance only. Search-term and keyword reporting are deferred: campaign economics come first, and Google withholds low-volume search terms for privacy, so that table would be incomplete by construction.",
    },
    recentSyncRuns,
  };
}

function buildCoverage(
  matchCounts: Record<"EXACT" | "MAPPED" | "UNMATCHED", number>,
  googleClicks: number,
  campaignCount: number,
  data: { byCampaign: Map<string, unknown> },
): AttributionCoverage {
  const googleAdsSessions = matchCounts.EXACT + matchCounts.MAPPED + matchCounts.UNMATCHED;
  const matched = matchCounts.EXACT + matchCounts.MAPPED;
  const matchedPct = rate(matched, googleAdsSessions);
  return {
    googleAdsSessions,
    exactSessions: matchCounts.EXACT,
    mappedSessions: matchCounts.MAPPED,
    unmatchedSessions: matchCounts.UNMATCHED,
    matchedPct,
    campaignsWithNoSessions: Math.max(0, campaignCount - data.byCampaign.size),
    googleClicks,
    clickToSessionPct: rate(googleAdsSessions, googleClicks),
    interpretation: describeCoverage(matchedPct, googleAdsSessions),
  };
}

function explainWindow(timeZone: string | null, window: { startDate: string; endDate: string }): string {
  if (!timeZone) {
    return "No Google Ads account is connected, so no reporting window has been resolved.";
  }
  if (!timeZoneDiffersFromUtc(timeZone)) {
    return `Google Ads reports this account in ${timeZone}, which matches the UTC reporting period, so ${window.startDate}–${window.endDate} covers exactly this period.`;
  }
  return `Google Ads reports this account's days in ${timeZone}, while BagDirect's period is UTC. Spend below covers the account-calendar days ${window.startDate}–${window.endDate}, which OVERLAP the period rather than matching it exactly — up to one day at each end may include hours outside the UTC window. Google-reported daily totals cannot be re-cut into UTC days without hourly data, which this integration deliberately does not fetch.`;
}

function buildDataQuality(input: {
  account: AdAccountRow | null;
  connection: ConnectionStatus;
  freshness: SyncFreshness;
  google: GoogleNativeTotals;
  firstParty: GoogleAdsFunnel;
  coverage: AttributionCoverage;
  efficiency: AdEfficiency;
  rows: number;
}): GoogleAdsDataQualityWarning[] {
  const warnings: GoogleAdsDataQualityWarning[] = [];

  if (input.connection.state !== "CONNECTED") {
    warnings.push({
      code: "GOOGLE_ADS_NOT_CONNECTED",
      message:
        input.rows > 0
          ? "Google Ads is not connected, so nothing can be synced from here on. The figures below are data that WAS synced while the connection worked — they are real but frozen, and they will not include any spend since then. Nothing here is zero."
          : "Google Ads is not connected. Ad spend, CAC and ROAS are UNAVAILABLE — not zero. Nothing on this page should be read as evidence that advertising costs nothing.",
    });
    // With no rows at all there is nothing further to qualify. With rows, the
    // remaining warnings (currency, profit, coverage) still apply to them.
    if (input.rows === 0) return warnings;
  }

  if (input.rows === 0) {
    warnings.push({
      code: "NO_DATA_FOR_PERIOD",
      message:
        "No Google Ads rows have been synced for this reporting window. That may mean the campaigns did not run, or simply that this window has never been synced — the two are indistinguishable until you sync it.",
    });
  }

  if (input.freshness.state !== "FRESH") {
    warnings.push({ code: `SYNC_${input.freshness.state}`, message: input.freshness.reason });
  }

  if (input.freshness.provisionalFromDate) {
    warnings.push({
      code: "RECENT_DAYS_PROVISIONAL",
      message: `Google revises recent days as delayed conversions arrive, so figures from ${input.freshness.provisionalFromDate} onward are provisional and will change on the next sync. A re-sync UPDATES those days in place — it never adds a second copy of the spend.`,
    });
  }

  warnings.push({
    code: "GOOGLE_CONVERSIONS_ARE_NOT_ORDERS",
    message:
      "Google-reported conversions and conversion value are Google Ads attribution figures, produced by whatever conversion actions that account is configured to count. They are NOT BagDirect orders and NOT BagDirect revenue, and this page never treats them as interchangeable.",
  });

  if (!input.efficiency.currency.compatible) {
    warnings.push({ code: "CURRENCY_MISMATCH", message: input.efficiency.currency.reason });
  }

  warnings.push({
    code: "PROFIT_ON_AD_SPEND_UNAVAILABLE",
    message:
      "Profit-based advertising efficiency is unavailable — manufacturing costs are not configured (config/costs.ts), so contribution profit does not exist for any order. Revenue ROAS is not profitability.",
  });

  if (input.coverage.googleAdsSessions > 0 && input.coverage.matchedPct !== null && input.coverage.matchedPct < 100) {
    warnings.push({
      code: "PARTIAL_CAMPAIGN_ATTRIBUTION",
      message: `${input.coverage.unmatchedSessions} of ${input.coverage.googleAdsSessions} Google Ads sessions carry no campaign parameter this system recognises. Their orders and revenue are counted in the Google Ads totals but appear under no campaign, so per-campaign first-party revenue is understated.`,
    });
  }

  if (input.coverage.googleClicks > 0 && input.coverage.clickToSessionPct !== null) {
    warnings.push({
      code: "CLICKS_EXCEED_SESSIONS",
      message: `Google recorded ${input.coverage.googleClicks} clicks and BagDirect recorded ${input.coverage.googleAdsSessions} Google Ads sessions (${input.coverage.clickToSessionPct}%). These are not expected to match: a visitor who leaves before the page's first-party tracking runs is a click with no session. The gap is not lost revenue.`,
    });
  }

  warnings.push({
    code: "SEARCH_TERMS_NOT_INGESTED",
    message:
      "Search-term and keyword performance are not synced in this session, so no question about what people searched can be answered from this data. Google also withholds low-volume search terms for privacy, so even a future report would be incomplete.",
  });

  if (input.account?.isTestAccount) {
    warnings.push({
      code: "TEST_ACCOUNT",
      message:
        "This is a Google Ads TEST account. Test accounts do not serve real ads, so no figure here reflects real spend or real customers.",
    });
  }

  return warnings;
}

/** Whether the snapshot holds any real Google Ads data at all. */
export const snapshotHasAdData = (s: GoogleAdsIntelligenceSnapshot): boolean =>
  s.connection.state === "CONNECTED" && s.google.daysWithData > 0;

/** Bounded row cap used by the admin table and the agent context. */
export const MAX_CAMPAIGN_ROWS = GOOGLE_ADS.MAX_BREAKDOWN_ROWS;
