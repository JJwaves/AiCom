/**
 * Experiment engine policy configuration (Session 11).
 *
 * Same doctrine as config/business-intelligence.ts and
 * config/customer-intelligence.ts: these are PROCESSING-POLICY defaults
 * documented in code, not invented business data. They decide when the
 * system is allowed to SPEAK about a result — never what the result is.
 * Deterministic measurement always runs regardless of these values.
 *
 * The hard business limit `maximumExperimentTrafficPct` deliberately does
 * NOT live here: it belongs to `config/guardrails.ts` (one home per limit)
 * and is still `[TO BE PROVIDED]`. See `resolveTrafficCap()` below for the
 * exact, non-silent way a missing limit is handled.
 */

import { GUARDRAIL_LIMITS } from "./guardrails";

export const EXPERIMENTS = {
  /**
   * Minimum EXPOSED SESSIONS PER ARM before any winner may be declared.
   *
   * This is a deliberately conservative DEVELOPMENT DEFAULT, not a power
   * calculation: a real minimum detectable effect needs a baseline
   * conversion rate and an effect size the owner has not provided
   * (BUSINESS_CONFIG_TODO.md → "Experimentation"). Every experiment may
   * carry its own `minimumSampleSize`, but never one BELOW this floor —
   * the floor can only ever be raised, never lowered, by an experiment.
   */
  DEFAULT_MINIMUM_SAMPLE_PER_VARIANT: 1_000,

  /** Two-sided significance level for the primary metric. */
  SIGNIFICANCE_ALPHA: 0.05,

  /** |z| threshold matching SIGNIFICANCE_ALPHA (two-sided normal). */
  Z_CRITICAL_TWO_SIDED: 1.959964,

  /**
   * Normal-approximation precondition: every cell (successes and failures
   * in each arm) must reach this count before a z-test is reported. Below
   * it the readout is INSUFFICIENT_DATA — never a p-value.
   */
  MIN_EXPECTED_COUNT_PER_CELL: 5,

  /**
   * MVP cap: control + ONE variant. The schema supports more arms, but a
   * multi-arm launch would need a multiple-comparison correction that
   * Session 11 deliberately does not implement.
   */
  MAX_VARIANTS_PER_EXPERIMENT: 2,

  /** Bounded admin loads (same posture as S08/S09/S10). */
  MAX_ROWS: 500,

  /**
   * DEVELOPMENT-ONLY ceiling on the share of eligible traffic an experiment
   * may take when `GUARDRAIL_LIMITS.maximumExperimentTrafficPct` is still
   * `[TO BE PROVIDED]`.
   *
   * ISOLATION RULE (spec §27): this value applies ONLY when
   * `NODE_ENV !== "production"`. In production a missing guardrail limit
   * BLOCKS the launch and says so — `null` is never read as "no limit" and
   * never as 100%.
   */
  DEV_ONLY_MAX_TRAFFIC_PCT: 50,

  /** Character budget for the CRO agent's structured context. */
  CRO_CONTEXT_MAX_CHARS: 16_000,

  /** Hard cap on proposals accepted from one CRO review. */
  MAX_PROPOSALS_PER_REVIEW: 6,
} as const;

/** Reporting periods offered by /admin/experiments (days). */
export const EXPERIMENT_PERIOD_DAYS = [7, 30, 90] as const;

export type TrafficCap =
  | { ok: true; capPct: number; source: "guardrail_limit" | "development_default"; note: string }
  | { ok: false; missingConfiguration: string[]; reason: string };

/**
 * The effective ceiling on an experiment's non-control traffic share.
 *
 * Resolution order, with no silent fallbacks:
 *  1. `GUARDRAIL_LIMITS.maximumExperimentTrafficPct` when the owner has set
 *     it — the single authoritative business limit, in every environment.
 *  2. Otherwise, in a NON-production environment only, the documented
 *     development ceiling above (so the engine is testable before the owner
 *     has made a business decision).
 *  3. Otherwise (production, limit unset) → BLOCKED, reporting the exact
 *     config path that must be filled.
 */
export function resolveTrafficCap(env: NodeJS.ProcessEnv = process.env): TrafficCap {
  const configured = GUARDRAIL_LIMITS.maximumExperimentTrafficPct;
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0 && configured <= 100) {
    return {
      ok: true,
      capPct: configured,
      source: "guardrail_limit",
      note: `Configured business limit: experiments may take at most ${configured}% of eligible traffic.`,
    };
  }
  if (env.NODE_ENV === "production") {
    return {
      ok: false,
      missingConfiguration: ["config/guardrails.ts → GUARDRAIL_LIMITS.maximumExperimentTrafficPct"],
      reason:
        "The maximum experiment traffic share is not configured. In production a missing limit blocks the launch — it is never interpreted as 100%.",
    };
  }
  return {
    ok: true,
    capPct: EXPERIMENTS.DEV_ONLY_MAX_TRAFFIC_PCT,
    source: "development_default",
    note:
      `No business limit is configured, so the DEVELOPMENT-ONLY ceiling of ${EXPERIMENTS.DEV_ONLY_MAX_TRAFFIC_PCT}% applies ` +
      "(non-production environments only). Set GUARDRAIL_LIMITS.maximumExperimentTrafficPct before running experiments in production.",
  };
}
