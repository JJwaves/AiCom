import type { MetadataRoute } from "next";
import { BUSINESS } from "@/config/business";
import { PRODUCTS } from "@/config/products";
import { LANDING_PAGES } from "@/config/landing-pages";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = `https://${BUSINESS.DOMAIN}`;
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
    ...PRODUCTS.map((p) => ({
      url: `${base}/products/${p.slug}`,
      changeFrequency: "weekly" as const,
      priority: p.hero ? 1 : 0.8,
    })),
    ...LANDING_PAGES.map((l) => ({ url: `${base}/${l.slug}`, changeFrequency: "weekly" as const, priority: 0.9 })),
  ];
}
