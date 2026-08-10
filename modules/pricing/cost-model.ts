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
 * All money is integer cents. All rates are integer basis points
 * (1 bps = 0.01%), so every computation stays in integer arithmetic.
 */

/** Shipping cost basis — whichever the factory/3PL actually quotes in. */
export type ShippingCostBasis =
  | { kind: "per_unit"; centsPerUnit: number }
  | { kind: "per_order"; centsPerOrder: number }
  | { kind: "per_carton"; centsPerCarton: number; unitsPerCarton: number };

/** Per-product cost inputs. `null` = [TO BE PROVIDED] — never a guess. */
export type ProductCostConfig = {
  /** Base manufacturing cost per unit (reference size, base material). */
  baseManufacturingCentsPerUnit: number | null;
  /** Manufacturing delta per unit by size id (every offered size must appear). */
  sizeAdjustmentCentsPerUnit: Record<string, number> | null;
  /** Cost delta per unit by material id — covers GSM/weight differences. */
  materialAdjustmentCentsPerUnit: Record<string, number> | null;
  /** Printing cost by print option id: per-unit ink/labor + one-time setup (screens/plates). */
  printing: Record<string, { centsPerUnit: number; setupFeeCents: number }> | null;
  /** Cartons, liners, fillers — per unit. */
  packagingCentsPerUnit: number | null;
  /** Freight to customer (real cost even when "free shipping" is subsidized). */
  shipping: ShippingCostBasis | null;
  /** Any other variable cost per unit; 0 is a valid confirmed value. */
  otherVariableCentsPerUnit: number | null;
};

export type PaymentFeeConfig = {
  /** Processor percentage in basis points (e.g. 290 = 2.9%). */
  percentBps: number | null;
  /** Processor fixed fee per transaction, cents. */
  fixedCents: number | null;
};

export type MarginPolicyConfig = {
  /** Floor for gross margin (product costs only), bps of price. */
  minimumGrossMarginBps: number | null;
  /** Floor for contribution margin (all variable costs), bps of price. */
  minimumContributionMarginBps: number | null;
  /** Target contribution margin used for recommendations, bps. Not a floor. */
  targetContributionMarginBps: number | null;
};

export type CostModelConfig = {
  /** Keyed by product id. Every purchasable product needs an entry. */
  products: Record<string, ProductCostConfig>;
  paymentFee: PaymentFeeConfig;
  marginPolicy: MarginPolicyConfig;
};

/** Per-line cost breakdown, integer cents. Only exists when fully configured. */
export type CostBreakdown = {
  /** (base + size adj + material adj) × quantity. */
  manufacturingCents: number;
  /** Per-unit printing cost × quantity. */
  printingCents: number;
  /** One-time printing setup (screens/plates) for the line. */
  setupCents: number;
  packagingCents: number;
  estimatedShippingCents: number;
  /** percentBps of the sell price + fixedCents. */
  paymentFeeCents: number;
  otherVariableCents: number;
  /** Sum of everything above. */
  totalCostCents: number;
};

export type CostComputation =
  | { status: "configured"; costs: CostBreakdown }
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
 * Compute the full cost breakdown for a priced configuration.
 * `totalPriceCents` is the engine's sell total (payment fee is a % of it).
 * Returns "unconfigured" listing every missing input when anything is null.
 */
export function computeCosts(
  product: Product,
  config: Pick<ProductConfiguration, "sizeId" | "materialId" | "printOptionId" | "quantity">,
  totalPriceCents: number,
  model: CostModelConfig,
): CostComputation {
  const c = new InputCollector();
  const pc = model.products[product.id];
  if (!pc) {
    return { status: "unconfigured", missingInputs: [`products.${product.id}`] };
  }

  const prefix = `products.${product.id}`;
  const base = c.need(pc.baseManufacturingCentsPerUnit, `${prefix}.baseManufacturingCentsPerUnit`);
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
  const feeBps = c.need(model.paymentFee.percentBps, "paymentFee.percentBps");
  const feeFixed = c.need(model.paymentFee.fixedCents, "paymentFee.fixedCents");
  if (!pc.shipping) c.missing.push(`${prefix}.shipping`);

  if (c.missing.length) return { status: "unconfigured", missingInputs: c.missing };

  const q = config.quantity;
  const manufacturingCents = (base + sizeAdj + materialAdj) * q;
  const printingCents = printPerUnit * q;
  const packagingCents = packagingPerUnit * q;
  const estimatedShippingCents = shippingCents(pc.shipping as ShippingCostBasis, q);
  const paymentFeeCents = Math.round((totalPriceCents * feeBps) / 10_000) + feeFixed;
  const otherVariableCents = otherPerUnit * q;
  const totalCostCents =
    manufacturingCents +
    printingCents +
    setupCents +
    packagingCents +
    estimatedShippingCents +
    paymentFeeCents +
    otherVariableCents;

  return {
    status: "configured",
    costs: {
      manufacturingCents,
      printingCents,
      setupCents,
      packagingCents,
      estimatedShippingCents,
      paymentFeeCents,
      otherVariableCents,
      totalCostCents,
    },
  };
}

/** Product costs only (no shipping/fees) — the gross-profit cost base. */
export function productCostCents(costs: CostBreakdown): number {
  return costs.manufacturingCents + costs.printingCents + costs.setupCents + costs.packagingCents;
}

/**
 * Minimum allowed line total (cents) satisfying every CONFIGURED margin
 * floor. Returns null — meaning "cannot be computed" — when costs are
 * unconfigured, when no floor is configured, or when a floor is
 * arithmetically unsatisfiable (fee% + floor ≥ 100%). Callers must treat
 * null as fail-closed, never as "no floor".
 *
 * Derivations (price P, all integer cents / bps):
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
 * — it applies to deviations from the engine price.
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
