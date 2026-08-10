import { COST_MODEL } from "@/config/costs";
import type { PricingTier, Product, ProductConfiguration } from "@/types/commerce";
import { quoteConfiguration, requiresCustomQuote } from "./engine";
import {
  computeCosts,
  minimumAllowedPriceCents,
  productCostCents,
  type CostBreakdown,
  type CostModelConfig,
} from "./cost-model";

/**
 * /modules/pricing — the sole pricing authority.
 *
 * - Sell-price math lives in engine.ts (pure tier kernel, unchanged since
 *   Session 01; unit-tested).
 * - Cost/margin math lives in cost-model.ts, fed by config/costs.ts
 *   ([TO BE PROVIDED] placeholders — margins report "unavailable" and
 *   price floors fail closed until real economics are configured).
 * - `calculatePrice` is the one entry point future callers (checkout
 *   re-quote, AI sales tools, pricing agent) should use. AI never invents
 *   prices; it calls this.
 *
 * Cost/margin figures are business-internal: never return them to the
 * browser or into prompts/analytics events.
 */

export {
  baseUnitPriceCents,
  optionDeltaCents,
  quoteConfiguration,
  requiresCustomQuote,
  savingsPct,
  startingUnitPriceCents,
  tierForQuantity,
} from "./engine";
export {
  computeCosts,
  evaluatePriceFloor,
  minimumAllowedPriceCents,
  productCostCents,
} from "./cost-model";
export type {
  CostBreakdown,
  CostComputation,
  CostModelConfig,
  MarginPolicyConfig,
  PaymentFeeConfig,
  PriceFloorVerdict,
  ProductCostConfig,
  ShippingCostBasis,
} from "./cost-model";

export type PriceCalculation =
  | {
      ok: true;
      /** Sell side — deterministic engine output. */
      unitPriceCents: number;
      subtotalCents: number;
      totalPriceCents: number;
      currency: "USD" | "CAD";
      tier: PricingTier;
      savingsPct: number;
      /** Cost side — null until config/costs.ts is fully provided. */
      costStatus: "configured" | "unconfigured";
      missingCostInputs: string[];
      costs: CostBreakdown | null;
      grossProfitCents: number | null;
      /** Fraction 0–1; null = unavailable (cost model unconfigured). */
      grossMarginPct: number | null;
      contributionProfitCents: number | null;
      contributionMarginPct: number | null;
      /** Line-total floor from margin policy; null = cannot compute (fail closed). */
      minimumAllowedPriceCents: number | null;
      minimumAllowedUnitPriceCents: number | null;
    }
  | { ok: false; reason: "requires_custom_quote" | "unpriceable" };

/**
 * Price a configuration: engine sell price + cost/margin breakdown.
 * The single calculation path for server re-quotes and future AI tools.
 */
export function calculatePrice(
  product: Product,
  config: ProductConfiguration,
  model: CostModelConfig = COST_MODEL,
): PriceCalculation {
  if (requiresCustomQuote(product, config)) return { ok: false, reason: "requires_custom_quote" };
  const quote = quoteConfiguration(product, config);
  if (!quote) return { ok: false, reason: "unpriceable" };

  const sell = {
    unitPriceCents: quote.unitPriceCents,
    subtotalCents: quote.totalCents,
    totalPriceCents: quote.totalCents,
    currency: quote.currency,
    tier: quote.tier,
    savingsPct: quote.savingsPct,
  };

  const computed = computeCosts(product, config, quote.totalCents, model);
  if (computed.status === "unconfigured") {
    return {
      ok: true,
      ...sell,
      costStatus: "unconfigured",
      missingCostInputs: computed.missingInputs,
      costs: null,
      grossProfitCents: null,
      grossMarginPct: null,
      contributionProfitCents: null,
      contributionMarginPct: null,
      minimumAllowedPriceCents: null,
      minimumAllowedUnitPriceCents: null,
    };
  }

  const costs = computed.costs;
  const grossProfitCents = quote.totalCents - productCostCents(costs);
  const contributionProfitCents = quote.totalCents - costs.totalCostCents;
  const floor = minimumAllowedPriceCents(costs, model.paymentFee, model.marginPolicy);
  return {
    ok: true,
    ...sell,
    costStatus: "configured",
    missingCostInputs: [],
    costs,
    grossProfitCents,
    grossMarginPct: quote.totalCents > 0 ? grossProfitCents / quote.totalCents : null,
    contributionProfitCents,
    contributionMarginPct: quote.totalCents > 0 ? contributionProfitCents / quote.totalCents : null,
    minimumAllowedPriceCents: floor,
    minimumAllowedUnitPriceCents: floor === null ? null : Math.ceil(floor / config.quantity),
  };
}
