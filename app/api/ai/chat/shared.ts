/**
 * Chat-route shared copy (Session 05 spec §19; rate limiting centralized in
 * Production Launch Session 03 §13, §16).
 *
 * The per-route token buckets that used to live here now come from
 * `lib/rate-limit` — ONE policy table, ONE enforcement path, and a durable
 * shared counter layered under the per-instance bucket so the effective
 * limit does not silently multiply by the instance count. The limits
 * themselves are unchanged (6/min per session, 20/min per network): they
 * were chosen for this route's cost profile and remain right.
 *
 * The AI budget guard (`assertWithinAiBudget`) remains the hard financial
 * backstop beneath all of it — request limiting bounds the RATE of spend,
 * the budget bounds the TOTAL.
 */

export const MAX_MESSAGE_CHARS = 2_000;

/** Customer-safe fallback for every AI-side failure (spec §23). Never provider internals. */
export const AI_UNAVAILABLE_MESSAGE =
  "Our packaging assistant is temporarily unavailable. You can still configure and order your bags directly on any product page.";

export const RATE_LIMITED_MESSAGE = "You're sending messages very quickly — give it a few seconds and try again.";
