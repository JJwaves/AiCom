import { logWarn } from "@/lib/observability/logger";
import { createRateLimiter, type RateLimiter, type RateLimitVerdict } from "./bucket";
import { networkKey } from "./identity";
import { policyFor, type RateLimitRoute, type ScopeLimit } from "./policy";
import { resolveRateLimitStore, type RateLimitStore } from "./store";

/**
 * THE rate-limit entry point (Production Launch Session 03 §12–§17).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAYERS, OUTERMOST FIRST
 * ─────────────────────────────────────────────────────────────────────────
 *  0. PLATFORM / WAF — the hard outer layer, and the only one that can
 *     refuse a request before it costs a function invocation. It is OWNER
 *     CONFIGURATION, not code: Vercel Firewall rate-limit rules (or an
 *     equivalent CDN/WAF). LAUNCH_CHECKLIST makes it an explicit launch
 *     requirement, and docs/OBSERVABILITY.md gives the concrete rules.
 *     NOTHING in this repository can substitute for it.
 *  1. PER-INSTANCE TOKEN BUCKET — synchronous, free, always available.
 *     Refuses the obvious abuse before any I/O.
 *  2. DURABLE SHARED COUNTER — Postgres fixed window, so the limit means the
 *     same thing across instances. Consulted only for routes whose policy
 *     sets `durable: true`.
 *
 * A request must pass EVERY applicable layer. The first refusal wins.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES NOT CLAIM
 * ─────────────────────────────────────────────────────────────────────────
 * It does not claim that a per-instance memory limiter is globally
 * sufficient on Vercel (§14) — that claim is exactly why layer 2 exists.
 * It does not claim to stop a distributed botnet: many source addresses with
 * fresh cookies defeat any application-layer limiter, which is what layer 0
 * is for. And it is not the AI spend control: `assertWithinAiBudget` remains
 * the hard financial backstop underneath everything here.
 */

export type EnforceInput = {
  route: RateLimitRoute;
  /** The first-party session id, when one is resolved. */
  sessionId?: string | null;
  /** The request, for network identity. Only headers are read. */
  req: { headers: { get(name: string): string | null } };
  /**
   * Which scopes to evaluate on this call. Routes check the NETWORK scope
   * first — before `sessionFromRequest` mints a session row — so an abusive
   * caller that drops cookies cannot force a database write per request just
   * by being counted. The SESSION scope is then checked once identity is
   * known, without double-counting the network scope.
   */
  scopes?: ("session" | "network")[];
  /** Test seam. */
  store?: RateLimitStore | null;
  now?: Date;
};

export type EnforceResult =
  | { allowed: true; degraded: boolean }
  | { allowed: false; retryAfterSeconds: number; scope: "session" | "network"; message: string };

/* ---- Layer 1: per-instance buckets, one pair per route ---- */

type RouteBuckets = { session: RateLimiter | null; network: RateLimiter | null };

const buckets = new Map<RateLimitRoute, RouteBuckets>();

function bucketsFor(route: RateLimitRoute): RouteBuckets {
  const existing = buckets.get(route);
  if (existing) return existing;
  const policy = policyFor(route);
  const created: RouteBuckets = {
    session: policy.session ? createRateLimiter(policy.session) : null,
    network: policy.network ? createRateLimiter(policy.network) : null,
  };
  buckets.set(route, created);
  return created;
}

/** Test isolation — fresh buckets for every case. Refused in production. */
export function __resetRateLimitsForTests(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__resetRateLimitsForTests is a test hook and cannot be used in production");
  }
  buckets.clear();
}

/**
 * The durable window. One minute matches how the policies are expressed
 * (requests per minute), and the allowance is the sustained rate plus the
 * burst so the two layers cannot disagree about a legitimate burst.
 */
const DURABLE_WINDOW_MS = 60_000;
const durableLimit = (limit: ScopeLimit): number => limit.refillPerMinute + limit.capacity;

export async function enforceRateLimit(input: EnforceInput): Promise<EnforceResult> {
  const policy = policyFor(input.route);
  const routeBuckets = bucketsFor(input.route);
  const network = networkKey(input.req);

  const requested: ("session" | "network")[] = input.scopes ?? ["session", "network"];
  const allScopes: { scope: "session" | "network"; limiter: RateLimiter | null; limit: ScopeLimit | null; id: string | null }[] = [
    { scope: "session", limiter: routeBuckets.session, limit: policy.session, id: input.sessionId ?? null },
    { scope: "network", limiter: routeBuckets.network, limit: policy.network, id: network },
  ];
  const scopes = allScopes.filter((entry) => requested.includes(entry.scope));

  // ---- Layer 1 ------------------------------------------------------
  for (const entry of scopes) {
    if (!entry.limiter || !entry.id) continue;
    const verdict: RateLimitVerdict = entry.limiter.take(`${input.route}:${entry.scope}:${entry.id}`);
    if (!verdict.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: verdict.retryAfterSeconds,
        scope: entry.scope,
        message: policy.message,
      };
    }
  }

  // ---- Layer 2 ------------------------------------------------------
  const store = input.store === undefined ? resolveRateLimitStore() : input.store;
  if (!policy.durable || !store) return { allowed: true, degraded: false };

  let degraded = false;
  for (const entry of scopes) {
    if (!entry.limit || !entry.id) continue;
    const verdict = await store.hit({
      key: `${input.route}:${entry.scope}:${entry.id}`,
      limit: durableLimit(entry.limit),
      windowMs: DURABLE_WINDOW_MS,
      now: input.now,
    });
    if (verdict.state === "limited") {
      return {
        allowed: false,
        retryAfterSeconds: verdict.retryAfterSeconds,
        scope: entry.scope,
        message: policy.message,
      };
    }
    if (verdict.state === "unavailable") {
      // Documented conservative mode: the per-instance limit above already
      // applied and stands. This is a DEGRADATION, logged as such — never a
      // silent upgrade to "unlimited".
      degraded = true;
      logWarn({
        subsystem: "rate-limit",
        event: "durable_store_unavailable",
        code: "DURABLE_UNAVAILABLE",
        route: input.route,
        scope: entry.scope,
        error: verdict.error,
      });
    }
  }

  return { allowed: true, degraded };
}

export { createRateLimiter, type RateLimiter, type RateLimitVerdict } from "./bucket";
export { hasStableNetworkKey, networkKey, __resetEphemeralNetworkKeyForTests } from "./identity";
export {
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_ROUTES,
  policyFor,
  type RateLimitPolicy,
  type RateLimitRoute,
  type RouteClass,
} from "./policy";
export {
  createMemoryRateLimitStore,
  createPostgresRateLimitStore,
  durableRateLimitEnabled,
  pruneExpiredRateLimitCounters,
  resolveRateLimitStore,
  setRateLimitStoreForTests,
  windowStartFor,
  type DurableVerdict,
  type RateLimitStore,
} from "./store";
