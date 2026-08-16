import { GOOGLE_ADS, SEARCH_TERMS_INGESTED } from "@/config/google-ads";
import { formatMoneyish } from "./format";
import type { CampaignRow } from "./campaigns";
import type { ConversionDiscrepancy } from "./discrepancy";
import type { AdEfficiency } from "./efficiency";
import type { GoogleAdsFunnel } from "./firstparty";
import type { GoogleNativeTotals } from "./native";
import type {
  AttributionCoverage,
  ConnectionStatus,
  GoogleAdsSignal,
  SyncFreshness,
} from "./types";

/**
 * Deterministic data-quality signals (Session 13 spec §56).
 *
 * Every signal here is a COUNT-BASED OBSERVATION with its limitation
 * attached. None of them diagnoses a root cause: "Google reported
 * conversions and we recorded no orders" is a fact; "your conversion
 * tracking is broken" is a diagnosis, and this file deliberately stops
 * short of it (spec §56). The agent may explain a signal; it may not
 * re-grade one, and it cannot invent one — signal ids are validated
 * against exactly this list.
 */

export type SignalInput = {
  connection: ConnectionStatus;
  freshness: SyncFreshness;
  native: GoogleNativeTotals;
  firstParty: GoogleAdsFunnel;
  coverage: AttributionCoverage;
  efficiency: AdEfficiency;
  discrepancy: ConversionDiscrepancy;
  campaigns: CampaignRow[];
  isTestAccount: boolean;
  metricCurrencies: string[];
};

export function buildGoogleAdsSignals(input: SignalInput): GoogleAdsSignal[] {
  const signals: GoogleAdsSignal[] = [];
  const push = (s: GoogleAdsSignal) => signals.push(s);

  /* ---------------- Connection & sync ---------------- */

  const hasSyncedData = input.native.daysWithData > 0;

  if (input.connection.state !== "CONNECTED") {
    push({
      id: "gads.signal.no_connection",
      kind: "NO_SUCCESSFUL_SYNC",
      title: hasSyncedData ? "Google Ads is no longer connected" : "Google Ads is not connected",
      description: input.connection.reason,
      route: "DATA_QUALITY",
      campaignId: null,
      evidence: [{ metricRef: "gads.connection.state", label: "Connection", value: input.connection.state }],
      limitations: [
        hasSyncedData
          ? "The figures shown were synced while the connection worked and are frozen at that point. Any spend since then is missing entirely, and none of these numbers is zero."
          : "Because there is no connection, this platform cannot tell the difference between “we spend nothing on advertising” and “we spend a great deal and cannot see it”. Nothing here should be read as zero spend.",
      ],
    });
    // With NO data at all, nothing downstream is measurable and no further
    // signal would be honest. With previously-synced data, the remaining
    // signals describe real numbers and still apply.
    if (!hasSyncedData) return signals;
  }

  if (input.freshness.state === "SYNC_FAILED") {
    push({
      id: "gads.signal.sync_failed",
      kind: "SYNC_FAILED",
      title: "The most recent Google Ads sync failed",
      description: input.freshness.reason,
      route: "DATA_QUALITY",
      campaignId: null,
      evidence: [
        { metricRef: "gads.sync.state", label: "Sync state", value: input.freshness.state },
        { metricRef: "gads.sync.lastErrorCode", label: "Error", value: input.freshness.lastErrorCode ?? "unknown" },
      ],
      limitations: [
        "The figures shown are the last successfully synced data, not current data. They were not replaced with zeros, and any spend since that sync is missing entirely.",
      ],
    });
  }

  if (input.freshness.state === "STALE") {
    push({
      id: "gads.signal.sync_stale",
      kind: "SYNC_STALE",
      title: "Google Ads data is stale",
      description: input.freshness.reason,
      route: "DATA_QUALITY",
      campaignId: null,
      evidence: [
        {
          metricRef: "gads.sync.ageHours",
          label: "Hours since last successful sync",
          value: input.freshness.ageHours === null ? "never" : String(input.freshness.ageHours),
        },
      ],
      limitations: ["A stale window understates recent spend and recent conversions. It does not mean spending stopped."],
    });
  }

  if (input.freshness.state === "PARTIAL") {
    push({
      id: "gads.signal.sync_partial",
      kind: "SYNC_PARTIAL",
      title: "The last sync was incomplete",
      description: input.freshness.reason,
      route: "DATA_QUALITY",
      campaignId: null,
      evidence: [{ metricRef: "gads.sync.state", label: "Sync state", value: "PARTIAL" }],
      limitations: ["Totals for this window are understated by an unknown amount. Do not compare them with a complete period."],
    });
  }

  if (input.isTestAccount) {
    push({
      id: "gads.signal.test_account",
      kind: "TEST_ACCOUNT",
      title: "Connected to a Google Ads TEST account",
      description:
        "This is a Google Ads test account. Test accounts do not serve real ads, so every impression, click, cost and conversion here is structural test data. Meaningful spend and performance require a production account.",
      route: "DATA_QUALITY",
      campaignId: null,
      evidence: [{ metricRef: "gads.account.isTestAccount", label: "Test account", value: "yes" }],
      limitations: ["No business decision should be made from test-account figures."],
    });
  }

  /* ---------------- Currency ---------------- */

  if (!input.efficiency.currency.compatible) {
    push({
      id: "gads.signal.currency_mismatch",
      kind: "CURRENCY_MISMATCH",
      title: "Ad spend and revenue are not in the same currency",
      description: input.efficiency.currency.reason,
      route: "DATA_QUALITY",
      campaignId: null,
      evidence: [
        {
          metricRef: "gads.account.currency",
          label: "Ad account currency",
          value: input.efficiency.currency.adCurrency ?? "unknown",
        },
        {
          metricRef: "gads.firstParty.revenueCurrencies",
          label: "Order currencies",
          value: input.efficiency.currency.revenueCurrencies.join(", ") || "none",
        },
      ],
      limitations: [
        "CAC and ROAS are unavailable rather than wrong. This system has no exchange-rate model and will not invent one.",
      ],
    });
  }
  if (input.metricCurrencies.length > 1) {
    push({
      id: "gads.signal.mixed_metric_currency",
      kind: "CURRENCY_MISMATCH",
      title: "Synced spend spans more than one currency",
      description: `Stored Google Ads rows carry ${input.metricCurrencies.length} different currencies (${input.metricCurrencies.join(", ")}). That normally means the account currency changed, or a second account was synced into the same record.`,
      route: "DATA_QUALITY",
      campaignId: null,
      evidence: [
        {
          metricRef: "gads.metrics.currencies",
          label: "Currencies present",
          value: input.metricCurrencies.join(", "),
        },
      ],
      limitations: ["Totals across mixed currencies are arithmetic, not money. Treat the headline spend figure as unusable until this is resolved."],
    });
  }

  /* ---------------- Attribution ---------------- */

  if (input.discrepancy.material) {
    push({
      id: "gads.signal.conversion_discrepancy",
      kind: "CONVERSION_DISCREPANCY",
      title: "Google's conversions and BagDirect's orders differ materially",
      description: input.discrepancy.interpretation,
      route: "ATTRIBUTION_REVIEW",
      campaignId: null,
      evidence: [
        {
          metricRef: "gads.google.conversions",
          label: "Google conversions",
          value: String(input.discrepancy.googleConversions),
        },
        {
          metricRef: "gads.firstParty.orders",
          label: "First-party attributed orders",
          value: String(input.discrepancy.firstPartyOrders),
        },
      ],
      limitations: [
        "A difference is expected and is usually attribution configuration, not a defect. It never means one of the two numbers is wrong.",
        ...input.discrepancy.knownCauses.slice(0, 2),
      ],
    });
  }

  if (input.native.googleConversions > 0 && input.firstParty.orders === 0) {
    push({
      id: "gads.signal.google_conversions_no_orders",
      kind: "GOOGLE_CONVERSIONS_NO_FIRST_PARTY_ORDERS",
      title: "Google reports conversions but no orders are attributed to Google Ads",
      description: `Google reported ${input.native.googleConversions} conversion(s) in this period while BagDirect attributed no orders to Google Ads traffic.`,
      route: "ATTRIBUTION_REVIEW",
      campaignId: null,
      evidence: [
        { metricRef: "gads.google.conversions", label: "Google conversions", value: String(input.native.googleConversions) },
        { metricRef: "gads.firstParty.orders", label: "First-party orders", value: "0" },
      ],
      limitations: [
        "Google's conversion actions may count something other than a purchase, and a conversion credited today may belong to a click weeks ago. This is a question about measurement before it is a question about performance.",
      ],
    });
  }

  if (input.native.googleConversions === 0 && input.firstParty.orders > 0) {
    push({
      id: "gads.signal.orders_no_google_conversions",
      kind: "FIRST_PARTY_ORDERS_NO_GOOGLE_CONVERSIONS",
      title: "Orders came from Google Ads but Google reports no conversions",
      description: `BagDirect attributed ${input.firstParty.orders} order(s) to Google Ads traffic while Google reported no conversions. Google cannot optimise toward outcomes it never receives.`,
      route: "ATTRIBUTION_REVIEW",
      campaignId: null,
      evidence: [
        { metricRef: "gads.firstParty.orders", label: "First-party orders", value: String(input.firstParty.orders) },
        { metricRef: "gads.google.conversions", label: "Google conversions", value: "0" },
      ],
      limitations: [
        "The orders are real regardless. What is unknown is whether Google Ads conversion tracking exists on this site — this session does not upload conversions and cannot check.",
      ],
    });
  }

  if (
    input.coverage.matchedPct !== null &&
    input.coverage.matchedPct < GOOGLE_ADS.MIN_ATTRIBUTION_COVERAGE_PCT &&
    input.coverage.googleAdsSessions > 0
  ) {
    push({
      id: "gads.signal.low_attribution_coverage",
      kind: "LOW_ATTRIBUTION_COVERAGE",
      title: "Most Google Ads visits cannot be tied to a campaign",
      description: input.coverage.interpretation,
      route: "ATTRIBUTION_REVIEW",
      campaignId: null,
      evidence: [
        {
          metricRef: "gads.coverage.matchedPct",
          label: "Sessions matched to a campaign",
          value: `${input.coverage.matchedPct}%`,
        },
        {
          metricRef: "gads.coverage.googleAdsSessions",
          label: "Google Ads sessions",
          value: String(input.coverage.googleAdsSessions),
        },
      ],
      limitations: [
        "Account-level figures are unaffected — only per-campaign first-party revenue is under-assigned. Fixing this is a tracking-template change, not a campaign change.",
      ],
    });
  }

  /* ---------------- Per-campaign anomalies ---------------- */

  for (const campaign of input.campaigns) {
    if (campaign.costCents > 0 && campaign.clicks === 0) {
      push({
        id: `gads.signal.cost_without_clicks.${campaign.campaignId}`,
        kind: "COST_WITHOUT_CLICKS",
        title: `“${campaign.campaignName}” spent with no clicks`,
        description: `${campaign.campaignName} recorded ${formatMoneyish(campaign.costCents, campaign.currencyCode)} of spend and zero clicks in this period.`,
        route: "MARKETING_REVIEW",
        campaignId: campaign.campaignId,
        evidence: [
          { metricRef: `gads.campaign.${campaign.campaignId}.cost`, label: "Spend", value: formatMoneyish(campaign.costCents, campaign.currencyCode) },
          { metricRef: `gads.campaign.${campaign.campaignId}.clicks`, label: "Clicks", value: "0" },
        ],
        limitations: [
          "Some campaign types legitimately bill on impressions or views rather than clicks. Check the campaign type before treating this as waste.",
        ],
      });
    }

    if (campaign.clicks >= GOOGLE_ADS.MIN_DENOMINATOR_FOR_PERCENTAGE && campaign.firstPartySessions === 0) {
      push({
        id: `gads.signal.spend_without_sessions.${campaign.campaignId}`,
        kind: "SPEND_WITHOUT_SESSIONS",
        title: `“${campaign.campaignName}” got clicks we never saw arrive`,
        description: `Google recorded ${campaign.clicks} clicks for ${campaign.campaignName}, but no first-party session in this period could be tied to it.`,
        route: "ATTRIBUTION_REVIEW",
        campaignId: campaign.campaignId,
        evidence: [
          { metricRef: `gads.campaign.${campaign.campaignId}.clicks`, label: "Google clicks", value: String(campaign.clicks) },
          { metricRef: `gads.campaign.${campaign.campaignId}.sessions`, label: "First-party sessions", value: "0" },
        ],
        limitations: [
          "This is at least as likely to be a tracking-template problem as a traffic-quality problem: without a campaign parameter we recognise, a real visit is invisible to the campaign. It is NOT evidence of click fraud.",
        ],
      });
    }
  }

  /* ---------------- Profit ---------------- */

  push({
    id: "gads.signal.profit_unavailable",
    kind: "PROFIT_UNAVAILABLE",
    title: "Profit-based advertising efficiency is unavailable",
    description:
      "Manufacturing costs are not configured, so contribution profit cannot be computed for any order and profit on ad spend (POAS) does not exist. Revenue-based ROAS is shown instead — revenue is not profit.",
    route: "DATA_QUALITY",
    campaignId: null,
    evidence: [
      {
        metricRef: "gads.profit.blockers",
        label: "Unfilled cost inputs",
        value: String(input.efficiency.profitBlockers.length),
      },
    ],
    limitations: [
      "A campaign with strong revenue ROAS can still lose money. Until config/costs.ts is filled, no advertising figure here says anything about profitability.",
    ],
  });

  /* ---------------- Deferred ingestion ---------------- */

  if (!SEARCH_TERMS_INGESTED) {
    push({
      id: "gads.signal.search_terms_not_ingested",
      kind: "SEARCH_TERMS_NOT_INGESTED",
      title: "Search-term data is not ingested",
      description:
        "Session 13 ingests campaign-level performance only. What people actually searched before arriving is not synced, so it cannot be reported — and Google withholds low-volume queries anyway, so any such report would be knowingly incomplete.",
      route: "DATA_QUALITY",
      campaignId: null,
      evidence: [{ metricRef: "gads.searchTerms.ingested", label: "Search terms ingested", value: "no" }],
      limitations: [
        "This is an absence of data, not a finding about search behaviour. An empty search-term table would have implied nobody searched, which is why none is shown.",
      ],
    });
  }

  return signals;
}
