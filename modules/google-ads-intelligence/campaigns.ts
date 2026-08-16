import { GOOGLE_ADS } from "@/config/google-ads";
import { ratio, type Ratio } from "@/modules/business-intelligence/availability";
import type { Metric } from "@/modules/business-intelligence/availability";
import { computeEfficiency, type AdEfficiency } from "./efficiency";
import type { CampaignFirstParty } from "./firstparty";
import type { CampaignNative } from "./native";
import type { MatchQuality } from "./types";

/**
 * Per-campaign performance (Session 13 spec §23, §33).
 *
 * ONE ROW, TWO LENSES, NEVER MIXED. Each row carries Google's own numbers
 * (spend, impressions, clicks, CTR, CPC, Google conversions, Google
 * conversion value, Google-reported CPA and ROAS) AND BagDirect's first-party
 * numbers (sessions, qualified conversations, cart, checkout, orders,
 * revenue, first-party CAC and ROAS) side by side, plus the MATCH QUALITY
 * that says how confidently the two halves belong to each other (spec §17).
 *
 * A campaign with no first-party sessions is NOT presented as a failure: it
 * may simply not be tagged in a way we can match. The `matchQuality` and the
 * coverage section are what turn that into an honest reading, and a
 * deterministic data-quality signal (`SPEND_WITHOUT_SESSIONS`) exists
 * precisely so the difference between "no traffic" and "no tracking" is
 * visible (spec §33, §56).
 */

export type CampaignRow = {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  advertisingChannelType: string | null;

  /* -------- Google's lens -------- */
  impressions: number;
  clicks: number;
  costCents: number;
  currencyCode: string | null;
  ctrPct: number | null;
  cpcCents: number | null;
  googleConversions: number;
  googleConversionValueCents: number;
  googleReportedCostPerConversionCents: number | null;
  googleReportedRoas: number | null;

  /* -------- BagDirect's lens -------- */
  matchQuality: MatchQuality | null;
  firstPartySessions: number;
  firstPartyConversations: number;
  firstPartyQualifiedConversations: number;
  firstPartyCartSessions: number;
  firstPartyCheckoutSessions: number;
  firstPartyOrders: number;
  firstPartyRevenueCents: number;
  firstPartyCostPerOrderCents: Metric<number>;
  firstPartyRoas: Metric<number>;

  /* -------- Quality beyond conversion (spec §33) -------- */
  /** Google clicks → first-party sessions we actually saw. */
  clickToSession: Ratio;
  /** First-party sessions → qualified conversations. */
  sessionToQualifiedConversation: Ratio;
  /** Qualified conversations → orders. */
  qualifiedConversationToOrder: Ratio;
};

export function buildCampaignRows(
  native: CampaignNative[],
  firstParty: Map<string, CampaignFirstParty>,
  attributionMatchedPct: number | null,
): CampaignRow[] {
  const rows = native.map((n) => {
    const fp = firstParty.get(n.campaignId);
    const efficiency: AdEfficiency = computeEfficiency({
      costCents: n.costCents,
      adCurrency: n.currencyCode,
      googleConversions: n.googleConversions,
      googleConversionValueCents: n.googleConversionValueCents,
      firstPartyOrders: fp?.orders ?? 0,
      firstPartyRevenueCents: fp?.revenueCents ?? 0,
      revenueCurrencies: fp?.revenueCurrencies ?? [],
      attributionMatchedPct,
      noAdData: false,
      contributionBeforePaidMediaCents: fp?.contributionBeforePaidMediaCents ?? null,
      ordersWithContribution: fp?.ordersWithContribution ?? 0,
    });

    return {
      campaignId: n.campaignId,
      campaignName: n.campaignName,
      campaignStatus: n.campaignStatus,
      advertisingChannelType: n.advertisingChannelType,

      impressions: n.impressions,
      clicks: n.clicks,
      costCents: n.costCents,
      currencyCode: n.currencyCode,
      ctrPct: n.ctrPct,
      cpcCents: n.cpcCents,
      googleConversions: n.googleConversions,
      googleConversionValueCents: n.googleConversionValueCents,
      googleReportedCostPerConversionCents: n.googleReportedCostPerConversionCents,
      googleReportedRoas: n.googleReportedRoas,

      // null match quality = we hold spend for this campaign but saw no
      // session naming it. Distinct from UNMATCHED, which is a session we
      // could not place.
      matchQuality: fp?.matchQuality ?? null,
      firstPartySessions: fp?.sessions ?? 0,
      firstPartyConversations: fp?.conversations ?? 0,
      firstPartyQualifiedConversations: fp?.qualifiedConversations ?? 0,
      firstPartyCartSessions: fp?.cartSessions ?? 0,
      firstPartyCheckoutSessions: fp?.checkoutSessions ?? 0,
      firstPartyOrders: fp?.orders ?? 0,
      firstPartyRevenueCents: fp?.revenueCents ?? 0,
      firstPartyCostPerOrderCents: efficiency.firstPartyCostPerOrderCents,
      firstPartyRoas: efficiency.firstPartyRoas,

      clickToSession: ratio(fp?.sessions ?? 0, n.clicks),
      sessionToQualifiedConversation: ratio(fp?.qualifiedConversations ?? 0, fp?.sessions ?? 0),
      qualifiedConversationToOrder: ratio(fp?.orders ?? 0, fp?.qualifiedConversations ?? 0),
    } satisfies CampaignRow;
  });

  return rows
    .sort((a, b) => b.costCents - a.costCents || a.campaignName.localeCompare(b.campaignName))
    .slice(0, GOOGLE_ADS.MAX_BREAKDOWN_ROWS);
}
