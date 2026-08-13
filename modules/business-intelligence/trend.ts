import { BUSINESS_INTELLIGENCE } from "@/config/business-intelligence";

/**
 * Trend semantics (Session 09 spec §16): period-over-period comparisons
 * with EXPLICIT states instead of absurd percentages. A previous-period
 * zero never becomes "+∞%"; a tiny base never becomes "+200%".
 */

export type TrendState =
  /** Meaningful base in the previous period — changePct is real. */
  | "TREND"
  /** Nothing in the previous period, activity now. */
  | "NEW_ACTIVITY"
  /** Nothing in either period. */
  | "NO_ACTIVITY"
  /** Previous period below MIN_TREND_BASE — a % would be noise. */
  | "LOW_BASELINE";

export type Trend = {
  state: TrendState;
  current: number;
  previous: number;
  /** Whole-number percent change; only set when state === "TREND". */
  changePct: number | null;
};

export function compareTrend(current: number, previous: number): Trend {
  if (previous === 0 && current === 0) return { state: "NO_ACTIVITY", current, previous, changePct: null };
  if (previous === 0) return { state: "NEW_ACTIVITY", current, previous, changePct: null };
  if (previous < BUSINESS_INTELLIGENCE.MIN_TREND_BASE) {
    return { state: "LOW_BASELINE", current, previous, changePct: null };
  }
  return {
    state: "TREND",
    current,
    previous,
    changePct: Math.round(((current - previous) / previous) * 100),
  };
}
