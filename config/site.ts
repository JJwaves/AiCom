/**
 * THE canonical site domain (Production Launch Session 03 §42).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 * `BUSINESS.DOMAIN` was the literal string `"example.com"`, hard-coded, and
 * five surfaces built URLs from it: `metadataBase`, the sitemap, robots.txt,
 * the About page's Organization JSON-LD and the product breadcrumb JSON-LD.
 * Launched as-is, that publishes canonical URLs, a sitemap and structured
 * data all pointing at a domain the owner does not own — which is worse than
 * publishing none of it, because search engines act on it.
 *
 * The domain cannot be invented here (CLAUDE.md: never invent owner data),
 * so it becomes CONFIGURATION with a loud unset state:
 *
 *   NEXT_PUBLIC_SITE_DOMAIN=bagdirect.com   → real URLs everywhere
 *   unset, or left as the placeholder        → `siteDomain()` returns null,
 *                                              launch readiness reports it
 *                                              BLOCKED, and no surface
 *                                              fabricates a URL
 *
 * NEXT_PUBLIC_ because `metadataBase` is evaluated during the build and the
 * value is a public fact about the site — it is on every page already. Being
 * build-time inlined means CHANGING IT REQUIRES A REDEPLOY, which is stated
 * in .env.example and the launch checklist rather than discovered later.
 */

/** The literal placeholder that must never reach production. */
export const PLACEHOLDER_DOMAIN = "example.com";

const DOMAIN_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function readDomain(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_DOMAIN;
  if (typeof raw !== "string") return null;
  const trimmed = raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (trimmed.length === 0) return null;
  if (trimmed.toLowerCase() === PLACEHOLDER_DOMAIN) return null;
  return DOMAIN_SHAPE.test(trimmed) ? trimmed : null;
}

/** The configured domain, or null. Null means "unknown" — never a guess. */
export function siteDomain(): string | null {
  return readDomain();
}

export function siteDomainConfigured(): boolean {
  return readDomain() !== null;
}

/** `https://<domain>`, or null when unconfigured. Callers must handle null. */
export function siteUrl(): string | null {
  const domain = readDomain();
  return domain ? `https://${domain}` : null;
}

/**
 * A domain for surfaces that structurally REQUIRE one at build time —
 * `metadataBase` throws on an invalid URL, and `next build` must keep
 * working with owner configuration missing (§48).
 *
 * It returns the placeholder when nothing is configured, which is exactly
 * why `siteDomainConfigured()` exists and why launch readiness checks it:
 * the build stays possible, and the gap stays visible.
 */
export function metadataDomain(): string {
  return readDomain() ?? PLACEHOLDER_DOMAIN;
}
