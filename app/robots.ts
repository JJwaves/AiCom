import type { MetadataRoute } from "next";
import { BUSINESS } from "@/config/business";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Ad landing variants, cart, account and the admin surface are noise for crawlers
        disallow: ["/lp/", "/cart", "/account", "/api/", "/admin"],
      },
    ],
    sitemap: `https://${BUSINESS.DOMAIN}/sitemap.xml`,
  };
}
