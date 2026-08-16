import type { Touch } from "@/lib/attribution/attribution";
import type { SessionRowLite } from "@/lib/data/intelligence-service";
import type { MatchQuality } from "./types";

/**
 * First-party ↔ Google Ads campaign matching (Session 13 spec §16–§17).
 *
 * THE EXACT SEMANTICS, stated here and in docs/GOOGLE_ADS_INTELLIGENCE.md,
 * because an attribution rule that lives only in someone's head is how
 * revenue silently lands on the wrong campaign.
 *
 * STEP 1 — is this session Google Ads paid traffic at all?
 *   YES if the session's first OR last touch carries a Google click id
 *   (`gclid`, `gbraid`, `wbraid`), or carries `utm_source=google` together
 *   with a paid `utm_medium` (cpc / ppc / paid / paidsearch / paid_search).
 *   A click id is proof: the browser only receives one from a Google Ads
 *   click. The utm pair is a convention, and is treated as weaker evidence
 *   only in the sense that it can be typed by hand — it is still exact
 *   string matching, never a guess.
 *
 * STEP 2 — which campaign?
 *   EXACT   `utm_campaign` equals a known Google campaign ID (what
 *           `{campaignid}` in a tracking template produces).
 *   MAPPED  `utm_campaign` equals a known campaign NAME after normalizing
 *           case, whitespace, underscores and hyphens.
 *   UNMATCHED  neither. Its orders and revenue still count in the
 *           Google-Ads-wide totals; they simply carry no campaign.
 *
 * WHAT WE DELIBERATELY DO NOT DO:
 *   - We do NOT resolve `gclid` → campaign. Google can do it (the
 *     `click_view` resource), but only for a short window and as a separate
 *     report; we do not ingest it, so a gclid tells us "Google Ads click"
 *     and nothing about which campaign (spec §16).
 *   - We do NOT fuzzy-match names. Two campaigns called "Restaurant Bags"
 *     and "Restaurant Bags 2026" are different campaigns.
 *   - We do NOT let AI attribute anything. This file is pure and typed;
 *     the model never sees a session (spec §17, §59).
 *
 * PRIVACY: click ids are used ONLY as a boolean "this was a paid click"
 * inside this module. No `gclid` value is stored by this session's tables,
 * returned in a snapshot, rendered in the admin UI, or placed in an AI
 * prompt (spec §59).
 */

const PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paidsearch", "paid_search", "paid-search"]);
const CLICK_ID_KEYS = ["gclid", "gbraid", "wbraid"] as const;

/** True when this touch demonstrably came from a Google Ads click. */
function touchIsGoogleAds(touch: Touch | null | undefined): boolean {
  const params = touch?.params;
  if (!params) return false;
  for (const key of CLICK_ID_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.trim().length > 0) return true;
  }
  const source = params.utm_source?.trim().toLowerCase();
  const medium = params.utm_medium?.trim().toLowerCase();
  return source === "google" && medium !== undefined && PAID_MEDIUMS.has(medium);
}

/** A session counts as Google Ads traffic on EITHER touch. */
export function isGoogleAdsSession(session: SessionRowLite | null | undefined): boolean {
  if (!session) return false;
  return touchIsGoogleAds(session.firstTouchJson) || touchIsGoogleAds(session.lastTouchJson);
}

/**
 * True when a click id is present — used ONLY to report how much of our
 * paid traffic carries hard proof versus utm convention. The VALUE never
 * leaves this function.
 */
export function hasClickId(session: SessionRowLite | null | undefined): boolean {
  for (const touch of [session?.firstTouchJson, session?.lastTouchJson]) {
    const params = touch?.params;
    if (!params) continue;
    for (const key of CLICK_ID_KEYS) {
      const value = params[key];
      if (typeof value === "string" && value.trim().length > 0) return true;
    }
  }
  return false;
}

/**
 * Normalize a campaign name for MAPPED matching.
 *
 * Case-insensitive, whitespace-collapsed, and `_`/`-` treated as spaces —
 * the three differences that appear when a human copies a campaign name
 * into a UTM parameter. Nothing more aggressive: removing words or
 * stemming would start matching campaigns that are genuinely different.
 */
export function normalizeCampaignName(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export type CampaignIdentity = { campaignId: string; campaignName: string };

export type CampaignMatch = { campaignId: string | null; quality: MatchQuality };

/**
 * An index over the campaigns we actually hold spend for. Built once per
 * snapshot; matching a session is then a hash lookup, not a scan.
 */
export class CampaignMatcher {
  private readonly byId = new Map<string, string>();
  private readonly byName = new Map<string, string>();
  /** Campaign names that are ambiguous (two campaigns, same normalized name). */
  private readonly ambiguousNames = new Set<string>();

  constructor(campaigns: CampaignIdentity[]) {
    for (const c of campaigns) {
      this.byId.set(c.campaignId, c.campaignId);
      const key = normalizeCampaignName(c.campaignName);
      const existing = this.byName.get(key);
      if (existing && existing !== c.campaignId) {
        // Two live campaigns normalize to the same name. Attributing to
        // either would be a coin flip, so BOTH become unmatchable by name
        // and the coverage report shows the shortfall (spec §17).
        this.ambiguousNames.add(key);
      } else {
        this.byName.set(key, c.campaignId);
      }
    }
  }

  /** Campaign names that could not be used because they are ambiguous. */
  get ambiguousNameCount(): number {
    return this.ambiguousNames.size;
  }

  /**
   * Resolve a session to a campaign. Checks the LAST touch first, then the
   * FIRST: for advertising performance, the campaign that brought this
   * visit is the one being measured. Both touches are checked so a returning
   * visitor whose first touch was the paid click still attributes.
   */
  match(session: SessionRowLite): CampaignMatch {
    for (const touch of [session.lastTouchJson, session.firstTouchJson]) {
      const raw = touch?.params?.utm_campaign?.trim();
      if (!raw) continue;

      const byId = this.byId.get(raw);
      if (byId) return { campaignId: byId, quality: "EXACT" };

      const key = normalizeCampaignName(raw);
      if (this.ambiguousNames.has(key)) continue;
      const byName = this.byName.get(key);
      if (byName) return { campaignId: byName, quality: "MAPPED" };
    }
    return { campaignId: null, quality: "UNMATCHED" };
  }
}

/**
 * Owner-language statement of what a given coverage level permits.
 *
 * Deliberately NOT a score. The point is to stop someone reading a
 * per-campaign ROAS as precise when half the sessions never matched
 * (spec §17, §20).
 */
export function describeCoverage(matchedPct: number | null, googleAdsSessions: number): string {
  if (googleAdsSessions === 0) {
    return "No sessions in this period arrived from a Google Ads click, so no first-party outcome can be tied to a campaign.";
  }
  if (matchedPct === null) {
    return `Only ${googleAdsSessions} sessions arrived from Google Ads — too few to state a matching percentage. Per-campaign first-party figures are indicative at best.`;
  }
  if (matchedPct >= 90) {
    return `${matchedPct}% of Google Ads sessions were tied to a specific campaign, so per-campaign first-party figures cover almost all paid traffic.`;
  }
  if (matchedPct >= 50) {
    return `${matchedPct}% of Google Ads sessions were tied to a specific campaign. The rest are counted in the Google Ads totals but not under any campaign, so per-campaign first-party revenue is understated.`;
  }
  return `Only ${matchedPct}% of Google Ads sessions could be tied to a campaign — most paid traffic does not carry a campaign parameter we recognise. Treat per-campaign first-party figures as incomplete, and fix the tracking templates before drawing campaign-level conclusions.`;
}
