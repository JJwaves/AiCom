"use client";

import Link from "next/link";
import { useState } from "react";
import { showsDemoPricing } from "@/config/business";
import { FLAT_US_SHIPPING_CENTS } from "@/config/shipping";
import { quoteConfiguration } from "@/modules/pricing";
import { formatDimensions, formatMoney, formatPct, formatQty, formatUnitPrice } from "@/lib/format";
import type { Product } from "@/types/commerce";

/**
 * The hero's live pricing panel — Workbench "product in use".
 * A real, interactive slice of the configurator: pick a quantity,
 * watch the unit price and total move. Instrument-panel styling.
 * The product arrives as a prop from a server component (catalog reads go
 * through lib/commerce/catalog, never config/products).
 *
 * EVERY LABEL IS DERIVED FROM THE CONFIGURATION IT PRICES. This panel used to
 * hardcode its size and printing text ("Medium · 12\"W × 10\"H × 8\"G",
 * "1-color logo") while quoting a different configuration entirely, so a
 * catalog change left the homepage advertising a size that does not exist at a
 * price belonging to another one. A displayed spec is now unable to disagree
 * with the quoted spec, because there is only one source for both.
 */
export function PricingDemo({ product }: { product: Product }) {
  const [qty, setQty] = useState(product.quantityPresets[0] ?? product.minQuantity);

  const size = product.sizes[0];
  const print = product.printOptions[0];
  const quote = quoteConfiguration(product, {
    productId: product.id,
    sizeId: size.id,
    materialId: product.materials[0].id,
    colorId: product.colors[0].id,
    printOptionId: print.id,
    quantity: qty,
  });
  const cheapestTier = product.pricingTiers[0];

  return (
    <div className="graphite-panel p-5 sm:p-6">
      {/* Window bar */}
      <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "oklch(32% 0.016 260)" }}>
        <p className="font-mono text-xs text-graphite-muted">quote — custom-takeout-bag</p>
        <p className="rounded bg-ok-soft px-1.5 py-0.5 font-mono text-[11px] font-medium text-ok">LIVE PRICE</p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-y-2 font-mono text-sm">
        <dt className="text-graphite-muted">size</dt>
        <dd className="text-right text-graphite-ink">
          {size.label} · {formatDimensions({ ...size.dimensions, unit: size.unit })}
        </dd>
        <dt className="text-graphite-muted">printing</dt>
        <dd className="text-right text-graphite-ink">{print.label}</dd>
        <dt className="text-graphite-muted">quantity</dt>
        <dd className="text-right text-graphite-ink">{formatQty(qty)} bags</dd>
      </dl>

      {/* Quantity picker */}
      <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Try a quantity">
        {product.quantityPresets.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setQty(q)}
            aria-pressed={q === qty}
            className="rounded-[6px] border px-2.5 py-1.5 font-mono text-xs transition-colors"
            style={
              q === qty
                ? { borderColor: "oklch(52% 0.2 256)", background: "oklch(52% 0.2 256 / 0.18)", color: "oklch(80% 0.1 256)" }
                : { borderColor: "oklch(32% 0.016 260)", color: "oklch(68% 0.014 255)" }
            }
          >
            {formatQty(q)}
          </button>
        ))}
      </div>

      {quote && (
        <div className="mt-5 flex items-end justify-between gap-4 border-t pt-4" style={{ borderColor: "oklch(32% 0.016 260)" }} aria-live="polite">
          <div>
            <p className="label-mono !text-graphite-muted">Price / bag</p>
            <p className="font-mono text-2xl font-semibold text-graphite-ink sm:text-3xl">
              {formatUnitPrice(quote.unitPriceCents, quote.currency)}
            </p>
            {quote.savingsPct > 0 && (
              <p className="mt-1 font-mono text-[11px] text-ok">
                save {formatPct(quote.savingsPct)} vs the {formatQty(cheapestTier.minQty)} price
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="label-mono !text-graphite-muted">Total</p>
            <p className="font-mono text-2xl font-semibold sm:text-3xl" style={{ color: "oklch(70% 0.14 256)" }}>
              {formatMoney(quote.totalCents, quote.currency)}
            </p>
            {/* Shipping is a separate charge; the panel must not read as an
                all-in price. */}
            <p className="mt-1 font-mono text-[11px] text-graphite-muted">
              + {formatMoney(FLAT_US_SHIPPING_CENTS, quote.currency)} shipping
            </p>
          </div>
        </div>
      )}

      <Link
        href={`/products/${product.slug}`}
        className="btn btn--primary mt-5 w-full text-sm"
      >
        Configure yours — full pricing
      </Link>
      {showsDemoPricing(product) && (
        <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-wide text-graphite-muted">
          Demo pricing shown — final prices on the product page
        </p>
      )}
    </div>
  );
}
