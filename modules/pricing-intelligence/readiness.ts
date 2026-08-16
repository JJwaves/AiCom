import { COST_MODEL } from "@/config/costs";
import { GUARDRAIL_LIMITS } from "@/config/guardrails";
import { isCostModelConfigured, type CostModelConfig } from "@/modules/pricing";
import type { ElasticityAssessment, PricingReadiness, ReadinessEntry } from "./types";

/**
 * Cost / margin readiness and PricingReadiness (spec §4, §22, §23, §44).
 *
 * The hard rule of this file: **null is never zero and never "no limit"**.
 * An unfilled cost input means margin is UNKNOWN, so profit impact is
 * UNAVAILABLE, so a specific price change cannot be shown to be safe. That
 * is reported as a blocker naming the exact config path — never softened
 * into an estimate, and never allowed to read as "fine".
 *
 * Everything here is a pure function of configuration. No clock, no
 * database, no model.
 */

/* ------------------------------------------------------------------ */
/* Cost availability                                                   */
/* ------------------------------------------------------------------ */

export type CostInputStatus = {
  /** Owner-facing name, e.g. "Manufacturing cost per unit". */
  label: string;
  /** The exact config path the owner must fill. */
  configPath: string;
  configured: boolean;
  /** What it is needed for, in owner language. */
  neededFor: string;
};

export type CostReadiness = {
  /** True only when EVERY product cost input and the payment fee are set. */
  costModelConfigured: boolean;
  /** True only when a usable margin FLOOR exists (gross or contribution). */
  marginPolicyConfigured: boolean;
  inputs: CostInputStatus[];
  /** Config paths still unfilled — the owner's to-do list, verbatim. */
  missingConfiguration: string[];
  /**
   * Whether gross margin can be computed at all. When false, margin is
   * UNAVAILABLE — it is never rendered as 0% and never estimated.
   */
  grossMarginAvailable: boolean;
  contributionMarginAvailable: boolean;
  /** Owner-language summary sentence for the dashboard. */
  summary: string;
};

const PRODUCT_INPUTS: {
  label: string;
  neededFor: string;
  read: (pc: CostModelConfig["products"][string]) => unknown;
  path: string;
}[] = [
  {
    label: "Manufacturing cost per unit",
    neededFor: "gross margin, minimum safe price",
    read: (pc) => pc.baseManufacturingCentsPerUnit,
    path: "baseManufacturingCentsPerUnit",
  },
  {
    label: "Size cost adjustments",
    neededFor: "per-configuration cost",
    read: (pc) => pc.sizeAdjustmentCentsPerUnit,
    path: "sizeAdjustmentCentsPerUnit",
  },
  {
    label: "Material cost adjustments",
    neededFor: "per-configuration cost",
    read: (pc) => pc.materialAdjustmentCentsPerUnit,
    path: "materialAdjustmentCentsPerUnit",
  },
  {
    label: "Printing cost + setup fee",
    neededFor: "gross margin on printed orders",
    read: (pc) => pc.printing,
    path: "printing",
  },
  { label: "Packaging cost per unit", neededFor: "gross margin", read: (pc) => pc.packagingCentsPerUnit, path: "packagingCentsPerUnit" },
  { label: "Freight cost basis", neededFor: "contribution margin", read: (pc) => pc.shipping, path: "shipping" },
  {
    label: "Other variable cost per unit",
    neededFor: "contribution margin",
    read: (pc) => pc.otherVariableCentsPerUnit,
    path: "otherVariableCentsPerUnit",
  },
];

export function assessCostReadiness(model: CostModelConfig = COST_MODEL): CostReadiness {
  const inputs: CostInputStatus[] = [];
  const missing: string[] = [];

  for (const [productId, pc] of Object.entries(model.products)) {
    for (const spec of PRODUCT_INPUTS) {
      const configPath = `config/costs.ts → products.${productId}.${spec.path}`;
      const configured = spec.read(pc) !== null && spec.read(pc) !== undefined;
      inputs.push({ label: `${spec.label} (${productId})`, configPath, configured, neededFor: spec.neededFor });
      if (!configured) missing.push(configPath);
    }
  }

  const feeInputs: [string, unknown, string, string][] = [
    [
      "Packaging cost per order",
      model.orderCosts.packagingCentsPerOrder,
      "config/costs.ts → orderCosts.packagingCentsPerOrder",
      "gross margin",
    ],
    [
      "Fulfilment handling per order",
      model.orderCosts.handlingCentsPerOrder,
      "config/costs.ts → orderCosts.handlingCentsPerOrder",
      "contribution margin",
    ],
    ["Payment processing %", model.paymentFee.percentBps, "config/costs.ts → paymentFee.percentBps", "contribution margin"],
    ["Payment processing fixed fee", model.paymentFee.fixedCents, "config/costs.ts → paymentFee.fixedCents", "contribution margin"],
    [
      "Minimum gross margin policy",
      model.marginPolicy.minimumGrossMarginBps,
      "config/costs.ts → marginPolicy.minimumGrossMarginBps",
      "minimum safe price (price floor)",
    ],
    [
      "Minimum contribution margin policy",
      model.marginPolicy.minimumContributionMarginBps,
      "config/costs.ts → marginPolicy.minimumContributionMarginBps",
      "minimum safe price (price floor)",
    ],
    [
      "Target gross margin",
      model.marginPolicy.targetGrossMarginBps,
      "config/costs.ts → marginPolicy.targetGrossMarginBps",
      "review signal — never a floor",
    ],
    [
      "Target contribution margin",
      model.marginPolicy.targetContributionMarginBps,
      "config/costs.ts → marginPolicy.targetContributionMarginBps",
      "review signal — never a floor",
    ],
  ];
  for (const [label, value, configPath, neededFor] of feeInputs) {
    const configured = value !== null && value !== undefined;
    inputs.push({ label, configPath, configured, neededFor });
    if (!configured) missing.push(configPath);
  }

  /* THE completeness verdict is NOT re-derived here — modules/pricing owns
   * it (Session 13.5), and two definitions of "are costs configured?" would
   * eventually disagree. This function only names the gaps. */
  const costModelConfigured = isCostModelConfigured(model);

  const marginPolicyConfigured =
    model.marginPolicy.minimumGrossMarginBps !== null || model.marginPolicy.minimumContributionMarginBps !== null;

  /* Gross margin needs product COGS only (including order-scope packaging);
   * contribution additionally needs freight, the payment fee and handling. */
  const grossInputsSet = Object.values(model.products).every(
    (pc) =>
      pc.baseManufacturingCentsPerUnit !== null &&
      pc.sizeAdjustmentCentsPerUnit !== null &&
      pc.materialAdjustmentCentsPerUnit !== null &&
      pc.printing !== null &&
      pc.packagingCentsPerUnit !== null,
  );
  const grossMarginAvailable =
    grossInputsSet && model.orderCosts.packagingCentsPerOrder !== null && Object.keys(model.products).length > 0;
  const contributionMarginAvailable = costModelConfigured;

  const summary = costModelConfigured
    ? marginPolicyConfigured
      ? "Manufacturing costs and a margin floor are configured — margin and minimum safe price can be computed."
      : "Manufacturing costs are configured, but no minimum margin policy exists — the price floor still fails closed, so no price change can be shown to be safe."
    : "Manufacturing costs have not been provided, so margin, profit impact and the minimum safe price cannot be computed. They are reported as unavailable — never as zero, and never estimated.";

  return {
    costModelConfigured,
    marginPolicyConfigured,
    inputs,
    missingConfiguration: missing,
    grossMarginAvailable,
    contributionMarginAvailable,
    summary,
  };
}

/* ------------------------------------------------------------------ */
/* Price-movement limits                                               */
/* ------------------------------------------------------------------ */

export type PriceLimitStatus = { label: string; configPath: string; configured: boolean; value: number | null };

const PRICE_LIMIT_KEYS = [
  ["maximumPriceDecreasePct", "Maximum price decrease per change"],
  ["maximumPriceIncreasePct", "Maximum price increase per change"],
  ["maximumDiscountPct", "Maximum discount"],
  ["maximumMoqChangePct", "Maximum MOQ change"],
  ["maximumExperimentTrafficPct", "Maximum experiment traffic share"],
] as const;

export function assessPriceLimits(limits: Record<string, number | null> = GUARDRAIL_LIMITS): PriceLimitStatus[] {
  return PRICE_LIMIT_KEYS.map(([key, label]) => ({
    label,
    configPath: `config/guardrails.ts → GUARDRAIL_LIMITS.${key}`,
    configured: typeof limits[key] === "number",
    value: typeof limits[key] === "number" ? (limits[key] as number) : null,
  }));
}

/* ------------------------------------------------------------------ */
/* Elasticity (spec §3)                                                */
/* ------------------------------------------------------------------ */

/**
 * Whether price elasticity is estimable.
 *
 * Today: no. The platform has never shown two different prices for the same
 * configuration to comparable audiences, so every observed price/quantity
 * relationship is confounded (bigger buyers differ from smaller buyers in
 * many ways at once). `controlledPriceVariationSources` counts real sources
 * of controlled variation — completed price experiments. While it is 0 the
 * answer is a refusal, not a coefficient.
 *
 * The return type is deliberately `estimable: false` (a literal): there is
 * no code path that produces an elasticity number, so an LLM cannot be
 * asked to fill one in.
 */
export function assessElasticity(controlledPriceVariationSources = 0): ElasticityAssessment {
  return {
    estimable: false,
    reason:
      controlledPriceVariationSources > 0
        ? "Controlled price variation exists but no causal estimation method is implemented, so no elasticity figure is produced."
        : "We have never shown two different prices for the same bag to similar customers, so there is nothing to compare. " +
          "Customers who buy 10,000 bags differ from customers who ask about 500 in many ways at once — order size, business type, " +
          "how they found us — so the fact that larger orders convert more often does not tell us what the price did.",
    controlledPriceVariationSources,
    requirements: [
      "A controlled price experiment (identical product and configuration, different price, comparable audiences), or another valid causal design.",
      "Configured manufacturing costs and a margin policy (config/costs.ts) so any tested price can be checked against the floor.",
      "A configured maximum price movement and experiment traffic share (config/guardrails.ts).",
      "Enough traffic to reach the documented minimum sample per arm.",
    ],
  };
}

/* ------------------------------------------------------------------ */
/* PricingReadiness (spec §22)                                         */
/* ------------------------------------------------------------------ */

export type ReadinessInput = {
  costs: CostReadiness;
  limits: PriceLimitStatus[];
  /** Deterministic behavioral evidence exists at all (any signal emitted). */
  hasBehavioralEvidence: boolean;
  /** Does the experiment engine support real price variants? (S11: no.) */
  priceExperimentSupported: boolean;
};

const entry = (state: ReadinessEntry["state"], reason: string, blockers: string[] = []): ReadinessEntry => ({
  state,
  reason,
  blockers,
});

export function assessPricingReadiness(input: ReadinessInput): PricingReadiness {
  const limitBlockers = input.limits
    .filter((l) => !l.configured && l.label !== "Maximum experiment traffic share")
    .map((l) => l.configPath);
  const trafficLimit = input.limits.find((l) => l.label === "Maximum experiment traffic share");

  const priceChangeBlockers = [
    ...input.costs.missingConfiguration,
    ...limitBlockers,
  ];

  return {
    PRICING_REVIEW: input.hasBehavioralEvidence
      ? entry(
          "AVAILABLE",
          "There is enough first-party evidence to ask a human to look at pricing. A review changes nothing by itself.",
        )
      : entry(
          "BLOCKED",
          "No pricing evidence has been recorded in this period, so there is nothing specific to review.",
          ["First-party pricing evidence (price views, price questions, or price objections) in the selected period"],
        ),

    SPECIFIC_PRICE_CHANGE: entry(
      "BLOCKED",
      priceChangeBlockers.length > 0
        ? "A specific price change cannot be shown to be safe: the manufacturing costs and price-movement limits it would be checked against are not configured. Any number proposed now would be a guess."
        : "Costs and limits are configured, but a specific price change still requires a deterministic price-floor check and explicit human approval — Session 12 proposes reviews only.",
      priceChangeBlockers,
    ),

    PRICE_EXPERIMENT: entry(
      "BLOCKED",
      input.priceExperimentSupported
        ? "The experiment engine could carry a price variant, but cost, margin and movement limits are still required before one may be designed."
        : "The experiment engine deliberately does not support real price variants: a price test changes cart totals, checkout, and what a returning customer sees, so it needs an authority-aware design that does not exist yet.",
      [
        ...(input.priceExperimentSupported ? [] : ["Experiment engine support for price variants (deliberately absent — docs/EXPERIMENTATION.md)"]),
        ...priceChangeBlockers,
        ...(trafficLimit && !trafficLimit.configured ? [trafficLimit.configPath] : []),
      ],
    ),

    AUTOMATED_PRICE_CHANGE: entry(
      "NOT_SUPPORTED",
      "Software never changes a price by itself. No price executor exists, the guarded-auto allow-list is empty, and every business agent is capped at RECOMMEND.",
      [],
    ),
  };
}
