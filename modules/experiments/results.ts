import { EXPERIMENTS } from "@/config/experiments";
import { twoProportionZTest, type TwoProportionResult } from "./statistics";
import {
  CONTROL_VARIANT_KEY,
  type ArmCounts,
  type ExperimentResultState,
  type ExperimentStatus,
} from "./types";

/**
 * Deterministic result determination (Session 11 spec §15, §17).
 *
 * The chain is: minimum sample → statistical preconditions → z-test →
 * state. Every gate is code; none of it is an LLM judgement, and no state
 * is reachable by prose. "Inconclusive" is a first-class outcome — an
 * experiment is never forced to produce a winner.
 *
 * STATE MEANINGS
 *  INVALID           the stored configuration no longer validates, or the
 *                    arms do not match it. Do not trust the numbers.
 *  RUNNING           still enrolling; the minimum sample per arm is not met.
 *  STOPPED           a human stopped it before the minimum sample was met.
 *  INSUFFICIENT_DATA the sample threshold is met but the test's
 *                    preconditions are not (too few events in a cell).
 *  CONTROL_WIN       |z| ≥ critical and control converts better.
 *  VARIANT_WIN       |z| ≥ critical and the variant converts better.
 *  NO_CLEAR_WINNER   thresholds met, difference not significant.
 */

export type ExperimentReadout = {
  state: ExperimentResultState;
  /** Copy the owner can read without a statistics background. */
  explanation: string;
  primaryMetric: string;
  minimumSamplePerVariant: number;
  minimumSampleMet: boolean;
  control: ArmCounts;
  variant: ArmCounts | null;
  statistics: TwoProportionResult | null;
  /** "control" | "<variantKey>" | null — set ONLY on a *_WIN state. */
  winner: string | null;
  /** Every caveat that applies, always rendered with the numbers. */
  caveats: string[];
};

export type ReadoutInput = {
  status: ExperimentStatus;
  primaryMetric: string;
  minimumSampleSize: number | null;
  arms: ArmCounts[];
  /** False when the target/variant/allocation no longer validates. */
  configurationValid: boolean;
  configurationIssues?: string[];
};

const pct = (n: number | null): string => (n === null ? "n/a" : `${(n * 100).toFixed(2)}%`);

export function computeReadout(input: ReadoutInput): ExperimentReadout {
  const minimumSamplePerVariant = effectiveMinimumSample(input.minimumSampleSize);
  const control = input.arms.find((a) => a.variant === CONTROL_VARIANT_KEY) ?? {
    variant: CONTROL_VARIANT_KEY,
    exposedSessions: 0,
    conversions: 0,
  };
  const variant = input.arms.find((a) => a.variant !== CONTROL_VARIANT_KEY) ?? null;
  const caveats: string[] = [];

  if (!input.configurationValid) {
    return {
      state: "INVALID",
      explanation:
        "This experiment's stored configuration no longer validates against the target registry, so its numbers cannot be interpreted.",
      primaryMetric: input.primaryMetric,
      minimumSamplePerVariant,
      minimumSampleMet: false,
      control,
      variant,
      statistics: null,
      winner: null,
      caveats: input.configurationIssues ?? ["Configuration failed validation."],
    };
  }

  if (!variant) {
    return {
      state: "INVALID",
      explanation: "No non-control arm was found for this experiment, so there is nothing to compare against control.",
      primaryMetric: input.primaryMetric,
      minimumSamplePerVariant,
      minimumSampleMet: false,
      control,
      variant: null,
      statistics: null,
      winner: null,
      caveats: ["Missing variant arm."],
    };
  }

  const minimumSampleMet =
    control.exposedSessions >= minimumSamplePerVariant && variant.exposedSessions >= minimumSamplePerVariant;

  if (!minimumSampleMet) {
    const shortfall =
      `Control has ${control.exposedSessions} and ${variant.variant} has ${variant.exposedSessions} exposed sessions; ` +
      `${minimumSamplePerVariant} per arm are required before any winner may be declared.`;
    if (input.status === "stopped" || input.status === "archived") {
      return {
        state: "STOPPED",
        explanation: `Stopped before reaching the minimum sample. ${shortfall}`,
        primaryMetric: input.primaryMetric,
        minimumSamplePerVariant,
        minimumSampleMet: false,
        control,
        variant,
        statistics: null,
        winner: null,
        caveats: [...caveats, "No winner may be inferred from an experiment stopped below its minimum sample."],
      };
    }
    return {
      state: "RUNNING",
      explanation: `Still collecting data. ${shortfall}`,
      primaryMetric: input.primaryMetric,
      minimumSamplePerVariant,
      minimumSampleMet: false,
      control,
      variant,
      statistics: null,
      winner: null,
      caveats: [
        ...caveats,
        "Interim conversion rates are shown for monitoring only — reading a winner out of them is exactly the error the sample threshold exists to prevent.",
      ],
    };
  }

  const statistics = twoProportionZTest(control, variant);
  caveats.push(...statistics.notes);

  if (!statistics.preconditionsMet || statistics.z === null) {
    return {
      state: "INSUFFICIENT_DATA",
      explanation:
        "The minimum sample was reached, but there are too few conversions (or non-conversions) in one arm for the statistical test to be valid.",
      primaryMetric: input.primaryMetric,
      minimumSamplePerVariant,
      minimumSampleMet: true,
      control,
      variant,
      statistics,
      winner: null,
      caveats,
    };
  }

  const rates = `control ${pct(statistics.controlRate)} vs ${variant.variant} ${pct(statistics.variantRate)}`;

  if (!statistics.significant) {
    return {
      state: "NO_CLEAR_WINNER",
      explanation:
        `No statistically significant difference on ${input.primaryMetric} (${rates}; p = ${statistics.pValue}). ` +
        "Inconclusive is a valid result — it does not mean the variant is worse.",
      primaryMetric: input.primaryMetric,
      minimumSamplePerVariant,
      minimumSampleMet: true,
      control,
      variant,
      statistics,
      winner: null,
      caveats,
    };
  }

  const variantWins = statistics.z > 0;
  return {
    state: variantWins ? "VARIANT_WIN" : "CONTROL_WIN",
    explanation:
      `${variantWins ? variant.variant : "Control"} had the higher observed ${input.primaryMetric} rate and met the ` +
      `configured statistical threshold (${rates}; p = ${statistics.pValue}).`,
    primaryMetric: input.primaryMetric,
    minimumSamplePerVariant,
    minimumSampleMet: true,
    control,
    variant,
    statistics,
    winner: variantWins ? variant.variant : CONTROL_VARIANT_KEY,
    caveats: [
      ...caveats,
      "This is an observed difference on one metric over one period on this site — not a general claim about what always increases sales.",
    ],
  };
}

/**
 * An experiment may RAISE its minimum sample but never lower the documented
 * development floor (config/experiments.ts).
 */
export function effectiveMinimumSample(configured: number | null | undefined): number {
  const floor = EXPERIMENTS.DEFAULT_MINIMUM_SAMPLE_PER_VARIANT;
  if (typeof configured !== "number" || !Number.isFinite(configured)) return floor;
  return Math.max(floor, Math.floor(configured));
}

/** Result states that permit a "promote the winner" recommendation. */
export function isDecisive(state: ExperimentResultState): boolean {
  return state === "CONTROL_WIN" || state === "VARIANT_WIN";
}
