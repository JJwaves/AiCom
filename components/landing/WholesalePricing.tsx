import Link from "next/link";
import { QUOTE_CTA, showsDemoPricing } from "@/config/business";
import { FLAT_US_SHIPPING_COPY } from "@/config/shipping";
import { formatDimensions, formatMoney, formatQty, formatUnitPrice } from "@/lib/format";
import type { Product } from "@/types/commerce";
import { Badge } from "@/components/ui/badge";

/**
 * Wholesale price breaks — DESIGN.md §4 "Tables" and b2b-commerce-ui principle 2:
 * price is shown as breaks (quantity tier → unit → total), per size, with the flat shipping
 * charge stated separately. Numbers come straight from the catalog tiers + size deltas, the
 * same inputs the pricing engine uses, so this table can never disagree with a quote.
 */
export function WholesalePricing({
  product,
  compact = false,
  ground = "canvas",
}: {
  product: Product;
  compact?: boolean;
  /** The background the table sits on — the sticky first column must match it. */
  ground?: "canvas" | "canvas-2";
}) {
  const tiers = product.pricingTiers;
  const demo = showsDemoPricing(product);
  const groundClass = ground === "canvas-2" ? "bg-brand-canvas-2" : "bg-brand-canvas";
  return (
    <div>
      <div className="table-scroll">
        <table className="w-full min-w-lg border-collapse text-sm tabular">
          <caption className="sr-only">Wholesale price per bag by size and quantity</caption>
          <thead>
            <tr className="border-b border-brand-hairline-strong bg-brand-canvas-2">
              <th scope="col" className="eyebrow sticky left-0 bg-brand-canvas-2 py-3 pr-4 pl-4 text-left font-medium">
                Size
              </th>
              {tiers.map((t) => (
                <th key={t.minQty} scope="col" className="eyebrow py-3 pr-4 text-right font-medium">
                  {formatQty(t.minQty)} bags
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {product.sizes.map((s) => (
              <tr key={s.id} className="border-b border-brand-hairline">
                <th scope="row" className={`sticky left-0 ${groundClass} py-4 pr-4 pl-4 text-left align-top font-normal`}>
                  <span className="block font-medium text-brand-ink">{s.label}</span>
                  <span className="block text-xs text-brand-ink-muted">{formatDimensions({ ...s.dimensions, unit: s.unit })}</span>
                </th>
                {tiers.map((t) => {
                  const unit = t.unitPriceCents + s.priceDeltaCents;
                  return (
                    <td key={t.minQty} className="py-4 pr-4 text-right align-top">
                      <span className="block font-heading text-xl font-medium text-brand-ink">{formatUnitPrice(unit, product.currency)}</span>
                      <span className="block text-xs text-brand-ink-muted">
                        {formatMoney(unit * t.minQty, product.currency)} {compact ? "" : "per design"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-brand-ink-2">
        {demo && <Badge variant="secondary">Demo pricing — replace before launch</Badge>}
        <p>Product subtotal per design, printed with your artwork. {FLAT_US_SHIPPING_COPY}, charged once per order.</p>
        {!compact && (
          <p>
            More than {formatQty(tiers[tiers.length - 1].minQty)}, a custom size or another colour?{" "}
            <Link href={`${QUOTE_CTA.href}?product=${product.slug}`} className="text-brand-accent-ink underline underline-offset-3 hover:text-brand-ink">
              Request a quote
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
