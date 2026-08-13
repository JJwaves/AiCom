import { CUSTOMER_INTELLIGENCE } from "@/config/customer-intelligence";

/**
 * Period semantics (Session 08 spec §13): every metric is computed over an
 * explicit half-open window [start, end) and every persisted insight
 * records periodStart/periodEnd. There are no timeless percentages.
 */
export type Period = {
  start: Date;
  end: Date;
  /** Whole days covered — drives the previous-period comparison window. */
  days: number;
  label: string;
};

export const STANDARD_PERIOD_DAYS = [7, 30, 90] as const;

export function periodFromDays(days: number, now: Date = new Date()): Period {
  const d = Math.max(1, Math.min(Math.floor(days), 365));
  const end = now;
  const start = new Date(end.getTime() - d * 24 * 60 * 60 * 1000);
  return { start, end, days: d, label: `last ${d} days` };
}

export function customPeriod(start: Date, end: Date): Period {
  if (!(start instanceof Date) || !(end instanceof Date) || !(start.getTime() < end.getTime())) {
    throw new Error("customPeriod requires start < end");
  }
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
  return { start, end, days, label: `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}` };
}

/** The equivalent window immediately before `p` — for trend comparison. */
export function previousPeriod(p: Period): Period {
  const length = p.end.getTime() - p.start.getTime();
  return {
    start: new Date(p.start.getTime() - length),
    end: p.start,
    days: p.days,
    label: `previous ${p.days} days`,
  };
}

/**
 * Denominator-honest percentage (spec §14): whole-number percent, or null
 * when the denominator is below the documented minimum — callers render
 * raw counts instead of a percentage in that case.
 */
export function safePercentage(numerator: number, denominator: number): number | null {
  if (denominator < CUSTOMER_INTELLIGENCE.MIN_DENOMINATOR_FOR_PERCENTAGE) return null;
  if (numerator < 0 || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

/**
 * Trend vs the previous period (spec §28): whole-number percent change,
 * or null when the previous-period base is too small to be meaningful.
 */
export function safeTrendPct(current: number, previous: number): number | null {
  if (previous < CUSTOMER_INTELLIGENCE.MIN_TREND_BASE) return null;
  return Math.round(((current - previous) / previous) * 100);
}
