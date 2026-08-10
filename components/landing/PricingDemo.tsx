"use client";

import Link from "next/link";
import { useState } from "react";
import { quoteConfiguration } from "@/modules/pricing";
import { formatMoney, formatPct, formatQty, formatUnitPrice } from "@/lib/format";
import type { Product } from "@/types/commerce";

/**
 * The hero's live pricing panel — Workbench "product in use".
 * A real, interactive slice of the configurator: pick a quantity,
 * watch the unit price and total move. Instrument-panel styling.
 * The product arrives as a prop from a server component (catalog reads go
 * through lib/commerce/catalog, never config/products).
 */
export function PricingDemo({ product }: { product: Product }) {
  const [qty, setQty] = useState(5000);

  const quote = quoteConfiguration(product, {
    productId: product.id,
    sizeId: product.sizes[1]?.id ?? product.sizes[0].id,
    materialId: product.materials[0].id,
    colorId: product.colors[0].id,
    printOptionId: "one-color",
    quantity: qty,
  });

  return (
    <div className="graphite-panel p-5 sm:p-6">
      {/* Window bar */}
      <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "oklch(32% 0.016 260)" }}>
        <p className="font-mono text-xs text-graphite-muted">quote — custom-takeout-bag</p>
        <p className="rounded bg-ok-soft px-1.5 py-0.5 font-mono text-[11px] font-medium text-ok">LIVE PRICE</p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-y-2 font-mono text-sm">
        <dt className="text-graphite-muted">size</dt>
        <dd className="text-right text-graphite-ink">Medium · 12&quot;W × 10&quot;H × 8&quot;G</dd>
        <dt className="text-graphite-muted">printing</dt>
        <dd className="text-right text-graphite-ink">1-color logo</dd>
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
              <p className="mt-1 font-mono text-[11px] text-ok">save {formatPct(quote.savingsPct)} vs 500-unit price</p>
            )}
          </div>
          <div className="text-right">
            <p className="label-mono !text-graphite-muted">Total</p>
            <p className="font-mono text-2xl font-semibold sm:text-3xl" style={{ color: "oklch(70% 0.14 256)" }}>
              {formatMoney(quote.totalCents, quote.currency)}
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
      <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-wide text-graphite-muted">
        Demo pricing shown — final prices on the product page
      </p>
    </div>
  );
}
