import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiRuntime, FakeAiProvider } from "@/lib/ai";
import { buildCroContext, croProposalIdentityKey, generateCroReview } from "@/lib/ai/agents/cro";
import type { CroProposal } from "@/lib/ai/agents/cro/schema";
import { listDecisions, reviewApproval } from "@/lib/data/agent-service";
import { listActions, syncDecisionsToActions } from "@/lib/data/agent-action-service";
import { recordServerEvent } from "@/lib/data/event-service";
import { createInsight } from "@/lib/data/insight-service";
import { buildBusinessHealthSnapshot, loadFunnelDropOff, periodFromDays } from "@/modules/business-intelligence";
import { getDb } from "@/db/client";
import { approvals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { makeSession, resetDb } from "./db-helpers";
import { seedConversation } from "./ci-helpers";

/**
 * Session 11 — the CRO Agent: closed-target validation, server-side
 * reference validation, traffic and sample clamping, the EXPERIMENT vs
 * REVIEW distinction, Action Center integration, and fail-safe behaviour
 * when the provider or the budget says no.
 *
 * FakeAiProvider only — no credentials, no network, no real model call.
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
  setEnv("AI_RUNTIME_ENABLED", "true");
  setEnv("AI_CRO_AGENT_ENABLED", "true");
  setEnv("EXPERIMENT_ENGINE_ENABLED", "true");
});

const period7 = () => periodFromDays(7, new Date(Date.now() + 60_000));
const output = (value: unknown) => ({ kind: "text" as const, text: JSON.stringify(value) });

const proposal = (over: Partial<CroProposal> = {}): CroProposal =>
  ({
    kind: "EXPERIMENT",
    title: "Set production expectations near Add to cart",
    observation: "Sessions that viewed a price did not continue to the cart at the observed rate.",
    hypothesis: "Showing when production starts may reduce uncertainty before adding to cart.",
    targetKey: "product.shipping_message",
    experimentType: "SHIPPING_MESSAGE",
    variantSummary: "A one-line production expectation above the button.",
    variantConfig: { message: "Production starts once you approve your artwork proof.", placement: "above_cta" },
    primaryMetric: "add_to_cart",
    secondaryMetrics: [],
    guardrailMetrics: ["purchase_completed"],
    proposedTrafficPct: 50,
    minimumSampleSize: null,
    supportingMetricRefs: ["funnel.surface.price_viewed"],
    evidenceRefs: [],
    expectedImpact: null,
    confidence: "MEDIUM",
    riskLevel: "LOW",
    limitations: ["Small sample in this period."],
    ...over,
  }) as CroProposal;

const review = (proposals: CroProposal[]) => ({
  summary: "Most sessions that see a price do not reach the cart.",
  frictionObservations: ["Price view to cart is the largest observed drop."],
  proposals,
  experimentNotes: [],
});

async function seedTraffic(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    const s = await makeSession();
    await recordServerEvent({ sessionId: s.id, name: "product_viewed" });
    await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
    if (i < 2) await recordServerEvent({ sessionId: s.id, name: "add_to_cart" });
  }
  const s = await makeSession();
  await seedConversation(s.id, ["How long does production take?"]);
}

/* ------------------------------------------------------------------ */
/* Context (spec §23)                                                  */
/* ------------------------------------------------------------------ */

describe("CRO context", () => {
  it("offers deterministic numbers, the closed target list, and nothing else to cite", async () => {
    await seedTraffic();
    const insight = await createInsight({
      insightType: "SHIPPING_SIGNAL",
      title: "Delivery timing questions",
      sourceRefs: [{ table: "conversations", id: "conv_x" }],
      evidenceCount: 3,
    });
    const period = period7();
    const context = buildCroContext({
      snapshot: await buildBusinessHealthSnapshot(period),
      dropOff: await loadFunnelDropOff(period),
      experiments: [],
    });

    expect(context.validMetricRefs.has("funnel.surface.price_viewed")).toBe(true);
    expect(context.validMetricRefs.has("dropoff.price_viewed_to_add_to_cart")).toBe(true);
    expect(context.validEvidenceRefs.has(insight.id)).toBe(true);
    expect(context.text).toContain("targetKey=product.shipping_message");
    expect(context.text).toContain("targetKey=homepage.hero");
    // Protected surfaces are named as refusals, never offered as targets.
    expect(context.text).not.toContain("targetKey=checkout");
    expect(context.text).toMatch(/never be experimented on/);
    // No PII leaks into the model context.
    expect(context.text).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});

/* ------------------------------------------------------------------ */
/* Happy path + boundaries (spec §21–§22)                              */
/* ------------------------------------------------------------------ */

describe("generateCroReview", () => {
  it("persists a pending AgentDecision with a fully validated design and launches nothing", async () => {
    await seedTraffic();
    const fake = new FakeAiProvider([output(review([proposal()]))]);
    const result = await generateCroReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.created).toBe(1);
    expect(result.droppedInvalid).toBe(0);

    const decisions = await listDecisions("cro");
    expect(decisions).toHaveLength(1);
    const d = decisions[0];
    expect(d.decisionType).toBe("cro_experiment_proposal");
    expect(d.approvalRequired).toBe(true);
    expect(d.approvalStatus).toBe("pending");
    expect(d.executionStatus).toBe("none");

    const design = (d.supportingDataJson as { design?: Record<string, unknown> }).design!;
    expect(design.targetKey).toBe("product.shipping_message");
    expect(design.allocation).toEqual([
      { variant: "control", pct: 50 },
      { variant: "variant_b", pct: 50 },
    ]);
    // The agent never chose the audience or the sample floor — the server did.
    expect(design.audience).toMatchObject({ routes: ["/products/"], device: "any", visitor: "any" });
    expect(design.minimumSampleSize).toBe(1000);
  });

  it("makes ONE structured call with no tools", async () => {
    await seedTraffic();
    const fake = new FakeAiProvider([output(review([]))]);
    await generateCroReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].method).toBe("generateStructured");
    expect("tools" in fake.requests[0].request && (fake.requests[0].request as { tools?: unknown }).tools).toBeFalsy();
  });

  it("drops a proposal that cites a metric the context never offered", async () => {
    await seedTraffic();
    const fake = new FakeAiProvider([
      output(review([proposal({ supportingMetricRefs: ["profits.secret_total"] }), proposal({ title: "Valid" })])),
    ]);
    const result = await generateCroReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.droppedInvalid).toBe(1);
    expect(await listDecisions("cro")).toHaveLength(1);
  });

  it("filters fabricated evidence ids instead of trusting them", async () => {
    await seedTraffic();
    const fake = new FakeAiProvider([output(review([proposal({ evidenceRefs: ["ins_made_up"] })]))]);
    const result = await generateCroReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    if (result.status !== "completed") throw new Error("unreachable");
    const decisions = await listDecisions("cro");
    const params = (decisions[0].proposedActionJson as { params: Record<string, unknown> }).params;
    expect(params.evidenceRefs).toEqual([]);
  });

  it("drops a proposal naming a target outside the registry", async () => {
    await seedTraffic();
    const fake = new FakeAiProvider([output(review([proposal({ targetKey: "checkout.payment_form" })]))]);
    const result = await generateCroReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.droppedInvalid).toBe(1);
    expect(result.dropReasons.join(" ")).toMatch(/unknown experiment target/i);
    expect(await listDecisions("cro")).toHaveLength(0);
  });

  it("drops a proposal whose variant copy contains markup or script", async () => {
    await seedTraffic();
    const fake = new FakeAiProvider([
      output(
        review([
          proposal({
            variantConfig: { message: "<script>fetch('/steal')</script>", placement: "above_cta" },
          }),
        ]),
      ),
    ]);
    const result = await generateCroReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.droppedInvalid).toBe(1);
    expect(await listDecisions("cro")).toHaveLength(0);
  });

  it("drops a proposal whose variant config carries an unknown field", async () => {
    await seedTraffic();
    const fake = new FakeAiProvider([
      output(review([proposal({ variantConfig: { message: "Ships fast.", component: "app/page.tsx" } })])),
    ]);
    const result = await generateCroReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.droppedInvalid).toBe(1);
  });

  it("clamps a greedy traffic request to the effective ceiling", async () => {
    await seedTraffic();
    const fake = new FakeAiProvider([output(review([proposal({ proposedTrafficPct: 100 })]))]);
    const result = await generateCroReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    if (result.status !== "completed") throw new Error("unreachable");
    const design = ((await listDecisions("cro"))[0].supportingDataJson as { design: Record<string, unknown> }).design;
    expect(design.allocation).toEqual([
      { variant: "control", pct: 50 },
      { variant: "variant_b", pct: 50 },
    ]);
  });

  it("never lets the model lower the minimum sample floor", async () => {
    await seedTraffic();
    const fake = new FakeAiProvider([output(review([proposal({ minimumSampleSize: 10 })]))]);
    await generateCroReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    const design = ((await listDecisions("cro"))[0].supportingDataJson as { design: Record<string, unknown> }).design;
    expect(design.minimumSampleSize).toBe(1000);
  });

  it("routes a business/product problem to a REVIEW, not a 'hide the objection' experiment", async () => {
    await seedTraffic();
    const fake = new FakeAiProvider([
      output(
        review([
          proposal({
            kind: "REVIEW",
            title: "Minimum order quantity looks like a real barrier",
            targetKey: null,
            experimentType: null,
            primaryMetric: null,
            variantConfig: null,
            proposedTrafficPct: null,
          }),
        ]),
      ),
    ]);
    const result = await generateCroReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.created).toBe(1);
    const decisions = await listDecisions("cro");
    expect(decisions[0].decisionType).toBe("cro_review");
    expect((decisions[0].supportingDataJson as { design?: unknown }).design).toBeNull();
  });

  it("refuses a price experiment — the schema has no such experiment type", async () => {
    await seedTraffic();
    const fake = new FakeAiProvider([
      output(review([proposal({ experimentType: "PRICE_EXPERIMENT" as CroProposal["experimentType"] })])),
    ]);
    // The whole response fails OUR schema, so the runtime retries once and
    // then raises AI_INVALID_RESPONSE — nothing is persisted.
    const result = await generateCroReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    expect(result.status).toBe("failed");
    expect(await listDecisions("cro")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Dedup (spec §24)                                                    */
/* ------------------------------------------------------------------ */

describe("deduplication", () => {
  it("refreshes a pending proposal in place instead of duplicating", async () => {
    await seedTraffic();
    const run = () =>
      generateCroReview({
        runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([proposal()]))]) }),
        period: period7(),
      });
    await run();
    const second = await run();
    if (second.status !== "completed") throw new Error("unreachable");
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);
    expect(await listDecisions("cro")).toHaveLength(1);
  });

  it("freezes a human verdict — regeneration never overwrites it", async () => {
    await seedTraffic();
    const first = await generateCroReview({
      runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([proposal()]))]) }),
      period: period7(),
    });
    if (first.status !== "completed") throw new Error("unreachable");
    const db = await getDb();
    const [approval] = await db.select().from(approvals).where(eq(approvals.decisionId, first.decisions[0].id));
    await reviewApproval({ approvalId: approval.id, status: "rejected", reviewedBy: "owner" });

    const second = await generateCroReview({
      runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([proposal()]))]) }),
      period: period7(),
    });
    if (second.status !== "completed") throw new Error("unreachable");
    expect(second.skippedReviewed).toBe(1);
    expect((await listDecisions("cro"))[0].approvalStatus).toBe("rejected");
  });

  it("keys identity on kind + target + evidence + period", () => {
    const key = croProposalIdentityKey(proposal(), 7);
    expect(key).toBe("CRO:EXPERIMENT:product.shipping_message:funnel.surface.price_viewed:7d");
  });
});

/* ------------------------------------------------------------------ */
/* Action Center integration (spec §24–§25)                            */
/* ------------------------------------------------------------------ */

describe("Action Center integration", () => {
  it("becomes a guardrail-evaluated CRO_EXPERIMENT_PROPOSAL awaiting human approval", async () => {
    await seedTraffic();
    await generateCroReview({
      runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([proposal()]))]) }),
      period: period7(),
    });
    const sync = await syncDecisionsToActions("admin:owner");
    expect(sync.created).toBe(1);

    const [action] = await listActions({});
    expect(action.sourceAgent).toBe("CRO_AGENT");
    expect(action.actionType).toBe("CRO_EXPERIMENT_PROPOSAL");
    expect(action.status).toBe("PENDING_APPROVAL");
    expect(action.riskLevel).toBe("LOW");
    // Review-only: approving records a decision; there is nothing to execute.
    expect(action.executionStatus).toBe("NOT_APPLICABLE");
    const payload = action.payloadJson as Record<string, unknown>;
    expect((payload.design as Record<string, unknown>).targetKey).toBe("product.shipping_message");
  });

  it("maps a CRO REVIEW proposal to CRO_REVIEW, never to an experiment", async () => {
    await seedTraffic();
    await generateCroReview({
      runtime: new AiRuntime({
        provider: new FakeAiProvider([
          output(
            review([
              proposal({
                kind: "REVIEW",
                title: "MOQ may be a real barrier",
                targetKey: null,
                experimentType: null,
                primaryMetric: null,
                variantConfig: null,
                proposedTrafficPct: null,
              }),
            ]),
          ),
        ]),
      }),
      period: period7(),
    });
    await syncDecisionsToActions("admin:owner");
    const [action] = await listActions({});
    expect(action.actionType).toBe("CRO_REVIEW");
  });

  it("is idempotent — re-running sync creates nothing new", async () => {
    await seedTraffic();
    await generateCroReview({
      runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([proposal()]))]) }),
      period: period7(),
    });
    await syncDecisionsToActions("admin:owner");
    const second = await syncDecisionsToActions("admin:owner");
    expect(second.created).toBe(0);
    expect(second.skippedExisting).toBe(1);
    expect(await listActions({})).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Failure modes (spec §47–§48)                                        */
/* ------------------------------------------------------------------ */

describe("failure is failure", () => {
  it("persists NOTHING when the provider is down", async () => {
    await seedTraffic();
    const fake = new FakeAiProvider([{ kind: "error", code: "AI_PROVIDER_UNAVAILABLE" }]);
    const result = await generateCroReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.errorCode).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(await listDecisions("cro")).toHaveLength(0);
  });

  it("persists NOTHING when the AI budget is exceeded", async () => {
    await seedTraffic();
    const fake = new FakeAiProvider([{ kind: "error", code: "AI_BUDGET_EXCEEDED" }]);
    const result = await generateCroReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    expect(result.status).toBe("failed");
    expect(await listDecisions("cro")).toHaveLength(0);
  });

  it("is unavailable — and silent — while the flag is off", async () => {
    delete process.env.AI_CRO_AGENT_ENABLED;
    const result = await generateCroReview({ period: period7() });
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.reason).toBe("AI_DISABLED");
    expect(await listDecisions("cro")).toHaveLength(0);
  });
});
