import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as processPost } from "@/app/api/admin/customer-intelligence/process/route";
import { POST as insightStatusPost } from "@/app/api/admin/customer-intelligence/insights/[id]/status/route";
import { POST as opportunityStatusPost } from "@/app/api/admin/customer-intelligence/opportunities/[id]/status/route";
import { checkAdminAuth } from "@/lib/admin/auth";
import { recordServerEvent } from "@/lib/data/event-service";
import { createInsight, createOpportunity, getInsight, getOpportunity, listInsights } from "@/lib/data/insight-service";
import { makeSession, resetDb } from "./db-helpers";
import { basicAuth, seedClassification, seedConversation } from "./ci-helpers";

/**
 * Session 08 — admin auth (fail closed), flag gating, and the explicit
 * processing/status routes. No real AI provider is ever reachable here:
 * AI runtime env stays unset, so processing must degrade gracefully while
 * deterministic generation still runs (§34).
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

const enableAll = () => {
  setEnv("ADMIN_USER", "owner");
  setEnv("ADMIN_PASSWORD", "correct-horse-battery");
  setEnv("AI_CUSTOMER_INTELLIGENCE_ENABLED", "true");
};

const processReq = (headers: Record<string, string> = {}, body = "{}") =>
  new Request("http://localhost/api/admin/customer-intelligence/process", { method: "POST", headers, body });

describe("checkAdminAuth — fail closed", () => {
  it("is not_configured without both env vars", () => {
    expect(checkAdminAuth(basicAuth("a", "b"), {})).toBe("not_configured");
    expect(checkAdminAuth(basicAuth("a", "b"), { ADMIN_USER: "a" })).toBe("not_configured");
  });

  it("authorizes only the exact credentials", () => {
    const env = { ADMIN_USER: "owner", ADMIN_PASSWORD: "pw" };
    expect(checkAdminAuth(basicAuth("owner", "pw"), env)).toBe("authorized");
    expect(checkAdminAuth(basicAuth("owner", "wrong"), env)).toBe("unauthorized");
    expect(checkAdminAuth("Basic not-base64!!!", env)).toBe("unauthorized");
    expect(checkAdminAuth(null, env)).toBe("unauthorized");
    expect(checkAdminAuth("Bearer token", env)).toBe("unauthorized");
  });
});

describe("admin routes — auth and flag gates", () => {
  it("answers 404 while admin credentials are unconfigured (the surface does not exist)", async () => {
    setEnv("AI_CUSTOMER_INTELLIGENCE_ENABLED", "true");
    const res = await processPost(processReq({ authorization: basicAuth("owner", "pw") }));
    expect(res.status).toBe(404);
  });

  it("answers 401 on wrong credentials, 404 with the feature flag off", async () => {
    setEnv("ADMIN_USER", "owner");
    setEnv("ADMIN_PASSWORD", "pw");
    const wrong = await processPost(processReq({ authorization: basicAuth("owner", "nope") }));
    expect(wrong.status).toBe(401);

    // Correct auth but flag off — the intelligence surface is dark.
    const flagOff = await processPost(processReq({ authorization: basicAuth("owner", "pw") }));
    expect(flagOff.status).toBe(404);
  });
});

describe("processing route — §17, §33–§34", () => {
  it("degrades gracefully without an AI provider: classification unavailable, deterministic generation still runs", async () => {
    enableAll();
    // Three qualified conversations with stored classifications (from a
    // past run) — enough for deterministic insight generation.
    for (let i = 0; i < 3; i += 1) {
      const s = await makeSession();
      const { conversation, messages } = await seedConversation(s.id, ["What is your MOQ?"]);
      await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
      await seedClassification(conversation.id, { questions: [{ theme: "MOQ", messageId: messages[0].id }] });
    }

    const res = await processPost(processReq({ authorization: basicAuth("owner", "correct-horse-battery") }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // No AI runtime configured → classification reports unavailable...
    expect(body.classification.status).toBe("unavailable");
    // ...but deterministic insights still generated from persisted labels.
    expect(body.insights.created).toBeGreaterThan(0);
    expect((await listInsights()).length).toBeGreaterThan(0);
  });

  it("validates its body strictly", async () => {
    enableAll();
    const auth = { authorization: basicAuth("owner", "correct-horse-battery") };
    expect((await processPost(processReq(auth, "not json"))).status).toBe(400);
    expect((await processPost(processReq(auth, JSON.stringify({ periodDays: 0 })))).status).toBe(422);
    expect((await processPost(processReq(auth, JSON.stringify({ injected: true })))).status).toBe(422);
  });
});

describe("status routes — human decisions only (§22, §36)", () => {
  const statusReq = (kind: string, id: string, status: string, auth = basicAuth("owner", "correct-horse-battery")) =>
    new Request(`http://localhost/api/admin/customer-intelligence/${kind}/${id}/status`, {
      method: "POST",
      headers: { authorization: auth },
      body: JSON.stringify({ status }),
    });

  it("updates insight status (dismiss) through the admin route", async () => {
    enableAll();
    const insight = await createInsight({
      insightType: "CUSTOMER_QUESTION",
      title: "Test",
      sourceRefs: [{ table: "conversations", id: "conv_x" }],
      evidenceCount: 3,
    });
    const res = await insightStatusPost(statusReq("insights", insight.id, "dismissed"), {
      params: Promise.resolve({ id: insight.id }),
    });
    expect(res.status).toBe(200);
    expect((await getInsight(insight.id))!.status).toBe("dismissed");
  });

  it("lets a human (and only this authed route) validate an opportunity", async () => {
    enableAll();
    const opp = await createOpportunity({ title: "Insulated bags", description: "Requested by 3 conversations." });
    expect(opp.status).toBe("proposed");
    expect(opp.humanValidationRequired).toBe(true);

    const res = await opportunityStatusPost(statusReq("opportunities", opp.id, "validated"), {
      params: Promise.resolve({ id: opp.id }),
    });
    expect(res.status).toBe(200);
    expect((await getOpportunity(opp.id))!.status).toBe("validated");
  });

  it("rejects unknown ids and invalid statuses", async () => {
    enableAll();
    const missing = await insightStatusPost(statusReq("insights", "ins_missing", "dismissed"), {
      params: Promise.resolve({ id: "ins_missing" }),
    });
    expect(missing.status).toBe(404);

    const insight = await createInsight({
      insightType: "CUSTOMER_QUESTION",
      title: "Test",
      sourceRefs: [{ table: "conversations", id: "conv_x" }],
      evidenceCount: 1,
    });
    const invalid = await insightStatusPost(statusReq("insights", insight.id, "exploded"), {
      params: Promise.resolve({ id: insight.id }),
    });
    expect(invalid.status).toBe(422);
  });

  it("keeps status routes dark without auth or flag", async () => {
    const insight = { id: "ins_x" };
    // No admin env at all → 404.
    const dark = await insightStatusPost(statusReq("insights", insight.id, "dismissed"), {
      params: Promise.resolve({ id: insight.id }),
    });
    expect(dark.status).toBe(404);
  });
});
