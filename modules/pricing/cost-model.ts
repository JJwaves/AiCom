import type { Product, ProductConfiguration } from "@/types/commerce";

/**
 * Cost model — the factory-economics side of the pricing module.
 *
 * Sell prices come from the engine (engine.ts); this file computes what a
 * configuration COSTS and therefore what it earns. All values arrive from
 * config/costs.ts, where every input is an explicit [TO BE PROVIDED]
 * placeholder (null) until the owner supplies real factory economics.
 *
 * NOTHING here invents a number. Any missing input makes the whole
 * breakdown "unconfigured": margin outputs become null ("unavailable") and
 * price-floor checks fail closed (see evaluatePriceFloor).
 *
 * NO AI. This file (and every file in modules/pricing) must never import
 * lib/ai — a cost is measured or it is missing; it is never inferred.
 * Asserted structurally in tests/unit-economics-separation.test.ts.
 *
 * COST SCOPES (Session 13.5 §6) — the model distinguishes three, because
 * collapsing them silently multiplies or divides real money:
 *
 *   PER UNIT    manufacturing, printing ink/labour, per-unit packaging,
 *               other variable per-unit cost.
 *   PER LINE    printing setup (screens/plates) — one setup per printed
 *               line, because one line is one artwork on one product.
 *   PER ORDER   order packaging (master carton/pallet), fulfilment
 *               handling, the payment processor's FIXED fee, and the
 *               shipping subsidy. Each is charged ONCE per order, never
 *               once per line — see modules/pricing/unit-economics.ts.
 *
 * All money is integer cents. All rates are integer basis points
 * (1 bps = 0.01%), so every computation stays in integer arithmetic.
 * Rounding rule: the only division is the payment percentage, rounded
 * half-up once per order with Math.round; price floors round UP
 * (Math.ceil) so a floor is never breached by a rounding cent.
 */

/* ------------------------------------------------------------------ */
/* Product cost inputs                                                 */
/* ------------------------------------------------------------------ */

/** Shipping cost basis — whichever the factory/3PL actually quotes in. */
export type ShippingCostBasis =
  | { kind: "per_unit"; centsPerUnit: number }
  | { kind: "per_order"; centsPerOrder: number }
  | { kind: "per_carton"; centsPerCarton: number; unitsPerCarton: number };

/**
 * A factory quantity break for manufacturing cost (§5). Deliberately
 * SEPARATE from the sell-price tiers in config/products.ts: the factory's
 * volume breaks and the storefront's volume breaks are two different
 * business facts and are never assumed to coincide.
 */
export type ManufacturingTier = { minQty: number; centsPerUnit: number };

/** Per-product cost inputs. `null` = [TO BE PROVIDED] — never a guess. */
export type ProductCostConfig = {
  /** Base manufacturing cost per unit (reference size, base material). */
  baseManufacturingCentsPerUnit: number | null;
  /**
   * OPTIONAL factory quantity breaks (§5). Omit the key entirely when the
   * factory quotes ONE unit cost at every volume — then the base above
   * applies at every quantity. When the key IS present it becomes
   * authoritative for manufacturing cost, and a quantity below the first
   * tier is a MISSING input (fail closed), never a silent fallback to base.
   */
  manufacturingTiers?: ManufacturingTier[];
  /** Manufacturing delta per unit by size id (every offered size must appear). */
  sizeAdjustmentCentsPerUnit: Record<string, number> | null;
  /** Cost delta per unit by material id — covers GSM/weight differences. */
  materialAdjustmentCentsPerUnit: Record<string, number> | null;
  /** Printing cost by print option id: per-unit ink/labor + one-time setup (screens/plates). */
  printing: Record<string, { centsPerUnit: number; setupFeeCents: number }> | null;
  /** Cartons, liners, fillers — per unit. */
  packagingCentsPerUnit: number | null;
  /** Freight to customer — the cost ACTUALLY incurred, before any subsidy math. */
  shipping: ShippingCostBasis | null;
  /** Any other variable cost per unit; 0 is a valid confirmed value. */
  otherVariableCentsPerUnit: number | null;
};

/**
 * Costs incurred ONCE PER ORDER, whatever the line count (§6, §8).
 * `null` = [TO BE PROVIDED]. 0 is a valid confirmed answer ("we do not
 * incur this"), which is why absence is not read as zero.
 */
export type OrderCostConfig = {
  /** Master carton / pallet / outbound packaging per ORDER. Counted as COGS. */
  packagingCentsPerOrder: number | null;
  /** Pick/pack/fulfilment handling per ORDER. A variable SELLING cost, not COGS. */
  handlingCentsPerOrder: number | null;
};

export type PaymentFeeConfig = {
  /** Processor percentage in basis points (e.g. 290 = 2.9%). */
  percentBps: number | null;
  /** Processor fixed fee per TRANSACTION (i.e. per order), cents. */
  fixedCents: number | null;
};

/**
 * What the customer is charged for shipping (§10, §11).
 *
 * This is NOT the cost of shipping — it is the money collected for it. The
 * two are separate business facts and the subsidy is their difference.
 *
 *  not_collected  Checkout collects no separate shipping charge. This is
 *                 today's STRUCTURAL fact, not an assumption: `orders` has
 *                 no shipping column and `createOrder` sets
 *                 totalCents = subtotalCents (asserted in tests).
 *  flat_per_order A configured flat charge. Supported, but the order model
 *                 does not record a per-order shipping charge, so the figure
 *                 is a CONFIGURED CONSTANT applied to every order and the
 *                 shipping economics are reported PARTIAL.
 *  unavailable    The owner has told us they do not know. Shipping subsidy —
 *                 and therefore contribution profit — is UNAVAILABLE.
 */
export type CustomerShippingChargeBasis =
  | { kind: "not_collected" }
  | { kind: "flat_per_order"; centsPerOrder: number }
  | { kind: "unavailable"; reason: string };

export type ShippingPolicyConfig = {
  customerCharge: CustomerShippingChargeBasis;
};

export type MarginPolicyConfig = {
  /** FLOOR for gross margin (product COGS only), bps of price. Hard boundary. */
  minimumGrossMarginBps: number | null;
  /** FLOOR for contribution margin (all variable costs), bps of price. Hard boundary. */
  minimumContributionMarginBps: number | null;
  /** TARGET gross margin, bps. An objective — NEVER used as a floor (§24). */
  targetGrossMarginBps: number | null;
  /** TARGET contribution margin, bps. An objective — NEVER used as a floor (§24). */
  targetContributionMarginBps: number | null;
};

export type CostModelConfig = {
  /**
   * Cost-model version stamp (§29). Recorded on every persisted order cost
   * snapshot so "which cost configuration produced this number?" stays
   * answerable. Bump it whenever any value in config/costs.ts changes.
   */
  version: string;
  /** Keyed by product id. Every purchasable product needs an entry. */
  products: Record<string, ProductCostConfig>;
  orderCosts: OrderCostConfig;
  paymentFee: PaymentFeeConfig;
  shippingPolicy: ShippingPolicyConfig;
  marginPolicy: MarginPolicyConfig;
};

/* ------------------------------------------------------------------ */
/* Line-level COGS                                                     */
/* ------------------------------------------------------------------ */

/** Product COGS for ONE order line, integer cents. */
export type LineCogs = {
  /** (manufacturing/unit + size adj + material adj) × quantity. */
  manufacturingCents: number;
  /** Per-unit printing cost × quantity. */
  printingCents: number;
  /** One-time printing setup (screens/plates) for THIS line. */
  setupCents: number;
  /** Per-unit packaging × quantity. Order-level packaging is separate. */
  packagingCents: number;
  /** Sum of the four above — the gross-profit cost base for the line. */
  totalCents: number;
};

/** Non-COGS variable costs attributable to ONE line, integer cents. */
export type LineVariableCosts = {
  /** Freight actually incurred for this line (before any subsidy math). */
  actualShippingCents: number;
  /**
   * How the freight above was quoted. Order-level assembly needs this: a
   * `per_order` basis is ONE charge per product per order, so summing it
   * across two lines of the same product would double-count real money.
   */
  shippingScope: ShippingCostBasis["kind"];
  /** otherVariableCentsPerUnit × quantity. */
  otherVariableCents: number;
};

export type LineCostComputation =
  | { status: "configured"; cogs: LineCogs; variable: LineVariableCosts }
  | { status: "unconfigured"; missingInputs: string[] };

/** Resolve required numbers, collecting the names of missing ones. */
class InputCollector {
  missing: string[] = [];
  need(value: number | null | undefined, name: string): number {
    if (value === null || value === undefined) {
      this.missing.push(name);
      return 0;
    }
    return value;
  }
}

function shippingCents(basis: ShippingCostBasis, quantity: number): number {
  switch (basis.kind) {
    case "per_unit":
      return basis.centsPerUnit * quantity;
    case "per_order":
      return basis.centsPerOrder;
    case "per_carton":
      return Math.ceil(quantity / basis.unitsPerCarton) * basis.centsPerCarton;
  }
}

/**
 * Manufacturing cost per unit before size/material adjustments.
 *
 * With `manufacturingTiers` present the tiers are authoritative: the
 * highest tier whose `minQty` the quantity reaches wins, and a quantity
 * below the FIRST tier is a missing input rather than a silent fallback to
 * the base rate (§5 — a factory quote that starts at 1,000 units says
 * nothing about 500).
 */
export function manufacturingCentsPerUnit(
  pc: ProductCostConfig,
  quantity: number,
  c: InputCollector,
  prefix: string,
): number {
  const tiers = pc.manufacturingTiers;
  if (tiers === undefined) return c.need(pc.baseManufacturingCentsPerUnit, `${prefix}.baseManufacturingCentsPerUnit`);
  const applicable = tiers.filter((t) => quantity >= t.minQty);
  if (applicable.length === 0) {
    c.missing.push(`${prefix}.manufacturingTiers (no tier covers quantity ${quantity})`);
    return 0;
  }
  return applicable.reduce((best, t) => (t.minQty > best.minQty ? t : best)).centsPerUnit;
}

/**
 * Per-line COGS + per-line variable costs. Order-level costs (order
 * packaging, handling, the payment fee, the shipping subsidy) are NOT here
 * — they belong to the order and are applied once (unit-economics.ts).
 */
export function computeLineCosts(
  product: Product,
  config: Pick<ProductConfiguration, "sizeId" | "materialId" | "printOptionId" | "quantity">,
  model: CostModelConfig,
): LineCostComputation {
  const c = new InputCollector();
  const pc = model.products[product.id];
  if (!pc) return { status: "unconfigured", missingInputs: [`products.${product.id}`] };

  const prefix = `products.${product.id}`;
  const q = config.quantity;
  const perUnitManufacturing = manufacturingCentsPerUnit(pc, q, c, prefix);
  const sizeAdj = c.need(
    pc.sizeAdjustmentCentsPerUnit?.[config.sizeId],
    `${prefix}.sizeAdjustmentCentsPerUnit.${config.sizeId}`,
  );
  const materialAdj = c.need(
    pc.materialAdjustmentCentsPerUnit?.[config.materialId],
    `${prefix}.materialAdjustmentCentsPerUnit.${config.materialId}`,
  );
  const printing = pc.printing?.[config.printOptionId];
  const printPerUnit = c.need(printing?.centsPerUnit, `${prefix}.printing.${config.printOptionId}.centsPerUnit`);
  const setupCents = c.need(printing?.setupFeeCents, `${prefix}.printing.${config.printOptionId}.setupFeeCents`);
  const packagingPerUnit = c.need(pc.packagingCentsPerUnit, `${prefix}.packagingCentsPerUnit`);
  const otherPerUnit = c.need(pc.otherVariableCentsPerUnit, `${prefix}.otherVariableCentsPerUnit`);
  if (!pc.shipping) c.missing.push(`${prefix}.shipping`);

  if (c.missing.length) return { status: "unconfigured", missingInputs: c.missing };

  const manufacturingCents = (perUnitManufacturing + sizeAdj + materialAdj) * q;
  const printingCents = printPerUnit * q;
  const packagingCents = packagingPerUnit * q;
  return {
    status: "configured",
    cogs: {
      manufacturingCents,
      printingCents,
      setupCents,
      packagingCents,
      totalCents: manufacturingCents + printingCents + setupCents + packagingCents,
    },
    variable: {
      actualShippingCents: shippingCents(pc.shipping as ShippingCostBasis, q),
      shippingScope: (pc.shipping as ShippingCostBasis).kind,
      otherVariableCents: otherPerUnit * q,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Payment fee + shipping subsidy — the two order-level primitives      */
/* ------------------------------------------------------------------ */

/**
 * Payment processing cost for ONE transaction (§9).
 *
 *   fee = round(orderRevenue × percentBps / 10_000) + fixedCents
 *
 * The fixed fee is charged ONCE PER ORDER. Callers must never invoke this
 * per line — that is the single most expensive arithmetic mistake available
 * in this model, and tests/unit-economics.test.ts pins it.
 * Returns null when either input is [TO BE PROVIDED].
 */
export function paymentFeeCents(orderRevenueCents: number, fee: PaymentFeeConfig): number | null {
  if (fee.percentBps === null || fee.fixedCents === null) return null;
  return Math.round((orderRevenueCents * fee.percentBps) / 10_000) + fee.fixedCents;
}

/**
 * Shipping economics for ONE order (§10).
 *
 *   subsidy        = max(actualShippingCost − customerShippingCharge, 0)
 *   shippingMargin = max(customerShippingCharge − actualShippingCost, 0)
 *
 * The subsidy is the economic cost BagDirect bears. It never goes negative:
 * profiting on shipping is a DIFFERENT fact, preserved separately in
 * `shippingMarginCents` rather than smuggled in as a negative cost.
 *
 * `shippingMarginCents` is reported but deliberately NOT added to
 * contribution profit, because a shipping charge is not recorded on the
 * order and therefore is not inside the revenue figure being divided into.
 * Adding it would credit money the revenue metric never counted.
 */
export type ShippingEconomics =
  | {
      status: "available" | "partial";
      actualShippingCents: number;
      customerShippingChargeCents: number;
      subsidyCents: number;
      shippingMarginCents: number;
      /** Present when status is "partial" — why the figure is not authoritative. */
      reason?: string;
    }
  | { status: "unavailable"; reason: string; missingInputs: string[] };

export function computeShippingEconomics(
  actualShippingCents: number,
  policy: ShippingPolicyConfig,
): ShippingEconomics {
  const charge = policy.customerCharge;
  if (charge.kind === "unavailable") {
    return {
      status: "unavailable",
      reason: `The shipping charge collected from the customer is not known (${charge.reason}), so the subsidy BagDirect actually bears cannot be computed. It is not assumed to be zero.`,
      missingInputs: ["shippingPolicy.customerCharge"],
    };
  }
  const customerShippingChargeCents = charge.kind === "not_collected" ? 0 : charge.centsPerOrder;
  const result = {
    actualShippingCents,
    customerShippingChargeCents,
    subsidyCents: Math.max(actualShippingCents - customerShippingChargeCents, 0),
    shippingMarginCents: Math.max(customerShippingChargeCents - actualShippingCents, 0),
  };
  if (charge.kind === "flat_per_order") {
    return {
      status: "partial",
      ...result,
      reason:
        "The customer shipping charge is a configured flat constant, not a per-order recorded amount — orders do not store a shipping charge. Shipping economics are therefore indicative, not accounting truth.",
    };
  }
  return { status: "available", ...result };
}

/* ------------------------------------------------------------------ */
/* Single-configuration costs (unchanged public contract)              */
/* ------------------------------------------------------------------ */

/**
 * Per-line cost breakdown, integer cents. Only exists when fully configured.
 *
 * NOTE ON SCOPE: this shape treats the configuration as a ONE-LINE ORDER,
 * so it carries the order-level costs too (order packaging, handling, the
 * payment fee, the shipping subsidy). For real multi-line orders use
 * `computeOrderUnitEconomics` (unit-economics.ts), which applies each of
 * those exactly once.
 */
export type CostBreakdown = {
  manufacturingCents: number;
  printingCents: number;
  setupCents: number;
  /** Per-unit packaging × quantity. */
  packagingCents: number;
  /** Order-scope packaging (master carton/pallet). COGS. */
  orderPackagingCents: number;
  /** Order-scope fulfilment handling. A variable selling cost, not COGS. */
  handlingCents: number;
  /** Freight actually incurred. */
  estimatedShippingCents: number;
  /** The economic shipping cost borne: max(actual − customer charge, 0). */
  shippingSubsidyCents: number;
  /** percentBps of the sell price + fixedCents, once. */
  paymentFeeCents: number;
  otherVariableCents: number;
  /** COGS + variable selling costs (uses the SUBSIDY, not raw freight). */
  totalCostCents: number;
};

export type CostComputation =
  | { status: "configured"; costs: CostBreakdown }
  | { status: "unconfigured"; missingInputs: string[] };

/**
 * Compute the full cost breakdown for a priced configuration, treated as a
 * single-line order. `totalPriceCents` is the engine's sell total (the
 * payment percentage applies to it).
 *
 * Returns "unconfigured" listing every missing input when anything is null.
 */
export function computeCosts(
  product: Product,
  config: Pick<ProductConfiguration, "sizeId" | "materialId" | "printOptionId" | "quantity">,
  totalPriceCents: number,
  model: CostModelConfig,
): CostComputation {
  const line = computeLineCosts(product, config, model);
  const missing: string[] = line.status === "unconfigured" ? [...line.missingInputs] : [];

  const c = new InputCollector();
  const orderPackagingCents = c.need(model.orderCosts.packagingCentsPerOrder, "orderCosts.packagingCentsPerOrder");
  const handlingCents = c.need(model.orderCosts.handlingCentsPerOrder, "orderCosts.handlingCentsPerOrder");
  if (model.paymentFee.percentBps === null) c.missing.push("paymentFee.percentBps");
  if (model.paymentFee.fixedCents === null) c.missing.push("paymentFee.fixedCents");
  missing.push(...c.missing);

  const shipping =
    line.status === "configured"
      ? computeShippingEconomics(line.variable.actualShippingCents, model.shippingPolicy)
      : null;
  if (shipping && shipping.status === "unavailable") missing.push(...shipping.missingInputs);

  if (missing.length || line.status !== "configured" || !shipping || shipping.status === "unavailable") {
    return { status: "unconfigured", missingInputs: missing };
  }

  const fee = paymentFeeCents(totalPriceCents, model.paymentFee) as number;
  const costs: CostBreakdown = {
    manufacturingCents: line.cogs.manufacturingCents,
    printingCents: line.cogs.printingCents,
    setupCents: line.cogs.setupCents,
    packagingCents: line.cogs.packagingCents,
    orderPackagingCents,
    handlingCents,
    estimatedShippingCents: shipping.actualShippingCents,
    shippingSubsidyCents: shipping.subsidyCents,
    paymentFeeCents: fee,
    otherVariableCents: line.variable.otherVariableCents,
    totalCostCents: 0,
  };
  costs.totalCostCents =
    productCostCents(costs) + costs.shippingSubsidyCents + costs.handlingCents + costs.paymentFeeCents + costs.otherVariableCents;
  return { status: "configured", costs };
}

/**
 * Product COGS only (no shipping/handling/fees) — the gross-profit cost
 * base (§14): manufacturing + printing + setup + packaging (per-unit AND
 * order-scope).
 */
export function productCostCents(costs: CostBreakdown): number {
  return (
    costs.manufacturingCents +
    costs.printingCents +
    costs.setupCents +
    costs.packagingCents +
    costs.orderPackagingCents
  );
}

/* ------------------------------------------------------------------ */
/* Margin policy: minimum (floor) vs target (objective)                */
/* ------------------------------------------------------------------ */

/**
 * Minimum allowed line total (cents) satisfying every CONFIGURED margin
 * FLOOR. Target margins are deliberately NOT consulted — a target is an
 * objective, never a boundary (§24).
 *
 * Returns null — meaning "cannot be computed" — when costs are
 * unconfigured, when no floor is configured, or when a floor is
 * arithmetically unsatisfiable (fee% + floor ≥ 100%). Callers must treat
 * null as fail-closed, never as "no floor".
 *
 * Derivations (price P, all integer cents / bps; ceil so the floor is never
 * breached by a rounding cent):
 *   gross floor:         P − productCost ≥ g·P            ⇒ P ≥ productCost / (1 − g)
 *   contribution floor:  P − nonFeeCost − fee(P) ≥ m·P,
 *   with fee(P) = P·f + F                                  ⇒ P ≥ (nonFeeCost + F) / (1 − f − m)
 */
export function minimumAllowedPriceCents(
  costs: CostBreakdown,
  paymentFee: PaymentFeeConfig,
  policy: MarginPolicyConfig,
): number | null {
  const floors: number[] = [];
  const nonFeeCost = costs.totalCostCents - costs.paymentFeeCents;

  if (policy.minimumGrossMarginBps !== null) {
    const g = policy.minimumGrossMarginBps;
    if (g >= 10_000) return null;
    floors.push(Math.ceil((productCostCents(costs) * 10_000) / (10_000 - g)));
  }

  if (policy.minimumContributionMarginBps !== null) {
    const m = policy.minimumContributionMarginBps;
    const f = paymentFee.percentBps;
    const fixed = paymentFee.fixedCents;
    if (f === null || fixed === null) return null;
    if (f + m >= 10_000) return null;
    floors.push(Math.ceil(((nonFeeCost + fixed) * 10_000) / (10_000 - f - m)));
  }

  if (!floors.length) return null;
  return Math.max(...floors);
}

/**
 * Where a realised margin sits relative to policy (§24).
 *
 *  BELOW_MINIMUM  breaches a hard floor — a future price action must be blocked.
 *  BELOW_TARGET   above every floor but under the business objective —
 *                 worth a human review, NOT a violation.
 *  AT_OR_ABOVE_TARGET  meets the objective.
 *  NO_TARGET      floors satisfied; no target configured to compare against.
 *  UNAVAILABLE    margin or policy unknown. Never rendered as "fine".
 */
export type MarginVerdictState =
  | "BELOW_MINIMUM"
  | "BELOW_TARGET"
  | "AT_OR_ABOVE_TARGET"
  | "NO_TARGET"
  | "UNAVAILABLE";

export type MarginVerdict = {
  state: MarginVerdictState;
  reason: string;
  /** Floors this margin breaches, by policy field name. Empty unless BELOW_MINIMUM. */
  violatedFloors: string[];
  missingInputs: string[];
};

/**
 * Compare ONE realised margin (bps) against its minimum and target.
 * `kind` selects which pair of policy fields applies.
 */
export function evaluateMarginAgainstPolicy(
  marginBps: number | null,
  kind: "gross" | "contribution",
  policy: MarginPolicyConfig,
): MarginVerdict {
  const minField = kind === "gross" ? "minimumGrossMarginBps" : "minimumContributionMarginBps";
  const targetField = kind === "gross" ? "targetGrossMarginBps" : "targetContributionMarginBps";
  const minimum = policy[minField];
  const target = policy[targetField];

  if (marginBps === null) {
    return {
      state: "UNAVAILABLE",
      reason: `The realised ${kind} margin is unavailable, so it cannot be compared with policy. It is not treated as compliant.`,
      violatedFloors: [],
      missingInputs: [],
    };
  }
  if (minimum === null) {
    return {
      state: "UNAVAILABLE",
      reason: `No minimum ${kind} margin is configured, so there is nothing to check this margin against. A missing floor is never read as "no floor".`,
      violatedFloors: [],
      missingInputs: [`marginPolicy.${minField}`],
    };
  }
  if (marginBps < minimum) {
    return {
      state: "BELOW_MINIMUM",
      reason: `Realised ${kind} margin ${marginBps} bps is below the configured minimum of ${minimum} bps.`,
      violatedFloors: [`marginPolicy.${minField}`],
      missingInputs: [],
    };
  }
  if (target === null) {
    return {
      state: "NO_TARGET",
      reason: `Realised ${kind} margin ${marginBps} bps meets the minimum of ${minimum} bps. No target is configured to compare against.`,
      violatedFloors: [],
      missingInputs: [`marginPolicy.${targetField}`],
    };
  }
  return marginBps < target
    ? {
        state: "BELOW_TARGET",
        reason: `Realised ${kind} margin ${marginBps} bps clears the minimum (${minimum} bps) but is under the target of ${target} bps. This is a review signal, not a violation.`,
        violatedFloors: [],
        missingInputs: [],
      }
    : {
        state: "AT_OR_ABOVE_TARGET",
        reason: `Realised ${kind} margin ${marginBps} bps meets the target of ${target} bps.`,
        violatedFloors: [],
        missingInputs: [],
      };
}

/* ------------------------------------------------------------------ */
/* Price floor                                                         */
/* ------------------------------------------------------------------ */

export type PriceFloorVerdict =
  | { allowed: true; reason: string }
  | { allowed: false; reason: string; violatedRules: string[] };

/**
 * Deterministic price-floor check for any price-affecting action (future
 * AI discounts, pricing agent proposals, manual overrides).
 *
 * FAIL CLOSED: if the cost model or margin policy is not fully configured,
 * the price cannot be verified and the verdict is `allowed: false`. Normal
 * checkout of engine-computed catalog prices does NOT go through this gate
 * — it applies to deviations from the engine price, and nothing in the
 * customer path calls it (asserted in tests).
 */
export function evaluatePriceFloor(
  proposedTotalCents: number,
  product: Product,
  config: Pick<ProductConfiguration, "sizeId" | "materialId" | "printOptionId" | "quantity">,
  model: CostModelConfig,
): PriceFloorVerdict {
  const computed = computeCosts(product, config, proposedTotalCents, model);
  if (computed.status === "unconfigured") {
    return {
      allowed: false,
      reason: `Cost model not configured (missing: ${computed.missingInputs.join(", ")}) — margin cannot be verified; failing closed.`,
      violatedRules: ["cost_model_unconfigured"],
    };
  }
  const floor = minimumAllowedPriceCents(computed.costs, model.paymentFee, model.marginPolicy);
  if (floor === null) {
    return {
      allowed: false,
      reason: "No margin floor configured — price cannot be verified; failing closed.",
      violatedRules: ["margin_policy_unconfigured"],
    };
  }
  if (proposedTotalCents < floor) {
    return {
      allowed: false,
      reason: `Proposed total ${proposedTotalCents}¢ is below the minimum allowed price ${floor}¢.`,
      violatedRules: ["below_minimum_allowed_price"],
    };
  }
  return { allowed: true, reason: `Total ${proposedTotalCents}¢ ≥ minimum allowed ${floor}¢.` };
}
