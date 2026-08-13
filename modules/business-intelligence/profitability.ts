import { COST_MODEL } from "@/config/costs";
import type { OrderLineRow, OrderRow } from "@/lib/data/order-service";
import { computeCosts, productCostCents, type CostModelConfig } from "@/modules/pricing";
import type { Product } from "@/types/commerce";
import { available, partial, unavailable, type Metric } from "./availability";
import { isCountedOrder } from "./revenue";

/**
 * DETERMINISTIC profitability (Session 09 spec §2, §9–§10).
 *
 * Every number reconstructs per-order costs from the SAME cost model the
 * pricing module uses (config/costs.ts → modules/pricing/cost-model.ts).
 * The hard rule holds structurally: any missing cost input makes the
 * affected orders un-costable and the metric PARTIAL/UNAVAILABLE with the
 * missing inputs listed — null is never zero, and nothing here estimates
 * a cost.
 *
 * Metric semantics (named precisely, spec §10):
 *  - GROSS PROFIT = revenue − product/factory COGS
 *    (manufacturing + printing + setup + packaging).
 *  - CONTRIBUTION PROFIT BEFORE PAID MEDIA = revenue − ALL variable costs
 *    (product COGS + shipping + payment fees + other variable). Payment
 *    fees are computed per ORDER (percent of order total + one fixed fee
 *    per transaction — never one fixed fee per line).
 *  - Paid-media (ad) spend is NOT ingested yet (spec §40) — the name says
 *    so explicitly; this is never presented as "net profit".
 *  - Discounts are structurally zero today: the engine is the only price
 *    authority and no discount mechanism exists.
 */

export type ProfitabilityMetrics = {
  ordersTotal: number;
  /** Orders whose every line could be costed under the current config. */
  ordersCosted: number;
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
  "Contribution profit (before paid media) = revenue − all variable costs (product COGS + shipping + payment fees + other variable).",
  "Ad spend is not integrated — contribution explicitly excludes paid media and is never presented as net profit.",
  "Discounts are structurally zero: the deterministic pricing engine is the only price authority.",
];

const MAX_MISSING_INPUTS = 25;

type OrderCosting =
  | { status: "costed"; grossProfitCents: number; contributionCents: number; revenueCents: number }
  | { status: "unconfigured"; missingInputs: string[] };

function costOrder(
  order: OrderRow,
  lines: OrderLineRow[],
  productById: Map<string, Product>,
  model: CostModelConfig,
): OrderCosting {
  const missing: string[] = [];
  let productCogs = 0;
  let nonFeeVariable = 0;

  if (lines.length === 0) return { status: "unconfigured", missingInputs: [`orders.${order.id}: no line rows`] };

  for (const line of lines) {
    const product = productById.get(line.productId);
    if (!product) {
      missing.push(`catalog product "${line.productId}" (order line no longer in catalog)`);
      continue;
    }
    const computed = computeCosts(product, line.configJson, line.totalCents, model);
    if (computed.status === "unconfigured") {
      missing.push(...computed.missingInputs);
      continue;
    }
    productCogs += productCostCents(computed.costs);
    // Per-line variable costs EXCLUDING the payment fee — the processor
    // charges per transaction, so the fee is recomputed at order level.
    nonFeeVariable += computed.costs.totalCostCents - computed.costs.paymentFeeCents;
  }
  if (missing.length > 0) return { status: "unconfigured", missingInputs: missing };

  const feeBps = model.paymentFee.percentBps;
  const feeFixed = model.paymentFee.fixedCents;
  if (feeBps === null || feeFixed === null) {
    return { status: "unconfigured", missingInputs: ["paymentFee.percentBps", "paymentFee.fixedCents"] };
  }
  const orderFee = Math.round((order.totalCents * feeBps) / 10_000) + feeFixed;

  return {
    status: "costed",
    revenueCents: order.totalCents,
    grossProfitCents: order.totalCents - productCogs,
    contributionCents: order.totalCents - nonFeeVariable - orderFee,
  };
}

/**
 * Static config completeness check — true only when EVERY cost input is
 * provided for every product plus the payment fee. Drives the dashboard's
 * data-quality warning even in periods with zero orders.
 */
export function isCostModelFullyConfigured(model: CostModelConfig = COST_MODEL): boolean {
  if (model.paymentFee.percentBps === null || model.paymentFee.fixedCents === null) return false;
  for (const pc of Object.values(model.products)) {
    if (
      pc.baseManufacturingCentsPerUnit === null ||
      pc.sizeAdjustmentCentsPerUnit === null ||
      pc.materialAdjustmentCentsPerUnit === null ||
      pc.printing === null ||
      pc.packagingCentsPerUnit === null ||
      pc.shipping === null ||
      pc.otherVariableCentsPerUnit === null
    ) {
      return false;
    }
  }
  return true;
}

export function computeProfitability(
  orders: OrderRow[],
  lines: OrderLineRow[],
  products: Product[],
  model: CostModelConfig = COST_MODEL,
): ProfitabilityMetrics {
  const counted = orders.filter(isCountedOrder);
  const productById = new Map(products.map((p) => [p.id, p]));
  const linesByOrder = new Map<string, OrderLineRow[]>();
  for (const line of lines) {
    const list = linesByOrder.get(line.orderId) ?? [];
    list.push(line);
    linesByOrder.set(line.orderId, list);
  }

  const base = {
    ordersTotal: counted.length,
    notes: PROFITABILITY_NOTES,
  };

  if (counted.length === 0) {
    const none = unavailable<number>("No completed orders in this period.");
    return {
      ...base,
      ordersCosted: 0,
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
      ordersCosted: 0,
      grossProfitCents: mixed,
      grossMarginPct: mixed,
      contributionProfitBeforePaidMediaCents: mixed,
      contributionMarginBeforePaidMediaPct: mixed,
      missingCostInputs: [],
    };
  }

  const missingSet = new Set<string>();
  let costed = 0;
  let revenue = 0;
  let gross = 0;
  let contribution = 0;
  for (const order of counted) {
    const result = costOrder(order, linesByOrder.get(order.id) ?? [], productById, model);
    if (result.status === "unconfigured") {
      for (const m of result.missingInputs) {
        if (missingSet.size < MAX_MISSING_INPUTS) missingSet.add(m);
      }
      continue;
    }
    costed += 1;
    revenue += result.revenueCents;
    gross += result.grossProfitCents;
    contribution += result.contributionCents;
  }
  const missingCostInputs = [...missingSet];

  if (costed === 0) {
    const reason =
      "Unavailable — configure manufacturing costs. The factory cost model (config/costs.ts) has unfilled inputs, so profit cannot be computed. Missing inputs are listed; they are never assumed to be zero.";
    const none = unavailable<number>(reason, missingCostInputs);
    return {
      ...base,
      ordersCosted: 0,
      grossProfitCents: none,
      grossMarginPct: none,
      contributionProfitBeforePaidMediaCents: none,
      contributionMarginBeforePaidMediaPct: none,
      missingCostInputs,
    };
  }

  const wrap = (value: number): Metric<number> =>
    costed === counted.length
      ? available(value)
      : partial(
          value,
          `Covers ${costed} of ${counted.length} orders — the rest have unconfigured cost inputs (never assumed zero).`,
          missingCostInputs,
        );
  const marginOf = (profit: number): Metric<number> =>
    revenue > 0 ? wrap(profit / revenue) : unavailable("Costed orders have zero revenue — margin undefined.");

  return {
    ...base,
    ordersCosted: costed,
    grossProfitCents: wrap(gross),
    grossMarginPct: marginOf(gross),
    contributionProfitBeforePaidMediaCents: wrap(contribution),
    contributionMarginBeforePaidMediaPct: marginOf(contribution),
    missingCostInputs,
  };
}
