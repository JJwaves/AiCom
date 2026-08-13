import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as modifyPost } from "@/app/api/admin/ai-actions/[id]/modify/route";
import { POST as reviewPost } from "@/app/api/admin/ai-actions/[id]/review/route";
import { POST as syncPost } from "@/app/api/admin/ai-actions/sync/route";
import { adminIdentity } from "@/lib/admin/auth";
import { getAction, listActions, proposeAction, syncDecisionsToActions } from "@/lib/data/agent-action-service";
import { recordDecision } from "@/lib/data/agent-service";
import { resetDb } from "./db-helpers";
import { basicAuth } from "./ci-helpers";

/**
 * Session 10 — admin surface + security red team (spec §26, §44–§46).
 *
 * The Action Center introduces the platform's first admin MUTATION routes,
 * so these tests cover the whole gate: fail-closed auth, the feature flag,
 * cross-site protection under HTTP Basic, strict bodies, server-derived
 * identity, and the invariant that no client field can set a verdict, a
 * risk level, or an execution status.
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

const enableAll = () => {
  setEnv("ADMIN_USER", CREDS.user);
  setEnv("ADMIN_PASSWORD", CREDS.password);
  setEnv("AI_ACTION_CENTER_ENABLED", "true");
};

const auth = () => basicAuth(CREDS.user, CREDS.password);

function req(path: string, body: unknown = {}, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      authorization: auth(),
      "content-type": "application/json",
      origin: ORIGIN,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function seedPendingAction() {
  await recordDecision({
    agentType: "ceo",
    decisionType: "ceo_recommendation",
    observation: "12 of 40 qualified conversations asked about a lower minimum.",
    reasoningSummary: "Review whether a lower MOQ is economically feasible.",
    supportingData: {
      title: "Investigate MOQ",
      actionCategory: "PRODUCT",
      supportingMetricRefs: ["funnel.qualified_conversations"],
      periodDays: 30,
    },
    riskLevel: "medium",
    proposedAction: { agentType: "ceo", actionType: "recommend_product", params: { identityKey: "k" } },
    approvalRequired: true,
  });
  await syncDecisionsToActions();
  const [action] = await listActions({});
  return action;
}

describe("auth + feature flag gates (fail closed)", () => {
  it("404s while admin credentials are unconfigured — the surface does not exist", async () => {
    setEnv("AI_ACTION_CENTER_ENABLED", "true");
    expect((await syncPost(req("/api/admin/ai-actions/sync"))).status).toBe(404);
  });

  it("401s on wrong credentials", async () => {
    enableAll();
    const bad = new Request(`${ORIGIN}/api/admin/ai-actions/sync`, {
      method: "POST",
      headers: { authorization: basicAuth("owner", "nope"), "content-type": "application/json", origin: ORIGIN },
      body: "{}",
    });
    expect((await syncPost(bad)).status).toBe(401);
  });

  it("404s with the feature flag off, even for a valid admin", async () => {
    setEnv("ADMIN_USER", CREDS.user);
    setEnv("ADMIN_PASSWORD", CREDS.password);
    expect((await syncPost(req("/api/admin/ai-actions/sync"))).status).toBe(404);
  });
});

describe("admin write safety under HTTP Basic (spec §26)", () => {
  it("blocks a cross-site request that carries valid browser credentials", async () => {
    enableAll();
    const crossSite = req("/api/admin/ai-actions/sync", {}, { origin: "https://evil.example" });
    const res = await syncPost(crossSite);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("CROSS_ORIGIN_BLOCKED");
  });

  it("blocks a request with no Origin or Referer at all", async () => {
    enableAll();
    const noOrigin = new Request(`${ORIGIN}/api/admin/ai-actions/sync`, {
      method: "POST",
      headers: { authorization: auth(), "content-type": "application/json" },
      body: "{}",
    });
    expect((await syncPost(noOrigin)).status).toBe(403);
  });

  it("blocks an HTML form post (wrong content type) before touching the body", async () => {
    enableAll();
    const formPost = new Request(`${ORIGIN}/api/admin/ai-actions/sync`, {
      method: "POST",
      headers: { authorization: auth(), "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      body: "outcome=approve",
    });
    expect((await syncPost(formPost)).status).toBe(415);
  });

  it("accepts a same-origin JSON request from the admin page", async () => {
    enableAll();
    const res = await syncPost(req("/api/admin/ai-actions/sync"));
    expect(res.status).toBe(200);
  });
});

describe("strict body validation", () => {
  it("rejects unparseable, oversized and unknown-key bodies", async () => {
    enableAll();
    expect((await syncPost(req("/api/admin/ai-actions/sync", "not json"))).status).toBe(400);
    expect((await syncPost(req("/api/admin/ai-actions/sync", { injected: true }))).status).toBe(422);
    expect((await syncPost(req("/api/admin/ai-actions/sync", "x".repeat(3_000)))).status).toBe(413);
  });

  it("requires an explicit expectedStateVersion on review", async () => {
    enableAll();
    const action = await seedPendingAction();
    const res = await reviewPost(req(`/api/admin/ai-actions/${action.id}/review`, { outcome: "approve" }), {
      params: Promise.resolve({ id: action.id }),
    });
    expect(res.status).toBe(422);
  });
});

describe("red team: no client-supplied authority (spec §45)", () => {
  it("ignores a client-supplied reviewedBy and derives the admin identity server-side", async () => {
    enableAll();
    const action = await seedPendingAction();
    const res = await reviewPost(
      req(`/api/admin/ai-actions/${action.id}/review`, {
        outcome: "approve",
        expectedStateVersion: action.stateVersion,
        reviewedBy: "CEO",
      }),
      { params: Promise.resolve({ id: action.id }) },
    );
    // reviewedBy is not an accepted field at all — the strict schema rejects it.
    expect(res.status).toBe(422);

    const clean = await reviewPost(
      req(`/api/admin/ai-actions/${action.id}/review`, { outcome: "approve", expectedStateVersion: action.stateVersion }),
      { params: Promise.resolve({ id: action.id }) },
    );
    expect(clean.status).toBe(200);
    expect((await getAction(action.id))?.reviewedBy).toBe(CREDS.user);
    expect(adminIdentity(auth())).toBe(CREDS.user);
  });

  it("rejects a body that tries to set approvalStatus or riskLevel directly", async () => {
    enableAll();
    const action = await seedPendingAction();
    for (const body of [
      { outcome: "approve", expectedStateVersion: action.stateVersion, approvalStatus: "APPROVED" },
      { outcome: "approve", expectedStateVersion: action.stateVersion, riskLevel: "LOW" },
      { outcome: "approve", expectedStateVersion: action.stateVersion, executionStatus: "EXECUTED" },
    ]) {
      const res = await reviewPost(req(`/api/admin/ai-actions/${action.id}/review`, body), {
        params: Promise.resolve({ id: action.id }),
      });
      expect(res.status).toBe(422);
    }
    expect((await getAction(action.id))?.status).toBe("PENDING_APPROVAL");
  });

  it("recomputes risk server-side when a modification claims a lower one", async () => {
    enableAll();
    const action = await seedPendingAction();
    const payload = { ...(action.payloadJson as Record<string, unknown>), riskLevel: "LOW" };
    const res = await modifyPost(
      req(`/api/admin/ai-actions/${action.id}/modify`, { payload, expectedStateVersion: action.stateVersion }),
      { params: Promise.resolve({ id: action.id }) },
    );
    const body = await res.json();
    // riskLevel is not part of any payload schema → the revision is blocked.
    expect(body.status).toBe("GUARDRAIL_BLOCKED");
    expect(body.guardrail.allowed).toBe(false);
    expect(body.riskLevel).toBe("CRITICAL");
  });

  it("returns 409 on a stale review and reports the current state", async () => {
    enableAll();
    const action = await seedPendingAction();
    await reviewPost(
      req(`/api/admin/ai-actions/${action.id}/review`, { outcome: "approve", expectedStateVersion: action.stateVersion }),
      { params: Promise.resolve({ id: action.id }) },
    );
    const stale = await reviewPost(
      req(`/api/admin/ai-actions/${action.id}/review`, { outcome: "reject", expectedStateVersion: action.stateVersion }),
      { params: Promise.resolve({ id: action.id }) },
    );
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.currentStatus).toBe("APPROVED");
    expect((await getAction(action.id))?.status).toBe("APPROVED");
  });

  it("404s on an unknown action id", async () => {
    enableAll();
    const res = await reviewPost(
      req("/api/admin/ai-actions/act_missing/review", { outcome: "approve", expectedStateVersion: 1 }),
      { params: Promise.resolve({ id: "act_missing" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("approval never means execution (spec §16)", () => {
  it("leaves executionStatus NOT_APPLICABLE / NOT_SUPPORTED after approval", async () => {
    enableAll();
    const action = await seedPendingAction();
    const res = await reviewPost(
      req(`/api/admin/ai-actions/${action.id}/review`, { outcome: "approve", expectedStateVersion: action.stateVersion }),
      { params: Promise.resolve({ id: action.id }) },
    );
    const body = await res.json();
    expect(body.status).toBe("APPROVED");
    expect(["NOT_APPLICABLE", "NOT_SUPPORTED"]).toContain(body.executionStatus);
    expect(body.executionStatus).not.toBe("EXECUTED");
  });

  it("cannot approve a guardrail-blocked action through the route either", async () => {
    enableAll();
    const { action } = await proposeAction({
      source: "CEO_AGENT",
      actionType: "REFUND",
      payload: { orderId: "ord_1", amountCents: 100_000, currency: "USD", reason: "asked nicely" },
      title: "Refund order",
      createdBy: "system:test",
    });
    expect(action.status).toBe("GUARDRAIL_BLOCKED");
    const res = await reviewPost(
      req(`/api/admin/ai-actions/${action.id}/review`, { outcome: "approve", expectedStateVersion: action.stateVersion }),
      { params: Promise.resolve({ id: action.id }) },
    );
    expect(res.status).toBe(409);
  });
});
