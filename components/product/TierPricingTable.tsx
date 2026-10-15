import { formatMoney, formatQty, formatUnitPrice } from "@/lib/format";
import type { PricingTier } from "@/types/commerce";

/**
 * Interactive tier table. On mobile it renders as cards (no tiny tables).
 * `activeMinQty` highlights the tier the current quantity falls into.
 *
 * `unitDeltaCents` adds the selected configuration's per-unit option delta
 * (today: the size delta) so the table shows the price the customer would
 * actually pay, not the price of some other size.
 *
 * `exactQuantities` drops the "+" suffix: on a product whose quantities are
 * a closed set (Product #1: 5,000 or 10,000), "5,000+" would advertise
 * quantities that cannot be ordered.
 */
export function TierPricingTable({
  tiers,
  currency,
  activeMinQty,
  onPick,
  unitDeltaCents = 0,
  exactQuantities = false,
  caption,
}: {
  tiers: PricingTier[];
  currency: "USD" | "CAD";
  activeMinQty?: number;
  onPick?: (qty: number) => void;
  unitDeltaCents?: number;
  exactQuantities?: boolean;
  caption?: string;
}) {
  const unitPrice = (t: PricingTier) => t.unitPriceCents + unitDeltaCents;
  const qtyLabel = (minQty: number) => `${formatQty(minQty)}${exactQuantities ? "" : "+"}`;
  return (
    <div>
      {/* Desktop table */}
      <div className="table-scroll hidden sm:block">
        <table className="w-full border-collapse text-sm tabular">
          <caption className={caption ? "eyebrow pb-3 text-left" : "sr-only"}>
            {caption ?? "Volume pricing by quantity"}
          </caption>
          <thead>
            <tr className="border-b border-brand-hairline-strong">
              <th scope="col" className="eyebrow py-2 pr-4 text-left font-medium">
                Quantity
              </th>
              <th scope="col" className="eyebrow py-2 pr-4 text-right font-medium">
                Price / bag
              </th>
              <th scope="col" className="eyebrow py-2 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => {
              const active = t.minQty === activeMinQty;
              return (
                <tr
                  key={t.minQty}
                  className={`border-b border-brand-hairline transition-colors ${
                    active ? "bg-brand-accent-soft" : "hover:bg-brand-canvas-2"
                  } ${onPick ? "cursor-pointer" : ""}`}
                  onClick={onPick ? () => onPick(t.minQty) : undefined}
                  aria-selected={active}
                >
                  <td className="py-3 pr-4 text-brand-ink">
                    {qtyLabel(t.minQty)}
                    {active && <span className="ml-3 text-xs font-medium text-brand-accent-ink">Your tier</span>}
                  </td>
                  <td className="py-3 pr-4 text-right font-medium text-brand-ink">
                    {formatUnitPrice(unitPrice(t), currency)}
                  </td>
                  <td className="py-3 text-right text-brand-ink-muted">
                    {formatMoney(unitPrice(t) * t.minQty, currency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="grid grid-cols-2 gap-2 sm:hidden">
        {tiers.map((t) => {
          const active = t.minQty === activeMinQty;
          return (
            <li key={t.minQty}>
              <button
                type="button"
                onClick={onPick ? () => onPick(t.minQty) : undefined}
                data-selected={active}
                className={`flex w-full flex-col items-start gap-1 rounded-sm border px-4 py-3 text-left tabular ${
                  active ? "border-brand-accent bg-brand-accent-soft" : "border-brand-border-control bg-brand-surface"
                }`}
              >
                <span className="text-xs text-brand-ink-muted">{qtyLabel(t.minQty)} bags</span>
                <span className="text-base font-medium text-brand-ink">{formatUnitPrice(unitPrice(t), currency)}</span>
                <span className="text-xs text-brand-ink-muted">{formatMoney(unitPrice(t) * t.minQty, currency)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
