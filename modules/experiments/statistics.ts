import { EXPERIMENTS } from "@/config/experiments";
import type { ArmCounts } from "./types";

/**
 * Statistical engine (Session 11 spec §16) — ONE method, deterministic,
 * documented, and small on purpose. This is not a data-science platform.
 *
 * METHOD: two-proportion z-test, two-sided, with a POOLED standard error.
 *
 *     p̂1 = c1/n1,  p̂2 = c2/n2,  p̄ = (c1+c2)/(n1+n2)
 *     SE  = sqrt( p̄(1−p̄) (1/n1 + 1/n2) )
 *     z   = (p̂2 − p̂1) / SE
 *     two-sided p = 2(1 − Φ(|z|))
 *
 * ASSUMPTIONS (all of which the engine states rather than hides):
 *  - The unit is an EXPOSED SESSION, and sessions are treated as
 *    independent. A person using two browsers counts twice; a person
 *    clearing cookies counts twice. We do not model that.
 *  - The metric is BINARY per exposed session ("did this session convert at
 *    least once after being exposed?"). Repeat conversions do not count
 *    twice, and revenue is not modelled at all.
 *  - Assignment is deterministic-by-hash, which is the closest practical
 *    substitute for randomisation. It is unbiased with respect to the
 *    metric, but it is not a random draw per request.
 *  - The normal approximation needs enough events. Every cell (conversions
 *    and non-conversions in each arm) must reach
 *    MIN_EXPECTED_COUNT_PER_CELL; below that the readout is
 *    INSUFFICIENT_DATA and NO p-value is produced.
 *
 * LIMITATIONS (deliberate, documented, not worked around):
 *  - NO sequential-testing / always-valid correction. Repeatedly peeking at
 *    a running experiment inflates false positives, which is exactly why a
 *    winner may not be declared before the configured minimum sample per
 *    arm (enforced in results.ts, not in the prompt).
 *  - NO multiple-comparison correction — Session 11 supports control + one
 *    variant and ONE primary metric. Secondary and guardrail metrics are
 *    reported for context and never declare a winner.
 *  - NO Bayesian posterior, NO confidence intervals on lift, NO power
 *    analysis. Adding them is a later decision, not an accident.
 *  - The LLM never computes, adjusts, or overrides anything in this file.
 */

export type TwoProportionResult = {
  method: "two_proportion_z_test";
  alpha: number;
  zCritical: number;
  /** Control conversion rate as a fraction, or null when the arm is empty. */
  controlRate: number | null;
  variantRate: number | null;
  /** variantRate − controlRate (percentage POINTS), null when undefined. */
  absoluteDiffPct: number | null;
  /** Relative lift in percent, null when the control rate is 0 or unknown. */
  relativeLiftPct: number | null;
  /** Null whenever preconditions are unmet — never a number we cannot defend. */
  z: number | null;
  pValue: number | null;
  significant: boolean;
  preconditionsMet: boolean;
  notes: string[];
};

/** Round to a fixed number of decimals so stored results are byte-stable. */
const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation
 * (|error| < 1.5e-7). Pure arithmetic — identical on every runtime.
 */
export function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

export function twoProportionZTest(control: ArmCounts, variant: ArmCounts): TwoProportionResult {
  const alpha = EXPERIMENTS.SIGNIFICANCE_ALPHA;
  const zCritical = EXPERIMENTS.Z_CRITICAL_TWO_SIDED;
  const notes: string[] = [];

  const n1 = control.exposedSessions;
  const n2 = variant.exposedSessions;
  const c1 = Math.min(control.conversions, n1);
  const c2 = Math.min(variant.conversions, n2);
  if (control.conversions > n1 || variant.conversions > n2) {
    notes.push("Conversions exceeded exposed sessions and were clamped — investigate the measurement query.");
  }

  const controlRate = n1 > 0 ? c1 / n1 : null;
  const variantRate = n2 > 0 ? c2 / n2 : null;
  const absoluteDiffPct =
    controlRate !== null && variantRate !== null ? round((variantRate - controlRate) * 100, 4) : null;
  const relativeLiftPct =
    controlRate !== null && variantRate !== null && controlRate > 0
      ? round(((variantRate - controlRate) / controlRate) * 100, 2)
      : null;

  const minCell = EXPERIMENTS.MIN_EXPECTED_COUNT_PER_CELL;
  const cells = [c1, n1 - c1, c2, n2 - c2];
  const preconditionsMet = n1 > 0 && n2 > 0 && cells.every((cell) => cell >= minCell);

  if (!preconditionsMet) {
    notes.push(
      `Normal approximation not applicable: every cell (conversions and non-conversions in each arm) needs at least ${minCell} sessions.`,
    );
    return {
      method: "two_proportion_z_test",
      alpha,
      zCritical,
      controlRate: controlRate === null ? null : round(controlRate, 6),
      variantRate: variantRate === null ? null : round(variantRate, 6),
      absoluteDiffPct,
      relativeLiftPct,
      z: null,
      pValue: null,
      significant: false,
      preconditionsMet: false,
      notes,
    };
  }

  const pooled = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (!(se > 0)) {
    notes.push("Standard error is zero (both arms converted identically at 0% or 100%) — no test is possible.");
    return {
      method: "two_proportion_z_test",
      alpha,
      zCritical,
      controlRate: round(controlRate!, 6),
      variantRate: round(variantRate!, 6),
      absoluteDiffPct,
      relativeLiftPct,
      z: null,
      pValue: null,
      significant: false,
      preconditionsMet: false,
      notes,
    };
  }

  const z = round((variantRate! - controlRate!) / se, 6);
  const pValue = round(2 * (1 - normalCdf(Math.abs(z))), 6);
  const significant = Math.abs(z) >= zCritical;
  notes.push(
    `Two-sided two-proportion z-test at α=${alpha} (|z| ≥ ${zCritical}); pooled standard error; no sequential-testing or multiple-comparison correction.`,
  );

  return {
    method: "two_proportion_z_test",
    alpha,
    zCritical,
    controlRate: round(controlRate!, 6),
    variantRate: round(variantRate!, 6),
    absoluteDiffPct,
    relativeLiftPct,
    z,
    pValue,
    significant,
    preconditionsMet: true,
    notes,
  };
}
