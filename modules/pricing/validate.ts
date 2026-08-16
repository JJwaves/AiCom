import type { Product } from "@/types/commerce";
import type { CostModelConfig, ManufacturingTier, ProductCostConfig } from "./cost-model";

/**
 * COST CONFIGURATION VALIDATION (Session 13.5 §39).
 *
 * Invalid configuration must FAIL SAFE and LOUDLY. Nothing here repairs a
 * bad value into a plausible one: a negative manufacturing cost is an
 * error, not a number to clamp at zero, because a clamped value would then
 * flow into margins and price floors looking exactly like a real one.
 *
 * `null` is NOT an error. Null means [TO BE PROVIDED] — the documented
 * unconfigured state, already handled by the cost model (metrics report
 * unavailable, price floors fail closed). Validation is about values that
 * are PRESENT and WRONG.
 *
 * These checks never throw during a customer request. Checkout does not
 * depend on cost configuration (§47) — validation is surfaced on the admin
 * readiness view and asserted in tests.
 */

export type CostConfigIssueSeverity = "ERROR" | "WARNING";

export type CostConfigIssue = {
  severity: CostConfigIssueSeverity;
  /** Exact config path, e.g. `products.p-custom-takeout.packagingCentsPerUnit`. */
  path: string;
  message: string;
};

export type CostConfigValidation = {
  valid: boolean;
  errors: CostConfigIssue[];
  warnings: CostConfigIssue[];
};

const MAX_BPS = 10_000;

function checkMoney(
  value: number | null | undefined,
  path: string,
  issues: CostConfigIssue[],
  { allowZero = true }: { allowZero?: boolean } = {},
): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value)) {
    issues.push({ severity: "ERROR", path, message: "Must be a finite number of integer cents." });
    return;
  }
  if (!Number.isInteger(value)) {
    issues.push({
      severity: "ERROR",
      path,
      message: `Must be integer cents (got ${value}). Fractional cents accumulate rounding error across thousands of units.`,
    });
  }
  if (value < 0) {
    issues.push({ severity: "ERROR", path, message: `A cost cannot be negative (got ${value}).` });
  }
  if (!allowZero && value === 0) {
    issues.push({ severity: "ERROR", path, message: "Must be greater than zero." });
  }
}

function checkBps(
  value: number | null | undefined,
  path: string,
  issues: CostConfigIssue[],
  { maxExclusive = MAX_BPS }: { maxExclusive?: number } = {},
): void {
  if (value === null || value === undefined) return;
  if (!Number.isInteger(value)) {
    issues.push({ severity: "ERROR", path, message: `Must be an integer number of basis points (got ${value}).` });
    return;
  }
  if (value < 0) {
    issues.push({ severity: "ERROR", path, message: `Cannot be negative (got ${value} bps).` });
  }
  if (value >= maxExclusive) {
    issues.push({
      severity: "ERROR",
      path,
      message: `Must be below ${maxExclusive} bps (${maxExclusive / 100}%) — got ${value} bps (${value / 100}%). A margin of 100% or more is unsatisfiable at any price.`,
    });
  }
}

function checkTiers(tiers: ManufacturingTier[] | undefined, path: string, issues: CostConfigIssue[]): void {
  if (tiers === undefined) return;
  if (!Array.isArray(tiers) || tiers.length === 0) {
    issues.push({
      severity: "ERROR",
      path,
      message: "When present, manufacturing tiers must be a non-empty array. Omit the key entirely if the factory quotes one unit cost at every volume.",
    });
    return;
  }
  const seen = new Set<number>();
  let previousMinQty = -1;
  tiers.forEach((tier, i) => {
    const tierPath = `${path}[${i}]`;
    if (!Number.isInteger(tier.minQty) || tier.minQty <= 0) {
      issues.push({ severity: "ERROR", path: tierPath, message: `minQty must be a positive integer (got ${tier.minQty}).` });
    }
    checkMoney(tier.centsPerUnit, `${tierPath}.centsPerUnit`, issues);
    if (seen.has(tier.minQty)) {
      issues.push({ severity: "ERROR", path: tierPath, message: `Duplicate tier for minQty ${tier.minQty}.` });
    }
    seen.add(tier.minQty);
    if (tier.minQty <= previousMinQty) {
      issues.push({
        severity: "ERROR",
        path: tierPath,
        message: `Tiers must be listed in ascending minQty order (${tier.minQty} follows ${previousMinQty}).`,
      });
    }
    previousMinQty = tier.minQty;
  });
}

function validateProduct(
  productId: string,
  pc: ProductCostConfig,
  product: Product | undefined,
  issues: CostConfigIssue[],
): void {
  const prefix = `products.${productId}`;

  if (!product) {
    issues.push({
      severity: "ERROR",
      path: prefix,
      message: `No catalog product has id "${productId}". A cost entry for an unknown product can never be applied to an order.`,
    });
  }

  checkMoney(pc.baseManufacturingCentsPerUnit, `${prefix}.baseManufacturingCentsPerUnit`, issues);
  checkMoney(pc.packagingCentsPerUnit, `${prefix}.packagingCentsPerUnit`, issues);
  checkMoney(pc.otherVariableCentsPerUnit, `${prefix}.otherVariableCentsPerUnit`, issues);
  checkTiers(pc.manufacturingTiers, `${prefix}.manufacturingTiers`, issues);

  if (pc.manufacturingTiers !== undefined && pc.baseManufacturingCentsPerUnit === null) {
    issues.push({
      severity: "WARNING",
      path: `${prefix}.baseManufacturingCentsPerUnit`,
      message:
        "Quantity tiers are configured, so the base rate is unused for quantities the tiers cover. Quantities below the first tier stay uncostable rather than falling back to the base rate.",
    });
  }

  const dimension = (
    map: Record<string, number> | null,
    field: string,
    offered: { id: string }[] | undefined,
    label: string,
  ) => {
    if (map === null) return;
    for (const [key, value] of Object.entries(map)) {
      checkMoney(value, `${prefix}.${field}.${key}`, issues);
      if (offered && !offered.some((o) => o.id === key)) {
        issues.push({
          severity: "WARNING",
          path: `${prefix}.${field}.${key}`,
          message: `"${key}" is not an offered ${label} for this product, so this cost can never apply.`,
        });
      }
    }
    if (offered) {
      for (const o of offered) {
        if (!(o.id in map)) {
          issues.push({
            severity: "ERROR",
            path: `${prefix}.${field}.${o.id}`,
            message: `The product offers ${label} "${o.id}" but no cost is configured for it, so any order using it is uncostable.`,
          });
        }
      }
    }
  };

  dimension(pc.sizeAdjustmentCentsPerUnit, "sizeAdjustmentCentsPerUnit", product?.sizes, "size");
  dimension(pc.materialAdjustmentCentsPerUnit, "materialAdjustmentCentsPerUnit", product?.materials, "material");

  if (pc.printing !== null) {
    for (const [key, value] of Object.entries(pc.printing)) {
      checkMoney(value?.centsPerUnit, `${prefix}.printing.${key}.centsPerUnit`, issues);
      checkMoney(value?.setupFeeCents, `${prefix}.printing.${key}.setupFeeCents`, issues);
      if (product && !product.printOptions.some((o) => o.id === key)) {
        issues.push({
          severity: "WARNING",
          path: `${prefix}.printing.${key}`,
          message: `"${key}" is not an offered printing option for this product, so this cost can never apply.`,
        });
      }
    }
    for (const option of product?.printOptions ?? []) {
      if (!(option.id in pc.printing)) {
        issues.push({
          severity: "ERROR",
          path: `${prefix}.printing.${option.id}`,
          message: `The product offers printing option "${option.id}" but no cost is configured for it, so any order using it is uncostable.`,
        });
      }
    }
  }

  if (pc.shipping !== null) {
    const path = `${prefix}.shipping`;
    switch (pc.shipping.kind) {
      case "per_unit":
        checkMoney(pc.shipping.centsPerUnit, `${path}.centsPerUnit`, issues);
        break;
      case "per_order":
        checkMoney(pc.shipping.centsPerOrder, `${path}.centsPerOrder`, issues);
        break;
      case "per_carton":
        checkMoney(pc.shipping.centsPerCarton, `${path}.centsPerCarton`, issues);
        if (!Number.isInteger(pc.shipping.unitsPerCarton) || pc.shipping.unitsPerCarton <= 0) {
          issues.push({
            severity: "ERROR",
            path: `${path}.unitsPerCarton`,
            message: `Units per carton must be a positive integer (got ${pc.shipping.unitsPerCarton}).`,
          });
        }
        break;
    }
  }
}

/**
 * Validate the whole cost model against the live catalog.
 *
 * ERRORs mean the configuration is wrong and must be corrected; WARNINGs
 * mean it is internally consistent but something in it can never apply.
 * Neither is ever fixed silently.
 */
export function validateCostModel(model: CostModelConfig, products: Product[]): CostConfigValidation {
  const issues: CostConfigIssue[] = [];
  const byId = new Map(products.map((p) => [p.id, p]));

  if (typeof model.version !== "string" || model.version.trim() === "") {
    issues.push({
      severity: "ERROR",
      path: "version",
      message: "A cost-model version stamp is required so every persisted calculation stays auditable.",
    });
  }

  for (const [productId, pc] of Object.entries(model.products)) {
    validateProduct(productId, pc, byId.get(productId), issues);
  }
  for (const product of products) {
    if (!(product.id in model.products)) {
      issues.push({
        severity: "ERROR",
        path: `products.${product.id}`,
        message: `Catalog product "${product.id}" has no cost entry, so orders for it can never be costed.`,
      });
    }
  }

  checkMoney(model.orderCosts.packagingCentsPerOrder, "orderCosts.packagingCentsPerOrder", issues);
  checkMoney(model.orderCosts.handlingCentsPerOrder, "orderCosts.handlingCentsPerOrder", issues);

  checkBps(model.paymentFee.percentBps, "paymentFee.percentBps", issues, { maxExclusive: MAX_BPS });
  checkMoney(model.paymentFee.fixedCents, "paymentFee.fixedCents", issues);

  const charge = model.shippingPolicy.customerCharge;
  if (charge.kind === "flat_per_order") {
    checkMoney(charge.centsPerOrder, "shippingPolicy.customerCharge.centsPerOrder", issues);
  }
  if (charge.kind === "unavailable" && charge.reason.trim() === "") {
    issues.push({
      severity: "ERROR",
      path: "shippingPolicy.customerCharge.reason",
      message: "An unavailable shipping charge must say why, so the dashboard can explain the gap.",
    });
  }

  const policy = model.marginPolicy;
  checkBps(policy.minimumGrossMarginBps, "marginPolicy.minimumGrossMarginBps", issues);
  checkBps(policy.minimumContributionMarginBps, "marginPolicy.minimumContributionMarginBps", issues);
  checkBps(policy.targetGrossMarginBps, "marginPolicy.targetGrossMarginBps", issues);
  checkBps(policy.targetContributionMarginBps, "marginPolicy.targetContributionMarginBps", issues);

  const pair = (min: number | null, target: number | null, kind: string, minPath: string, targetPath: string) => {
    if (min !== null && target !== null && target < min) {
      issues.push({
        severity: "ERROR",
        path: targetPath,
        message: `The target ${kind} margin (${target} bps) is below its own minimum (${min} bps at ${minPath}). A target below the floor is contradictory.`,
      });
    }
  };
  pair(
    policy.minimumGrossMarginBps,
    policy.targetGrossMarginBps,
    "gross",
    "marginPolicy.minimumGrossMarginBps",
    "marginPolicy.targetGrossMarginBps",
  );
  pair(
    policy.minimumContributionMarginBps,
    policy.targetContributionMarginBps,
    "contribution",
    "marginPolicy.minimumContributionMarginBps",
    "marginPolicy.targetContributionMarginBps",
  );

  if (
    policy.minimumContributionMarginBps !== null &&
    model.paymentFee.percentBps !== null &&
    policy.minimumContributionMarginBps + model.paymentFee.percentBps >= MAX_BPS
  ) {
    issues.push({
      severity: "ERROR",
      path: "marginPolicy.minimumContributionMarginBps",
      message: `The minimum contribution margin (${policy.minimumContributionMarginBps} bps) plus the payment fee (${model.paymentFee.percentBps} bps) reaches or exceeds 100%, so no price can ever satisfy it.`,
    });
  }

  const errors = issues.filter((i) => i.severity === "ERROR");
  const warnings = issues.filter((i) => i.severity === "WARNING");
  return { valid: errors.length === 0, errors, warnings };
}
