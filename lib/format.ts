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

/**
 * width × height × side gusset, in the size's own unit.
 *
 * The unit is never assumed: Product #1 is specified in centimetres and the
 * older catalog entries in inches, so a bare `26 × 26 × 17` would read as
 * inches on one product and centimetres on another.
 */
export function formatDimensions(d: {
  width: number;
  height: number;
  gusset: number;
  unit?: "in" | "cm";
}): string {
  if (d.unit === "cm") return `${d.width} × ${d.height} × ${d.gusset} cm`;
  return `${d.width}"W × ${d.height}"H × ${d.gusset}"G`;
}

/** Spelled-out dimensions, for places with room to be unambiguous. */
export function describeDimensions(d: {
  width: number;
  height: number;
  gusset: number;
  unit?: "in" | "cm";
}): string {
  const u = d.unit === "cm" ? "cm" : "in";
  return `Width ${d.width} ${u} · Height ${d.height} ${u} · Side gusset ${d.gusset} ${u}`;
}
