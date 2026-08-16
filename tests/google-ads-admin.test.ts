import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as adsReviewPost } from "@/app/api/admin/google-ads/ads-review/route";
import { POST as syncPost } from "@/app/api/admin/google-ads/sync/route";
import { POST as testConnectionPost } from "@/app/api/admin/google-ads/test-connection/route";
import { listSyncRuns } from "@/lib/data/google-ads-service";
import { buildGoogleAdsIntelligenceReport, customPeriod } from "@/modules/google-ads-intelligence";
import { resetDb } from "./db-helpers";
import { basicAuth } from "./ci-helpers";
import { CONFIGURED_CREDENTIALS, UNCONFIGURED_CREDENTIALS } from "./gads-helpers";

/**
 * Session 13 — the Google Ads admin surface + security red team (spec §67).
 *
 * All three routes are MUTATION routes on the storefront's own origin behind
 * HTTP Basic, so the whole S10 write-guard applies: fail-closed auth, the
 * feature flags, same-origin, JSON-only, bounded strict bodies. And the
 * deterministic dashboard must keep working with Google Ads entirely absent.
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

const enableAdmin = () => {
  setEnv("ADMIN_USER", CREDS.user);
  setEnv("ADMIN_PASSWORD", CREDS.password);
  setEnv("GOOGLE_ADS_INTELLIGENCE_ENABLED", "true");
};

function req(path: string, body: unknown = {}, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/admin/google-ads/${path}`, {
    method: "POST",
    headers: { authorization: auth(), "content-type": "application/json", origin: ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ROUTES = [
  ["test-connection", testConnectionPost],
  ["sync", syncPost],
  ["ads-review", adsReviewPost],
] as const;

/* ------------------------------------------------------------------ */
/* Auth + flag gates (fail closed)                                     */
/* ------------------------------------------------------------------ */

describe("admin gates fail closed", () => {
  it.each(ROUTES)("%s 404s when admin credentials are not configured at all", async (path, handler) => {
    setEnv("GOOGLE_ADS_INTELLIGENCE_ENABLED", "true");
    const res = await handler(req(path));
    expect(res.status).toBe(404);
  });

  it.each(ROUTES)("%s 401s with wrong credentials", async (path, handler) => {
    enableAdmin();
    setEnv("AI_GOOGLE_ADS_AGENT_ENABLED", "true");
    const res = await handler(req(path, {}, { authorization: basicAuth("owner", "wrong") }));
    expect(res.status).toBe(401);
  });

  it.each(ROUTES)("%s 404s while GOOGLE_ADS_INTELLIGENCE is off", async (path, handler) => {
    setEnv("ADMIN_USER", CREDS.user);
    setEnv("ADMIN_PASSWORD", CREDS.password);
    setEnv("AI_GOOGLE_ADS_AGENT_ENABLED", "true");
    const res = await handler(req(path));
    expect(res.status).toBe(404);
  });

  it("ads-review 404s while the AGENT flag is off, even with the dashboard flag on", async () => {
    enableAdmin();
    const res = await adsReviewPost(req("ads-review"));
    expect(res.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/* CSRF posture (the cost of Basic auth)                               */
/* ------------------------------------------------------------------ */

describe("write guard", () => {
  it.each(ROUTES)("%s rejects a CROSS-ORIGIN request", async (path, handler) => {
    enableAdmin();
    setEnv("AI_GOOGLE_ADS_AGENT_ENABLED", "true");
    const res = await handler(req(path, {}, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it.each(ROUTES)("%s rejects a request with NO Origin or Referer", async (path, handler) => {
    enableAdmin();
    setEnv("AI_GOOGLE_ADS_AGENT_ENABLED", "true");
    const res = await handler(
      new Request(`${ORIGIN}/api/admin/google-ads/${path}`, {
        method: "POST",
        headers: { authorization: auth(), "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(403);
  });

  it.each(ROUTES)("%s rejects an HTML form post (415)", async (path, handler) => {
    enableAdmin();
    setEnv("AI_GOOGLE_ADS_AGENT_ENABLED", "true");
    const res = await handler(req(path, "a=1", { "content-type": "application/x-www-form-urlencoded" }));
    expect(res.status).toBe(415);
  });

  it.each(ROUTES)("%s rejects a GET", async (path, handler) => {
    enableAdmin();
    setEnv("AI_GOOGLE_ADS_AGENT_ENABLED", "true");
    const res = await handler(
      new Request(`${ORIGIN}/api/admin/google-ads/${path}`, {
        method: "GET",
        headers: { authorization: auth(), origin: ORIGIN },
      }),
    );
    expect(res.status).toBe(403);
  });
});

/* ------------------------------------------------------------------ */
/* Strict bodies — the client cannot choose the account                */
/* ------------------------------------------------------------------ */

describe("strict request bodies", () => {
  it("sync rejects an unknown field rather than ignoring it", async () => {
    enableAdmin();
    const res = await syncPost(req("sync", { customerId: "999", lookbackDays: 7 }));
    expect(res.status).toBe(422);
  });

  it("sync rejects a half-specified date range", async () => {
    enableAdmin();
    const res = await syncPost(req("sync", { startDate: "2026-08-01" }));
    expect(res.status).toBe(422);
  });

  it("sync rejects a lookback beyond the documented ceiling", async () => {
    enableAdmin();
    const res = await syncPost(req("sync", { lookbackDays: 3650 }));
    expect(res.status).toBe(422);
  });

  it("a client CANNOT name the Google Ads account to probe — the id is server config", async () => {
    enableAdmin();
    // test-connection accepts no parameters at all; a body is simply ignored,
    // and the account comes from resolveCredentials() (unset in tests).
    const res = await testConnectionPost(req("test-connection", { customerId: "1112223333" }));
    const data = (await res.json()) as { code?: string };
    expect(res.status).toBe(200);
    expect(data.code).toBe("NOT_CONFIGURED");
  });

  it("ads-review rejects an unknown field", async () => {
    enableAdmin();
    setEnv("AI_GOOGLE_ADS_AGENT_ENABLED", "true");
    const res = await adsReviewPost(req("ads-review", { periodDays: 7, force: true }));
    expect(res.status).toBe(422);
  });
});

/* ------------------------------------------------------------------ */
/* Honest behaviour without credentials                                */
/* ------------------------------------------------------------------ */

describe("without Google Ads credentials", () => {
  it("test-connection reports NOT_CONFIGURED, naming the missing variables", async () => {
    enableAdmin();
    const res = await testConnectionPost(req("test-connection"));
    const data = (await res.json()) as { ok: boolean; code: string; missing: string[]; explanation: string };
    expect(data.ok).toBe(false);
    expect(data.code).toBe("NOT_CONFIGURED");
    expect(data.missing).toContain("GOOGLE_ADS_DEVELOPER_TOKEN");
    expect(data.explanation).toMatch(/not zero spend/i);
  });

  it("sync reports NOT_CONNECTED and writes no run row — nothing to be stale about", async () => {
    enableAdmin();
    const res = await syncPost(req("sync"));
    const data = (await res.json()) as { ok: boolean; code: string; reason: string };
    expect(data.ok).toBe(false);
    expect(data.code).toBe("NOT_CONNECTED");
    expect(await listSyncRuns(5)).toEqual([]);
  });

  it("returns a 503 (not a crash) when the AI runtime is unconfigured", async () => {
    enableAdmin();
    setEnv("AI_GOOGLE_ADS_AGENT_ENABLED", "true");
    const res = await adsReviewPost(req("ads-review", { periodDays: 7 }));
    expect(res.status).toBe(503);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe("AI_UNAVAILABLE");
  });
});

/* ------------------------------------------------------------------ */
/* Deterministic report needs no AI and no Google                      */
/* ------------------------------------------------------------------ */

describe("the deterministic report", () => {
  const period = customPeriod(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-31T23:59:59Z"));

  it("renders with no AI configuration and no Google connection", async () => {
    const report = await buildGoogleAdsIntelligenceReport(period, UNCONFIGURED_CREDENTIALS);
    expect(report.snapshot.connection.state).toBe("NOT_CONNECTED");
    expect(report.adsReport).toBeNull();
    expect(report.snapshot.dataQuality.length).toBeGreaterThan(0);
    // The page has something honest to say in every section.
    expect(report.snapshot.signals.length).toBeGreaterThan(0);
  });

  it("never reports a spend number when nothing is connected", async () => {
    const report = await buildGoogleAdsIntelligenceReport(period, CONFIGURED_CREDENTIALS);
    expect(report.snapshot.google.daysWithData).toBe(0);
    expect(report.snapshot.efficiency.firstPartyRoas.status).toBe("UNAVAILABLE");
    expect(report.snapshot.efficiency.profitOnAdSpend.status).toBe("UNAVAILABLE");
  });
});
