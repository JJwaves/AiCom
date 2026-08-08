import { formatMoney, formatQty, formatUnitPrice } from "@/lib/format";
import type { PricingTier } from "@/types/commerce";

/**
 * Interactive tier table. On mobile it renders as cards (no tiny tables).
 * `activeMinQty` highlights the tier the current quantity falls into.
 */
export function TierPricingTable({
  tiers,
  currency,
  activeMinQty,
  onPick,
}: {
  tiers: PricingTier[];
  currency: "USD" | "CAD";
  activeMinQty?: number;
  onPick?: (qty: number) => void;
}) {
  return (
    <div>
      {/* Desktop table */}
      <div className="table-scroll hidden sm:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Volume pricing by quantity</caption>
          <thead>
            <tr className="border-b border-rule-2">
              <th scope="col" className="label-mono py-2 pr-4 text-left font-medium">
                Quantity
              </th>
              <th scope="col" className="label-mono py-2 pr-4 text-right font-medium">
                Price / bag
              </th>
              <th scope="col" className="label-mono py-2 text-right font-medium">
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
                  className={`border-b border-rule transition-colors ${
                    active ? "bg-accent-soft" : "hover:bg-paper-2"
                  } ${onPick ? "cursor-pointer" : ""}`}
                  onClick={onPick ? () => onPick(t.minQty) : undefined}
                  aria-selected={active}
                >
                  <td className="py-2.5 pr-4 font-mono text-ink">
                    {formatQty(t.minQty)}+{active && <span className="label-mono ml-2 !text-accent">← your tier</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-ink">
                    {formatUnitPrice(t.unitPriceCents, currency)}
                  </td>
                  <td className="py-2.5 text-right font-mono text-ink-3">
                    {formatMoney(t.unitPriceCents * t.minQty, currency)}
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
                className="chip w-full flex-col !items-start gap-1 py-3"
              >
                <span className="font-mono text-xs text-ink-3">{formatQty(t.minQty)}+ bags</span>
                <span className="font-mono text-base text-ink">{formatUnitPrice(t.unitPriceCents, currency)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
