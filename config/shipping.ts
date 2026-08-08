/**
 * Shipping configuration — separate from UI.
 *
 * NO INVENTED PRICES. Until a live rate source (UPS/FedEx/DHL/freight table)
 * is configured, the estimator returns mode "checkout" and the UI shows
 * "Shipping calculated at checkout".
 *
 * Future integrations plug in via `rateSource`.
 */

export type ShippingEstimate =
  | { mode: "checkout"; message: string }
  | { mode: "estimate"; message: string; costCents: number; transitDays: [number, number] };

export const SHIPPING_CONFIG = {
  /** "none" until a real rate source exists. Options: none | ups | fedex | dhl | freight-table */
  rateSource: "none" as "none" | "ups" | "fedex" | "dhl" | "freight-table",
  originCountry: "[TO BE PROVIDED]",
  /** Handling/production buffer in business days — placeholder. */
  handlingDays: null as [number, number] | null,
  markets: {
    US: { enabled: true, zipPattern: /^\d{5}(-\d{4})?$/ },
    CA: { enabled: true, zipPattern: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/ },
  },
};

export function detectMarket(postal: string): "US" | "CA" | null {
  const p = postal.trim();
  if (SHIPPING_CONFIG.markets.US.zipPattern.test(p)) return "US";
  if (SHIPPING_CONFIG.markets.CA.zipPattern.test(p)) return "CA";
  return null;
}

/**
 * Estimate shipping for a destination. With no rate source configured this
 * honestly reports "calculated at checkout" rather than inventing numbers.
 */
export function estimateShipping(postal: string): ShippingEstimate | { mode: "invalid"; message: string } {
  const market = detectMarket(postal);
  if (!market) {
    return { mode: "invalid", message: "Enter a valid US ZIP or Canadian postal code." };
  }
  if (SHIPPING_CONFIG.rateSource === "none") {
    return {
      mode: "checkout",
      message: `Ships to ${market === "US" ? "the US" : "Canada"} — shipping calculated at checkout.`,
    };
  }
  // Live-rate integrations land here (UPS/FedEx/DHL/freight tables).
  return { mode: "checkout", message: "Shipping calculated at checkout." };
}
