import { BUSINESS_INTELLIGENCE } from "@/config/business-intelligence";

/**
 * Metric availability model (Session 09 spec §3).
 *
 * Every business metric is a typed result that distinguishes AVAILABLE /
 * PARTIAL / UNAVAILABLE. The hard rule: a missing input NEVER becomes
 * zero — an unavailable metric carries its reason (and the missing
 * config inputs) instead of a number, and every consumer (admin UI, CEO
 * agent context) renders that state honestly.
 */

export type MetricStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";

export type Metric<T = number> =
  | { status: "AVAILABLE"; value: T }
  | { status: "PARTIAL"; value: T; reason: string; missingInputs?: string[] }
  | { status: "UNAVAILABLE"; reason: string; missingInputs?: string[] };

export const available = <T>(value: T): Metric<T> => ({ status: "AVAILABLE", value });

export const partial = <T>(value: T, reason: string, missingInputs?: string[]): Metric<T> => ({
  status: "PARTIAL",
  value,
  reason,
  ...(missingInputs && missingInputs.length > 0 ? { missingInputs } : {}),
});

export const unavailable = <T = number>(reason: string, missingInputs?: string[]): Metric<T> => ({
  status: "UNAVAILABLE",
  reason,
  ...(missingInputs && missingInputs.length > 0 ? { missingInputs } : {}),
});

/** The metric's value, or null. NEVER coerce this null to zero. */
export function metricValue<T>(m: Metric<T>): T | null {
  return m.status === "UNAVAILABLE" ? null : m.value;
}

/**
 * Denominator-honest conversion rate: whole-number percent, or null when
 * the denominator is below the documented minimum (raw counts still
 * render). Same posture as customer-intelligence's safePercentage, gated
 * by the BI policy config.
 */
export type Ratio = { numerator: number; denominator: number; percentage: number | null };

export function ratio(numerator: number, denominator: number): Ratio {
  const percentage =
    denominator < BUSINESS_INTELLIGENCE.MIN_DENOMINATOR_FOR_PERCENTAGE || numerator < 0 || denominator <= 0
      ? null
      : Math.round((numerator / denominator) * 100);
  return { numerator, denominator, percentage };
}
