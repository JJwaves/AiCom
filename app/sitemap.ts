import type { MetadataRoute } from "next";
import { siteUrl } from "@/config/site";
import { listCatalogProducts } from "@/lib/commerce/catalog";
import { LANDING_PAGES } from "@/config/landing-pages";

/**
 * sitemap.xml.
 *
 * Same rule as robots.ts, which is where it was missing (PL Session 04):
 * with NEXT_PUBLIC_SITE_DOMAIN unconfigured there is no honest canonical
 * host, so this publishes NOTHING rather than a full index of pages on
 * `example.com`. It built its base from `BUSINESS.DOMAIN`, whose placeholder
 * fallback exists only so `next build` keeps working — not so that URLs on a
 * domain the owner does not own get served with a 200. robots.txt already
 * refuses to advertise the sitemap in this state, but a disallow is advisory
 * and does not stop a direct fetch or a manual Search Console submission.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  if (!base) return [];

  const products = await listCatalogProducts();
  const staticPaths = [
    "",
    "/products",
    "/custom-bags",
    "/how-it-works",
    "/about",
    "/faq",
    "/contact",
    "/request-quote",
    "/shipping-policy",
    "/return-policy",
    "/privacy",
    "/terms",
  ];
  return [
    ...staticPaths.map((p) => ({ url: `${base}${p}`, changeFrequency: "weekly" as const })),
    ...products.map((p) => ({
      url: `${base}/products/${p.slug}`,
      changeFrequency: "weekly" as const,
      priority: p.hero ? 1 : 0.8,
    })),
    ...LANDING_PAGES.map((l) => ({ url: `${base}/${l.slug}`, changeFrequency: "weekly" as const, priority: 0.9 })),
  ];
}
