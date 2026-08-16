import type { Product, ProductConfiguration } from "@/types/commerce";
import {
  computeLineCosts,
  computeShippingEconomics,
  evaluateMarginAgainstPolicy,
  paymentFeeCents,
  type CostModelConfig,
  type MarginVerdict,
} from "./cost-model";

/**
 * ORDER-LEVEL UNIT ECONOMICS (Session 13.5).
 *
 * The one place the profitability ladder is defined:
 *
 *   SELL PRICE
 *     ↓  product COGS (manufacturing + printing + setup + packaging)
 *   GROSS PROFIT
 *     ↓  variable selling / fulfilment costs
 *        (payment processing + shipping subsidy + handling + other variable)
 *   CONTRIBUTION PROFIT BEFORE PAID MEDIA
 *     ↓  attributed ad spend (period/campaign level — NOT order level)
 *   CONTRIBUTION PROFIT AFTER PAID MEDIA
 *
 * The names are load-bearing. `Contribution Profit Before Paid Media` is
 * never shortened to "profit" and never to "net profit": advertising is a
 * real cost that is simply not attributable at order level here (§18, §31).
 *
 * NO AI. NO database. NO clock beyond an injected `capturedAt`. Pure
 * arithmetic over configuration and order rows.
 *
 * ORDER-LEVEL COSTS ARE APPLIED ONCE. The payment processor's fixed fee,
 * order packaging, handling and the shipping subsidy are per-ORDER facts;
 * a multi-line order pays each exactly once. That is the invariant this
 * file exists to protect.
 *
 * AVAILABILITY IS PER LEVEL (§22). Gross profit can be AVAILABLE while
 * contribution profit is UNAVAILABLE — knowing what a bag costs to make
 * does not tell you what the processor charged. Each level carries its own
 * status and its own missing inputs; nothing is silently partial.
 */

export type EconomicsStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";

/** Product COGS for a whole order, integer cents. */
export type OrderCogs = {
  manufacturingCents: number;
  printingCents: number;
  /** Printing setup, summed across lines — one setup per printed line. */
  setupCents: number;
  /** Per-unit packaging across all lines. */
  packagingCents: number;
  /** Order-scope packaging (master carton/pallet), applied ONCE. */
  orderPackagingCents: number;
  totalCents: number;
};

/** Variable selling / fulfilment costs for a whole order, integer cents. */
export type OrderVariableCosts = {
  /** round(revenue × bps / 10_000) + fixed, computed ONCE per order. */
  paymentProcessingCents: number;
  /** max(actual freight − customer shipping charge, 0). */
  shippingSubsidyCents: number;
  /** Fulfilment handling, applied ONCE. */
  handlingCents: number;
  /** Per-unit other variable cost across all lines. */
  otherVariableCents: number;
  totalCents: number;
};

/** Shipping facts kept separate from the subsidy so neither hides the other. */
export type OrderShipping = {
  actualShippingCents: number;
  customerShippingChargeCents: number;
  subsidyCents: number;
  /**
   * max(customer charge − actual cost, 0). Reported, never folded into
   * contribution: the charge is not part of recorded order revenue.
   */
  shippingMarginCents: number;
};

/** Per-line gross economics. Order-level costs are deliberately NOT allocated (§31). */
export type LineEconomics = {
  productId: string;
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
};

export type UnitEconomics = {
  /** Which cost configuration produced these numbers (§29). */
  costModelVersion: string;
  revenueCents: number;
  currency: string;

  /* ---- Level 1: gross ---- */
  grossStatus: EconomicsStatus;
  cogs: OrderCogs | null;
  grossProfitCents: number | null;
  /** Basis points of revenue. null = unavailable — NEVER 0, NEVER NaN. */
  grossMarginBps: number | null;

  /* ---- Level 2: contribution before paid media ---- */
  contributionStatus: EconomicsStatus;
  variableCosts: OrderVariableCosts | null;
  shipping: OrderShipping | null;
  contributionBeforePaidMediaCents: number | null;
  contributionMarginBeforePaidMediaBps: number | null;

  /**
   * Per-line GROSS economics. There is no per-line contribution field
   * because no deterministic allocation rule for order-level costs exists.
   */
  lines: LineEconomics[];
  /** Weaker of the two levels — the headline availability. */
  status: EconomicsStatus;
  missingInputs: string[];
  /** Availability caveats, e.g. a configured-constant shipping charge. */
  reasons: string[];
};

export type OrderEconomicsLineInput = {
  productId: string;
  product: Product | null;
  config: Pick<ProductConfiguration, "sizeId" | "materialId" | "printOptionId" | "quantity">;
  /** Sell revenue recorded for this line. */
  revenueCents: number;
};

export type OrderEconomicsInput = {
  /** Recorded order revenue. The payment percentage applies to THIS figure. */
  revenueCents: number;
  currency: string;
  lines: OrderEconomicsLineInput[];
  model: CostModelConfig;
};

/** Safe margin: integer bps, or null when revenue is zero/negative. */
export function marginBps(profitCents: number, revenueCents: number): number | null {
  if (!Number.isFinite(profitCents) || !Number.isFinite(revenueCents) || revenueCents <= 0) return null;
  return Math.round((profitCents * 10_000) / revenueCents);
}

const dedupe = (values: string[]): string[] => [...new Set(values)];

function unavailableEconomics(
  input: OrderEconomicsInput,
  missingInputs: string[],
  reasons: string[],
): UnitEconomics {
  return {
    costModelVersion: input.model.version,
    revenueCents: input.revenueCents,
    currency: input.currency,
    grossStatus: "UNAVAILABLE",
    cogs: null,
    grossProfitCents: null,
    grossMarginBps: null,
    contributionStatus: "UNAVAILABLE",
    variableCosts: null,
    shipping: null,
    contributionBeforePaidMediaCents: null,
    contributionMarginBeforePaidMediaBps: null,
    lines: [],
    status: "UNAVAILABLE",
    missingInputs: dedupe(missingInputs),
    reasons,
  };
}

/**
 * Compute deterministic unit economics for ONE order.
 *
 * Gross profit is computed whenever every line's COGS and the order-scope
 * packaging are configured — the payment fee being unknown does not make
 * the factory cost unknown. Contribution additionally needs the payment
 * fee, handling and a knowable shipping subsidy; when any of those is
 * missing, contribution is UNAVAILABLE while gross stays AVAILABLE (§22).
 */
export function computeOrderUnitEconomics(input: OrderEconomicsInput): UnitEconomics {
  const { model } = input;

  if (input.lines.length === 0) {
    return unavailableEconomics(input, ["order has no lines"], [
      "The order has no line rows, so there is nothing to cost.",
    ]);
  }

  /* ---- Level 1: product COGS, per line ---- */
  const cogsMissing: string[] = [];
  const cogs: OrderCogs = {
    manufacturingCents: 0,
    printingCents: 0,
    setupCents: 0,
    packagingCents: 0,
    orderPackagingCents: 0,
    totalCents: 0,
  };
  let actualShippingCents = 0;
  let otherVariableCents = 0;
  /**
   * `per_order` freight is quoted ONCE per product per order, so it is
   * collected here and added once — summing it per line would charge a
   * two-line order twice for one shipment. `per_unit` and `per_carton`
   * scale with the line and accumulate normally (carton rounding stays
   * per line: separate lines are separate artwork and are packed apart).
   */
  const perOrderShippingByProduct = new Map<string, number>();
  const lines: LineEconomics[] = [];

  for (const line of input.lines) {
    if (!line.product) {
      cogsMissing.push(`catalog product "${line.productId}" (order line no longer in catalog)`);
      continue;
    }
    const computed = computeLineCosts(line.product, line.config, model);
    if (computed.status === "unconfigured") {
      cogsMissing.push(...computed.missingInputs);
      continue;
    }
    cogs.manufacturingCents += computed.cogs.manufacturingCents;
    cogs.printingCents += computed.cogs.printingCents;
    cogs.setupCents += computed.cogs.setupCents;
    cogs.packagingCents += computed.cogs.packagingCents;
    if (computed.variable.shippingScope === "per_order") {
      perOrderShippingByProduct.set(line.productId, computed.variable.actualShippingCents);
    } else {
      actualShippingCents += computed.variable.actualShippingCents;
    }
    otherVariableCents += computed.variable.otherVariableCents;
    lines.push({
      productId: line.productId,
      revenueCents: line.revenueCents,
      cogsCents: computed.cogs.totalCents,
      grossProfitCents: line.revenueCents - computed.cogs.totalCents,
    });
  }

  if (model.orderCosts.packagingCentsPerOrder === null) cogsMissing.push("orderCosts.packagingCentsPerOrder");
  else cogs.orderPackagingCents = model.orderCosts.packagingCentsPerOrder;

  if (cogsMissing.length > 0) {
    return unavailableEconomics(input, cogsMissing, [
      "Gross profit is unavailable because part of the product cost model is not provided. Missing inputs are named; none is assumed to be zero.",
    ]);
  }

  for (const cents of perOrderShippingByProduct.values()) actualShippingCents += cents;

  cogs.totalCents =
    cogs.manufacturingCents + cogs.printingCents + cogs.setupCents + cogs.packagingCents + cogs.orderPackagingCents;
  const grossProfitCents = input.revenueCents - cogs.totalCents;

  /* ---- Level 2: variable selling / fulfilment costs, per ORDER ---- */
  const contributionMissing: string[] = [];
  const reasons: string[] = [];

  const fee = paymentFeeCents(input.revenueCents, model.paymentFee);
  if (fee === null) {
    if (model.paymentFee.percentBps === null) contributionMissing.push("paymentFee.percentBps");
    if (model.paymentFee.fixedCents === null) contributionMissing.push("paymentFee.fixedCents");
  }
  const handling = model.orderCosts.handlingCentsPerOrder;
  if (handling === null) contributionMissing.push("orderCosts.handlingCentsPerOrder");

  const shippingEconomics = computeShippingEconomics(actualShippingCents, model.shippingPolicy);
  if (shippingEconomics.status === "unavailable") {
    contributionMissing.push(...shippingEconomics.missingInputs);
    reasons.push(shippingEconomics.reason);
  } else if (shippingEconomics.status === "partial" && shippingEconomics.reason) {
    reasons.push(shippingEconomics.reason);
  }

  const grossBlock = {
    costModelVersion: model.version,
    revenueCents: input.revenueCents,
    currency: input.currency,
    grossStatus: "AVAILABLE" as EconomicsStatus,
    cogs,
    grossProfitCents,
    grossMarginBps: marginBps(grossProfitCents, input.revenueCents),
    lines,
  };

  if (contributionMissing.length > 0 || shippingEconomics.status === "unavailable") {
    return {
      ...grossBlock,
      contributionStatus: "UNAVAILABLE",
      variableCosts: null,
      shipping: null,
      contributionBeforePaidMediaCents: null,
      contributionMarginBeforePaidMediaBps: null,
      status: "PARTIAL",
      missingInputs: dedupe(contributionMissing),
      reasons: [
        ...reasons,
        "Gross profit is available, but contribution profit before paid media is not: the variable selling costs it subtracts are not fully configured. The two levels are reported separately rather than pretending they share one availability.",
      ],
    };
  }

  const shipping: OrderShipping = {
    actualShippingCents: shippingEconomics.actualShippingCents,
    customerShippingChargeCents: shippingEconomics.customerShippingChargeCents,
    subsidyCents: shippingEconomics.subsidyCents,
    shippingMarginCents: shippingEconomics.shippingMarginCents,
  };
  const variableCosts: OrderVariableCosts = {
    paymentProcessingCents: fee as number,
    shippingSubsidyCents: shipping.subsidyCents,
    handlingCents: handling as number,
    otherVariableCents,
    totalCents: (fee as number) + shipping.subsidyCents + (handling as number) + otherVariableCents,
  };
  const contributionBeforePaidMediaCents = grossProfitCents - variableCosts.totalCents;
  const contributionStatus: EconomicsStatus = shippingEconomics.status === "partial" ? "PARTIAL" : "AVAILABLE";

  return {
    ...grossBlock,
    contributionStatus,
    variableCosts,
    shipping,
    contributionBeforePaidMediaCents,
    contributionMarginBeforePaidMediaBps: marginBps(contributionBeforePaidMediaCents, input.revenueCents),
    status: contributionStatus,
    missingInputs: [],
    reasons,
  };
}

/**
 * Margin-policy verdicts for a computed order (§23, §24). Minimum breaches
 * and target shortfalls are DIFFERENT states and never collapse into one.
 */
export function evaluateOrderMarginPolicy(
  economics: UnitEconomics,
  model: CostModelConfig,
): { gross: MarginVerdict; contribution: MarginVerdict } {
  return {
    gross: evaluateMarginAgainstPolicy(economics.grossMarginBps, "gross", model.marginPolicy),
    contribution: evaluateMarginAgainstPolicy(
      economics.contributionMarginBeforePaidMediaBps,
      "contribution",
      model.marginPolicy,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Paid media (§18–§20)                                                */
/* ------------------------------------------------------------------ */

/**
 * ROAS and POAS are DIFFERENT MEASUREMENTS and never merge (§20):
 *
 *   ROAS = Revenue / Ad Spend
 *   POAS = Contribution Profit Before Paid Media / Ad Spend
 *
 * A campaign can post a strong ROAS and a POAS below 1 — that is the whole
 * point of computing both. `postAdContributionCents` is the same comparison
 * in currency rather than as a ratio:
 *
 *   Post-Ad Contribution = Contribution Profit Before Paid Media − Ad Spend
 *
 * which is exactly "Contribution Profit After Paid Media" for the period.
 */
export type PaidMediaEconomics =
  | {
      status: "AVAILABLE" | "PARTIAL";
      contributionBeforePaidMediaCents: number;
      adSpendCents: number;
      /** Contribution profit AFTER paid media, cents. May be negative. */
      postAdContributionCents: number;
      /** Contribution profit before paid media ÷ ad spend. null when spend is 0. */
      poas: number | null;
      reason?: string;
    }
  | { status: "UNAVAILABLE"; reason: string; missingInputs: string[] };

export function computePaidMediaEconomics(args: {
  contributionBeforePaidMediaCents: number | null;
  adSpendCents: number;
  /** Set when contribution or attribution coverage is only partial. */
  partialReason?: string;
  missingInputs?: string[];
}): PaidMediaEconomics {
  if (args.contributionBeforePaidMediaCents === null) {
    return {
      status: "UNAVAILABLE",
      reason:
        "Profit on ad spend cannot be computed because contribution profit before paid media is unavailable. Revenue is never substituted for profit.",
      missingInputs: args.missingInputs ?? [],
    };
  }
  const contribution = args.contributionBeforePaidMediaCents;
  const postAdContributionCents = contribution - args.adSpendCents;
  const poas = args.adSpendCents > 0 ? Math.round((contribution / args.adSpendCents) * 100) / 100 : null;
  return args.partialReason
    ? {
        status: "PARTIAL",
        contributionBeforePaidMediaCents: contribution,
        adSpendCents: args.adSpendCents,
        postAdContributionCents,
        poas,
        reason: args.partialReason,
      }
    : {
        status: "AVAILABLE",
        contributionBeforePaidMediaCents: contribution,
        adSpendCents: args.adSpendCents,
        postAdContributionCents,
        poas,
      };
}
