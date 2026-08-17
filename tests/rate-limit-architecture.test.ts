import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as eventsRoute } from "@/app/api/events/route";
import {
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_ROUTES,
  __resetEphemeralNetworkKeyForTests,
  __resetRateLimitsForTests,
  createMemoryRateLimitStore,
  createPostgresRateLimitStore,
  durableRateLimitEnabled,
  enforceRateLimit,
  networkKey,
  policyFor,
  setRateLimitStoreForTests,
  windowStartFor,
  type RateLimitStore,
} from "@/lib/rate-limit";
import { SESSION_COOKIE } from "@/lib/data/session-service";
import { makeSession, resetDb } from "./db-helpers";

/**
 * Production Launch Session 03 §12–§17, §61 — request-frequency protection.
 *
 * The properties that matter are not "a limit exists" but:
 *   - normal traffic is untouched,
 *   - burst traffic is refused,
 *   - one session's abuse does not limit another's,
 *   - a cookie-dropping caller is still bounded,
 *   - and there is NO path in which a backend failure grants unlimited
 *     expensive AI usage.
 */

const req = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { headers: { "x-forwarded-for": "203.0.113.9", ...headers } });

beforeEach(async () => {
  await resetDb();
  __resetRateLimitsForTests();
  setRateLimitStoreForTests(null);
});

afterEach(() => {
  setRateLimitStoreForTests(null);
  __resetRateLimitsForTests();
});

/* ------------------------------------------------------------------ */

describe("policy coverage (§15)", () => {
  it("every route has a policy, a class and at least one scope", () => {
    for (const route of RATE_LIMIT_ROUTES) {
      const policy = policyFor(route);
      expect(policy.routeClass).toBeTruthy();
      expect(policy.session || policy.network).toBeTruthy();
      expect(policy.message.length).toBeGreaterThan(10);
    }
  });

  it("every route that costs real money is classified PUBLIC_EXTERNAL_COST and limited tightly", () => {
    for (const route of ["ai_chat", "checkout", "artwork_upload", "quote"] as const) {
      const policy = policyFor(route);
      expect(policy.routeClass).toBe("PUBLIC_EXTERNAL_COST");
      expect(policy.session?.refillPerMinute ?? Infinity).toBeLessThanOrEqual(10);
      // The durable layer must apply where a per-instance bypass costs money.
      expect(policy.durable).toBe(true);
    }
  });

  it("no policy is so tight that a normal B2B checkout would meet it", () => {
    // Six configurations, each re-confirmed once after a reprice, is 12
    // checkout requests over a purchase — but a real one sends far fewer.
    expect(RATE_LIMIT_POLICIES.checkout.session!.capacity).toBeGreaterThanOrEqual(8);
    expect(RATE_LIMIT_POLICIES.artwork_upload.session!.capacity).toBeGreaterThanOrEqual(10);
  });
});

describe("layer 1: per-instance buckets", () => {
  it("lets normal traffic through", async () => {
    for (let i = 0; i < 5; i += 1) {
      const verdict = await enforceRateLimit({ route: "events", req: req(), sessionId: "sess_a", store: null });
      expect(verdict.allowed).toBe(true);
    }
  });

  it("refuses a burst and reports a retry delay", async () => {
    const capacity = policyFor("ai_chat").session!.capacity;
    let refused: Awaited<ReturnType<typeof enforceRateLimit>> | null = null;
    for (let i = 0; i < capacity + 3; i += 1) {
      const verdict = await enforceRateLimit({ route: "ai_chat", req: req(), sessionId: "sess_burst", store: null });
      if (!verdict.allowed) {
        refused = verdict;
        break;
      }
    }
    expect(refused).not.toBeNull();
    expect(refused!.allowed).toBe(false);
    if (refused!.allowed) throw new Error("unreachable");
    expect(refused!.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps sessions separate — one abuser does not lock out everyone else", async () => {
    for (let i = 0; i < 20; i += 1) {
      await enforceRateLimit({ route: "ai_chat", req: req(), sessionId: "sess_abuser", store: null });
    }
    // A different session on a different network is unaffected.
    const other = await enforceRateLimit({
      route: "ai_chat",
      req: req({ "x-forwarded-for": "198.51.100.4" }),
      sessionId: "sess_innocent",
      store: null,
    });
    expect(other.allowed).toBe(true);
  });

  it("bounds a caller that drops its cookie, via the network scope", async () => {
    let refused = false;
    for (let i = 0; i < policyFor("ai_chat").network!.capacity + 5; i += 1) {
      const verdict = await enforceRateLimit({ route: "ai_chat", req: req(), scopes: ["network"], store: null });
      if (!verdict.allowed) refused = true;
    }
    expect(refused).toBe(true);
  });
});

describe("identity is hashed, never a raw address (§13)", () => {
  it("never contains the IP it was derived from", () => {
    const key = networkKey(req({ "x-forwarded-for": "203.0.113.9" }));
    expect(key).not.toContain("203.0.113.9");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is stable for one address and different for another", () => {
    const a = networkKey(req({ "x-forwarded-for": "203.0.113.9" }));
    const b = networkKey(req({ "x-forwarded-for": "203.0.113.9" }));
    const c = networkKey(req({ "x-forwarded-for": "198.51.100.4" }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("with no salt configured, a new process key makes old digests uncorrelatable", () => {
    delete process.env.RATE_LIMIT_IP_SALT;
    __resetEphemeralNetworkKeyForTests();
    const before = networkKey(req());
    __resetEphemeralNetworkKeyForTests();
    const after = networkKey(req());
    expect(before).not.toBe(after);
  });

  it("with a salt configured, digests are reproducible across restarts", () => {
    process.env.RATE_LIMIT_IP_SALT = "a-long-random-salt";
    __resetEphemeralNetworkKeyForTests();
    const before = networkKey(req());
    __resetEphemeralNetworkKeyForTests();
    const after = networkKey(req());
    expect(before).toBe(after);
    delete process.env.RATE_LIMIT_IP_SALT;
  });
});

describe("layer 2: the durable shared counter (§14)", () => {
  it("counts across INSTANCES — two independent buckets, one shared limit", async () => {
    const store = createMemoryRateLimitStore();
    const limit = 5;
    const verdicts: string[] = [];
    for (let i = 0; i < limit + 2; i += 1) {
      const v = await store.hit({ key: "checkout:session:s1", limit, windowMs: 60_000 });
      verdicts.push(v.state);
    }
    expect(verdicts.filter((v) => v === "allowed")).toHaveLength(limit);
    expect(verdicts.filter((v) => v === "limited")).toHaveLength(2);
  });

  it("the Postgres store is atomic and idempotent within one window", async () => {
    const store = createPostgresRateLimitStore();
    const now = new Date("2026-08-16T10:00:30Z");
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.hit({ key: "events:session:concurrent", limit: 6, windowMs: 60_000, now })),
    );
    const counts = results.filter((r) => r.state === "allowed").length;
    // Exactly `limit` requests may pass, regardless of concurrency.
    expect(counts).toBe(6);
  });

  it("a new window resets the count", async () => {
    const store = createPostgresRateLimitStore();
    const first = new Date("2026-08-16T10:00:30Z");
    const second = new Date("2026-08-16T10:01:30Z");
    for (let i = 0; i < 3; i += 1) await store.hit({ key: "events:session:w", limit: 3, windowMs: 60_000, now: first });
    const overflow = await store.hit({ key: "events:session:w", limit: 3, windowMs: 60_000, now: first });
    expect(overflow.state).toBe("limited");
    const nextWindow = await store.hit({ key: "events:session:w", limit: 3, windowMs: 60_000, now: second });
    expect(nextWindow.state).toBe("allowed");
  });

  it("window boundaries are derived from the clock, so instances agree", () => {
    const a = windowStartFor(new Date("2026-08-16T10:00:01Z"), 60_000);
    const b = windowStartFor(new Date("2026-08-16T10:00:59Z"), 60_000);
    expect(a.toISOString()).toBe(b.toISOString());
  });
});

describe("failure modes never open the gate (§61)", () => {
  it("a durable-store outage degrades to the per-instance limit, and still refuses a burst", async () => {
    const broken: RateLimitStore = {
      kind: "broken",
      async hit() {
        return { state: "unavailable", error: "database is on fire" };
      },
    };

    // Degraded, but allowed — the per-instance bucket still applied.
    const first = await enforceRateLimit({ route: "ai_chat", req: req(), sessionId: "sess_degraded", store: broken });
    expect(first.allowed).toBe(true);
    if (!first.allowed) throw new Error("unreachable");
    expect(first.degraded).toBe(true);

    // And crucially: unlimited AI spend is still impossible.
    let refused = false;
    for (let i = 0; i < 20; i += 1) {
      const verdict = await enforceRateLimit({ route: "ai_chat", req: req(), sessionId: "sess_degraded", store: broken });
      if (!verdict.allowed) refused = true;
    }
    expect(refused).toBe(true);
  });

  it("respects an explicit RATE_LIMIT_DURABLE override in both directions", () => {
    process.env.RATE_LIMIT_DURABLE = "true";
    expect(durableRateLimitEnabled()).toBe(true);
    process.env.RATE_LIMIT_DURABLE = "false";
    expect(durableRateLimitEnabled()).toBe(false);
    delete process.env.RATE_LIMIT_DURABLE;
    // Default: off outside production, so tests and local runs need no
    // shared state. Production defaults ON — the environment where multiple
    // instances actually exist.
    expect(durableRateLimitEnabled()).toBe(process.env.NODE_ENV === "production");
  });
});

describe("/api/events is bounded by request frequency (§12)", () => {
  const eventBody = () =>
    JSON.stringify({
      events: [
        {
          name: "page_view",
          clientEventId: `evt_${crypto.randomUUID().replace(/-/g, "")}`,
          occurredAt: new Date().toISOString(),
          page: "/",
          props: {},
        },
      ],
    });

  const eventsRequest = (cookie?: string, ip = "203.0.113.55") =>
    new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
      body: eventBody(),
    });

  it("accepts ordinary traffic", async () => {
    const session = await makeSession();
    const res = await eventsRoute(eventsRequest(`${SESSION_COOKIE}=${session.id}`));
    expect(res.status).toBe(200);
  });

  it("refuses a flood from ONE network before it can write unbounded rows", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < policyFor("events").network!.capacity + 20; i += 1) {
      statuses.push((await eventsRoute(eventsRequest(undefined, "203.0.113.77"))).status);
    }
    expect(statuses).toContain(429);
  });

  it("the 429 carries Retry-After and no internal detail", async () => {
    let limited: Response | null = null;
    for (let i = 0; i < policyFor("events").network!.capacity + 20; i += 1) {
      const res = await eventsRoute(eventsRequest(undefined, "198.51.100.200"));
      if (res.status === 429) {
        limited = res;
        break;
      }
    }
    expect(limited).not.toBeNull();
    expect(limited!.headers.get("Retry-After")).toBeTruthy();
    const body = await limited!.json();
    expect(body.code).toBe("RATE_LIMITED");
    expect(JSON.stringify(body)).not.toMatch(/capacity|bucket|session:|network:/);
  });
});
