import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

describe("token-bucket rate limiter", () => {
  it("allows bursts up to capacity, then denies with a retry hint", () => {
    let t = 0;
    const limiter = createRateLimiter({ capacity: 3, refillPerMinute: 60, now: () => t });
    expect(limiter.take("k")).toEqual({ allowed: true });
    expect(limiter.take("k")).toEqual({ allowed: true });
    expect(limiter.take("k")).toEqual({ allowed: true });
    const denied = limiter.take("k");
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    // 60/min = 1 token per second.
    t += 1000;
    expect(limiter.take("k")).toEqual({ allowed: true });
    expect(limiter.take("k").allowed).toBe(false);
  });

  it("keys are independent", () => {
    const t = 0;
    const limiter = createRateLimiter({ capacity: 1, refillPerMinute: 1, now: () => t });
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(false);
    expect(limiter.take("b").allowed).toBe(true);
  });

  it("refill never exceeds capacity", () => {
    let t = 0;
    const limiter = createRateLimiter({ capacity: 2, refillPerMinute: 60, now: () => t });
    t += 3_600_000; // an hour idle refills to capacity, not beyond
    expect(limiter.take("k").allowed).toBe(true);
    expect(limiter.take("k").allowed).toBe(true);
    expect(limiter.take("k").allowed).toBe(false);
  });

  it("rejects nonsensical configuration", () => {
    expect(() => createRateLimiter({ capacity: 0, refillPerMinute: 10 })).toThrow();
    expect(() => createRateLimiter({ capacity: 5, refillPerMinute: 0 })).toThrow();
  });
});
