import type { Product } from "@/types/commerce";
import type { CostModelConfig, ProductCostConfig } from "./cost-model";
import { validateCostModel, type CostConfigValidation } from "./validate";

/**
 * COST READINESS (Session 13.5 §37, §38) — the owner-facing answer to
 * "what do you still need from me, and what does it unlock?"
 *
 * READ-ONLY. This is a view over `config/costs.ts`, never a second source
 * of configuration: there is no editor, no database mirror and no admin
 * write path, so the file stays the single authority (§37).
 *
 * Two layers, deliberately separate:
 *   CATEGORIES    one row per cost/margin input: Configured / Missing /
 *                 Invalid / Partial.
 *   CAPABILITIES  what those inputs unlock: Profit Intelligence, POAS,
 *                 Price Action Safety. Ready / Partial / Unavailable.
 *
 * A category being Missing is not a failure — it is the honest state until
 * the owner supplies a real number. Nothing here estimates one.
 */

export type CategoryState = "CONFIGURED" | "PARTIAL" | "MISSING" | "INVALID";
export type CapabilityState = "READY" | "PARTIAL" | "UNAVAILABLE";

export type CostReadinessCategory = {
  key: string;
  /** Owner language, e.g. "Manufacturing cost". */
  label: string;
  state: CategoryState;
  /** What this input is needed for, in owner language. */
  neededFor: string;
  /** Exact config paths still unfilled (empty when configured). */
  missingPaths: string[];
  /** Config paths carrying an invalid value. */
  invalidPaths: string[];
};

export type CostCapability = {
  key: "GROSS_PROFIT" | "CONTRIBUTION_PROFIT" | "POAS" | "PRICE_ACTION_SAFETY";
  label: string;
  state: CapabilityState;
  reason: string;
  blockers: string[];
};

export type CostReadiness = {
  costModelVersion: string;
  categories: CostReadinessCategory[];
  capabilities: CostCapability[];
  validation: CostConfigValidation;
  /** Every unfilled config path, deduplicated — the owner's to-do list. */
  missingConfiguration: string[];
  /** True only when EVERY product input, order cost and the payment fee are set. */
  costModelConfigured: boolean;
  /** True when a usable margin FLOOR exists (gross or contribution). */
  marginFloorConfigured: boolean;
  grossProfitAvailable: boolean;
  contributionProfitAvailable: boolean;
  summary: string;
};

const isSet = (v: unknown): boolean => v !== null && v !== undefined;

/**
 * Sync completeness check over the CONFIG ALONE (no catalog needed): true
 * only when every product input, both order costs, the payment fee and a
 * knowable customer shipping charge are provided.
 *
 * This is THE one definition of "are costs configured?" — `assessCostReadiness`
 * and `modules/business-intelligence` both call it rather than re-deriving
 * the answer, because two definitions would eventually disagree.
 */
export function isCostModelConfigured(model: CostModelConfig): boolean {
  if (Object.keys(model.products).length === 0) return false;
  if (!isSet(model.paymentFee.percentBps) || !isSet(model.paymentFee.fixedCents)) return false;
  if (!isSet(model.orderCosts.packagingCentsPerOrder) || !isSet(model.orderCosts.handlingCentsPerOrder)) return false;
  if (model.shippingPolicy.customerCharge.kind === "unavailable") return false;
  return Object.values(model.products).every(
    (pc) =>
      isSet(pc.baseManufacturingCentsPerUnit) &&
      isSet(pc.sizeAdjustmentCentsPerUnit) &&
      isSet(pc.materialAdjustmentCentsPerUnit) &&
      isSet(pc.printing) &&
      isSet(pc.packagingCentsPerUnit) &&
      isSet(pc.shipping) &&
      isSet(pc.otherVariableCentsPerUnit),
  );
}

/** Per-product paths for one input, across every configured product. */
function productPaths(
  model: CostModelConfig,
  field: string,
  read: (pc: ProductCostConfig) => unknown,
): string[] {
  return Object.entries(model.products)
    .filter(([, pc]) => !isSet(read(pc)))
    .map(([id]) => `config/costs.ts → products.${id}.${field}`);
}

/**
 * Printing needs BOTH a per-unit rate and a setup fee for every offered
 * option, so it is reported as two categories reading the same block.
 */
function printingPaths(model: CostModelConfig, products: Product[], part: "centsPerUnit" | "setupFeeCents"): string[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const missing: string[] = [];
  for (const [id, pc] of Object.entries(model.products)) {
    if (pc.printing === null) {
      missing.push(`config/costs.ts → products.${id}.printing`);
      continue;
    }
    for (const option of byId.get(id)?.printOptions ?? []) {
      const entry = pc.printing[option.id];
      if (!isSet(entry?.[part])) missing.push(`config/costs.ts → products.${id}.printing.${option.id}.${part}`);
    }
  }
  return missing;
}

function category(
  key: string,
  label: string,
  neededFor: string,
  missingPaths: string[],
  invalidPaths: string[],
  totalScope: number,
): CostReadinessCategory {
  const state: CategoryState =
    invalidPaths.length > 0
      ? "INVALID"
      : missingPaths.length === 0
        ? "CONFIGURED"
        : missingPaths.length >= totalScope
          ? "MISSING"
          : "PARTIAL";
  return { key, label, state, neededFor, missingPaths, invalidPaths };
}

export function assessCostReadiness(model: CostModelConfig, products: Product[]): CostReadiness {
  const validation = validateCostModel(model, products);
  const invalidFor = (prefixes: string[]): string[] =>
    validation.errors.filter((e) => prefixes.some((p) => e.path.startsWith(p))).map((e) => `config/costs.ts → ${e.path}`);

  const productCount = Math.max(Object.keys(model.products).length, 1);

  const manufacturing = productPaths(model, "baseManufacturingCentsPerUnit", (pc) => pc.baseManufacturingCentsPerUnit);
  const sizes = productPaths(model, "sizeAdjustmentCentsPerUnit", (pc) => pc.sizeAdjustmentCentsPerUnit);
  const materials = productPaths(model, "materialAdjustmentCentsPerUnit", (pc) => pc.materialAdjustmentCentsPerUnit);
  const printingUnit = printingPaths(model, products, "centsPerUnit");
  const printingSetup = printingPaths(model, products, "setupFeeCents");
  const packagingUnit = productPaths(model, "packagingCentsPerUnit", (pc) => pc.packagingCentsPerUnit);
  const shippingBasis = productPaths(model, "shipping", (pc) => pc.shipping);
  const otherVariable = productPaths(model, "otherVariableCentsPerUnit", (pc) => pc.otherVariableCentsPerUnit);

  const orderPackaging = isSet(model.orderCosts.packagingCentsPerOrder)
    ? []
    : ["config/costs.ts → orderCosts.packagingCentsPerOrder"];
  const handling = isSet(model.orderCosts.handlingCentsPerOrder)
    ? []
    : ["config/costs.ts → orderCosts.handlingCentsPerOrder"];
  const paymentFee = [
    ...(isSet(model.paymentFee.percentBps) ? [] : ["config/costs.ts → paymentFee.percentBps"]),
    ...(isSet(model.paymentFee.fixedCents) ? [] : ["config/costs.ts → paymentFee.fixedCents"]),
  ];
  const shippingCharge =
    model.shippingPolicy.customerCharge.kind === "unavailable"
      ? ["config/costs.ts → shippingPolicy.customerCharge"]
      : [];

  const marginPath = (field: keyof CostModelConfig["marginPolicy"]): string[] =>
    isSet(model.marginPolicy[field]) ? [] : [`config/costs.ts → marginPolicy.${field}`];

  const categories: CostReadinessCategory[] = [
    category("manufacturing", "Manufacturing cost", "gross profit, minimum safe price", manufacturing, invalidFor(Object.keys(model.products).map((id) => `products.${id}.baseManufacturing`)), productCount),
    category("size-adjustments", "Size cost adjustments", "per-configuration cost", sizes, [], productCount),
    category("material-adjustments", "Material cost adjustments", "per-configuration cost", materials, [], productCount),
    category("printing", "Printing cost", "gross profit on printed orders", printingUnit, [], Math.max(printingUnit.length, 1)),
    category("printing-setup", "Printing setup cost", "gross profit on printed orders", printingSetup, [], Math.max(printingSetup.length, 1)),
    category("packaging-unit", "Packaging cost (per unit)", "gross profit", packagingUnit, [], productCount),
    category("packaging-order", "Packaging cost (per order)", "gross profit", orderPackaging, invalidFor(["orderCosts.packagingCentsPerOrder"]), 1),
    category("handling", "Fulfilment handling (per order)", "contribution profit", handling, invalidFor(["orderCosts.handlingCentsPerOrder"]), 1),
    category("shipping-cost", "Shipping cost basis", "shipping subsidy, contribution profit", shippingBasis, [], productCount),
    category("shipping-charge", "Customer shipping charge", "shipping subsidy", shippingCharge, invalidFor(["shippingPolicy"]), 1),
    category("payment-fee", "Payment processing fee", "contribution profit", paymentFee, invalidFor(["paymentFee"]), 2),
    category("other-variable", "Other variable cost", "contribution profit", otherVariable, [], productCount),
    category("min-gross-margin", "Minimum gross margin", "price floor (hard boundary)", marginPath("minimumGrossMarginBps"), invalidFor(["marginPolicy.minimumGrossMarginBps"]), 1),
    category("min-contribution-margin", "Minimum contribution margin", "price floor (hard boundary)", marginPath("minimumContributionMarginBps"), invalidFor(["marginPolicy.minimumContributionMarginBps"]), 1),
    category("target-gross-margin", "Target gross margin", "review signal (never a floor)", marginPath("targetGrossMarginBps"), invalidFor(["marginPolicy.targetGrossMarginBps"]), 1),
    category("target-contribution-margin", "Target contribution margin", "review signal (never a floor)", marginPath("targetContributionMarginBps"), invalidFor(["marginPolicy.targetContributionMarginBps"]), 1),
  ];

  /* ---- Capabilities ---- */
  const grossBlockers = [
    ...manufacturing,
    ...sizes,
    ...materials,
    ...printingUnit,
    ...printingSetup,
    ...packagingUnit,
    ...orderPackaging,
  ];
  const contributionBlockers = [...grossBlockers, ...shippingBasis, ...shippingCharge, ...paymentFee, ...handling, ...otherVariable];
  const priceActionBlockers = [
    ...contributionBlockers,
    ...(isSet(model.marginPolicy.minimumGrossMarginBps) || isSet(model.marginPolicy.minimumContributionMarginBps)
      ? []
      : ["config/costs.ts → marginPolicy.minimumGrossMarginBps", "config/costs.ts → marginPolicy.minimumContributionMarginBps"]),
  ];

  const invalidBlocker = validation.valid ? [] : validation.errors.map((e) => `config/costs.ts → ${e.path} (invalid)`);
  const grossProfitAvailable = grossBlockers.length === 0 && validation.valid;
  const contributionProfitAvailable = contributionBlockers.length === 0 && validation.valid;
  const marginFloorConfigured =
    isSet(model.marginPolicy.minimumGrossMarginBps) || isSet(model.marginPolicy.minimumContributionMarginBps);

  const capabilities: CostCapability[] = [
    {
      key: "GROSS_PROFIT",
      label: "Profit Intelligence (gross)",
      state: grossProfitAvailable ? "READY" : "UNAVAILABLE",
      reason: grossProfitAvailable
        ? "Product costs are configured, so gross profit and gross margin can be computed for orders that carry a cost snapshot."
        : "Gross profit is unavailable: part of the product cost model has not been provided. It is reported as unavailable, never as zero and never estimated.",
      blockers: [...grossBlockers, ...invalidBlocker],
    },
    {
      key: "CONTRIBUTION_PROFIT",
      label: "Contribution profit before paid media",
      state: contributionProfitAvailable ? "READY" : "UNAVAILABLE",
      reason: contributionProfitAvailable
        ? "Product costs, payment fees, handling and shipping semantics are configured, so contribution profit before paid media can be computed."
        : "Contribution profit before paid media is unavailable: the variable selling costs it subtracts are not fully configured.",
      blockers: [...contributionBlockers, ...invalidBlocker],
    },
    {
      key: "POAS",
      label: "POAS (profit on ad spend)",
      state: contributionProfitAvailable ? "READY" : "UNAVAILABLE",
      reason: contributionProfitAvailable
        ? "Contribution profit exists, so POAS can be computed where ad spend, currency and attribution coverage also permit. Revenue ROAS is never presented as POAS."
        : "POAS is unavailable because contribution profit before paid media cannot be computed. Revenue-based ROAS is shown instead and is NOT a profitability measure.",
      blockers: [...contributionBlockers, ...invalidBlocker],
    },
    {
      key: "PRICE_ACTION_SAFETY",
      label: "Price action safety (minimum safe price)",
      state: priceActionBlockers.length === 0 && validation.valid ? "READY" : "UNAVAILABLE",
      reason:
        priceActionBlockers.length === 0 && validation.valid
          ? "Costs and a margin floor are configured, so a proposed price can be checked against a deterministic minimum. Approval remains human — no executor exists."
          : "The minimum safe price cannot be computed, so no price change can be shown to be safe. The price floor fails closed; it never defaults to permitting a change.",
      blockers: [...priceActionBlockers, ...invalidBlocker],
    },
  ];

  const missingConfiguration = [...new Set(categories.flatMap((c) => c.missingPaths))];
  const costModelConfigured = contributionBlockers.length === 0;

  const summary = !validation.valid
    ? `The cost configuration has ${validation.errors.length} invalid ${validation.errors.length === 1 ? "value" : "values"}. Profit intelligence stays unavailable until they are corrected — a bad value is never normalised into a plausible one.`
    : costModelConfigured
      ? marginFloorConfigured
        ? "Costs and a margin floor are configured — profit intelligence and the minimum safe price can be computed."
        : "Costs are configured, but no minimum margin is set — the price floor still fails closed, so no price change can be shown to be safe."
      : `${missingConfiguration.length} cost ${missingConfiguration.length === 1 ? "input has" : "inputs have"} not been provided, so profit is reported as unavailable — never as zero, and never estimated.`;

  return {
    costModelVersion: model.version,
    categories,
    capabilities,
    validation,
    missingConfiguration,
    costModelConfigured,
    marginFloorConfigured,
    grossProfitAvailable,
    contributionProfitAvailable,
    summary,
  };
}
