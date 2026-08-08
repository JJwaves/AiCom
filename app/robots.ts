import type { MetadataRoute } from "next";
import { BUSINESS } from "@/config/business";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Ad landing variants, cart and account are noise for crawlers
        disallow: ["/lp/", "/cart", "/account", "/api/"],
      },
    ],
    sitemap: `https://${BUSINESS.DOMAIN}/sitemap.xml`,
  };
}
