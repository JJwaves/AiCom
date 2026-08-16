import { COST_MODEL } from "@/config/costs";
import type { OrderLineRow, OrderRow } from "@/lib/data/order-service";
import {
  computeOrderUnitEconomics,
  economicsFromSnapshot,
  HISTORICAL_COST_UNAVAILABLE,
  HISTORICAL_COST_UNAVAILABLE_REASON,
  isCostModelConfigured,
  type CostModelConfig,
  type UnitEconomics,
} from "@/modules/pricing";
import type { Product } from "@/types/commerce";
import { available, partial, unavailable, type Metric } from "./availability";
import { isCountedOrder } from "./revenue";

/**
 * DETERMINISTIC profitability (Session 09 spec §2, §9–§10; rebuilt on the
 * Session 13.5 unit-economics model).
 *
 * Every number comes from `modules/pricing` — the single cost authority.
 * The hard rule holds structurally: any missing cost input makes the
 * affected orders un-costable and the metric PARTIAL/UNAVAILABLE with the
 * missing inputs listed — null is never zero, and nothing here estimates
 * a cost.
 *
 * METRIC SEMANTICS (named precisely):
 *  - GROSS PROFIT = revenue − product COGS (manufacturing + printing +
 *    setup + packaging, including order-scope packaging).
 *  - CONTRIBUTION PROFIT BEFORE PAID MEDIA = gross profit − variable
 *    selling/fulfilment costs (payment processing + shipping subsidy +
 *    handling + other variable). Payment fees are computed per ORDER:
 *    percent of the order total plus ONE fixed fee per transaction, never
 *    one fixed fee per line.
 *  - PAID MEDIA is NOT subtracted here. The name says so; this is never
 *    presented as "net profit". Contribution AFTER paid media lives in
 *    modules/google-ads-intelligence, where attributable spend exists.
 *
 * TWO LEVELS, TWO AVAILABILITIES (13.5 §22). Gross profit may be
 * AVAILABLE while contribution is UNAVAILABLE — knowing what a bag costs
 * to make does not tell you what the processor charged.
 *
 * HISTORICAL COST BASIS (13.5 §28, §48). By default only orders carrying a
 * COST SNAPSHOT are costed: an order placed before the cost model existed
 * reports HISTORICAL_COST_UNAVAILABLE, because applying today's costs
 * backwards would report a number that was never true. A clearly labelled
 * CURRENT_CONFIG_SCENARIO basis exists for "what would these orders look
 * like under today's costs?" — it is opt-in and never the dashboard default.
 */

export type HistoricalCostBasis = "SNAPSHOT_ONLY" | "CURRENT_CONFIG_SCENARIO";

export type ProfitabilityOptions = {
  /** Default SNAPSHOT_ONLY — accounting truth. See the module note. */
  historicalCostBasis?: HistoricalCostBasis;
};

export type ProfitabilityMetrics = {
  ordersTotal: number;
  /** Orders whose gross profit could be established. */
  ordersCosted: number;
  /** Orders with no cost snapshot (SNAPSHOT_ONLY basis only). */
  ordersWithoutCostSnapshot: number;
  /** Orders costed but whose contribution level was unavailable. */
  ordersWithoutContribution: number;
  /** Which cost basis produced these numbers. Rendered wherever they appear. */
  costBasis: HistoricalCostBasis;
  grossProfitCents: Metric<number>;
  /** Fraction 0–1 (repo convention, cf. calculatePrice.grossMarginPct). */
  grossMarginPct: Metric<number>;
  contributionProfitBeforePaidMediaCents: Metric<number>;
  contributionMarginBeforePaidMediaPct: Metric<number>;
  /** Deduplicated missing cost inputs (capped) — drives the owner TODO list. */
  missingCostInputs: string[];
  /** Formula + exclusions, rendered wherever the numbers appear. */
  notes: string[];
};

export const PROFITABILITY_NOTES = [
  "Gross profit = revenue − product COGS (manufacturing + printing + setup + packaging).",
  "Contribution profit (before paid media) = gross profit − variable selling costs (payment processing + shipping subsidy + fulfilment handling + other variable).",
  "Shipping subsidy = max(actual shipping cost − shipping charged to the customer, 0). Checkout collects no separate shipping charge today, so the subsidy is the full freight cost.",
  "Ad spend is not subtracted here — contribution explicitly excludes paid media and is never presented as net profit. POAS lives in Google Ads Intelligence.",
  "Discounts are structurally zero: the deterministic pricing engine is the only price authority and no discount mechanism exists.",
  "Only orders carrying a cost snapshot are costed. Orders placed before their costs were known report their profit as unavailable rather than being re-costed at today's prices.",
];

const MAX_MISSING_INPUTS = 25;

type OrderCosting =
  | { status: "costed"; economics: UnitEconomics }
  | { status: "uncosted"; missingInputs: string[]; code?: typeof HISTORICAL_COST_UNAVAILABLE };

/** Resolve one order's economics under the selected historical cost basis. */
function costOrder(
  order: OrderRow,
  lines: OrderLineRow[],
  productById: Map<string, Product>,
  model: CostModelConfig,
  basis: HistoricalCostBasis,
): OrderCosting {
  if (basis === "SNAPSHOT_ONLY") {
    const snapshot = order.costSnapshotJson;
    if (!snapshot) {
      return { status: "uncosted", missingInputs: [], code: HISTORICAL_COST_UNAVAILABLE };
    }
    return { status: "costed", economics: economicsFromSnapshot(snapshot) };
  }

  if (lines.length === 0) {
    return { status: "uncosted", missingInputs: [`orders.${order.id}: no line rows`] };
  }
  const economics = computeOrderUnitEconomics({
    revenueCents: order.totalCents,
    currency: order.currency,
    model,
    lines: lines.map((line) => ({
      productId: line.productId,
      product: productById.get(line.productId) ?? null,
      config: line.configJson,
      revenueCents: line.totalCents,
    })),
  });
  return economics.grossStatus === "AVAILABLE"
    ? { status: "costed", economics }
    : { status: "uncosted", missingInputs: economics.missingInputs };
}

/**
 * Static config completeness check — true only when EVERY cost input is
 * provided. Delegates to `modules/pricing` so there is exactly one
 * definition of "are costs configured?" in the repository.
 */
export function isCostModelFullyConfigured(model: CostModelConfig = COST_MODEL): boolean {
  return isCostModelConfigured(model);
}

export function computeProfitability(
  orders: OrderRow[],
  lines: OrderLineRow[],
  products: Product[],
  model: CostModelConfig = COST_MODEL,
  options: ProfitabilityOptions = {},
): ProfitabilityMetrics {
  const costBasis = options.historicalCostBasis ?? "SNAPSHOT_ONLY";
  const counted = orders.filter(isCountedOrder);
  const productById = new Map(products.map((p) => [p.id, p]));
  const linesByOrder = new Map<string, OrderLineRow[]>();
  for (const line of lines) {
    const list = linesByOrder.get(line.orderId) ?? [];
    list.push(line);
    linesByOrder.set(line.orderId, list);
  }

  const notes =
    costBasis === "CURRENT_CONFIG_SCENARIO"
      ? [
          ...PROFITABILITY_NOTES.slice(0, -1),
          "SCENARIO: these figures apply TODAY'S cost configuration to past orders. They are an illustration, not accounting truth.",
        ]
      : PROFITABILITY_NOTES;

  const base = { ordersTotal: counted.length, costBasis, notes };
  const emptyCounts = { ordersCosted: 0, ordersWithoutCostSnapshot: 0, ordersWithoutContribution: 0 };

  if (counted.length === 0) {
    const none = unavailable<number>("No completed orders in this period.");
    return {
      ...base,
      ...emptyCounts,
      grossProfitCents: none,
      grossMarginPct: none,
      contributionProfitBeforePaidMediaCents: none,
      contributionMarginBeforePaidMediaPct: none,
      missingCostInputs: [],
    };
  }

  const currencies = new Set(counted.map((o) => o.currency));
  if (currencies.size > 1) {
    const mixed = unavailable<number>(
      "Orders span multiple currencies and no conversion model is configured — profitability cannot be combined.",
    );
    return {
      ...base,
      ...emptyCounts,
      grossProfitCents: mixed,
      grossMarginPct: mixed,
      contributionProfitBeforePaidMediaCents: mixed,
      contributionMarginBeforePaidMediaPct: mixed,
      missingCostInputs: [],
    };
  }

  const missingSet = new Set<string>();
  let costed = 0;
  let withoutSnapshot = 0;
  let grossRevenue = 0;
  let gross = 0;
  /* Contribution has its own coverage: an order may have gross without it. */
  let contributionOrders = 0;
  let contributionRevenue = 0;
  let contribution = 0;

  for (const order of counted) {
    const result = costOrder(order, linesByOrder.get(order.id) ?? [], productById, model, costBasis);
    if (result.status === "uncosted") {
      if (result.code === HISTORICAL_COST_UNAVAILABLE) withoutSnapshot += 1;
      for (const m of result.missingInputs) {
        if (missingSet.size < MAX_MISSING_INPUTS) missingSet.add(m);
      }
      continue;
    }
    costed += 1;
    grossRevenue += result.economics.revenueCents;
    gross += result.economics.grossProfitCents ?? 0;
    if (result.economics.contributionBeforePaidMediaCents !== null) {
      contributionOrders += 1;
      contributionRevenue += result.economics.revenueCents;
      contribution += result.economics.contributionBeforePaidMediaCents;
    } else {
      for (const m of result.economics.missingInputs) {
        if (missingSet.size < MAX_MISSING_INPUTS) missingSet.add(m);
      }
    }
  }
  const missingCostInputs = [...missingSet];

  const snapshotReason = `${HISTORICAL_COST_UNAVAILABLE}: ${HISTORICAL_COST_UNAVAILABLE_REASON}`;
  const configReason =
    "Unavailable — configure manufacturing costs. The factory cost model (config/costs.ts) has unfilled inputs, so profit cannot be computed. Missing inputs are listed; they are never assumed to be zero.";

  if (costed === 0) {
    const reason = withoutSnapshot > 0 && missingCostInputs.length === 0 ? snapshotReason : configReason;
    const none = unavailable<number>(reason, missingCostInputs);
    return {
      ...base,
      ordersCosted: 0,
      ordersWithoutCostSnapshot: withoutSnapshot,
      ordersWithoutContribution: 0,
      grossProfitCents: none,
      grossMarginPct: none,
      contributionProfitBeforePaidMediaCents: none,
      contributionMarginBeforePaidMediaPct: none,
      missingCostInputs,
    };
  }

  /** Wrap a level's value with the coverage its own denominator earned. */
  const wrap = (value: number, covered: number, what: string): Metric<number> =>
    covered === counted.length
      ? available(value)
      : partial(
          value,
          `Covers ${covered} of ${counted.length} orders — the rest have no ${what} (never assumed zero).`,
          missingCostInputs,
        );
  const marginOf = (profit: number, revenue: number, covered: number, what: string): Metric<number> =>
    revenue > 0
      ? wrap(profit / revenue, covered, what)
      : unavailable("Costed orders have zero revenue — margin undefined.");

  const grossWhat = costBasis === "SNAPSHOT_ONLY" ? "recorded cost snapshot" : "configured cost inputs";
  const contributionMetric: Metric<number> =
    contributionOrders === 0
      ? unavailable(
          "Gross profit is available, but contribution profit before paid media is not: the variable selling costs it subtracts (payment processing, shipping subsidy, fulfilment handling) were not known for any order in this period.",
          missingCostInputs,
        )
      : wrap(contribution, contributionOrders, "recorded variable selling costs");

  return {
    ...base,
    ordersCosted: costed,
    ordersWithoutCostSnapshot: withoutSnapshot,
    ordersWithoutContribution: costed - contributionOrders,
    grossProfitCents: wrap(gross, costed, grossWhat),
    grossMarginPct: marginOf(gross, grossRevenue, costed, grossWhat),
    contributionProfitBeforePaidMediaCents: contributionMetric,
    contributionMarginBeforePaidMediaPct:
      contributionOrders === 0
        ? (contributionMetric as Metric<number>)
        : marginOf(contribution, contributionRevenue, contributionOrders, "recorded variable selling costs"),
    missingCostInputs,
  };
}
