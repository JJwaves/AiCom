import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { approvals } from "@/db/schema";
import { AiRuntime, FakeAiProvider } from "@/lib/ai";
import {
  buildPricingContext,
  generatePricingReview,
  pricingRecommendationIdentityKey,
} from "@/lib/ai/agents/pricing";
import type { PricingRecommendation } from "@/lib/ai/agents/pricing/schema";
import { listActions, syncDecisionsToActions } from "@/lib/data/agent-action-service";
import { listDecisions, reviewApproval } from "@/lib/data/agent-service";
import { listPricingReports } from "@/lib/data/pricing-report-service";
import { buildPricingIntelligenceSnapshot, periodFromDays } from "@/modules/pricing-intelligence";
import { makeSession, resetDb } from "./db-helpers";
import { seedClassification, seedConversation } from "./ci-helpers";
import { HERO, seedConfiguredQuantity, seedPricingSession } from "./pi-helpers";

/**
 * Session 12 — the Pricing Intelligence Agent.
 *
 * Server-side reference validation, catalog/tier scope validation,
 * deterministic prerequisite override, the closed recommendation taxonomy,
 * Action Center integration, and fail-safe behaviour when the provider or
 * the budget says no.
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
  setEnv("AI_PRICING_AGENT_ENABLED", "true");
  setEnv("PRICING_INTELLIGENCE_ENABLED", "true");
});

const period7 = () => periodFromDays(7, new Date(Date.now() + 60_000));
const output = (value: unknown) => ({ kind: "text" as const, text: JSON.stringify(value) });

const recommendation = (over: Partial<PricingRecommendation> = {}): PricingRecommendation =>
  ({
    title: "Review the 5,000-unit tier",
    observation: "Qualified conversations attributed to the 5,000-unit band said the price was too high.",
    recommendation: "Look at the 5,000-unit tier and decide whether the level is right for this market.",
    recommendationType: "PRICING_REVIEW",
    productId: HERO.id,
    quantityTier: 5000,
    metricRefs: ["pricing.conversations.priceObjection"],
    evidenceRefs: [],
    confidence: "MEDIUM",
    risk: "MEDIUM",
    limitations: ["Only customers who opened the chat are represented."],
    requiresCostConfiguration: false,
    requiresExperiment: false,
    ...over,
  }) as PricingRecommendation;

const review = (recommendations: PricingRecommendation[], signals: { signalId: string; note: string }[] = []) => ({
  executiveSummary: "Price objections cluster in the largest quantity band.",
  signals,
  recommendations,
  openQuestions: [],
});

/** Enough real evidence for the deterministic layer to emit signals. */
async function seedPricingEvidence(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    const s = await makeSession();
    await seedPricingSession(s.id, { quantity: 5000, cart: i < 2 });
    await seedConfiguredQuantity(s.id, 5000);
    const { conversation, messages } = await seedConversation(s.id, ["That is too expensive."]);
    await seedClassification(conversation.id, {
      objections: [{ type: "PRICE_TOO_HIGH", messageId: messages[0].id }],
    });
  }
}

/* ------------------------------------------------------------------ */
/* Context (spec §24, §33)                                             */
/* ------------------------------------------------------------------ */

describe("pricing context", () => {
  it("offers deterministic numbers and nothing else to cite", async () => {
    await seedPricingEvidence();
    const context = buildPricingContext(await buildPricingIntelligenceSnapshot(period7()));

    expect(context.validMetricRefs.has("pricing.conversations.priceObjection")).toBe(true);
    expect(context.validMetricRefs.has("pricing.funnel.priceViewSessions")).toBe(true);
    expect(context.validTiersByProduct.get(HERO.id)?.has(5000)).toBe(true);
    expect(context.text).toContain("NOT ESTIMABLE");
    expect(context.text).toMatch(/QUESTION.*OBJECTION|question, not resistance/i);
    expect(context.text).toMatch(/You cannot propose a price/);
    // Cost truth is stated before anything else can be recommended.
    expect(context.text).toMatch(/Manufacturing cost model configured: NO/);
    // No PII leaks into the model context.
    expect(context.text).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it("prints the three quantity lanes separately", async () => {
    await seedPricingEvidence();
    const context = buildPricingContext(await buildPricingIntelligenceSnapshot(period7()));
    expect(context.text).toMatch(/THREE QUANTITY LANES — never merge these/);
    expect(context.text).toMatch(/requested \d+ \(\d+ stated \/ \d+ inferred\), configured \d+, purchased \d+/);
  });
});

/* ------------------------------------------------------------------ */
/* Happy path + validation                                             */
/* ------------------------------------------------------------------ */

describe("generatePricingReview", () => {
  it("persists a report and a pending decision, and changes no price", async () => {
    await seedPricingEvidence();
    const fake = new FakeAiProvider([output(review([recommendation()]))]);
    const result = await generatePricingReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.created).toBe(1);
    expect(result.droppedInvalid).toBe(0);

    const decisions = await listDecisions("pricing");
    expect(decisions).toHaveLength(1);
    const d = decisions[0];
    expect(d.decisionType).toBe("pricing_recommendation");
    expect(d.approvalRequired).toBe(true);
    expect(d.approvalStatus).toBe("pending");
    expect(d.executionStatus).toBe("none");

    const support = d.supportingDataJson as Record<string, unknown>;
    expect(support.recommendationType).toBe("PRICING_REVIEW");
    expect(support.actionType).toBe("PRICING_REVIEW");
    // Nothing anywhere in the persisted decision proposes a price.
    expect(JSON.stringify(d)).not.toMatch(/proposedUnitPriceCents|newPriceCents|discountPct/);

    const reports = await listPricingReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].promptId).toBe("ai_pricing_intelligence_review");
    expect(reports[0].decisionIdsJson).toEqual([d.id]);
    // The exact snapshot the model saw is preserved for audit.
    expect((reports[0].snapshotJson as { elasticity: { estimable: boolean } }).elasticity.estimable).toBe(false);
  });

  it("makes ONE structured call with no tools", async () => {
    await seedPricingEvidence();
    const fake = new FakeAiProvider([output(review([]))]);
    await generatePricingReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].method).toBe("generateStructured");
    expect("tools" in fake.requests[0].request && (fake.requests[0].request as { tools?: unknown }).tools).toBeFalsy();
  });

  it("drops a recommendation citing a metric the context never offered (spec §40)", async () => {
    await seedPricingEvidence();
    const fake = new FakeAiProvider([
      output(
        review([
          recommendation({ title: "Fabricated", metricRefs: ["pricing.customers.complained_23"] }),
          recommendation({ title: "Grounded" }),
        ]),
      ),
    ]);
    const result = await generatePricingReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.droppedInvalid).toBe(1);
    expect(result.dropReasons.join(" ")).toMatch(/no valid metric reference/);
    const decisions = await listDecisions("pricing");
    expect(decisions).toHaveLength(1);
    expect((decisions[0].supportingDataJson as { title: string }).title).toBe("Grounded");
  });

  it("filters fabricated evidence ids instead of trusting them", async () => {
    await seedPricingEvidence();
    const fake = new FakeAiProvider([output(review([recommendation({ evidenceRefs: ["ins_invented"] })]))]);
    const result = await generatePricingReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.droppedReferences).toBeGreaterThan(0);
    const params = ((await listDecisions("pricing"))[0].proposedActionJson as { params: Record<string, unknown> }).params;
    expect(params.evidenceRefs).toEqual([]);
  });

  it("removes a productId that is not in the catalog", async () => {
    await seedPricingEvidence();
    const fake = new FakeAiProvider([output(review([recommendation({ productId: "p-invented", quantityTier: 5000 })]))]);
    const result = await generatePricingReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.review.recommendations[0].productId).toBeNull();
    expect(result.review.recommendations[0].quantityTier).toBeNull();
    expect(result.dropReasons.join(" ")).toMatch(/unknown productId/);
  });

  it("removes a quantityTier that is not a real tier of that product", async () => {
    await seedPricingEvidence();
    const fake = new FakeAiProvider([output(review([recommendation({ quantityTier: 4321 })]))]);
    const result = await generatePricingReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.review.recommendations[0].productId).toBe(HERO.id);
    expect(result.review.recommendations[0].quantityTier).toBeNull();
  });

  it("drops a signal note pointing at a signal the context never printed", async () => {
    await seedPricingEvidence();
    const fake = new FakeAiProvider([
      output(review([recommendation()], [{ signalId: "PRICE_OBJECTION:invented", note: "Made up." }])),
    ]);
    const result = await generatePricingReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.review.signals).toHaveLength(0);
  });

  it("OVERRIDES the model's cost/experiment prerequisites with the deterministic answer", async () => {
    await seedPricingEvidence();
    const fake = new FakeAiProvider([
      output(
        review([
          // The model claims a price review needs no cost data and no test.
          recommendation({ requiresCostConfiguration: false, requiresExperiment: false }),
          recommendation({
            title: "Consider a price test later",
            recommendationType: "PRICE_EXPERIMENT_REVIEW",
            requiresExperiment: false,
          }),
        ]),
      ),
    ]);
    const result = await generatePricingReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    if (result.status !== "completed") throw new Error("unreachable");
    // Costs are unconfigured, so the server says a price review depends on them.
    expect(result.review.recommendations[0].requiresCostConfiguration).toBe(true);
    expect(result.review.recommendations[1].requiresExperiment).toBe(true);
  });

  it("cannot express a specific price change at all (spec §26)", async () => {
    await seedPricingEvidence();
    const fake = new FakeAiProvider([
      output(
        review([
          {
            ...recommendation({ title: "Lower price from $0.42 to $0.37" }),
            // A model trying to smuggle a price in.
            proposedUnitPriceCents: 37,
          } as unknown as PricingRecommendation,
        ]),
      ),
    ]);
    const result = await generatePricingReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    if (result.status !== "completed") throw new Error("unreachable");
    // The extra key is stripped by the schema and never reaches persistence.
    expect(JSON.stringify(result.review)).not.toMatch(/proposedUnitPriceCents/);
    expect(JSON.stringify(await listDecisions("pricing"))).not.toMatch(/proposedUnitPriceCents/);
  });

  it("rejects an invented recommendation type — the enum is closed", async () => {
    await seedPricingEvidence();
    const fake = new FakeAiProvider([
      output(
        review([
          { ...recommendation(), recommendationType: "SET_PRICE" } as unknown as PricingRecommendation,
        ]),
      ),
    ]);
    // The whole response fails OUR schema: the runtime retries once, then fails.
    const result = await generatePricingReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    expect(result.status).toBe("failed");
    expect(await listDecisions("pricing")).toHaveLength(0);
    expect(await listPricingReports()).toHaveLength(0);
  });

  it("requires at least one limitation on every recommendation", async () => {
    await seedPricingEvidence();
    const fake = new FakeAiProvider([
      output(review([{ ...recommendation(), limitations: [] } as unknown as PricingRecommendation])),
    ]);
    const result = await generatePricingReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    expect(result.status).toBe("failed");
  });
});

/* ------------------------------------------------------------------ */
/* Dedup                                                               */
/* ------------------------------------------------------------------ */

describe("deduplication", () => {
  it("refreshes a pending recommendation in place instead of duplicating", async () => {
    await seedPricingEvidence();
    const run = () =>
      generatePricingReview({
        runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([recommendation()]))]) }),
        period: period7(),
      });
    await run();
    const second = await run();
    if (second.status !== "completed") throw new Error("unreachable");
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);
    expect(await listDecisions("pricing")).toHaveLength(1);
  });

  it("freezes a human verdict — regeneration never overwrites it", async () => {
    await seedPricingEvidence();
    const first = await generatePricingReview({
      runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([recommendation()]))]) }),
      period: period7(),
    });
    if (first.status !== "completed") throw new Error("unreachable");
    const db = await getDb();
    const [approval] = await db.select().from(approvals).where(eq(approvals.decisionId, first.decisions[0].id));
    await reviewApproval({ approvalId: approval.id, status: "rejected", reviewedBy: "owner" });

    const second = await generatePricingReview({
      runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([recommendation()]))]) }),
      period: period7(),
    });
    if (second.status !== "completed") throw new Error("unreachable");
    expect(second.skippedReviewed).toBe(1);
    expect((await listDecisions("pricing"))[0].approvalStatus).toBe("rejected");
  });

  it("keys identity on type + scope + evidence + period", () => {
    expect(pricingRecommendationIdentityKey(recommendation(), 7)).toBe(
      `PRICING:PRICING_REVIEW:${HERO.id}:5000:pricing.conversations.priceObjection:7d`,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Action Center integration (spec §27–§29)                            */
/* ------------------------------------------------------------------ */

describe("Action Center integration", () => {
  it("becomes a guardrail-evaluated PRICING_REVIEW awaiting human approval, executing nothing", async () => {
    await seedPricingEvidence();
    await generatePricingReview({
      runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([recommendation()]))]) }),
      period: period7(),
    });
    const sync = await syncDecisionsToActions("test");
    expect(sync.created).toBe(1);
    expect(sync.blocked).toBe(0);

    const actions = await listActions({});
    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe("PRICING_REVIEW");
    expect(actions[0].sourceAgent).toBe("PRICING_AGENT");
    expect(actions[0].status).toBe("PENDING_APPROVAL");
    expect(actions[0].executionStatus).toBe("NOT_APPLICABLE");
  });

  it("maps every recommendation type to a review-only action, never to PRICE_CHANGE", async () => {
    await seedPricingEvidence();
    await generatePricingReview({
      runtime: new AiRuntime({
        provider: new FakeAiProvider([
          output(
            review([
              recommendation({ title: "A", recommendationType: "PRICING_REVIEW" }),
              recommendation({ title: "B", recommendationType: "TIER_STRUCTURE_REVIEW" }),
              recommendation({ title: "C", recommendationType: "PRICE_PRESENTATION_REVIEW" }),
              recommendation({ title: "D", recommendationType: "PRICE_EXPERIMENT_REVIEW" }),
              recommendation({ title: "E", recommendationType: "MOQ_REVIEW" }),
              recommendation({ title: "F", recommendationType: "DATA_QUALITY" }),
            ]),
          ),
        ]),
      }),
      period: period7(),
    });
    await syncDecisionsToActions("test");
    const types = (await listActions({})).map((a) => a.actionType).sort();
    expect(types).toEqual([
      "DATA_QUALITY_REVIEW",
      "MOQ_REVIEW",
      "PRICING_REVIEW",
      "PRICING_REVIEW",
      "PRICING_REVIEW",
      "PRICING_REVIEW",
    ]);
    expect(types).not.toContain("PRICE_CHANGE");
    expect(types).not.toContain("PRICE_EXPERIMENT");
  });

  it("records every proposal as review-only with nothing execution-eligible", async () => {
    await seedPricingEvidence();
    await generatePricingReview({
      runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([recommendation()]))]) }),
      period: period7(),
    });
    await syncDecisionsToActions("test");
    const actions = await listActions({});
    expect(actions[0].executionStatus).toBe("NOT_APPLICABLE");
    expect(actions[0].riskLevel).toBe("LOW");
  });
});

/* ------------------------------------------------------------------ */
/* Fail-safe behaviour (spec §41–§42)                                  */
/* ------------------------------------------------------------------ */

describe("failure is failure — never a fabricated review", () => {
  it("persists nothing when the provider errors, and leaves the previous review visible", async () => {
    await seedPricingEvidence();
    await generatePricingReview({
      runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([recommendation()]))]) }),
      period: period7(),
    });
    const before = await listPricingReports();

    const failing = new FakeAiProvider([{ kind: "error", code: "AI_PROVIDER_UNAVAILABLE" }]);
    const result = await generatePricingReview({ runtime: new AiRuntime({ provider: failing }), period: period7() });
    expect(result.status).toBe("failed");

    const after = await listPricingReports();
    expect(after).toHaveLength(before.length);
    expect(after[0].id).toBe(before[0].id);
  });

  it("is unavailable (and writes nothing) when the flag is off", async () => {
    await seedPricingEvidence();
    delete process.env.AI_PRICING_AGENT_ENABLED;
    const result = await generatePricingReview({
      runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([recommendation()]))]) }),
      period: period7(),
    });
    expect(result).toEqual({ status: "unavailable", reason: "AI_DISABLED" });
    expect(await listDecisions("pricing")).toHaveLength(0);
    expect(await listPricingReports()).toHaveLength(0);
  });

  it("refuses when the AI budget is exceeded, persisting nothing", async () => {
    await seedPricingEvidence();
    setEnv("AI_DAILY_BUDGET_USD", "0.0000001");
    setEnv("AI_MONTHLY_BUDGET_USD", "0.0000001");
    const result = await generatePricingReview({
      runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([recommendation()]))]) }),
      period: period7(),
    });
    expect(result.status).toBe("failed");
    expect(await listPricingReports()).toHaveLength(0);
  });
});
