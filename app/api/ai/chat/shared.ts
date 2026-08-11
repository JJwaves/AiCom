import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

/**
 * Chat-route shared state: rate limiters + customer-facing copy.
 * Lives outside route.ts because Next route modules may only export HTTP
 * handlers/config — and tests need to reset the buckets between cases.
 */

export const MAX_MESSAGE_CHARS = 2_000;

/** Customer-safe fallback for every AI-side failure (spec §23). Never provider internals. */
export const AI_UNAVAILABLE_MESSAGE =
  "Our packaging assistant is temporarily unavailable. You can still configure and order your bags directly on any product page.";

export const RATE_LIMITED_MESSAGE = "You're sending messages very quickly — give it a few seconds and try again.";

/** Per-session sustained ~6 msg/min with a burst of 6 — generous for humans, a wall for scripts. */
const SESSION_LIMIT = { capacity: 6, refillPerMinute: 6 };
/** Per-IP backstop for cookie-dropping clients; wider because of NAT. */
const IP_LIMIT = { capacity: 20, refillPerMinute: 20 };

export let chatSessionLimiter: RateLimiter = createRateLimiter(SESSION_LIMIT);
export let chatIpLimiter: RateLimiter = createRateLimiter(IP_LIMIT);

/** Test isolation — fresh buckets. Refused in production. */
export function __resetChatRateLimitersForTests(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__resetChatRateLimitersForTests is a test hook and cannot be used in production");
  }
  chatSessionLimiter = createRateLimiter(SESSION_LIMIT);
  chatIpLimiter = createRateLimiter(IP_LIMIT);
}

/** First hop of x-forwarded-for, or a stable placeholder when absent (single-host dev). */
export function clientIpKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : "local";
}
