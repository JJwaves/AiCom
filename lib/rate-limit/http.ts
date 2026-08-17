import { NextResponse } from "next/server";
import type { EnforceResult } from "./index";

/**
 * The ONE 429 shape (Production Launch Session 03 §12).
 *
 * A rate-limited caller gets: a stable `RATE_LIMITED` code, customer-safe
 * copy, and a `Retry-After` header so a well-behaved client backs off
 * instead of hammering. It never says WHICH scope was hit or what the limit
 * is — that is a map of how to stay just under it.
 */
export function rateLimitedResponse(result: Extract<EnforceResult, { allowed: false }>): NextResponse {
  return NextResponse.json(
    { ok: false, code: "RATE_LIMITED", error: result.message, message: result.message, retryAfterSeconds: result.retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}
