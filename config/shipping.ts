/**
 * Shipping configuration — separate from UI.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MVP: FLAT $100 PER ORDER, UNITED STATES ONLY
 * ─────────────────────────────────────────────────────────────────────────
 * `FLAT_US_SHIPPING_CENTS` is the CUSTOMER SHIPPING CHARGE. It is a
 * commercial decision, NOT a measured freight cost and NOT a carrier quote.
 * Nothing may describe it as actual freight, as tax-inclusive or as
 * duty-inclusive, and it must never be written into supplier freight cost in
 * config/costs.ts — that field is what shipping COSTS, which nobody has
 * measured yet. The two meet in exactly one place: `shippingPolicy`
 * (config/costs.ts), which subtracts the charge from the cost to report the
 * subsidy BagDirect bears.
 *
 * It is charged ONCE PER ORDER, never once per line: it rides the Shopify
 * draft order as a single `shippingLine` (lib/commerce/shopify.ts), so a
 * six-configuration B2B order pays $100, not $600.
 *
 * Canada is DISABLED for the soft launch (config/business.ts → MARKETS).
 * There is no Canadian rate, no customs handling and no CAD pricing, so a
 * Canadian postal code is answered honestly rather than quoted a US rate.
 */

export type ShippingEstimate =
  | { mode: "checkout"; message: string }
  | { mode: "flat"; message: string; costCents: number }
  | { mode: "unavailable"; message: string }
  | { mode: "estimate"; message: string; costCents: number; transitDays: [number, number] };

/** The MVP flat U.S. shipping charge, in integer cents. One per ORDER. */
export const FLAT_US_SHIPPING_CENTS = 10_000;

/** THE customer-facing sentence for the flat rate. One wording everywhere. */
export const FLAT_US_SHIPPING_COPY = "Flat-rate U.S. shipping: $100 per order";

export const SHIPPING_CONFIG = {
  /**
   * "flat-us" = the MVP flat customer charge above. A real carrier
   * integration (ups | fedex | dhl | freight-table) replaces it; "none"
   * returns to "calculated at checkout".
   */
  rateSource: "flat-us" as "none" | "flat-us" | "ups" | "fedex" | "dhl" | "freight-table",
  originCountry: "[TO BE PROVIDED]",
  /** Handling/production buffer in business days — placeholder. */
  handlingDays: null as [number, number] | null,
  markets: {
    US: { enabled: true, zipPattern: /^\d{5}(-\d{4})?$/ },
    /** Disabled for the soft launch — see the header note. */
    CA: { enabled: false, zipPattern: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/ },
  },
};

/** Which market a postal code belongs to — independent of whether we serve it. */
export function detectMarket(postal: string): "US" | "CA" | null {
  const p = postal.trim();
  if (SHIPPING_CONFIG.markets.US.zipPattern.test(p)) return "US";
  if (SHIPPING_CONFIG.markets.CA.zipPattern.test(p)) return "CA";
  return null;
}

/** True when we actually ship to that market today. */
export function marketEnabled(market: "US" | "CA"): boolean {
  return SHIPPING_CONFIG.markets[market].enabled;
}

/**
 * Estimate shipping for a destination. With the flat MVP rate this returns
 * the exact charge; a market we do not serve is told so plainly rather than
 * being quoted a rate that does not apply to it.
 */
export function estimateShipping(postal: string): ShippingEstimate | { mode: "invalid"; message: string } {
  const market = detectMarket(postal);
  if (!market) {
    return { mode: "invalid", message: "Enter a valid US ZIP code." };
  }
  if (!marketEnabled(market)) {
    return {
      mode: "unavailable",
      message:
        market === "CA"
          ? "We only ship within the United States right now. Request a quote and we'll tell you when Canada opens."
          : "We do not ship to that market yet — request a quote.",
    };
  }
  if (SHIPPING_CONFIG.rateSource === "flat-us") {
    return { mode: "flat", message: `${FLAT_US_SHIPPING_COPY}.`, costCents: FLAT_US_SHIPPING_CENTS };
  }
  if (SHIPPING_CONFIG.rateSource === "none") {
    return { mode: "checkout", message: "Shipping calculated at checkout." };
  }
  // Live-rate integrations land here (UPS/FedEx/DHL/freight tables).
  return { mode: "checkout", message: "Shipping calculated at checkout." };
}
