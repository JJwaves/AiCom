import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as archivePost } from "@/app/api/admin/experiments/[id]/archive/route";
import { POST as launchPost } from "@/app/api/admin/experiments/[id]/launch/route";
import { POST as stopPost } from "@/app/api/admin/experiments/[id]/stop/route";
import { POST as materializePost } from "@/app/api/admin/experiments/materialize/route";
import { POST as croReviewPost } from "@/app/api/admin/experiments/cro-review/route";
import {
  createExperimentDraft,
  getExperiment,
  listExperiments,
  type ExperimentRow,
} from "@/lib/data/experiment-service";
import { listActions, proposeAction, reviewAction } from "@/lib/data/agent-action-service";
import { resetDb } from "./db-helpers";
import { basicAuth } from "./ci-helpers";

/**
 * Session 11 — the experiment admin surface + security red team (spec §49).
 *
 * These are MUTATION routes on the storefront's own origin behind HTTP
 * Basic, so the whole S10 gate applies: fail-closed auth, the feature flag,
 * same-origin, JSON-only, strict bodies, server-derived actors, and
 * stateVersion staleness. Plus the Session-11 invariants: launching is
 * human-only, capped, and idempotent, and stopping deletes nothing.
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
  setEnv("EXPERIMENT_ENGINE_ENABLED", "true");
};

function req(path: string, body: unknown = {}, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { authorization: auth(), "content-type": "application/json", origin: ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const DESIGN = {
  targetKey: "product.shipping_message",
  experimentType: "SHIPPING_MESSAGE",
  variantConfig: { message: "Production starts once you approve your artwork proof.", placement: "above_cta" },
  primaryMetric: "add_to_cart",
  allocation: [
    { variant: "control", pct: 50 },
    { variant: "variant_b", pct: 50 },
  ],
};

async function makeDraft(name = "shipping-message-v1"): Promise<ExperimentRow> {
  const created = await createExperimentDraft({
    name,
    hypothesis: "Setting production expectations near the CTA reduces uncertainty.",
    createdBy: "admin:owner",
    design: DESIGN,
  });
  if (!created.ok) throw new Error(created.reason);
  return created.experiment;
}

/* ------------------------------------------------------------------ */
/* Gates                                                               */
/* ------------------------------------------------------------------ */

describe("auth + flag gates (fail closed)", () => {
  it("404s while admin credentials are unconfigured — the surface does not exist", async () => {
    setEnv("EXPERIMENT_ENGINE_ENABLED", "true");
    const res = await materializePost(req("/api/admin/experiments/materialize"));
    expect(res.status).toBe(404);
  });

  it("401s on wrong credentials", async () => {
    enableAll();
    const res = await materializePost(
      new Request(`${ORIGIN}/api/admin/experiments/materialize`, {
        method: "POST",
        headers: { authorization: basicAuth("owner", "wrong"), "content-type": "application/json", origin: ORIGIN },
        body: "{}",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("404s while EXPERIMENT_ENGINE is off, even for an authenticated admin", async () => {
    setEnv("ADMIN_USER", CREDS.user);
    setEnv("ADMIN_PASSWORD", CREDS.password);
    const draft = await makeDraft();
    const res = await launchPost(req(`/api/admin/experiments/${draft.id}/launch`, { expectedStateVersion: 1 }), params(draft.id));
    expect(res.status).toBe(404);
    expect((await getExperiment(draft.id))?.status).toBe("draft");
  });

  it("404s the CRO review route while the CRO agent flag is off", async () => {
    enableAll();
    const res = await croReviewPost(req("/api/admin/experiments/cro-review"));
    expect(res.status).toBe(404);
  });
});

describe("CSRF posture under HTTP Basic", () => {
  it("blocks a cross-origin request even with valid credentials", async () => {
    enableAll();
    const draft = await makeDraft();
    const res = await launchPost(
      req(`/api/admin/experiments/${draft.id}/launch`, { expectedStateVersion: 1 }, { origin: "https://evil.test" }),
      params(draft.id),
    );
    expect(res.status).toBe(403);
    expect((await getExperiment(draft.id))?.status).toBe("draft");
  });

  it("blocks a request with no Origin or Referer", async () => {
    enableAll();
    const draft = await makeDraft();
    const res = await launchPost(
      new Request(`${ORIGIN}/api/admin/experiments/${draft.id}/launch`, {
        method: "POST",
        headers: { authorization: auth(), "content-type": "application/json" },
        body: JSON.stringify({ expectedStateVersion: 1 }),
      }),
      params(draft.id),
    );
    expect(res.status).toBe(403);
  });

  it("blocks an HTML form post (415) — forms cannot send application/json", async () => {
    enableAll();
    const draft = await makeDraft();
    const res = await launchPost(
      req(
        `/api/admin/experiments/${draft.id}/launch`,
        "expectedStateVersion=1",
        { "content-type": "application/x-www-form-urlencoded" },
      ),
      params(draft.id),
    );
    expect(res.status).toBe(415);
  });
});

describe("strict bodies", () => {
  it("rejects unknown fields — a client cannot set status, actor, or traffic", async () => {
    enableAll();
    const draft = await makeDraft();
    for (const body of [
      { expectedStateVersion: 1, status: "running" },
      { expectedStateVersion: 1, launchedBy: "CEO" },
      { expectedStateVersion: 1, trafficPct: 100 },
      { expectedStateVersion: 1, allocation: [{ variant: "variant_b", pct: 100 }] },
    ]) {
      const res = await launchPost(req(`/api/admin/experiments/${draft.id}/launch`, body), params(draft.id));
      expect(res.status).toBe(422);
    }
    expect((await getExperiment(draft.id))?.status).toBe("draft");
  });

  it("requires expectedStateVersion on every transition", async () => {
    enableAll();
    const draft = await makeDraft();
    expect((await launchPost(req(`/api/admin/experiments/${draft.id}/launch`, {}), params(draft.id))).status).toBe(422);
    expect((await stopPost(req(`/api/admin/experiments/${draft.id}/stop`, {}), params(draft.id))).status).toBe(422);
    expect((await archivePost(req(`/api/admin/experiments/${draft.id}/archive`, {}), params(draft.id))).status).toBe(422);
  });
});

/* ------------------------------------------------------------------ */
/* Launch / stop through the routes                                    */
/* ------------------------------------------------------------------ */

describe("launch route", () => {
  it("launches, records a server-derived actor, and is idempotent", async () => {
    enableAll();
    const draft = await makeDraft();
    const first = await launchPost(req(`/api/admin/experiments/${draft.id}/launch`, { expectedStateVersion: draft.stateVersion }), params(draft.id));
    expect(first.status).toBe(200);
    const running = (await getExperiment(draft.id))!;
    expect(running.status).toBe("running");
    expect(running.launchedBy).toBe(`admin:${CREDS.user}`);

    const second = await launchPost(
      req(`/api/admin/experiments/${draft.id}/launch`, { expectedStateVersion: running.stateVersion }),
      params(draft.id),
    );
    const body = (await second.json()) as { ok: boolean; alreadyRunning: boolean };
    expect(second.status).toBe(200);
    expect(body.alreadyRunning).toBe(true);
  });

  it("409s a stale launch instead of overwriting", async () => {
    enableAll();
    const draft = await makeDraft();
    await launchPost(req(`/api/admin/experiments/${draft.id}/launch`, { expectedStateVersion: draft.stateVersion }), params(draft.id));
    // A second admin acting on the page they loaded before the stop below.
    const running = (await getExperiment(draft.id))!;
    await stopPost(req(`/api/admin/experiments/${draft.id}/stop`, { expectedStateVersion: running.stateVersion }), params(draft.id));
    const stale = await launchPost(
      req(`/api/admin/experiments/${draft.id}/launch`, { expectedStateVersion: running.stateVersion }),
      params(draft.id),
    );
    expect(stale.status).toBe(409);
  });

  it("409s a second experiment on the same target", async () => {
    enableAll();
    const first = await makeDraft("shipping-v1");
    const second = await makeDraft("shipping-v2");
    await launchPost(req(`/api/admin/experiments/${first.id}/launch`, { expectedStateVersion: first.stateVersion }), params(first.id));
    const res = await launchPost(
      req(`/api/admin/experiments/${second.id}/launch`, { expectedStateVersion: second.stateVersion }),
      params(second.id),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("TARGET_BUSY");
  });

  it("404s an unknown experiment id", async () => {
    enableAll();
    const res = await launchPost(req(`/api/admin/experiments/exp_nope/launch`, { expectedStateVersion: 1 }), params("exp_nope"));
    expect(res.status).toBe(404);
  });
});

describe("stop route", () => {
  it("stops, freezes the result, and deletes nothing", async () => {
    enableAll();
    const draft = await makeDraft();
    await launchPost(req(`/api/admin/experiments/${draft.id}/launch`, { expectedStateVersion: draft.stateVersion }), params(draft.id));
    const running = (await getExperiment(draft.id))!;
    const res = await stopPost(
      req(`/api/admin/experiments/${draft.id}/stop`, { expectedStateVersion: running.stateVersion, reason: "done" }),
      params(draft.id),
    );
    expect(res.status).toBe(200);
    const stopped = (await getExperiment(draft.id))!;
    expect(stopped.status).toBe("stopped");
    expect(stopped.stoppedBy).toBe(`admin:${CREDS.user}`);
    expect((stopped.resultJson as { state?: string }).state).toBeTruthy();
    expect(stopped.variantsJson).toEqual(running.variantsJson); // config preserved
  });
});

/* ------------------------------------------------------------------ */
/* Materialize (spec §25)                                              */
/* ------------------------------------------------------------------ */

async function approvedProposal(design: unknown = DESIGN) {
  const { action } = await proposeAction({
    source: "CRO_AGENT",
    actionType: "CRO_EXPERIMENT_PROPOSAL",
    title: "Set production expectations near Add to cart",
    createdBy: "system:test",
    payload: {
      page: "product.shipping_message",
      hypothesis: "Setting production expectations near the CTA reduces uncertainty.",
      control: "Current UI",
      variant: "One-line production expectation",
      primaryMetric: "add_to_cart",
      design,
      metricRefs: [],
      evidenceRefs: [],
    },
  });
  await reviewAction({
    actionId: action.id,
    outcome: "approve",
    reviewedBy: CREDS.user,
    expectedStateVersion: action.stateVersion,
  });
  return action;
}

describe("materialize", () => {
  it("creates a DRAFT (never a running experiment) from an approved proposal", async () => {
    enableAll();
    await approvedProposal();
    const res = await materializePost(req("/api/admin/experiments/materialize"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: number };
    expect(body.created).toBe(1);

    const [experiment] = await listExperiments({});
    expect(experiment.status).toBe("draft");
    expect(experiment.sourceActionId).toBeTruthy();
    expect(experiment.createdBy).toBe(`admin:${CREDS.user}`);
  });

  it("is idempotent — re-running creates nothing new", async () => {
    enableAll();
    await approvedProposal();
    await materializePost(req("/api/admin/experiments/materialize"));
    const second = await materializePost(req("/api/admin/experiments/materialize"));
    const body = (await second.json()) as { created: number; skippedExisting: number };
    expect(body.created).toBe(0);
    expect(body.skippedExisting).toBe(1);
    expect(await listExperiments({})).toHaveLength(1);
  });

  it("ignores proposals that are still PENDING_APPROVAL — approval is the gate", async () => {
    enableAll();
    await proposeAction({
      source: "CRO_AGENT",
      actionType: "CRO_EXPERIMENT_PROPOSAL",
      title: "Not yet approved",
      createdBy: "system:test",
      payload: {
        page: "product.shipping_message",
        hypothesis: "h",
        control: "c",
        variant: "v",
        primaryMetric: "add_to_cart",
        design: DESIGN,
        metricRefs: [],
        evidenceRefs: [],
      },
    });
    const res = await materializePost(req("/api/admin/experiments/materialize"));
    expect(((await res.json()) as { created: number }).created).toBe(0);
    expect(await listExperiments({})).toHaveLength(0);
    expect((await listActions({}))[0].status).toBe("PENDING_APPROVAL");
  });

  it("skips a design-less proposal instead of inventing one", async () => {
    enableAll();
    await approvedProposal(null);
    const res = await materializePost(req("/api/admin/experiments/materialize"));
    const body = (await res.json()) as { created: number; skippedNoDesign: number };
    expect(body.created).toBe(0);
    expect(body.skippedNoDesign).toBe(1);
  });
});
