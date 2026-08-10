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
 * Units: integer cents; rates in integer basis points (290 = 2.90%).
 * What each field means: BUSINESS_CONFIG_TODO.md → "Cost model".
 */

/** Placeholder block — every input [TO BE PROVIDED]. */
const COSTS_TO_BE_PROVIDED: ProductCostConfig = {
  baseManufacturingCentsPerUnit: null,
  sizeAdjustmentCentsPerUnit: null,
  materialAdjustmentCentsPerUnit: null,
  printing: null,
  packagingCentsPerUnit: null,
  shipping: null,
  otherVariableCentsPerUnit: null,
};

export const COST_MODEL: CostModelConfig = {
  // One entry per purchasable product (ids from config/products.ts).
  products: {
    "p-custom-takeout": COSTS_TO_BE_PROVIDED,
    "p-heavy-duty": COSTS_TO_BE_PROVIDED,
    "p-cafe-carryout": COSTS_TO_BE_PROVIDED,
    "p-catering": COSTS_TO_BE_PROVIDED,
  },
  paymentFee: {
    percentBps: null, // [TO BE PROVIDED] — processor % in bps (e.g. 290 = 2.9%)
    fixedCents: null, // [TO BE PROVIDED] — processor fixed fee (e.g. 30 = $0.30)
  },
  marginPolicy: {
    minimumGrossMarginBps: null, // [TO BE PROVIDED] — e.g. 3000 = 30%
    minimumContributionMarginBps: null, // [TO BE PROVIDED]
    targetContributionMarginBps: null, // [TO BE PROVIDED]
  },
};
