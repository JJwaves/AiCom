/**
 * First-party campaign attribution.
 *
 * Captures UTM params + ad click ids on landing, keeps FIRST touch immutable
 * and updates LAST touch per new campaign visit. Stored in localStorage;
 * attached to checkout as cart/order attributes (see lib/commerce).
 *
 * Pure functions here are unit-tested in tests/attribution.test.ts.
 */

export const CAMPAIGN_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
] as const;

export type Touch = {
  params: Partial<Record<(typeof CAMPAIGN_PARAMS)[number], string>>;
  landing_page: string;
  referrer: string;
  ts: string;
};

export type Attribution = { first: Touch; last: Touch };

const STORAGE_KEY = "bd_attribution_v1";

/** Extract campaign params from a query string. Returns null when none present. */
export function extractCampaignParams(search: string): Touch["params"] | null {
  const qs = new URLSearchParams(search);
  const out: Touch["params"] = {};
  let found = false;
  for (const key of CAMPAIGN_PARAMS) {
    const v = qs.get(key);
    if (v) {
      out[key] = v.slice(0, 500);
      found = true;
    }
  }
  return found ? out : null;
}

/**
 * Merge a new visit into stored attribution.
 * - First touch is written once and never overwritten.
 * - Last touch updates only when the new visit carries campaign params
 *   (plain internal navigation must not clobber the last campaign touch).
 */
export function mergeAttribution(stored: Attribution | null, visit: Touch): Attribution {
  const hasCampaign = Object.keys(visit.params).length > 0;
  if (!stored) return { first: visit, last: visit };
  if (!hasCampaign) return stored;
  return { first: stored.first, last: visit };
}

/** Flatten for order metadata (Shopify cart attributes / analytics params). */
export function attributionToMetadata(attr: Attribution | null): Record<string, string> {
  if (!attr) return {};
  const out: Record<string, string> = {};
  for (const [prefix, touch] of [["first", attr.first], ["last", attr.last]] as const) {
    for (const [k, v] of Object.entries(touch.params)) out[`${prefix}_${k}`] = v;
    out[`${prefix}_landing_page`] = touch.landing_page;
    if (touch.referrer) out[`${prefix}_referrer`] = touch.referrer;
    out[`${prefix}_ts`] = touch.ts;
  }
  return out;
}

/* ---- Browser-side persistence ---- */

export function readAttribution(): Attribution | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Attribution) : null;
  } catch {
    return null;
  }
}

/** Call once per page load (AnalyticsProvider does this). */
export function captureVisit(): Attribution | null {
  if (typeof window === "undefined") return null;
  const visit: Touch = {
    params: extractCampaignParams(window.location.search) ?? {},
    landing_page: window.location.pathname,
    referrer: document.referrer ?? "",
    ts: new Date().toISOString(),
  };
  const merged = mergeAttribution(readAttribution(), visit);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* storage unavailable (private mode) — attribution is best-effort */
  }
  return merged;
}
