import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as pricingReviewPost } from "@/app/api/admin/pricing-intelligence/pricing-review/route";
import { buildPricingIntelligenceReport, periodFromDays } from "@/modules/pricing-intelligence";
import { listPricingReports } from "@/lib/data/pricing-report-service";
import { listDecisions } from "@/lib/data/agent-service";
import { makeSession, resetDb } from "./db-helpers";
import { basicAuth, seedClassification, seedConversation } from "./ci-helpers";
import { seedPricingSession } from "./pi-helpers";

/**
 * Session 12 — the pricing admin surface + security red team (spec §36, §38,
 * §42, §52).
 *
 * The generation route is a MUTATION route on the storefront's own origin
 * behind HTTP Basic, so the whole S10 gate applies: fail-closed auth, the
 * feature flags, same-origin, JSON-only, strict bodies. And the deterministic
 * dashboard must keep working with the AI entirely absent.
 */

const touched = new Set<string>();
function setEnv(key: string, value: string): void {
  touched.add(key);
  process.env[key] = value;
}
afterEach(() => {
  for (const key of touched) delete process.env[key];
  touched.clear();
});
beforeEach(async () => {
  await resetDb();
});

const ORIGIN = "http://localhost";
const CREDS = { user: "owner", password: "correct-horse-battery" };
const auth = () => basicAuth(CREDS.user, CREDS.password);

const enableAll = () => {
  setEnv("ADMIN_USER", CREDS.user);
  setEnv("ADMIN_PASSWORD", CREDS.password);
  setEnv("PRICING_INTELLIGENCE_ENABLED", "true");
  setEnv("AI_PRICING_AGENT_ENABLED", "true");
};

function req(body: unknown = {}, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/admin/pricing-intelligence/pricing-review`, {
    method: "POST",
    headers: { authorization: auth(), "content-type": "application/json", origin: ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/* ------------------------------------------------------------------ */
/* Auth + flag gates (fail closed)                                     */
/* ------------------------------------------------------------------ */

describe("admin gates fail closed", () => {
  it("404s when admin credentials are not configured at all", async () => {
    setEnv("PRICING_INTELLIGENCE_ENABLED", "true");
    const res = await pricingReviewPost(req());
    expect(res.status).toBe(404);
  });

  it("401s on wrong credentials", async () => {
    enableAll();
    const res = await pricingReviewPost(
      req({}, { authorization: basicAuth("owner", "wrong") }),
    );
    expect(res.status).toBe(401);
  });

  it("404s when the pricing-intelligence flag is off", async () => {
    setEnv("ADMIN_USER", CREDS.user);
    setEnv("ADMIN_PASSWORD", CREDS.password);
    setEnv("AI_PRICING_AGENT_ENABLED", "true");
    const res = await pricingReviewPost(req());
    expect(res.status).toBe(404);
  });

  it("404s when the pricing AGENT flag is off, even with the surface enabled", async () => {
    setEnv("ADMIN_USER", CREDS.user);
    setEnv("ADMIN_PASSWORD", CREDS.password);
    setEnv("PRICING_INTELLIGENCE_ENABLED", "true");
    const res = await pricingReviewPost(req());
    expect(res.status).toBe(404);
  });
});

describe("CSRF and body hardening", () => {
  it("blocks a cross-origin request carrying valid Basic credentials", async () => {
    enableAll();
    const res = await pricingReviewPost(req({}, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("CROSS_ORIGIN_BLOCKED");
  });

  it("blocks a request with no Origin or Referer at all", async () => {
    enableAll();
    const res = await pricingReviewPost(
      new Request(`${ORIGIN}/api/admin/pricing-intelligence/pricing-review`, {
        method: "POST",
        headers: { authorization: auth(), "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects an HTML form post (415)", async () => {
    enableAll();
    const res = await pricingReviewPost(
      req({}, { "content-type": "application/x-www-form-urlencoded" }),
    );
    expect(res.status).toBe(415);
  });

  it("rejects unknown body keys (422) — no smuggled instruction reaches the agent", async () => {
    enableAll();
    const res = await pricingReviewPost(req({ periodDays: 30, proposedUnitPriceCents: 37 }));
    expect(res.status).toBe(422);
  });

  it("rejects an out-of-range period (422)", async () => {
    enableAll();
    const res = await pricingReviewPost(req({ periodDays: 9999 }));
    expect(res.status).toBe(422);
  });
});

/* ------------------------------------------------------------------ */
/* Provider failure ≠ dashboard failure (spec §38, §42)                */
/* ------------------------------------------------------------------ */

describe("the deterministic dashboard does not depend on AI", () => {
  it("builds a full report with no AI configuration and no persisted review", async () => {
    const s = await makeSession();
    await seedPricingSession(s.id, { quantity: 5000, cart: true });
    const { conversation, messages } = await seedConversation(s.id, ["How much for 5,000?"]);
    await seedClassification(conversation.id, { questions: [{ theme: "PRICE", messageId: messages[0].id }] });

    const report = await buildPricingIntelligenceReport(periodFromDays(7, new Date(Date.now() + 60_000)));
    expect(report.pricingReport).toBeNull();
    expect(report.snapshot.funnel.priceViewSessions).toBe(1);
    expect(report.snapshot.funnel.conversations.priceQuestion).toBe(1);
    expect(report.snapshot.readiness.AUTOMATED_PRICE_CHANGE.state).toBe("NOT_SUPPORTED");
    expect(report.snapshot.costs.costModelConfigured).toBe(false);
  });

  it("returns an honest 503 (and writes nothing) when the AI runtime is unusable", async () => {
    enableAll();
    setEnv("AI_RUNTIME_ENABLED", "true");
    // No provider credentials configured — the runtime cannot be built.
    const res = await pricingReviewPost(req({ periodDays: 7 }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(["AI_UNAVAILABLE", "AI_FAILED"]).toContain(body.code);
    expect(await listPricingReports()).toHaveLength(0);
    expect(await listDecisions("pricing")).toHaveLength(0);
  });
});
