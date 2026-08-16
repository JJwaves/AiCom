import {
  getConnectedAdAccount,
  listCampaignDailyMetrics,
  type AdAccountRow,
} from "@/lib/data/google-ads-service";
import { available, unavailable, type Metric } from "@/modules/business-intelligence/availability";
import type { Period } from "@/modules/customer-intelligence/period";
import { accountDayRangeForPeriod } from "./dates";

/**
 * Ad spend, as Business Intelligence (S09) and the CEO agent see it
 * (Session 13 spec §52–§53).
 *
 * DELIBERATELY NARROW. Session 09's Business Intelligence layer is not
 * rewritten by this session — its revenue, funnel, profitability and
 * attribution semantics are unchanged, and `attribution.adSpendIntegrated`
 * stays `false` because that breakdown still contains no ad spend and still
 * computes no CAC or ROAS. What S13 adds is a SEPARATE, explicitly-available
 * ad-spend section, so the change to existing metrics is exactly none
 * (spec §52: "do NOT change existing historical semantics silently").
 *
 * The full advertising picture — per campaign, with attribution coverage and
 * both lenses — lives at `/admin/google-ads-intelligence`. This is the
 * one-line answer to "what did we spend?", with its availability state
 * attached so a missing integration can never read as zero.
 *
 * This file imports `lib/data` and the S09 availability leaf ONLY. It does
 * not import `lib/ai`, `lib/google-ads`, or the S13 barrel, so it introduces
 * no cycle and no model dependency.
 */

export type AdSpendSummary = {
  /** True when a Google Ads account row exists at all. */
  connected: boolean;
  /**
   * Total Google Ads spend for the period, integer cents in the ACCOUNT
   * currency. UNAVAILABLE (with a reason) whenever no account is connected
   * or no data has been synced — NEVER the number 0 (spec §18).
   */
  spendCents: Metric<number>;
  currencyCode: string | null;
  clicks: Metric<number>;
  /** Google-reported conversions. NOT BagDirect orders (spec §14). */
  googleConversions: Metric<number>;
  /** Account-calendar day range the figures cover (spec §29). */
  window: { startDate: string; endDate: string; timeZone: string | null };
  lastSuccessfulSyncAt: Date | null;
  /** One sentence the CEO context and the BI page can print verbatim. */
  statement: string;
};

const NOT_CONNECTED_REASON =
  "Google Ads is not connected, so advertising spend is unknown. This is NOT zero spend — the platform has no visibility into advertising at all, and no CAC or ROAS can be computed from it.";

export async function loadAdSpendSummary(period: Period): Promise<AdSpendSummary> {
  const account: AdAccountRow | null = await getConnectedAdAccount();

  if (!account) {
    return {
      connected: false,
      spendCents: unavailable(NOT_CONNECTED_REASON),
      currencyCode: null,
      clicks: unavailable(NOT_CONNECTED_REASON),
      googleConversions: unavailable(NOT_CONNECTED_REASON),
      window: { startDate: "", endDate: "", timeZone: null },
      lastSuccessfulSyncAt: null,
      statement: NOT_CONNECTED_REASON,
    };
  }

  const window = accountDayRangeForPeriod(account.timeZone, period);
  const rows = await listCampaignDailyMetrics(account.id, window.startDate, window.endDate);

  if (rows.length === 0) {
    const reason = `Google Ads is connected (account ${account.externalAccountId}) but no reporting rows have been synced for ${window.startDate}–${window.endDate}. Spend for this window is unknown, not zero — sync it before drawing any conclusion.`;
    return {
      connected: true,
      spendCents: unavailable(reason),
      currencyCode: account.currencyCode,
      clicks: unavailable(reason),
      googleConversions: unavailable(reason),
      window: { ...window, timeZone: account.timeZone },
      lastSuccessfulSyncAt: account.lastSuccessfulSyncAt,
      statement: reason,
    };
  }

  let spend = 0;
  let clicks = 0;
  let conversions = 0;
  for (const row of rows) {
    spend += row.costCents;
    clicks += row.clicks;
    conversions += row.googleConversions;
  }

  return {
    connected: true,
    spendCents: available(spend),
    currencyCode: account.currencyCode,
    clicks: available(clicks),
    googleConversions: available(conversions),
    window: { ...window, timeZone: account.timeZone },
    lastSuccessfulSyncAt: account.lastSuccessfulSyncAt,
    statement: `Google Ads spend for ${window.startDate}–${window.endDate} (account calendar, ${account.timeZone}) was ${(spend / 100).toFixed(2)} ${account.currencyCode} across ${clicks} clicks. Google reported ${conversions} conversions, which are Google's attribution and are NOT BagDirect orders. Cost per order, ROAS and attribution coverage are on the Google Ads Intelligence page; profit on ad spend is unavailable while manufacturing costs are unconfigured.`,
  };
}
