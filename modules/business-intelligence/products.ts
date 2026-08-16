import { volumeGroupFor } from "@/config/customer-intelligence";
import { COST_MODEL } from "@/config/costs";
import type { OrderLineRow, OrderRow } from "@/lib/data/order-service";
import { computeLineCosts, type CostModelConfig } from "@/modules/pricing";
import type { Product } from "@/types/commerce";
import { available, partial, unavailable, type Metric } from "./availability";
import type { ProfitabilityOptions } from "./profitability";
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
  options: ProfitabilityOptions = {},
): ProductPerformance[] {
  const costBasis = options.historicalCostBasis ?? "SNAPSHOT_ONLY";
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

    /* Cost basis, in order of truthfulness:
     *  1. the line's OWN cost snapshot — what it actually cost that day;
     *  2. nothing. A line without a snapshot is uncosted, because
     *     re-costing it at today's prices would report a number that was
     *     never true (13.5 §28). The CURRENT_CONFIG_SCENARIO basis is
     *     available at order level only, where it is labelled. */
    const snapshot = costBasis === "SNAPSHOT_ONLY" ? line.costSnapshotJson : null;
    const product = productById.get(line.productId);
    if (snapshot) {
      acc.costedLines += 1;
      acc.grossCents += line.totalCents - snapshot.cogs.totalCents;
    } else if (!product) {
      acc.uncostedLines += 1;
      acc.missing.add(`catalog product "${line.productId}"`);
    } else {
      const computed = computeLineCosts(product, line.configJson, model);
      if (costBasis === "CURRENT_CONFIG_SCENARIO" && computed.status === "configured") {
        acc.costedLines += 1;
        acc.grossCents += line.totalCents - computed.cogs.totalCents;
      } else {
        acc.uncostedLines += 1;
        if (computed.status === "unconfigured") {
          for (const m of computed.missingInputs.slice(0, 10)) acc.missing.add(m);
        } else {
          acc.missing.add("orders: no cost snapshot recorded for this line (HISTORICAL_COST_UNAVAILABLE)");
        }
      }
    }
    byProduct.set(line.productId, acc);
  }

  return [...byProduct.entries()]
    .map(([productId, acc]) => {
      let grossProfitCents: Metric<number>;
      if (acc.costedLines === 0) {
        grossProfitCents = unavailable(
          "Unavailable — no line in this period carries a cost snapshot. Either manufacturing costs are not configured (config/costs.ts) or these orders predate cost snapshots; today's costs are not applied backwards.",
          [...acc.missing],
        );
      } else if (acc.uncostedLines > 0) {
        grossProfitCents = partial(
          acc.grossCents,
          `Covers ${acc.costedLines} of ${acc.lines} lines — the rest have no recorded cost snapshot.`,
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
