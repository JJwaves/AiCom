/**
 * Guardrail policy configuration (Session 10) — the ONE place hard limits,
 * autonomy ceilings and the guarded-auto allow-list live.
 *
 * Doctrine (docs/GUARDRAILS.md):
 *  - Business limits are [TO BE PROVIDED]. Every numeric limit below is
 *    `null` until the owner supplies a real figure. A `null` limit is NEVER
 *    "no limit": the evaluator reports it as MISSING CONFIGURATION, which
 *    blocks automated execution and says so honestly in the UI.
 *  - Margin floors are NOT duplicated here — `config/costs.ts`
 *    (`marginPolicy`) is already the authority the pricing engine uses, and
 *    the guardrail engine reads that same config. One number, one home.
 *  - Autonomy is capped by policy, not only by the database. Even a
 *    tampered/mistaken `agent_configs` row cannot raise an agent above its
 *    `maxAutonomyMode` here.
 *
 * Changing anything in this file MUST bump GUARDRAIL_POLICY_VERSION — every
 * stored evaluation records the version it was produced under so
 * "why was this allowed on that date?" stays answerable.
 */

/** Bump on every policy/limit/taxonomy change. Recorded on every evaluation. */
export const GUARDRAIL_POLICY_VERSION = "2026-08-12.s11.1";

/**
 * Hard business limits — all [TO BE PROVIDED] (BUSINESS_CONFIG_TODO.md →
 * "AI & guardrail configuration"). Units: integer cents, or percent as a
 * whole number (10 = 10%). NOTHING here may be filled with an estimate.
 */
export const GUARDRAIL_LIMITS = {
  /** Max discount an automated action may apply, percent of list price. */
  maximumDiscountPct: null as number | null,
  /** Max downward price movement per change, percent. */
  maximumPriceDecreasePct: null as number | null,
  /** Max upward price movement per change, percent. */
  maximumPriceIncreasePct: null as number | null,
  /** Max change to a campaign budget in one action, percent. */
  maximumCampaignBudgetChangePct: null as number | null,
  /** Ceiling on total daily advertising spend, cents. */
  maximumDailyAdSpendCents: null as number | null,
  /** Ceiling on a new campaign's test budget, cents. */
  maximumNewCampaignTestBudgetCents: null as number | null,
  /**
   * Max share of traffic an experiment may take, percent (Session 11).
   *
   * While this is null the experiment engine NEVER reads it as 100%:
   * `config/experiments.ts → resolveTrafficCap()` blocks a launch outright
   * in production, and applies a documented development-only ceiling
   * everywhere else. Automated/guarded launch stays blocked regardless —
   * CRO_EXPERIMENT_LAUNCH lists this key in `requiredLimits`.
   */
  maximumExperimentTrafficPct: null as number | null,
  /** Order value above which a human must review, cents. */
  highValueOrderThresholdCents: null as number | null,
  /** Refund value above which a human must approve, cents. */
  refundApprovalThresholdCents: null as number | null,
  /** Max MOQ reduction in one action, percent. */
  maximumMoqChangePct: null as number | null,
} as const;

export type GuardrailLimitKey = keyof typeof GUARDRAIL_LIMITS;

/**
 * Per-source autonomy policy. `defaultMode` applies when no `agent_configs`
 * row exists (an absent row already reads as OBSERVE at the data layer —
 * this raises named agents to their DESIGNED mode, and never higher).
 * `maxMode` is the ceiling the evaluator clamps to, whatever the DB says.
 *
 * Session 10 state: nothing above RECOMMEND anywhere. Promotion needs
 * operating history plus an explicit human decision (roadmap Stage J).
 */
export const AGENT_AUTONOMY_POLICY = {
  CEO_AGENT: { defaultMode: "RECOMMEND", maxMode: "RECOMMEND" },
  PRICING_AGENT: { defaultMode: "OBSERVE", maxMode: "RECOMMEND" },
  /**
   * Session 11: the CRO agent is implemented and DESIGNED to recommend, so
   * its default rises to RECOMMEND — the same treatment the CEO agent got
   * when it shipped. The ceiling is unchanged, the guarded-auto allow-list
   * is still empty, and the `AI_CRO_AGENT` flag still gates whether the
   * agent runs at all. It can propose; it can never launch or execute.
   */
  CRO_AGENT: { defaultMode: "RECOMMEND", maxMode: "RECOMMEND" },
  GOOGLE_ADS_AGENT: { defaultMode: "OBSERVE", maxMode: "RECOMMEND" },
  META_ADS_AGENT: { defaultMode: "OBSERVE", maxMode: "RECOMMEND" },
  /** A human proposing through the admin surface — still guardrail-checked. */
  HUMAN_ADMIN: { defaultMode: "RECOMMEND", maxMode: "RECOMMEND" },
} as const;

/**
 * Action types eligible for GUARDED_AUTO execution without human approval.
 * DELIBERATELY EMPTY: no executor exists, no agent is above RECOMMEND, and
 * no business limits are configured. Adding a type here is a business
 * decision, not a code cleanup.
 */
export const GUARDED_AUTO_ALLOWED_ACTION_TYPES: readonly string[] = [];

/**
 * Risk ceiling for anything that could ever run without human approval.
 * HIGH and CRITICAL actions always require a human — permanently.
 */
export const MAX_UNATTENDED_RISK_LEVEL = "MEDIUM" as const;

/** Bounded list loads for the Action Center (same posture as S08/S09). */
export const ACTION_CENTER_MAX_ROWS = 500;
