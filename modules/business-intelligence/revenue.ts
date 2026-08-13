import type { OrderLineRow, OrderRow } from "@/lib/data/order-service";
import { listOrderLinesForOrderIds, listOrdersCreatedBetween } from "@/lib/data/intelligence-service";
import type { Period } from "@/modules/customer-intelligence/period";
import { available, unavailable, type Metric } from "./availability";

/**
 * DETERMINISTIC revenue metrics (Session 09 spec §5).
 *
 * Source of truth: the orders table (order rows are written server-side
 * at order creation; totals are the engine-priced amounts the customer
 * confirmed). Rules:
 *  - "counted" orders follow existing order semantics: every persisted
 *    order EXCEPT terminal cancelled/refunded statuses (none exist today —
 *    mock orders are `created`; Shopify webhooks land in a later session).
 *  - Revenue comes from orders.totalCents — line rows are used for units
 *    only, so multi-line orders are never double counted.
 *  - Currencies are NEVER combined without a conversion model: per-currency
 *    rows are always exact; the single-number headline metrics are
 *    AVAILABLE only while the period's orders share one currency.
 */

/** Order statuses excluded from revenue (terminal reversals). */
export const EXCLUDED_ORDER_STATUSES = ["cancelled", "refunded"] as const;

export function isCountedOrder(order: OrderRow): boolean {
  return !(EXCLUDED_ORDER_STATUSES as readonly string[]).includes(order.status);
}

export type CurrencyRevenue = {
  currency: string;
  revenueCents: number;
  orders: number;
  /** Revenue ÷ orders, integer cents; null when the period has no orders. */
  aovCents: number | null;
  units: number;
  lines: number;
  aiAssisted: { orders: number; revenueCents: number; units: number };
};

export type RevenueMetrics = {
  byCurrency: CurrencyRevenue[];
  /** Headline metrics — single-currency only (no invented FX conversion). */
  revenueCents: Metric<number>;
  orders: Metric<number>;
  aovCents: Metric<number>;
  units: Metric<number>;
  aiAssistedRevenueCents: Metric<number>;
  aiAssistedOrders: Metric<number>;
  /** The single currency the headlines are denominated in (null when mixed/none). */
  currency: string | null;
  /** Orders excluded by status (cancelled/refunded) — surfaced, not hidden. */
  excludedOrders: number;
};

const MIXED_CURRENCY_REASON =
  "Orders span multiple currencies and no conversion model is configured — see per-currency rows instead.";

/** Pure aggregation over already-loaded rows (unit-testable without a DB). */
export function computeRevenueMetrics(orders: OrderRow[], lines: OrderLineRow[]): RevenueMetrics {
  const counted = orders.filter(isCountedOrder);
  const excludedOrders = orders.length - counted.length;
  const linesByOrder = new Map<string, OrderLineRow[]>();
  for (const line of lines) {
    const list = linesByOrder.get(line.orderId) ?? [];
    list.push(line);
    linesByOrder.set(line.orderId, list);
  }

  const byCurrency = new Map<string, CurrencyRevenue>();
  for (const order of counted) {
    const row =
      byCurrency.get(order.currency) ??
      ({
        currency: order.currency,
        revenueCents: 0,
        orders: 0,
        aovCents: null,
        units: 0,
        lines: 0,
        aiAssisted: { orders: 0, revenueCents: 0, units: 0 },
      } satisfies CurrencyRevenue);
    const orderLines = linesByOrder.get(order.id) ?? [];
    const units = orderLines.reduce((s, l) => s + l.quantity, 0);
    row.revenueCents += order.totalCents;
    row.orders += 1;
    row.units += units;
    row.lines += orderLines.length;
    if (order.aiAssisted) {
      row.aiAssisted.orders += 1;
      row.aiAssisted.revenueCents += order.totalCents;
      row.aiAssisted.units += units;
    }
    byCurrency.set(order.currency, row);
  }
  for (const row of byCurrency.values()) {
    row.aovCents = row.orders > 0 ? Math.round(row.revenueCents / row.orders) : null;
  }
  const currencies = [...byCurrency.values()].sort((a, b) => b.revenueCents - a.revenueCents);

  if (currencies.length > 1) {
    return {
      byCurrency: currencies,
      revenueCents: unavailable(MIXED_CURRENCY_REASON),
      orders: available(counted.length),
      aovCents: unavailable(MIXED_CURRENCY_REASON),
      units: available(currencies.reduce((s, c) => s + c.units, 0)),
      aiAssistedRevenueCents: unavailable(MIXED_CURRENCY_REASON),
      aiAssistedOrders: available(currencies.reduce((s, c) => s + c.aiAssisted.orders, 0)),
      currency: null,
      excludedOrders,
    };
  }

  const single = currencies[0] ?? null;
  return {
    byCurrency: currencies,
    revenueCents: available(single?.revenueCents ?? 0),
    orders: available(single?.orders ?? 0),
    aovCents:
      single && single.aovCents !== null
        ? available(single.aovCents)
        : unavailable("No completed orders in this period."),
    units: available(single?.units ?? 0),
    aiAssistedRevenueCents: available(single?.aiAssisted.revenueCents ?? 0),
    aiAssistedOrders: available(single?.aiAssisted.orders ?? 0),
    currency: single?.currency ?? null,
    excludedOrders,
  };
}

export type PeriodOrders = { period: Period; orders: OrderRow[]; lines: OrderLineRow[] };

/** Load the period's order rows once — shared by revenue/products/profitability/segments. */
export async function loadPeriodOrders(period: Period): Promise<PeriodOrders> {
  const orders = await listOrdersCreatedBetween(period.start, period.end);
  const lines = await listOrderLinesForOrderIds(orders.map((o) => o.id));
  return { period, orders, lines };
}
