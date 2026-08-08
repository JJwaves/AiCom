/** Money + number formatting at the presentation edge. */

export function formatMoney(cents: number, currency: "USD" | "CAD" = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/** Per-unit prices keep sub-cent clarity: $0.42 not $0.4. */
export function formatUnitPrice(cents: number, currency: "USD" | "CAD" = "USD"): string {
  return formatMoney(cents, currency);
}

export function formatQty(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function formatDimensions(d: { width: number; height: number; gusset: number }): string {
  return `${d.width}"W × ${d.height}"H × ${d.gusset}"G`;
}
