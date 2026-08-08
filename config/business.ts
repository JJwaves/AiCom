/**
 * Central business configuration.
 *
 * Every value here is editable without touching frontend components.
 * Values marked [TO BE PROVIDED] are placeholders — see BUSINESS_CONFIG_TODO.md.
 */

export const BUSINESS = {
  BRAND_NAME: "Your Brand",
  /** Short display name used in headers/footers until the real brand exists. */
  DISPLAY_NAME: "BagDirect",
  DOMAIN: "example.com",
  TAGLINE: "Custom Takeout Bags. Factory Direct.",
  FACTORY_LOCATION: "[TO BE PROVIDED]",
  SHIPPING_ORIGIN: "[TO BE PROVIDED]",
  DEFAULT_CURRENCY_US: "USD",
  /** "CAD" or "USD" — configurable. */
  DEFAULT_CURRENCY_CA: "USD",
  /** Minimum order quantity, in units. Placeholder until confirmed. */
  MOQ: 500,
  MOQ_CONFIRMED: false,
  STANDARD_PRODUCTION_TIME: "[TO BE PROVIDED]",
  STANDARD_SHIPPING_TIME: "[TO BE PROVIDED]",
  CUSTOMER_SERVICE_EMAIL: "[TO BE PROVIDED]",
  CUSTOMER_SERVICE_PHONE: "[TO BE PROVIDED]",
  /** Markets served. Drives copy + currency handling. */
  MARKETS: ["US", "CA"] as const,
} as const;

/**
 * Trust/value row content. Only verifiable, structural claims —
 * no fake badges, no invented statistics.
 */
export const VALUE_PROPS = [
  { id: "factory-direct", label: "Factory direct" },
  { id: "custom-printing", label: "Custom logo printing" },
  { id: "bulk-pricing", label: "Bulk pricing" },
  { id: "us-ca", label: "Ships to US & Canada" },
] as const;

/** Announcement bar. Set `enabled: false` to hide. */
export const ANNOUNCEMENT = {
  enabled: true,
  text: "Volume pricing on every order — see the tier table on any product page.",
  href: "/products/custom-non-woven-takeout-bags",
};

/**
 * Demo-content guard. When true, seed pricing renders with a visible
 * "demo pricing" notice. Production builds must set
 * NEXT_PUBLIC_DEMO_PRICING=false only after real prices are loaded.
 */
export function isDemoPricing(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_PRICING !== "false";
}
