/**
 * In-memory token-bucket rate limiter — the FIRST layer of the rate-limit
 * architecture (Session 05 spec §19; generalized in Production Launch
 * Session 03 §13).
 *
 * It is cheap, synchronous and always available, which makes it the right
 * first gate: an abusive caller is refused before a database round trip or a
 * provider call happens. It is also, on its own, NOT globally authoritative:
 *
 * - State is per server instance (a Map in module memory). On serverless /
 *   multi-instance deploys each instance enforces independently, so the
 *   effective global limit is (instances x capacity). This file never
 *   pretends otherwise, and `lib/rate-limit/index.ts` layers a durable
 *   shared-store limiter on top for exactly that reason.
 * - Keys are caller-chosen (a session id, or a keyed hash of the network
 *   identity — never a raw IP). Buckets are pruned lazily once full-capacity
 *   idle, so the map cannot grow without bound.
 */

export type RateLimitVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export type RateLimiter = {
  take(key: string): RateLimitVerdict;
  /** Test/observability introspection. */
  size(): number;
};

export function createRateLimiter(opts: {
  /** Maximum burst (bucket capacity in tokens; 1 token = 1 request). */
  capacity: number;
  /** Sustained refill rate, tokens per minute. */
  refillPerMinute: number;
  /** Injectable clock for tests. */
  now?: () => number;
}): RateLimiter {
  if (opts.capacity < 1 || opts.refillPerMinute <= 0) {
    throw new Error("rate limiter requires capacity >= 1 and refillPerMinute > 0");
  }
  const now = opts.now ?? Date.now;
  const refillPerMs = opts.refillPerMinute / 60_000;
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();
  /** A bucket idle long enough to be full again carries no state worth keeping. */
  const idleMs = (opts.capacity / refillPerMs) + 60_000;

  function prune(at: number): void {
    if (buckets.size < 10_000) return;
    for (const [key, bucket] of buckets) {
      if (at - bucket.updatedAt > idleMs) buckets.delete(key);
    }
  }

  return {
    take(key: string): RateLimitVerdict {
      const at = now();
      prune(at);
      const bucket = buckets.get(key) ?? { tokens: opts.capacity, updatedAt: at };
      bucket.tokens = Math.min(opts.capacity, bucket.tokens + (at - bucket.updatedAt) * refillPerMs);
      bucket.updatedAt = at;
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        buckets.set(key, bucket);
        return { allowed: true };
      }
      buckets.set(key, bucket);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000)) };
    },
    size: () => buckets.size,
  };
}
