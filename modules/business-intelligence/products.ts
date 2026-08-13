import { volumeGroupFor } from "@/config/customer-intelligence";
import { COST_MODEL } from "@/config/costs";
import type { OrderLineRow, OrderRow } from "@/lib/data/order-service";
import { computeCosts, productCostCents, type CostModelConfig } from "@/modules/pricing";
import type { Product } from "@/types/commerce";
import { available, partial, unavailable, type Metric } from "./availability";
import { isCountedOrder } from "./revenue";

/**
 * DETERMINISTIC product performance (Session 09 spec §12) — aggregation
 * over immutable order-line snapshots.
 *
 * Per-product profitability is GROSS only (revenue − product COGS): the
 * payment fee is charged per TRANSACTION, so contribution profit is an
 * order-level metric (profitability.ts) — allocating a fixed per-order
 * fee across products would be an invented split. Selling price alone is
 * never presented as profit.
 */

export type ValueCount = { value: string; count: number };

export type ProductPerformance = {
  productId: string;
  /** Title from the order-line snapshot (survives catalog changes). */
  title: string;
  orders: number;
  lines: number;
  revenueCents: number;
  units: number;
  volumeGroups: ValueCount[];
  quantities: ValueCount[];
  sizes: ValueCount[];
  colors: ValueCount[];
  printing: ValueCount[];
  /** GROSS profit only — see module note. Unavailable until costs exist. */
  grossProfitCents: Metric<number>;
};

const toCounts = (m: Map<string, number>): ValueCount[] =>
  [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);

export function computeProductPerformance(
  orders: OrderRow[],
  lines: OrderLineRow[],
  products: Product[],
  model: CostModelConfig = COST_MODEL,
): ProductPerformance[] {
  const countedOrderIds = new Set(orders.filter(isCountedOrder).map((o) => o.id));
  const productById = new Map(products.map((p) => [p.id, p]));

  type Acc = {
    title: string;
    orderIds: Set<string>;
    lines: number;
    revenueCents: number;
    units: number;
    volumeGroups: Map<string, number>;
    quantities: Map<string, number>;
    sizes: Map<string, number>;
    colors: Map<string, number>;
    printing: Map<string, number>;
    grossCents: number;
    costedLines: number;
    uncostedLines: number;
    missing: Set<string>;
  };
  const byProduct = new Map<string, Acc>();

  for (const line of lines) {
    if (!countedOrderIds.has(line.orderId)) continue;
    const acc =
      byProduct.get(line.productId) ??
      ({
        title: line.title,
        orderIds: new Set(),
        lines: 0,
        revenueCents: 0,
        units: 0,
        volumeGroups: new Map(),
        quantities: new Map(),
        sizes: new Map(),
        colors: new Map(),
        printing: new Map(),
        grossCents: 0,
        costedLines: 0,
        uncostedLines: 0,
        missing: new Set(),
      } satisfies Acc);
    acc.orderIds.add(line.orderId);
    acc.lines += 1;
    acc.revenueCents += line.totalCents;
    acc.units += line.quantity;
    const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);
    bump(acc.volumeGroups, volumeGroupFor(line.quantity));
    bump(acc.quantities, String(line.quantity));
    const conf = line.configJson;
    if (conf) {
      bump(acc.sizes, conf.sizeId);
      bump(acc.colors, conf.colorId);
      bump(acc.printing, conf.printOptionId);
    }

    const product = productById.get(line.productId);
    if (!product) {
      acc.uncostedLines += 1;
      acc.missing.add(`catalog product "${line.productId}"`);
    } else {
      const computed = computeCosts(product, line.configJson, line.totalCents, model);
      if (computed.status === "unconfigured") {
        acc.uncostedLines += 1;
        for (const m of computed.missingInputs.slice(0, 10)) acc.missing.add(m);
      } else {
        acc.costedLines += 1;
        acc.grossCents += line.totalCents - productCostCents(computed.costs);
      }
    }
    byProduct.set(line.productId, acc);
  }

  return [...byProduct.entries()]
    .map(([productId, acc]) => {
      let grossProfitCents: Metric<number>;
      if (acc.costedLines === 0) {
        grossProfitCents = unavailable(
          "Unavailable — configure manufacturing costs for this product (config/costs.ts).",
          [...acc.missing],
        );
      } else if (acc.uncostedLines > 0) {
        grossProfitCents = partial(
          acc.grossCents,
          `Covers ${acc.costedLines} of ${acc.lines} lines — the rest have unconfigured cost inputs.`,
          [...acc.missing],
        );
      } else {
        grossProfitCents = available(acc.grossCents);
      }
      return {
        productId,
        title: acc.title,
        orders: acc.orderIds.size,
        lines: acc.lines,
        revenueCents: acc.revenueCents,
        units: acc.units,
        volumeGroups: toCounts(acc.volumeGroups),
        quantities: toCounts(acc.quantities),
        sizes: toCounts(acc.sizes),
        colors: toCounts(acc.colors),
        printing: toCounts(acc.printing),
        grossProfitCents,
      };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents);
}
