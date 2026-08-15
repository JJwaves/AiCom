import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { events, experimentAssignments, experiments } from "@/db/schema";
import { recordServerEvent } from "@/lib/data/event-service";
import {
  archiveExperiment,
  armTotals,
  createExperimentDraft,
  findRunningExperimentForTarget,
  getAssignment,
  getExperiment,
  launchExperiment,
  listExperimentEvents,
  markExposed,
  recordAssignment,
  stopExperiment,
  validateStoredExperiment,
  type ExperimentRow,
} from "@/lib/data/experiment-service";
import { metricByVariant } from "@/lib/data/experiment-metrics-service";
import { buildExperimentSummary } from "@/lib/experiments/readout";
import { ensureSession } from "@/lib/data/session-service";
import { resetDb } from "./db-helpers";

/**
 * Session 11 — the experiment RUNTIME over the real (embedded) database:
 * launch/stop idempotency, the one-running-experiment-per-target rule,
 * stale-transition conflicts, sticky assignment, exposure deduplication,
 * post-exposure-only measurement, and end-to-end readouts.
 *
 * `next/headers` is mocked so the server resolver (a Server Component
 * helper) can be exercised without a running Next server.
 */

const cookieJar = { value: null as string | null };
const headerJar = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36" };

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "bd_sid" && cookieJar.value ? { value: cookieJar.value } : undefined) }),
  headers: async () => ({ get: (name: string) => (name.toLowerCase() === "user-agent" ? headerJar.userAgent : null) }),
}));

const { resolveExperimentTarget, resolveProductShippingMessage } = await import("@/lib/experiments/server");

const touched = new Set<string>();
function setEnv(key: string, value: string): void {
  touched.add(key);
  process.env[key] = value;
}
afterEach(() => {
  for (const key of touched) delete process.env[key];
  touched.clear();
  cookieJar.value = null;
});
beforeEach(async () => {
  await resetDb();
  setEnv("EXPERIMENT_ENGINE_ENABLED", "true");
});

const SHIPPING_DESIGN = {
  targetKey: "product.shipping_message",
  experimentType: "SHIPPING_MESSAGE",
  variantConfig: { message: "Production starts once you approve the artwork proof.", placement: "above_cta" },
  primaryMetric: "add_to_cart",
  secondaryMetrics: ["ai_chat_started"],
  guardrailMetrics: ["purchase_completed"],
  allocation: [
    { variant: "control", pct: 50 },
    { variant: "variant_b", pct: 50 },
  ],
};

async function makeDraft(over: { name?: string; design?: Record<string, unknown> } = {}): Promise<ExperimentRow> {
  const created = await createExperimentDraft({
    name: over.name ?? "shipping-message-v1",
    hypothesis: "Setting production expectations near the CTA reduces uncertainty.",
    createdBy: "admin:owner",
    design: over.design ?? SHIPPING_DESIGN,
  });
  if (!created.ok) throw new Error(`draft creation failed: ${created.reason}`);
  return created.experiment;
}

async function launch(experiment: ExperimentRow): Promise<ExperimentRow> {
  const result = await launchExperiment({
    experimentId: experiment.id,
    actor: "admin:owner",
    expectedStateVersion: experiment.stateVersion,
  });
  if (!result.ok) throw new Error(`launch failed: ${JSON.stringify(result)}`);
  return result.experiment;
}

/* ------------------------------------------------------------------ */
/* Creation + validation                                               */
/* ------------------------------------------------------------------ */

describe("draft creation", () => {
  it("stores a validated design with a control snapshot and enrols nobody", async () => {
    const experiment = await makeDraft();
    expect(experiment.status).toBe("draft");
    expect(experiment.targetKey).toBe("product.shipping_message");
    expect(experiment.variantKey).toBe("variant_b");
    expect(experiment.targetVersion).toBe("1.0.0");
    expect(experiment.trafficSplitJson).toEqual({ control: 50, variant_b: 50 });
    expect((experiment.controlJson as { summary?: string }).summary).toMatch(/No additional shipping message/);
    expect(await findRunningExperimentForTarget("product.shipping_message")).toBeNull();
  });

  it("refuses a design naming an unregistered target", async () => {
    const created = await createExperimentDraft({
      name: "checkout-test",
      hypothesis: "Nope.",
      createdBy: "admin:owner",
      design: { ...SHIPPING_DESIGN, targetKey: "checkout.payment_form" },
    });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.reason).toMatch(/Unknown experiment target/);
  });

  it("refuses variant copy containing markup", async () => {
    const created = await createExperimentDraft({
      name: "xss-test",
      hypothesis: "Nope.",
      createdBy: "admin:owner",
      design: {
        ...SHIPPING_DESIGN,
        variantConfig: { message: "<img src=x onerror=alert(1)>", placement: "above_cta" },
      },
    });
    expect(created.ok).toBe(false);
  });

  it("raises a too-small minimum sample to the documented floor", async () => {
    const experiment = await makeDraft({ design: { ...SHIPPING_DESIGN, minimumSampleSize: 5 } });
    expect(experiment.minimumSampleSize).toBe(1000);
  });
});

/* ------------------------------------------------------------------ */
/* Launch (spec §25–§27, §43–§45)                                      */
/* ------------------------------------------------------------------ */

describe("launch", () => {
  it("moves a draft to running and snapshots the guardrail policy", async () => {
    const running = await launch(await makeDraft());
    expect(running.status).toBe("running");
    expect(running.launchedBy).toBe("admin:owner");
    expect(running.policyVersion).toBeTruthy();
    const policy = running.policySnapshotJson as Record<string, unknown>;
    expect(policy.trafficCap).toBeTruthy();
    expect(policy.launchMode).toBe("human_admin_route");
    // The guardrail engine reports the unconfigured business limit honestly.
    expect(policy.missingConfiguration).toContain("config/guardrails.ts → GUARDRAIL_LIMITS.maximumExperimentTrafficPct");
    const timeline = await listExperimentEvents(running.id);
    expect(timeline.map((e) => e.type)).toEqual(["experiment_created", "experiment_launched"]);
  });

  it("is idempotent — launching a running experiment writes nothing", async () => {
    const draft = await makeDraft();
    const running = await launch(draft);
    const again = await launchExperiment({
      experimentId: draft.id,
      actor: "admin:owner",
      expectedStateVersion: running.stateVersion,
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.alreadyRunning).toBe(true);
    expect((await listExperimentEvents(draft.id)).filter((e) => e.type === "experiment_launched")).toHaveLength(1);
  });

  it("refuses a concurrent stale launch (409-style CONFLICT)", async () => {
    const draft = await makeDraft();
    const stale = draft.stateVersion;
    await launch(draft);
    // A second admin acting on the page they loaded before the first launch.
    const other = await makeDraft({ name: "shipping-message-v2" });
    const result = await launchExperiment({
      experimentId: other.id,
      actor: "admin:other",
      expectedStateVersion: stale + 99,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });

  it("refuses a SECOND experiment on the same target (one running per target)", async () => {
    await launch(await makeDraft());
    const second = await makeDraft({ name: "shipping-message-v2" });
    const result = await launchExperiment({
      experimentId: second.id,
      actor: "admin:owner",
      expectedStateVersion: second.stateVersion,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.code === "TARGET_BUSY") {
      expect(result.reason).toMatch(/already running/);
    } else {
      throw new Error(`expected TARGET_BUSY, got ${JSON.stringify(result)}`);
    }
    expect((await getExperiment(second.id))?.status).toBe("draft");
  });

  it("allows different targets to run at the same time", async () => {
    await launch(await makeDraft());
    const cta = await makeDraft({
      name: "cta-copy-v1",
      design: {
        targetKey: "product.primary_cta",
        experimentType: "CTA_COPY",
        variantConfig: { ctaLabel: "Add to cart and see shipping" },
        primaryMetric: "checkout_started",
        allocation: [
          { variant: "control", pct: 50 },
          { variant: "variant_b", pct: 50 },
        ],
      },
    });
    const result = await launchExperiment({
      experimentId: cta.id,
      actor: "admin:owner",
      expectedStateVersion: cta.stateVersion,
    });
    expect(result.ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Stop / archive (spec §33)                                           */
/* ------------------------------------------------------------------ */

describe("stop", () => {
  it("preserves assignments, exposures and the frozen result", async () => {
    const running = await launch(await makeDraft());
    const { session } = await ensureSession({ userAgent: "vitest-runtime" });
    await recordAssignment(running.id, session.id, "variant_b");
    await markExposed(running.id, session.id);

    const summary = await buildExperimentSummary(running);
    const stopped = await stopExperiment({
      experimentId: running.id,
      actor: "admin:owner",
      reason: "Enough signal",
      expectedStateVersion: running.stateVersion,
      finalReadout: JSON.parse(JSON.stringify(summary.readout)),
    });
    expect(stopped.ok).toBe(true);
    if (!stopped.ok) return;
    expect(stopped.experiment.status).toBe("stopped");
    expect(stopped.experiment.stopReason).toBe("Enough signal");
    expect((stopped.experiment.resultJson as { state?: string }).state).toBeTruthy();

    // Nothing was deleted.
    expect(await getAssignment(running.id, session.id)).not.toBeNull();
    const totals = await armTotals(running.id);
    expect(totals.find((t) => t.variant === "variant_b")?.exposedSessions).toBe(1);
  });

  it("is idempotent", async () => {
    const running = await launch(await makeDraft());
    const first = await stopExperiment({
      experimentId: running.id,
      actor: "admin:owner",
      expectedStateVersion: running.stateVersion,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await stopExperiment({
      experimentId: running.id,
      actor: "admin:owner",
      expectedStateVersion: first.experiment.stateVersion,
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.alreadyStopped).toBe(true);
  });

  it("stops enrolling: new sessions see control again", async () => {
    const running = await launch(await makeDraft());
    await stopExperiment({ experimentId: running.id, actor: "admin:owner", expectedStateVersion: running.stateVersion });
    const { session } = await ensureSession({ userAgent: headerJar.userAgent });
    cookieJar.value = session.id;
    const resolved = await resolveExperimentTarget("product.shipping_message", "/products/bag");
    expect(resolved.enrolled).toBe(false);
    if (!resolved.enrolled) expect(resolved.reason).toBe("no_running_experiment");
  });

  it("refuses to archive a running experiment", async () => {
    const running = await launch(await makeDraft());
    const result = await archiveExperiment({
      experimentId: running.id,
      actor: "admin:owner",
      expectedStateVersion: running.stateVersion,
    });
    expect(result.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Assignment + exposure through the server resolver (spec §9, §12)    */
/* ------------------------------------------------------------------ */

describe("server-side resolution", () => {
  async function sessionCookie(): Promise<string> {
    const { session } = await ensureSession({ userAgent: headerJar.userAgent });
    cookieJar.value = session.id;
    return session.id;
  }

  it("renders control (and touches nothing) when the flag is off", async () => {
    delete process.env.EXPERIMENT_ENGINE_ENABLED;
    const running = await launch(await makeDraft());
    setEnv("EXPERIMENT_ENGINE_ENABLED", "true");
    await stopExperiment({ experimentId: running.id, actor: "a", expectedStateVersion: running.stateVersion });
    delete process.env.EXPERIMENT_ENGINE_ENABLED;

    await sessionCookie();
    const resolved = await resolveExperimentTarget("product.shipping_message", "/products/bag");
    expect(resolved.enrolled).toBe(false);
    if (!resolved.enrolled) expect(resolved.reason).toBe("experiment_engine_disabled");

    const db = await getDb();
    expect(await db.select().from(experimentAssignments)).toHaveLength(0);
  });

  it("does not enrol a browser with no first-party session yet", async () => {
    await launch(await makeDraft());
    cookieJar.value = null;
    const resolved = await resolveExperimentTarget("product.shipping_message", "/products/bag");
    expect(resolved.enrolled).toBe(false);
    if (!resolved.enrolled) expect(resolved.reason).toBe("no_first_party_session_yet");
  });

  it("does not enrol bots", async () => {
    await launch(await makeDraft());
    await sessionCookie();
    const previous = headerJar.userAgent;
    headerJar.userAgent = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
    const resolved = await resolveExperimentTarget("product.shipping_message", "/products/bag");
    headerJar.userAgent = previous;
    expect(resolved.enrolled).toBe(false);
    if (!resolved.enrolled) expect(resolved.reason).toBe("automated_traffic_excluded");
  });

  it("never enrols an admin route", async () => {
    await launch(await makeDraft());
    await sessionCookie();
    const resolved = await resolveExperimentTarget("product.shipping_message", "/admin/experiments");
    expect(resolved.enrolled).toBe(false);
    if (!resolved.enrolled) expect(resolved.reason).toBe("admin_traffic_excluded");
  });

  it("is sticky across renders and records exactly one exposure event", async () => {
    await launch(await makeDraft());
    const sessionId = await sessionCookie();

    const first = await resolveExperimentTarget("product.shipping_message", "/products/bag");
    const second = await resolveExperimentTarget("product.shipping_message", "/products/bag");
    const third = await resolveExperimentTarget("product.shipping_message", "/products/bag");
    expect(first.enrolled).toBe(true);
    if (!first.enrolled || !second.enrolled || !third.enrolled) return;
    expect(second.variantKey).toBe(first.variantKey);
    expect(third.variantKey).toBe(first.variantKey);

    const db = await getDb();
    const assignments = await db.select().from(experimentAssignments);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].exposedAt).not.toBeNull();

    const exposureEvents = await db
      .select()
      .from(events)
      .where(and(eq(events.name, "experiment_exposed"), eq(events.sessionId, sessionId)));
    expect(exposureEvents).toHaveLength(1);
    expect(exposureEvents[0].propsJson.target).toBe("product.shipping_message");
  });

  it("gives control sessions NO override and variant sessions a validated one", async () => {
    await launch(await makeDraft());
    const seen = new Map<string, unknown>();
    for (let i = 0; i < 30 && seen.size < 2; i += 1) {
      const { session } = await ensureSession({ userAgent: headerJar.userAgent });
      cookieJar.value = session.id;
      const resolved = await resolveProductShippingMessage("/products/bag");
      if (resolved.variantKey) seen.set(resolved.variantKey, resolved.override);
    }
    expect(seen.size).toBe(2);
    expect(seen.get("control")).toBeNull();
    expect(seen.get("variant_b")).toMatchObject({ message: expect.stringContaining("artwork proof") });
  });

  it("distinguishes assignment count from unique exposed sessions", async () => {
    const running = await launch(await makeDraft());
    const { session: a } = await ensureSession({ userAgent: headerJar.userAgent });
    const { session: b } = await ensureSession({ userAgent: headerJar.userAgent });
    await recordAssignment(running.id, a.id, "control");
    await recordAssignment(running.id, b.id, "control");
    await markExposed(running.id, a.id); // only ONE of them actually saw it

    const totals = await armTotals(running.id);
    const control = totals.find((t) => t.variant === "control")!;
    expect(control.assignments).toBe(2);
    expect(control.exposedSessions).toBe(1);
  });

  it("marks exposure exactly once even under repeated calls", async () => {
    const running = await launch(await makeDraft());
    const { session } = await ensureSession({ userAgent: headerJar.userAgent });
    await recordAssignment(running.id, session.id, "variant_b");
    expect(await markExposed(running.id, session.id)).toBe(true);
    expect(await markExposed(running.id, session.id)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Measurement (spec §13)                                              */
/* ------------------------------------------------------------------ */

describe("measurement", () => {
  it("counts only conversions that happened AFTER exposure, once per session", async () => {
    const running = await launch(await makeDraft());
    const { session } = await ensureSession({ userAgent: headerJar.userAgent });

    // A conversion BEFORE exposure must not be credited to the experiment.
    await recordServerEvent({ sessionId: session.id, name: "add_to_cart" });
    await new Promise((r) => setTimeout(r, 5));
    await recordAssignment(running.id, session.id, "variant_b");
    await markExposed(running.id, session.id);
    await new Promise((r) => setTimeout(r, 5));
    // Two post-exposure conversions in one session count ONCE.
    await recordServerEvent({ sessionId: session.id, name: "add_to_cart" });
    await recordServerEvent({ sessionId: session.id, name: "add_to_cart" });

    const metric = await metricByVariant(running.id, "add_to_cart");
    const arm = metric.arms.find((a) => a.variant === "variant_b")!;
    expect(arm.exposedSessions).toBe(1);
    expect(arm.conversions).toBe(1);
  });

  it("rejects a metric name outside the platform event taxonomy", async () => {
    const running = await launch(await makeDraft());
    await expect(metricByVariant(running.id, "revenue_per_visitor")).rejects.toThrow();
  });

  it("produces a deterministic end-to-end readout", async () => {
    const running = await launch(await makeDraft());
    // 6 exposed sessions per arm, 1 conversion in control, 4 in the variant.
    for (let i = 0; i < 12; i += 1) {
      const { session } = await ensureSession({ userAgent: headerJar.userAgent });
      const variant = i % 2 === 0 ? "control" : "variant_b";
      await recordAssignment(running.id, session.id, variant);
      await markExposed(running.id, session.id);
      const converts = variant === "control" ? i === 0 : i < 8;
      if (converts) await recordServerEvent({ sessionId: session.id, name: "add_to_cart" });
    }

    const first = await buildExperimentSummary((await getExperiment(running.id))!);
    const second = await buildExperimentSummary((await getExperiment(running.id))!);
    // Far below the minimum sample — the engine refuses to name a winner.
    expect(first.readout.state).toBe("RUNNING");
    expect(first.readout.winner).toBeNull();
    expect(JSON.stringify(first.readout)).toBe(JSON.stringify(second.readout));
    expect(first.arms.map((a) => a.exposedSessions)).toEqual([6, 6]);
  });

  it("reports INVALID when a stored experiment's target disappears", async () => {
    const running = await launch(await makeDraft());
    const db = await getDb();
    // Simulate a registry change: the stored target no longer exists.
    await db.update(experiments).set({ targetKey: "gone.target" }).where(eq(experiments.id, running.id));
    const reloaded = (await getExperiment(running.id))!;
    expect(validateStoredExperiment(reloaded).ok).toBe(false);
    const summary = await buildExperimentSummary(reloaded);
    expect(summary.readout.state).toBe("INVALID");
    expect(summary.readout.winner).toBeNull();
  });
});
