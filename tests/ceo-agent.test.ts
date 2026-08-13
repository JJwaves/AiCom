import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { approvals } from "@/db/schema";
import { AiRuntime, FakeAiProvider } from "@/lib/ai";
import { buildCeoContext, generateCeoReview, recommendationIdentityKey } from "@/lib/ai/agents/ceo";
import type { CeoRecommendation } from "@/lib/ai/agents/ceo/schema";
import { listDecisions, reviewApproval } from "@/lib/data/agent-service";
import { getLatestCeoReport, listCeoReports } from "@/lib/data/ceo-report-service";
import { applyNeedProfileUpdate } from "@/lib/data/customer-need-service";
import { recordServerEvent } from "@/lib/data/event-service";
import { createInsight } from "@/lib/data/insight-service";
import { createOrder } from "@/lib/data/order-service";
import { buildBusinessHealthSnapshot, periodFromDays } from "@/modules/business-intelligence";
import { makeSession, resetDb } from "./db-helpers";
import { seedConversation } from "./ci-helpers";

/**
 * Session 09 — CEO Recommendation Agent: structured output validation,
 * server-side metric/evidence reference validation, stable-identity dedup,
 * AgentDecision + ceo_reports persistence, fail-safe budget/provider
 * behavior, privacy-safe context, and the structural absence of any
 * execution path. FakeAiProvider only — no credentials, no network.
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
  setEnv("AI_BUSINESS_INTELLIGENCE_ENABLED", "true");
});

// End the window slightly in the future: DB rows are stamped with microsecond
// precision, so a same-millisecond JS Date can exclude a just-created row.
const period7 = () => periodFromDays(7, new Date(Date.now() + 60_000));

const output = (value: unknown) => ({ kind: "text" as const, text: JSON.stringify(value) });

const recommendation = (over: Partial<CeoRecommendation> = {}): CeoRecommendation => ({
  title: "Review MOQ-related friction",
  observation: "MOQ questions appear in qualified conversations while order volume is low.",
  recommendation: "Consider reviewing whether MOQ guidance on product pages answers the common questions.",
  supportingMetricRefs: ["commerce.orders"],
  evidenceRefs: [],
  confidence: "MEDIUM",
  riskLevel: "LOW",
  actionCategory: "CUSTOMER_EXPERIENCE",
  limitations: ["Small sample in this period."],
  ...over,
});

const review = (recs: CeoRecommendation[]) => ({
  executiveSummary: "Quiet period with limited but clean data.",
  highlights: ["Orders were recorded without data issues."],
  concerns: ["Sample sizes are small."],
  opportunities: ["MOQ guidance may deserve review."],
  recommendations: recs,
});

async function seedBusiness(): Promise<void> {
  const s = await makeSession();
  await seedConversation(s.id, ["What is your MOQ?"]);
  await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
  await createOrder({
    sessionId: s.id,
    provider: "mock",
    currency: "USD",
    lines: [
      {
        productId: "p-custom-takeout",
        quantity: 1000,
        unitPriceCents: 54,
        totalCents: 54_000,
        title: "Bags",
        config: {
          productId: "p-custom-takeout",
          sizeId: "l",
          materialId: "standard",
          colorId: "black",
          printOptionId: "one-color",
          quantity: 1000,
          artwork: null,
        },
      },
    ],
  });
}

describe("generateCeoReview — happy path", () => {
  it("persists a versioned report and pending AgentDecision rows; nothing is executed", async () => {
    await seedBusiness();
    const insight = await createInsight({
      insightType: "MOQ_SIGNAL",
      title: "MOQ concerns in 3 conversations",
      sourceRefs: [{ table: "conversations", id: "conv_x" }],
      evidenceCount: 3,
    });

    const fake = new FakeAiProvider([output(review([recommendation({ evidenceRefs: [insight.id] })]))]);
    const result = await generateCeoReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.created).toBe(1);
    expect(result.droppedInvalid).toBe(0);

    // Report row: period + prompt version + linked decisions + the snapshot it saw.
    const report = await getLatestCeoReport(7);
    expect(report).not.toBeNull();
    expect(report!.promptId).toBe("ai_ceo_business_review");
    expect(report!.promptVersion).toBe("1.0.0");
    expect(report!.decisionIdsJson).toHaveLength(1);
    expect(report!.snapshotJson).toHaveProperty("commerce");

    // Decision row: recommendation-only audit record awaiting human review.
    const decisions = await listDecisions("ceo");
    expect(decisions).toHaveLength(1);
    const d = decisions[0];
    expect(d.decisionType).toBe("ceo_recommendation");
    expect(d.approvalRequired).toBe(true);
    expect(d.approvalStatus).toBe("pending");
    expect(d.executionStatus).toBe("none"); // nothing executes, ever
    expect(d.riskLevel).toBe("low");
    expect((d.supportingDataJson as Record<string, unknown>).confidence).toBe("MEDIUM");
    const params = (d.proposedActionJson as { params: Record<string, unknown> }).params;
    expect(params.evidenceRefs).toEqual([insight.id]);
    expect(params.identityKey).toBe(recommendationIdentityKey(recommendation({ evidenceRefs: [insight.id] }), 7));
  });

  it("sends the model a structured request with NO tools (the agent has no execution surface)", async () => {
    await seedBusiness();
    const fake = new FakeAiProvider([output(review([]))]);
    const result = await generateCeoReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    expect(result.status).toBe("completed");
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].method).toBe("generateStructured"); // never generateToolStep
    expect("tools" in fake.requests[0].request && (fake.requests[0].request as { tools?: unknown }).tools).toBeFalsy();
  });
});

describe("server-side reference validation (§36)", () => {
  it("drops recommendations whose metric refs were never offered, filters fabricated evidence ids", async () => {
    await seedBusiness();
    const fake = new FakeAiProvider([
      output(
        review([
          recommendation({ title: "Fabricated", supportingMetricRefs: ["profits.secret_total"] }),
          recommendation({ title: "Half valid", evidenceRefs: ["ins_fabricated_id"] }),
        ]),
      ),
    ]);
    const result = await generateCeoReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.droppedInvalid).toBe(1); // fabricated metric ref → dropped entirely
    const decisions = await listDecisions("ceo");
    expect(decisions).toHaveLength(1);
    const params = (decisions[0].proposedActionJson as { params: Record<string, unknown> }).params;
    expect(params.title).toBe("Half valid");
    expect(params.evidenceRefs).toEqual([]); // fabricated insight id filtered out
  });
});

describe("deduplication (§24)", () => {
  it("updates the pending decision on regeneration instead of duplicating", async () => {
    await seedBusiness();
    const run = () =>
      generateCeoReview({
        runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([recommendation()]))]) }),
        period: period7(),
      });
    const first = await run();
    const second = await run();
    expect(first.status).toBe("completed");
    expect(second.status).toBe("completed");
    if (second.status !== "completed") throw new Error("unreachable");
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);
    expect(await listDecisions("ceo")).toHaveLength(1);
    expect(await listCeoReports()).toHaveLength(2); // reports are append-only history
  });

  it("never overwrites a human-reviewed decision", async () => {
    await seedBusiness();
    const run = () =>
      generateCeoReview({
        runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([recommendation()]))]) }),
        period: period7(),
      });
    await run();
    const [decision] = await listDecisions("ceo");
    const db = await getDb();
    const [approval] = await db.select().from(approvals).where(eq(approvals.decisionId, decision.id));
    await reviewApproval({ approvalId: approval.id, status: "rejected", reviewedBy: "owner" });

    const again = await run();
    expect(again.status).toBe("completed");
    if (again.status !== "completed") throw new Error("unreachable");
    expect(again.created).toBe(0);
    expect(again.updated).toBe(0);
    expect(again.skippedReviewed).toBe(1);
    const [after] = await listDecisions("ceo");
    expect(after.approvalStatus).toBe("rejected"); // the human verdict stands
  });
});

describe("fail-safe behavior (§34–§35)", () => {
  it("budget exhaustion fails safely: no report, no decisions, deterministic BI untouched", async () => {
    await seedBusiness();
    const fake = new FakeAiProvider([{ kind: "error", code: "AI_BUDGET_EXCEEDED" }]);
    const result = await generateCeoReview({ runtime: new AiRuntime({ provider: fake }), period: period7() });
    expect(result).toEqual({ status: "failed", errorCode: "AI_BUDGET_EXCEEDED" });
    expect(await getLatestCeoReport(7)).toBeNull();
    expect(await listDecisions("ceo")).toHaveLength(0);
    // Deterministic metrics still compute with the provider dead.
    const snapshot = await buildBusinessHealthSnapshot(period7());
    expect(snapshot.commerce.revenue.orders).toEqual({ status: "AVAILABLE", value: 1 });
  });

  it("provider outage keeps the PREVIOUS report visible", async () => {
    await seedBusiness();
    const ok = await generateCeoReview({
      runtime: new AiRuntime({ provider: new FakeAiProvider([output(review([]))]) }),
      period: period7(),
    });
    expect(ok.status).toBe("completed");
    const failed = await generateCeoReview({
      runtime: new AiRuntime({ provider: new FakeAiProvider([{ kind: "error", code: "AI_PROVIDER_UNAVAILABLE" }]) }),
      period: period7(),
    });
    expect(failed.status).toBe("failed");
    expect(await getLatestCeoReport(7)).not.toBeNull(); // the old review remains
  });

  it("is unavailable with flags off — and never invents a narrative", async () => {
    delete process.env.AI_BUSINESS_INTELLIGENCE_ENABLED;
    const result = await generateCeoReview({ periodDays: 7 });
    expect(result).toEqual({ status: "unavailable", reason: "AI_DISABLED" });
    expect(await listCeoReports()).toHaveLength(0);
  });
});

describe("privacy-safe context (§44)", () => {
  it("the CEO context contains aggregates only — never emails, names, or raw messages", async () => {
    const s = await makeSession();
    await seedConversation(s.id, ["My email is jerry.secret@example.com and my name is Jerry Q. Human. What is your MOQ?"]);
    await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
    await applyNeedProfileUpdate(s.id, { businessType: "cafe", businessName: "Jerry Secret Ventures LLC" }, "USER_STATED");
    await createOrder({
      sessionId: s.id,
      provider: "mock",
      currency: "USD",
      lines: [
        {
          productId: "p-custom-takeout",
          quantity: 1000,
          unitPriceCents: 54,
          totalCents: 54_000,
          title: "Bags",
          config: {
            productId: "p-custom-takeout",
            sizeId: "l",
            materialId: "standard",
            colorId: "black",
            printOptionId: "one-color",
            quantity: 1000,
            artwork: { fileName: "jerry-family-logo.pdf", fileType: "application/pdf", fileSizeBytes: 100 },
          },
        },
      ],
    });

    const snapshot = await buildBusinessHealthSnapshot(period7());
    const context = buildCeoContext(snapshot);
    expect(context.text).not.toContain("jerry.secret@example.com");
    expect(context.text).not.toContain("Jerry Q. Human");
    expect(context.text).not.toContain("Jerry Secret Ventures");
    expect(context.text).not.toContain("jerry-family-logo"); // artwork names stay out
    expect(context.text).not.toContain("My email is"); // raw message content stays out
    // Aggregates ARE present.
    expect(context.text).toContain("commerce.orders");
    expect(context.validMetricRefs.has("commerce.orders")).toBe(true);
  });
});
