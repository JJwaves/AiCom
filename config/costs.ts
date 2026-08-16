import type { CostModelConfig, ProductCostConfig } from "@/modules/pricing/cost-model";

/**
 * Factory cost model — [TO BE PROVIDED] BY THE BUSINESS OWNER.
 *
 * Every `null` below is a deliberate placeholder. The pricing module treats
 * ANY null as "cost model unconfigured": margin outputs render as
 * unavailable and every price-floor guardrail fails closed (see
 * modules/pricing/cost-model.ts). DO NOT fill these with estimates or
 * invented numbers — only real factory/carrier/processor economics.
 *
 * NO INDUSTRY AVERAGES. Not 20%, not 30%, not "typical for non-woven".
 * A guessed cost is worse than a missing one: a missing cost reports
 * "unavailable"; a guessed cost reports a number that looks true.
 *
 * MISSING COSTS NEVER BLOCK A SALE (§47). The storefront prices, the cart
 * totals and checkout completes with every value here null — only PROFIT
 * ANALYTICS and future PRICE ACTIONS are blocked.
 *
 * Units: integer cents; rates in integer basis points (290 = 2.90%).
 * What each field means, and a fill-in template: BUSINESS_CONFIG_TODO.md →
 * "Cost model". Full architecture: docs/UNIT_ECONOMICS.md.
 */

/**
 * Cost-model version stamp (§29). Recorded on every persisted order cost
 * snapshot, so "which cost configuration produced this number?" stays
 * answerable after the numbers change.
 *
 * BUMP THIS ON EVERY CHANGE to any value in this file. Format:
 * `YYYY-MM-DD.<session>.<n>`.
 */
export const COST_MODEL_VERSION = "2026-08-16.s13_5.1";

/** Placeholder block — every input [TO BE PROVIDED]. */
const COSTS_TO_BE_PROVIDED: ProductCostConfig = {
  baseManufacturingCentsPerUnit: null,
  // `manufacturingTiers` is deliberately ABSENT, not null: omitting the key
  // means "the factory quotes one unit cost at every volume". Add it only
  // when the factory really does quote volume breaks (see the template in
  // BUSINESS_CONFIG_TODO.md) — the factory's breaks are NOT assumed to
  // match the storefront's sell-price tiers in config/products.ts.
  sizeAdjustmentCentsPerUnit: null,
  materialAdjustmentCentsPerUnit: null,
  printing: null,
  packagingCentsPerUnit: null,
  shipping: null,
  otherVariableCentsPerUnit: null,
};

export const COST_MODEL: CostModelConfig = {
  version: COST_MODEL_VERSION,

  // One entry per purchasable product (ids from config/products.ts).
  products: {
    "p-custom-takeout": COSTS_TO_BE_PROVIDED,
    "p-heavy-duty": COSTS_TO_BE_PROVIDED,
    "p-cafe-carryout": COSTS_TO_BE_PROVIDED,
    "p-catering": COSTS_TO_BE_PROVIDED,
  },

  /**
   * Costs charged ONCE PER ORDER regardless of how many lines it has.
   * 0 is a valid CONFIRMED answer ("we do not incur this") — which is
   * exactly why a null is not read as zero.
   */
  orderCosts: {
    packagingCentsPerOrder: null, // [TO BE PROVIDED] — master carton/pallet. Counted as COGS.
    handlingCentsPerOrder: null, // [TO BE PROVIDED] — pick/pack. A variable selling cost, not COGS.
  },

  paymentFee: {
    percentBps: null, // [TO BE PROVIDED] — processor % in bps (e.g. 290 = 2.9%)
    fixedCents: null, // [TO BE PROVIDED] — processor fixed fee PER TRANSACTION (e.g. 30 = $0.30)
  },

  /**
   * What the customer is charged for shipping — NOT what shipping costs.
   *
   * `not_collected` is a STRUCTURAL FACT here, not an assumption: checkout
   * collects no separate shipping charge (`orders` has no shipping column
   * and `createOrder` sets totalCents = subtotalCents), and the storefront
   * says "shipping calculated at checkout" because no rate source is
   * configured (config/shipping.ts). The shipping subsidy BagDirect bears
   * is therefore the FULL freight cost:
   *   subsidy = max(actual freight − 0, 0) = actual freight.
   *
   * When real shipping charging exists, this must change together with the
   * order model — see docs/UNIT_ECONOMICS.md → "Shipping economics".
   */
  shippingPolicy: {
    customerCharge: { kind: "not_collected" },
  },

  /**
   * MINIMUM = hard safety boundary. A price below it must be blocked.
   * TARGET  = business objective. Below target is a review signal, NOT a
   *           violation, and a target is NEVER used as a floor (§24).
   */
  marginPolicy: {
    minimumGrossMarginBps: null, // [TO BE PROVIDED] — e.g. 3000 = 30%
    minimumContributionMarginBps: null, // [TO BE PROVIDED]
    targetGrossMarginBps: null, // [TO BE PROVIDED]
    targetContributionMarginBps: null, // [TO BE PROVIDED]
  },
};
