import { GOOGLE_ADS } from "@/config/google-ads";
import type { AdCampaignDailyRow } from "@/lib/data/google-ads-service";

/**
 * GOOGLE-NATIVE metrics (Session 13 spec §15, §22).
 *
 * Everything in this file comes from Google Ads and describes GOOGLE'S view
 * of the world. Nothing here touches a BagDirect order, session or
 * conversation, and no field is named `orders` or `revenue` — the two lenses
 * are kept apart at the type level so one can never be silently written into
 * the other (spec §15, §34, §64).
 *
 * Rates are computed deterministically from real denominators (spec §22).
 * A zero denominator produces `null`, never `0` and never `Infinity`: "we
 * had no clicks, so there is no cost per click" is a different statement
 * from "our cost per click was zero", and only one of them is true.
 */

export type GoogleNativeTotals = {
  /** Days of data actually present in the window (account calendar). */
  daysWithData: number;
  campaigns: number;
  impressions: number;
  clicks: number;
  /** Integer cents in the ACCOUNT currency. The authoritative spend figure. */
  costCents: number;
  currencyCode: string | null;
  /** Google's conversion count. NOT BagDirect orders (spec §14). */
  googleConversions: number;
  /** Google's conversion value in cents. NOT BagDirect revenue (spec §34). */
  googleConversionValueCents: number;

  /** clicks ÷ impressions, whole-number percent to one decimal, or null. */
  ctrPct: number | null;
  /** cost ÷ clicks, integer cents, or null when there were no clicks. */
  cpcCents: number | null;
  /** clicks ÷ Google conversions expressed as a rate, or null. */
  googleConversionRatePct: number | null;
  /**
   * cost ÷ Google conversions. Named `googleReportedCostPerConversionCents`
   * and NOT `cac`, because Google's conversion is whatever the account's
   * conversion actions count — which may be a form view, a call, or a
   * purchase (spec §19).
   */
  googleReportedCostPerConversionCents: number | null;
  /**
   * Google conversion value ÷ cost. Named `googleReportedRoas` and never
   * merged with first-party ROAS (spec §20).
   */
  googleReportedRoas: number | null;
};

const EMPTY: GoogleNativeTotals = {
  daysWithData: 0,
  campaigns: 0,
  impressions: 0,
  clicks: 0,
  costCents: 0,
  currencyCode: null,
  googleConversions: 0,
  googleConversionValueCents: 0,
  ctrPct: null,
  cpcCents: null,
  googleConversionRatePct: null,
  googleReportedCostPerConversionCents: null,
  googleReportedRoas: null,
};

/**
 * Aggregate persisted campaign-days.
 *
 * An EMPTY row list produces zeros with `daysWithData: 0` and a null
 * currency. That combination is the caller's signal to say "no data for this
 * window" rather than "you spent $0" — the connection status and freshness
 * sections carry that distinction, and the admin page renders it
 * (spec §6, §18).
 */
export function aggregateNative(rows: AdCampaignDailyRow[]): GoogleNativeTotals {
  if (rows.length === 0) return { ...EMPTY };

  const campaigns = new Set<string>();
  const days = new Set<string>();
  const currencies = new Set<string>();
  let impressions = 0;
  let clicks = 0;
  let costCents = 0;
  let googleConversions = 0;
  let googleConversionValueCents = 0;

  for (const r of rows) {
    campaigns.add(r.campaignId);
    days.add(r.date);
    currencies.add(r.currencyCode);
    impressions += r.impressions;
    clicks += r.clicks;
    costCents += r.costCents;
    googleConversions += r.googleConversions;
    googleConversionValueCents += r.googleConversionValueCents;
  }

  return {
    daysWithData: days.size,
    campaigns: campaigns.size,
    impressions,
    clicks,
    // A mixed-currency window is a real (if unlikely) state; the totals are
    // still summed so nothing disappears, and the currency reads null so
    // every downstream financial comparison refuses to run (spec §30).
    currencyCode: currencies.size === 1 ? [...currencies][0] : null,
    costCents,
    googleConversions,
    googleConversionValueCents,
    ctrPct: rate(clicks, impressions),
    cpcCents: clicks > 0 ? Math.round(costCents / clicks) : null,
    googleConversionRatePct: rate(googleConversions, clicks),
    googleReportedCostPerConversionCents:
      googleConversions > 0 ? Math.round(costCents / googleConversions) : null,
    googleReportedRoas: costCents > 0 ? round2(googleConversionValueCents / costCents) : null,
  };
}

/**
 * A percentage with an honest denominator: null below the documented
 * minimum, and null (never Infinity) when the denominator is zero.
 */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0 || denominator < GOOGLE_ADS.MIN_DENOMINATOR_FOR_PERCENTAGE) return null;
  return round2((numerator / denominator) * 100);
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Per-campaign native aggregation, keyed by campaign id. */
export type CampaignNative = GoogleNativeTotals & {
  campaignId: string;
  campaignName: string;
  /** Google's status on the most recent day we hold for this campaign. */
  campaignStatus: string;
  advertisingChannelType: string | null;
  firstDate: string;
  lastDate: string;
};

export function aggregateByCampaign(rows: AdCampaignDailyRow[]): CampaignNative[] {
  const groups = new Map<string, AdCampaignDailyRow[]>();
  for (const r of rows) {
    const list = groups.get(r.campaignId);
    if (list) list.push(r);
    else groups.set(r.campaignId, [r]);
  }

  const out: CampaignNative[] = [];
  for (const [campaignId, group] of groups) {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    out.push({
      ...aggregateNative(group),
      campaignId,
      // Name and status from the LATEST day: a campaign renamed mid-period
      // should read under its current name, and its current status is the
      // one an owner would act on.
      campaignName: latest.campaignName,
      campaignStatus: latest.campaignStatus,
      advertisingChannelType: latest.advertisingChannelType,
      firstDate: sorted[0].date,
      lastDate: latest.date,
    });
  }
  return out.sort((a, b) => b.costCents - a.costCents || a.campaignName.localeCompare(b.campaignName));
}

/** Spend by account-calendar day — the sparkline / trend source. */
export type DailySpend = { date: string; costCents: number; clicks: number; googleConversions: number };

export function spendByDay(rows: AdCampaignDailyRow[]): DailySpend[] {
  const byDate = new Map<string, DailySpend>();
  for (const r of rows) {
    const entry = byDate.get(r.date) ?? { date: r.date, costCents: 0, clicks: 0, googleConversions: 0 };
    entry.costCents += r.costCents;
    entry.clicks += r.clicks;
    entry.googleConversions += r.googleConversions;
    byDate.set(r.date, entry);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
