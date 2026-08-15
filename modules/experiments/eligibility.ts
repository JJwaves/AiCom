import { z } from "zod";

/**
 * Experiment eligibility (Session 11 spec §11, §30).
 *
 * Deliberately SIMPLE and deterministic. Selectors are limited to signals we
 * already hold first-party and can evaluate without guessing:
 *   - route prefix (where the surface lives)
 *   - first-touch traffic source / medium (session attribution)
 *   - campaign (session attribution)
 *   - device category, only when the user agent classifies confidently
 *   - new vs returning session, only when deterministically known
 *
 * No sensitive personal characteristics are usable, by construction: the
 * schema has no field for them.
 *
 * THE RULE THAT MATTERS: when a selector is set and the corresponding
 * context value is UNKNOWN, the session is NOT enrolled. Ambiguity never
 * resolves to "include" — an unknown device is not a desktop.
 */

export const audienceSchema = z
  .object({
    /** Route prefixes; empty = wherever the target renders. */
    routes: z.array(z.string().min(1).max(200)).max(10).default([]),
    /** first-touch "source / medium" keys, e.g. "google / cpc". */
    trafficSources: z.array(z.string().min(1).max(120)).max(10).default([]),
    campaigns: z.array(z.string().min(1).max(120)).max(10).default([]),
    device: z.enum(["any", "mobile", "desktop"]).default("any"),
    visitor: z.enum(["any", "new", "returning"]).default("any"),
  })
  .strict();

export type Audience = z.infer<typeof audienceSchema>;

export const DEFAULT_AUDIENCE: Audience = {
  routes: [],
  trafficSources: [],
  campaigns: [],
  device: "any",
  visitor: "any",
};

export type EligibilityContext = {
  path: string;
  /** "source / medium" from the session's immutable first touch, when known. */
  firstTouchSourceMedium: string | null;
  campaign: string | null;
  device: "mobile" | "desktop" | null;
  visitor: "new" | "returning" | null;
  /** Admin traffic and obvious automation never enter customer experiments. */
  isAdminPath: boolean;
  isBot: boolean;
};

export type EligibilityResult = { eligible: true } | { eligible: false; reason: string };

export function isEligible(audience: Audience, ctx: EligibilityContext): EligibilityResult {
  if (ctx.isAdminPath) return { eligible: false, reason: "admin_traffic_excluded" };
  if (ctx.isBot) return { eligible: false, reason: "automated_traffic_excluded" };

  if (audience.routes.length > 0 && !audience.routes.some((r) => matchRoute(r, ctx.path))) {
    return { eligible: false, reason: "route_not_in_audience" };
  }

  if (audience.trafficSources.length > 0) {
    if (!ctx.firstTouchSourceMedium) return { eligible: false, reason: "traffic_source_unknown" };
    if (!audience.trafficSources.includes(ctx.firstTouchSourceMedium)) {
      return { eligible: false, reason: "traffic_source_not_in_audience" };
    }
  }

  if (audience.campaigns.length > 0) {
    if (!ctx.campaign) return { eligible: false, reason: "campaign_unknown" };
    if (!audience.campaigns.includes(ctx.campaign)) return { eligible: false, reason: "campaign_not_in_audience" };
  }

  if (audience.device !== "any") {
    if (ctx.device === null) return { eligible: false, reason: "device_unknown" };
    if (ctx.device !== audience.device) return { eligible: false, reason: "device_not_in_audience" };
  }

  if (audience.visitor !== "any") {
    if (ctx.visitor === null) return { eligible: false, reason: "visitor_type_unknown" };
    if (ctx.visitor !== audience.visitor) return { eligible: false, reason: "visitor_type_not_in_audience" };
  }

  return { eligible: true };
}

/** Exact match, or prefix match when the pattern ends in "/" or "*". */
export function matchRoute(pattern: string, path: string): boolean {
  if (pattern.endsWith("*")) return path.startsWith(pattern.slice(0, -1));
  if (pattern.endsWith("/") && pattern.length > 1) return path.startsWith(pattern);
  return path === pattern;
}

/**
 * Conservative user-agent classification. Returns null whenever the answer
 * is not obvious — a null device means "not enrolled" for device-targeted
 * experiments, which is the honest failure direction (spec §11).
 */
export function classifyDevice(userAgent: string | null | undefined): "mobile" | "desktop" | null {
  if (!userAgent || userAgent.length < 8) return null;
  if (isBotUserAgent(userAgent)) return null;
  if (/\b(Mobi|Android|iPhone|iPod|Windows Phone)\b/i.test(userAgent)) return "mobile";
  if (/\b(iPad|Tablet)\b/i.test(userAgent)) return null; // deliberately ambiguous
  if (/\b(Windows NT|Macintosh|X11|CrOS)\b/i.test(userAgent)) return "desktop";
  return null;
}

/**
 * Minimal, deliberately un-clever bot detection (spec §30). The point is to
 * keep obvious crawlers, previews and our own test automation out of
 * customer experiments — not to build a bot-defence system.
 */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true; // no UA at all is not a customer browser
  return /(bot|crawler|spider|crawling|slurp|headless|phantom|puppeteer|playwright|lighthouse|preview|monitor|curl|wget|python-requests|vitest|node-fetch)/i.test(
    userAgent,
  );
}

/** Admin surfaces never participate in customer experiments. */
export function isAdminPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/");
}
