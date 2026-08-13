import { z } from "zod";
import type { ExecutionSupport, RiskLevel } from "./types";

/**
 * The CLOSED proposed-action model (Session 10 spec §3–§4).
 *
 * An action is never an arbitrary JSON blob. Every type has a runtime
 * schema, a policy-assigned base risk, and an explicit statement of whether
 * an executor could ever exist for it. Unknown types fail closed — the
 * evaluator refuses anything not in this table, so a model inventing
 * "TRANSFER_MONEY" produces a blocked record, not a capability.
 *
 * Two separate axes, deliberately (spec §3):
 *   ACTION TYPE       — what is being proposed (representable today).
 *   EXECUTION SUPPORT — whether software could carry it out (mostly not).
 */

/* ------------------------------------------------------------------ */
/* Payload schemas                                                     */
/* ------------------------------------------------------------------ */

/** Shared reference fields. Server-validated (spec §19) — never trusted as sent. */
const refs = {
  /** Deterministic metric keys copied from the evidence the agent was shown. */
  metricRefs: z.array(z.string().min(1).max(120)).max(16).default([]),
  /** Insight / opportunity / report ids the proposal rests on. */
  evidenceRefs: z.array(z.string().min(1).max(64)).max(16).default([]),
};

const money = z.number().int().min(0).max(1_000_000_000);
const currency = z.enum(["USD", "CAD"]);
const percent = z.number().min(0).max(100);

/**
 * Review-only actions (spec §21). Approving one means "yes, investigate
 * this" — no production system changes, ever. Shared shape by design: a
 * review is a question plus its evidence, whatever the domain.
 */
export const reviewActionPayloadSchema = z
  .object({
    title: z.string().min(1).max(200),
    /** What the data shows (copied from the agent's observation). */
    observation: z.string().min(1).max(2000),
    /** What should be looked into. Review language only — never an instruction. */
    question: z.string().min(1).max(2000),
    expectedImpact: z.string().max(600).nullable().default(null),
    limitations: z.array(z.string().min(1).max(300)).max(8).default([]),
    periodDays: z.number().int().min(1).max(365).nullable().default(null),
    ...refs,
  })
  .strict();

export type ReviewActionPayload = z.infer<typeof reviewActionPayloadSchema>;

export const priceChangePayloadSchema = z
  .object({
    productId: z.string().min(1).max(100),
    /** Quantity tier the price applies to; null = all tiers. */
    quantityTier: z.number().int().min(1).max(10_000_000).nullable().default(null),
    currentUnitPriceCents: money,
    proposedUnitPriceCents: money,
    currency,
    reason: z.string().min(1).max(2000),
    ...refs,
  })
  .strict();

export const priceExperimentPayloadSchema = z
  .object({
    productId: z.string().min(1).max(100),
    quantityTier: z.number().int().min(1).max(10_000_000).nullable().default(null),
    controlUnitPriceCents: money,
    variantUnitPriceCents: money,
    currency,
    trafficPct: percent,
    primaryMetric: z.string().min(1).max(120),
    hypothesis: z.string().min(1).max(2000),
    ...refs,
  })
  .strict();

export const moqChangePayloadSchema = z
  .object({
    productId: z.string().min(1).max(100),
    currentMoq: z.number().int().min(1).max(10_000_000),
    proposedMoq: z.number().int().min(1).max(10_000_000),
    reason: z.string().min(1).max(2000),
    ...refs,
  })
  .strict();

const adPlatform = z.enum(["google_ads", "meta_ads"]);

export const adBudgetChangePayloadSchema = z
  .object({
    platform: adPlatform,
    campaignId: z.string().min(1).max(120),
    campaignName: z.string().max(200).nullable().default(null),
    currentDailyBudgetCents: money,
    proposedDailyBudgetCents: money,
    currency,
    reason: z.string().min(1).max(2000),
    ...refs,
  })
  .strict();

export const adStatusChangePayloadSchema = z
  .object({
    platform: adPlatform,
    campaignId: z.string().min(1).max(120),
    campaignName: z.string().max(200).nullable().default(null),
    reason: z.string().min(1).max(2000),
    ...refs,
  })
  .strict();

export const adCreativeTestPayloadSchema = z
  .object({
    platform: adPlatform,
    campaignId: z.string().min(1).max(120),
    hypothesis: z.string().min(1).max(2000),
    controlSummary: z.string().min(1).max(1000),
    variantSummary: z.string().min(1).max(1000),
    testBudgetCents: money.nullable().default(null),
    currency: currency.nullable().default(null),
    ...refs,
  })
  .strict();

export const croExperimentProposalPayloadSchema = z
  .object({
    page: z.string().min(1).max(200),
    hypothesis: z.string().min(1).max(2000),
    control: z.string().min(1).max(1000),
    variant: z.string().min(1).max(1000),
    primaryMetric: z.string().min(1).max(120),
    /** Design intent only — a proposal launches nothing. */
    proposedTrafficPct: percent.nullable().default(null),
    ...refs,
  })
  .strict();

export const croExperimentLaunchPayloadSchema = z
  .object({
    experimentName: z.string().min(1).max(200),
    page: z.string().min(1).max(200),
    trafficPct: percent,
    primaryMetric: z.string().min(1).max(120),
    ...refs,
  })
  .strict();

export const aiCostChangePayloadSchema = z
  .object({
    setting: z.enum(["model_routing", "daily_budget", "monthly_budget", "batch_size"]),
    currentValue: z.string().max(200).nullable().default(null),
    proposedValue: z.string().min(1).max(200),
    reason: z.string().min(1).max(2000),
    ...refs,
  })
  .strict();

export const refundPayloadSchema = z
  .object({
    orderId: z.string().min(1).max(100),
    amountCents: money,
    currency,
    reason: z.string().min(1).max(2000),
    ...refs,
  })
  .strict();

export const manufacturingChangePayloadSchema = z
  .object({
    changeKind: z.enum([
      "new_material",
      "new_product",
      "unsupported_size",
      "delivery_promise",
      "capability_claim",
    ]),
    description: z.string().min(1).max(2000),
    reason: z.string().min(1).max(2000),
    ...refs,
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export type ActionTypeSpec = {
  /** Runtime schema for this type's payload. Strict: unknown keys are errors. */
  schema: z.ZodType<Record<string, unknown>>;
  /** Deterministic base risk (spec §8). Escalation may raise it, never lower it. */
  baseRisk: RiskLevel;
  /** Whether an executor could exist. REVIEW_ONLY means it never will. */
  executionSupport: Exclude<ExecutionSupport, "AVAILABLE">;
  /**
   * Permanently human-only regardless of autonomy mode or configuration
   * (spec §36–§37 + docs/GUARDRAILS.md "never automated").
   */
  neverAutomated: boolean;
  /** Limit keys that must be configured before automated execution is conceivable. */
  requiredLimits: readonly string[];
  /** Touches the price/margin surface — the cost-model floor applies. */
  priceAffecting: boolean;
  /** One-line owner-facing description shown in the Action Center. */
  label: string;
};

const REVIEW_TYPES = [
  ["PRICING_REVIEW", "Investigate pricing"],
  ["PRODUCT_REVIEW", "Investigate the product offering"],
  ["MOQ_REVIEW", "Investigate minimum order quantity"],
  ["CRO_REVIEW", "Investigate conversion / site experience"],
  ["MARKETING_REVIEW", "Investigate marketing"],
  ["CUSTOMER_EXPERIENCE_REVIEW", "Investigate customer experience"],
  ["OPERATIONS_REVIEW", "Investigate operations"],
  ["AI_COST_REVIEW", "Investigate AI cost"],
  ["DATA_QUALITY_REVIEW", "Investigate data quality"],
  ["SALES_REVIEW", "Investigate sales process"],
] as const;

const reviewSpec = (label: string): ActionTypeSpec => ({
  schema: reviewActionPayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
  baseRisk: "LOW",
  executionSupport: "REVIEW_ONLY",
  neverAutomated: false,
  requiredLimits: [],
  priceAffecting: false,
  label,
});

export const ACTION_TYPE_REGISTRY: Record<string, ActionTypeSpec> = {
  ...Object.fromEntries(REVIEW_TYPES.map(([type, label]) => [type, reviewSpec(label)])),

  PRICE_CHANGE: {
    schema: priceChangePayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
    baseRisk: "HIGH",
    executionSupport: "NOT_IMPLEMENTED",
    neverAutomated: false,
    requiredLimits: ["maximumPriceDecreasePct", "maximumPriceIncreasePct"],
    priceAffecting: true,
    label: "Change a published price",
  },
  PRICE_EXPERIMENT: {
    schema: priceExperimentPayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
    baseRisk: "HIGH",
    executionSupport: "NOT_IMPLEMENTED",
    neverAutomated: false,
    requiredLimits: ["maximumPriceDecreasePct", "maximumPriceIncreasePct", "maximumExperimentTrafficPct"],
    priceAffecting: true,
    label: "Run a bounded price test",
  },
  MOQ_CHANGE: {
    schema: moqChangePayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
    baseRisk: "HIGH",
    executionSupport: "NOT_IMPLEMENTED",
    neverAutomated: false,
    requiredLimits: ["maximumMoqChangePct"],
    priceAffecting: true,
    label: "Change a minimum order quantity",
  },
  AD_BUDGET_CHANGE: {
    schema: adBudgetChangePayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
    baseRisk: "HIGH",
    executionSupport: "NOT_IMPLEMENTED",
    neverAutomated: false,
    requiredLimits: ["maximumCampaignBudgetChangePct", "maximumDailyAdSpendCents"],
    priceAffecting: false,
    label: "Change an advertising budget",
  },
  AD_PAUSE: {
    schema: adStatusChangePayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
    baseRisk: "MEDIUM",
    executionSupport: "NOT_IMPLEMENTED",
    neverAutomated: false,
    requiredLimits: [],
    priceAffecting: false,
    label: "Pause an advertising campaign",
  },
  AD_RESUME: {
    schema: adStatusChangePayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
    baseRisk: "MEDIUM",
    executionSupport: "NOT_IMPLEMENTED",
    neverAutomated: false,
    requiredLimits: ["maximumDailyAdSpendCents"],
    priceAffecting: false,
    label: "Resume an advertising campaign",
  },
  AD_CREATIVE_TEST: {
    schema: adCreativeTestPayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
    baseRisk: "MEDIUM",
    executionSupport: "NOT_IMPLEMENTED",
    neverAutomated: false,
    requiredLimits: ["maximumNewCampaignTestBudgetCents"],
    priceAffecting: false,
    label: "Test an advertising creative",
  },
  CRO_EXPERIMENT_PROPOSAL: {
    schema: croExperimentProposalPayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
    baseRisk: "LOW",
    executionSupport: "REVIEW_ONLY",
    neverAutomated: false,
    requiredLimits: [],
    priceAffecting: false,
    label: "Propose a CRO experiment (design only)",
  },
  CRO_EXPERIMENT_LAUNCH: {
    schema: croExperimentLaunchPayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
    baseRisk: "MEDIUM",
    executionSupport: "NOT_IMPLEMENTED",
    neverAutomated: false,
    requiredLimits: ["maximumExperimentTrafficPct"],
    priceAffecting: false,
    label: "Launch a CRO experiment on live traffic",
  },
  AI_COST_CHANGE: {
    schema: aiCostChangePayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
    baseRisk: "MEDIUM",
    executionSupport: "NOT_IMPLEMENTED",
    neverAutomated: false,
    requiredLimits: [],
    priceAffecting: false,
    label: "Change AI cost / routing settings",
  },
  REFUND: {
    schema: refundPayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
    baseRisk: "CRITICAL",
    executionSupport: "NOT_IMPLEMENTED",
    // Payment mutation is outside the AI boundary, permanently (spec §36).
    neverAutomated: true,
    requiredLimits: ["refundApprovalThresholdCents"],
    priceAffecting: false,
    label: "Refund an order",
  },
  MANUFACTURING_CHANGE: {
    schema: manufacturingChangePayloadSchema as unknown as z.ZodType<Record<string, unknown>>,
    baseRisk: "CRITICAL",
    // Factory feasibility is human knowledge, not model output (spec §37).
    neverAutomated: true,
    executionSupport: "NOT_IMPLEMENTED",
    requiredLimits: [],
    priceAffecting: false,
    label: "Commit to a manufacturing capability",
  },
};

export const ACTION_TYPES = Object.keys(ACTION_TYPE_REGISTRY) as readonly string[];

export function isKnownActionType(value: unknown): value is string {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ACTION_TYPE_REGISTRY, value);
}

export function getActionTypeSpec(actionType: string): ActionTypeSpec | null {
  return isKnownActionType(actionType) ? ACTION_TYPE_REGISTRY[actionType] : null;
}

export function isReviewOnlyActionType(actionType: string): boolean {
  return getActionTypeSpec(actionType)?.executionSupport === "REVIEW_ONLY";
}

/**
 * Which sources may propose which action types (spec §5, §43). A CEO
 * recommendation does NOT become more authorized because a high-level agent
 * produced it: the CEO agent may only ever raise review-shaped proposals.
 *
 * The Sales agent is absent on purpose — customer transaction tools are a
 * separate, already-bounded system (spec §32).
 */
export const SOURCE_PERMITTED_ACTION_TYPES: Record<string, readonly string[]> = {
  CEO_AGENT: [...REVIEW_TYPES.map(([t]) => t), "CRO_EXPERIMENT_PROPOSAL"],
  PRICING_AGENT: ["PRICING_REVIEW", "PRICE_CHANGE", "PRICE_EXPERIMENT", "MOQ_REVIEW"],
  CRO_AGENT: ["CRO_REVIEW", "CRO_EXPERIMENT_PROPOSAL", "CRO_EXPERIMENT_LAUNCH"],
  GOOGLE_ADS_AGENT: ["MARKETING_REVIEW", "AD_BUDGET_CHANGE", "AD_PAUSE", "AD_RESUME", "AD_CREATIVE_TEST"],
  META_ADS_AGENT: ["MARKETING_REVIEW", "AD_BUDGET_CHANGE", "AD_PAUSE", "AD_RESUME", "AD_CREATIVE_TEST"],
  /** A human may raise anything the model may not — still fully guardrailed. */
  HUMAN_ADMIN: ACTION_TYPES,
};
