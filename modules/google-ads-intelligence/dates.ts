/**
 * Reporting-date arithmetic (Session 13 spec §29).
 *
 * THE TIME ZONE PROBLEM, stated plainly:
 *
 *   Google Ads reports a "day" in the ACCOUNT's time zone. BagDirect's
 *   sessions, orders and events are timestamptz, and every other
 *   intelligence layer (S08–S12) defines its period in UTC. These are not
 *   the same calendar, and pretending they are shifts spend onto the wrong
 *   day at both ends of every window.
 *
 * The normalization strategy this file implements, and which
 * docs/GOOGLE_ADS_INTELLIGENCE.md documents:
 *
 *   1. Google-native metrics are stored and aggregated by the ACCOUNT's
 *      calendar day, exactly as Google reported them. They are never
 *      re-bucketed into UTC — re-bucketing a daily total is impossible
 *      without hourly data we deliberately do not fetch.
 *   2. A BagDirect UTC period is mapped to the account-calendar days it
 *      OVERLAPS (`accountDayRangeForPeriod`). The mapping is inclusive, so
 *      an offset account can contribute one boundary day of spend that a
 *      strict UTC reading would exclude.
 *   3. Where the two calendars can disagree (any account whose zone is not
 *      UTC), the snapshot says so and the admin page shows both the account
 *      zone and the exact account-day range used. The disagreement is
 *      REPORTED, never silently reconciled.
 *
 * Everything here is pure. No clock is read except through an injected
 * `now`, so every test is deterministic.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar date in `timeZone` at instant `now`, as `YYYY-MM-DD`.
 *
 * Uses `Intl` with `en-CA` (which formats as ISO) rather than manual offset
 * math, so DST transitions and historical zone changes are handled by the
 * platform's tz database instead of by arithmetic we would get wrong.
 */
export function dateInTimeZone(timeZone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // An unknown zone is a data problem, not a crash. UTC is the honest
    // fallback and the caller surfaces the account's declared zone anyway.
    return now.toISOString().slice(0, 10);
  }
}

/** Shift a `YYYY-MM-DD` by whole days. Calendar-safe (UTC arithmetic). */
export function addDays(date: string, days: number): string {
  if (!DATE_RE.test(date)) throw new Error("addDays expects YYYY-MM-DD");
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Inclusive day count between two `YYYY-MM-DD` dates. */
export function daysBetween(startDate: string, endDate: string): number {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * The default sync window: `lookbackDays` ending TODAY in the account's zone.
 *
 * Today is included deliberately — the owner pressing "Sync" wants today's
 * spend even though it is incomplete — and the snapshot marks the trailing
 * days provisional rather than presenting them as final (spec §28).
 */
export function defaultSyncRange(
  timeZone: string,
  lookbackDays: number,
  now: Date,
): { startDate: string; endDate: string } {
  const endDate = dateInTimeZone(timeZone, now);
  return { startDate: addDays(endDate, -(Math.max(1, lookbackDays) - 1)), endDate };
}

/**
 * Account-calendar days overlapping a BagDirect UTC reporting period.
 *
 * Inclusive at both ends: an account in `America/Los_Angeles` is still on
 * the previous calendar day when a UTC period begins, and that day's spend
 * genuinely overlaps the period.
 */
export function accountDayRangeForPeriod(
  timeZone: string,
  period: { start: Date; end: Date },
): { startDate: string; endDate: string } {
  return {
    startDate: dateInTimeZone(timeZone, period.start),
    endDate: dateInTimeZone(timeZone, period.end),
  };
}

/**
 * Whether an account's calendar can disagree with UTC.
 *
 * `UTC` and `Etc/UTC` cannot; everything else can, and the surface says so.
 * This is intentionally conservative — a zone that happens to be at UTC+0
 * today (Europe/London in winter) still gets flagged, because it will not be
 * in July.
 */
export function timeZoneDiffersFromUtc(timeZone: string): boolean {
  return !["UTC", "Etc/UTC", "Etc/GMT", "GMT"].includes(timeZone);
}
