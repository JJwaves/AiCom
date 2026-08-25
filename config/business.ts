import { metadataDomain } from "./site";

/**
 * Central business configuration.
 *
 * Every value here is editable without touching frontend components.
 * Values marked [TO BE PROVIDED] are placeholders — see BUSINESS_CONFIG_TODO.md.
 *
 * `DOMAIN` is no longer a literal (Production Launch Session 03 §42): it
 * resolves from NEXT_PUBLIC_SITE_DOMAIN via config/site.ts, and falls back to
 * the placeholder ONLY so `next build` keeps working with owner configuration
 * missing. Use `siteDomain()` / `siteUrl()` when you need to know whether a
 * real domain exists; use this when a string is structurally required.
 */

export const BUSINESS = {
  BRAND_NAME: "Your Brand",
  /** Short display name used in headers/footers until the real brand exists. */
  DISPLAY_NAME: "BagDirect",
  get DOMAIN(): string {
    return metadataDomain();
  },
  TAGLINE: "Custom Takeout Bags. Factory Direct.",
  FACTORY_LOCATION: "[TO BE PROVIDED]",
  SHIPPING_ORIGIN: "[TO BE PROVIDED]",
  DEFAULT_CURRENCY_US: "USD",
  /** "CAD" or "USD" — configurable. */
  DEFAULT_CURRENCY_CA: "USD",
  /**
   * Minimum order quantity, in units — 5,000 pieces PER DESIGN, confirmed
   * with the factory for the launch product. Below it there is no published
   * price, so the configurator routes to the custom-quote flow and checkout
   * refuses (modules/pricing → requiresCustomQuote).
   */
  MOQ: 5_000,
  MOQ_CONFIRMED: true,
  /**
   * Production time. The clock starts at ARTWORK-PROOF APPROVAL, not at
   * checkout — saying "ships in 15 days" would start it at payment and make
   * every order late by however long the proof takes.
   */
  STANDARD_PRODUCTION_TIME: "15–30 days after artwork approval",
  /** Transit time after production. Still unknown — no carrier is contracted. */
  STANDARD_SHIPPING_TIME: "[TO BE PROVIDED]",
  CUSTOMER_SERVICE_EMAIL: "[TO BE PROVIDED]",
  CUSTOMER_SERVICE_PHONE: "[TO BE PROVIDED]",
  /**
   * Markets served. US-ONLY for the soft launch: no Canadian shipping rate,
   * no customs/duty handling and no CAD pricing exist, so promising Canada
   * would be selling something that cannot be fulfilled.
   */
  MARKETS: ["US"] as const,
} as const;

/**
 * Digital-proof semantics — the promise the storefront, the cart, the
 * confirmation copy and the AI all have to make identically.
 *
 * Proof preparation is a HUMAN production step. Nothing in this codebase
 * generates a proof, so nothing may say a proof is produced instantly or
 * automatically, and nothing may imply an order enters manufacturing at
 * checkout.
 */
export const PROOF_POLICY = {
  included: true,
  headline: "Digital proof included",
  detail: "A digital proof will be provided for your approval before production begins.",
  productionStart: "Production starts after artwork approval.",
  leadTime: "Production typically takes 15–30 days after you approve your digital proof.",
} as const;

/**
 * Trust/value row content. Only verifiable, structural claims —
 * no fake badges, no invented statistics.
 */
export const VALUE_PROPS = [
  { id: "factory-direct", label: "Factory direct" },
  { id: "custom-printing", label: "Custom logo printing" },
  { id: "digital-proof", label: "Digital proof before production" },
  { id: "flat-shipping", label: "Flat $100 U.S. shipping" },
] as const;

/** Announcement bar. Set `enabled: false` to hide. */
export const ANNOUNCEMENT = {
  enabled: true,
  text: "Custom printed insulated takeout bags — 5,000 piece minimum, digital proof before production.",
  href: "/products/custom-insulated-takeout-bags",
};

/**
 * Demo-content guard. When true, seed pricing renders with a visible
 * "demo pricing" notice. Production builds must set
 * NEXT_PUBLIC_DEMO_PRICING=false only after real prices are loaded.
 *
 * This is an owner ASSERTION, not evidence: it is an environment variable a
 * person sets, and it can disagree with the catalog. Prefer
 * `showsDemoPricing(product)` on any surface that shows or publishes a
 * price — see below.
 */
export function isDemoPricing(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_PRICING !== "false";
}

/**
 * Is the price this product would display a DEMO price? (PL Session 04)
 *
 * THE one answer, because three surfaces were each gating on a different
 * combination of the same two inputs and two of them were wrong:
 *
 *   - the configurator notice required BOTH (`flag && DEMO`), so setting
 *     NEXT_PUBLIC_DEMO_PRICING=false hid the warning while the catalog was
 *     still serving demo numbers;
 *   - the product JSON-LD omitted `offers` on the FLAG ALONE, so the same
 *     setting published demo prices to search engines and Merchant Center as
 *     real `AggregateOffer` prices — the exact thing its comment said it
 *     prevented;
 *   - the homepage panel's notice was unconditional, so it would keep
 *     telling customers "demo pricing" after real prices went live.
 *
 * OR, not AND: a price is demo if EITHER source says so. The catalog
 * (`pricingStatus`) is evidence and the environment flag is an assertion,
 * and neither may silently overrule the other into showing a fake number as
 * real. Both must agree before a price is treated as live — which is also
 * exactly what launch readiness blocks on.
 */
export function showsDemoPricing(product: { pricingStatus: "DEMO" | "LIVE" }): boolean {
  return isDemoPricing() || product.pricingStatus === "DEMO";
}
