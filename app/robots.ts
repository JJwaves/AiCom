import type { MetadataRoute } from "next";
import { siteUrl } from "@/config/site";

/**
 * robots.txt.
 *
 * With NEXT_PUBLIC_SITE_DOMAIN unconfigured there is no honest canonical
 * host, so this refuses indexing entirely rather than advertising a sitemap
 * at the placeholder domain (Production Launch Session 03 §42). A
 * deployment that is not ready to say where it lives is not ready to be
 * crawled — and launch readiness reports the same gap as BLOCKED.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  if (!base) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Ad landing variants, cart, account and the admin surface are noise for crawlers
        disallow: ["/lp/", "/cart", "/account", "/api/", "/admin"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
