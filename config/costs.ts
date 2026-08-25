import { FLAT_US_SHIPPING_CENTS } from "@/config/shipping";
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
export const COST_MODEL_VERSION = "2026-08-16.product1.1";

/**
 * SUPPLIER REFERENCE FIGURES — NON-AUTHORITATIVE, DELIBERATELY NOT WIRED IN
 * ─────────────────────────────────────────────────────────────────────────
 * The factory quotes Product #1 in CNY:
 *
 *   Large        ¥0.67 / bag   ·  plate fee ¥310 per production colour
 *   Extra Large  ¥0.81 / bag   ·  plate fee ¥400 per production colour
 *   (historic XL job: 10,000 × ¥0.81 + 6 colours × ¥400 = ¥10,500)
 *
 * They are recorded here as a COMMENT and nowhere else. Putting them in the
 * fields below would be an accounting error, not a shortcut: every value in
 * this model is USD integer cents, BagDirect's revenue is USD, and there is
 * deliberately NO FX conversion anywhere in the unit-economics architecture.
 * A ¥0.81 read as 81 US cents against a 23¢ sell price invents a catastrophic
 * loss; read as 0.81 of anything it silently invents a currency. Either way
 * the dashboard would show a confident, false margin.
 *
 * The costs stay null until the owner supplies NORMALISED USD costs, or an
 * explicit FX/accounting policy is implemented. Until then profit analytics
 * correctly report "unavailable" — see docs/UNIT_ECONOMICS.md.
 */

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

  // One entry per CATALOG product (ids from config/products.ts), including
  // launch-disabled ones — cost validation runs against the whole file.
  products: {
    // Product #1 (launch). NULL ON PURPOSE — see the CNY note above.
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
   * What the customer is CHARGED for shipping — NOT what shipping costs.
   *
   * The MVP collects a flat $100 per order: it rides the Shopify draft order
   * as a single `shippingLine`, so the customer sees and pays it before
   * payment. That is a real collected charge, so `not_collected` is no
   * longer true and saying so would understate revenue and overstate the
   * subsidy.
   *
   * It is `flat_per_order`, which the model reports as PARTIAL on purpose:
   * BagDirect's `orders` table still records only product revenue
   * (totalCents = subtotalCents; there is no shipping column), so this is a
   * CONFIGURED CONSTANT applied to every order rather than a per-order
   * recorded amount. Product revenue and the shipping charge therefore stay
   * semantically distinct in the accounting, which is exactly what we want
   * — the $100 is never counted as product revenue.
   *
   * The freight COST it offsets (`products.*.shipping`) is still null, so
   * the subsidy remains unavailable rather than being reported as "-$100".
   */
  shippingPolicy: {
    customerCharge: { kind: "flat_per_order", centsPerOrder: FLAT_US_SHIPPING_CENTS },
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
