import { beforeEach, describe, expect, it } from "vitest";
import {
  getAgentConfig,
  getDecision,
  recordDecision,
  reviewApproval,
  setAgentConfig,
  setExecutionStatus,
} from "@/lib/data/agent-service";
import { aiUsageTotalsSince, listRecentAiUsage, recordAiUsage } from "@/lib/data/ai-usage-service";
import { createExperimentDraft, getAssignment, recordAssignment } from "@/lib/data/experiment-service";
import { createInsight, createOpportunity } from "@/lib/data/insight-service";
import { makeSession, resetDb } from "./db-helpers";

describe("AiUsage interface", () => {
  beforeEach(resetDb);

  it("records calls and aggregates spend for budget caps", async () => {
    await recordAiUsage({
      provider: "anthropic",
      model: "test-model",
      requestType: "chat",
      inputTokens: 1200,
      outputTokens: 300,
      estimatedCostMicros: 4500,
      latencyMs: 900,
      success: true,
    });
    await recordAiUsage({ provider: "anthropic", model: "test-model", requestType: "extraction", success: false, errorCode: "timeout" });

    const rows = await listRecentAiUsage();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => !r.success)?.errorCode).toBe("timeout");

    const totals = await aiUsageTotalsSince(new Date(Date.now() - 60_000));
    expect(totals).toEqual({ calls: 2, inputTokens: 1200, outputTokens: 300, estimatedCostMicros: 4500 });
  });

  it("aggregates totals past int4 range without overflowing (Session 03.5)", async () => {
    // Each row fits the int4 columns; the SUM must not be squeezed back into
    // int4 (the pre-hardening `::int` casts threw "integer out of range"
    // once a window's cost passed ~$2,147 in micro-dollars).
    const nearMax = 2_000_000_000; // < 2^31−1 per row
    for (let i = 0; i < 3; i++) {
      await recordAiUsage({
        provider: "anthropic",
        model: "test-model",
        requestType: "chat",
        inputTokens: nearMax,
        outputTokens: nearMax,
        estimatedCostMicros: nearMax,
        success: true,
      });
    }

    const totals = await aiUsageTotalsSince(new Date(Date.now() - 60_000));
    expect(totals.calls).toBe(3);
    expect(totals.inputTokens).toBe(6_000_000_000);
    expect(totals.outputTokens).toBe(6_000_000_000);
    expect(totals.estimatedCostMicros).toBe(6_000_000_000); // $6,000 — a plausible monthly window
    expect(Number.isSafeInteger(totals.estimatedCostMicros)).toBe(true);
  });

  it("returns zeroed totals for an empty window", async () => {
    const totals = await aiUsageTotalsSince(new Date(Date.now() - 60_000));
    expect(totals).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0 });
  });

  it("rejects invalid usage rows", async () => {
    await expect(
      recordAiUsage({ provider: "", model: "m", requestType: "chat", success: true }),
    ).rejects.toThrow();
    await expect(
      recordAiUsage({ provider: "p", model: "m", requestType: "chat", success: true, inputTokens: -1 }),
    ).rejects.toThrow();
  });
});

describe("AgentDecision + Approval audit trail", () => {
  beforeEach(resetDb);

  const proposal = {
    agentType: "pricing" as const,
    decisionType: "price_change_recommendation",
    observation: "Tier-3 conversion dropped 20% after the last price update.",
    reasoningSummary: "Recommend reverting the 10k tier to the prior price.",
    riskLevel: "medium" as const,
    confidence: 0.7,
    proposedAction: {
      agentType: "pricing" as const,
      actionType: "propose_tier_price",
      params: { productId: "p-1", tierMinQty: 10000, proposedUnitPriceCents: 38 },
    },
  };

  it("creates a pending approval with the decision and resolves it atomically", async () => {
    const { decision, approval } = await recordDecision(proposal);
    expect(decision.approvalStatus).toBe("pending");
    expect(decision.executionStatus).toBe("none");
    expect(approval?.status).toBe("pending");
    expect(approval?.decisionId).toBe(decision.id);

    await reviewApproval({
      approvalId: approval!.id,
      status: "approved",
      reviewedBy: "owner",
      reviewNotes: "ok for next cycle",
    });
    expect((await getDecision(decision.id))?.approvalStatus).toBe("approved");

    await setExecutionStatus(decision.id, "executed", { applied: true });
    const executed = await getDecision(decision.id);
    expect(executed?.executionStatus).toBe("executed");
    expect(executed?.executedAt).toBeInstanceOf(Date);
  });

  it("observe-only decisions can skip approval explicitly", async () => {
    const { decision, approval } = await recordDecision({ ...proposal, approvalRequired: false });
    expect(decision.approvalStatus).toBe("none");
    expect(approval).toBeNull();
  });

  it("validates decisions and typed AgentActions", async () => {
    await expect(recordDecision({ ...proposal, riskLevel: "extreme" as never })).rejects.toThrow();
    await expect(recordDecision({ ...proposal, confidence: 1.5 })).rejects.toThrow();
    await expect(
      recordDecision({ ...proposal, proposedAction: { ...proposal.proposedAction, agentType: "rogue" as never } }),
    ).rejects.toThrow();
    await expect(
      reviewApproval({ approvalId: "apr_missing", status: "approved", reviewedBy: "owner" }),
    ).rejects.toThrow(/unknown approval/i);
  });

  it("autonomy defaults to OBSERVE when unconfigured (fail-safe)", async () => {
    expect((await getAgentConfig("sales")).autonomyMode).toBe("OBSERVE");
    await setAgentConfig({ agentType: "sales", autonomyMode: "GUARDED_AUTO", limits: { maxCartValueCents: 500000 } });
    const configured = await getAgentConfig("sales");
    expect(configured.autonomyMode).toBe("GUARDED_AUTO");
    expect(configured.limitsJson).toEqual({ maxCartValueCents: 500000 });
    await expect(setAgentConfig({ agentType: "sales", autonomyMode: "GOD_MODE" as never })).rejects.toThrow();
  });
});

describe("insight/opportunity anti-fabrication + experiment stickiness", () => {
  beforeEach(resetDb);

  it("insights require traceable evidence", async () => {
    await expect(
      createInsight({ insightType: "top_question", title: "?", sourceRefs: [], evidenceCount: 5 }),
    ).rejects.toThrow();
    await expect(
      createInsight({
        insightType: "top_question",
        title: "Lead time questions dominate",
        sourceRefs: [{ table: "messages", id: "msg_1" }, { table: "messages", id: "msg_2" }],
        evidenceCount: 1, // fewer than the refs provided — inconsistent
      }),
    ).rejects.toThrow();

    const insight = await createInsight({
      insightType: "top_question",
      title: "Lead time questions dominate",
      sourceRefs: [{ table: "messages", id: "msg_1" }, { table: "messages", id: "msg_2" }],
      evidenceCount: 2,
    });
    expect(insight.status).toBe("candidate");
    expect(insight.sourceRefsJson).toHaveLength(2);
  });

  it("opportunities always start requiring human validation", async () => {
    const opp = await createOpportunity({
      title: "Insulated bag requests",
      description: "Multiple prospects asked for insulated options.",
      evidenceCount: 3,
    });
    expect(opp.humanValidationRequired).toBe(true);
    expect(opp.status).toBe("proposed");
  });

  it("experiment assignments are sticky per session", async () => {
    const session = await makeSession();
    const created = await createExperimentDraft({
      name: "hero-copy-v1",
      hypothesis: "Benefit-led hero increases configurator starts.",
      createdBy: "test",
      design: {
        targetKey: "homepage.hero",
        experimentType: "HERO_COPY",
        variantConfig: { headline: "Factory-direct takeout bags, priced online" },
        primaryMetric: "configurator_started",
        allocation: [
          { variant: "control", pct: 50 },
          { variant: "variant_b", pct: 50 },
        ],
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.experiment.status).toBe("draft");

    const first = await recordAssignment(created.experiment.id, session.id, "variant_b");
    const second = await recordAssignment(created.experiment.id, session.id, "control"); // must NOT reassign
    expect(first?.variant).toBe("variant_b");
    expect(second?.variant).toBe("variant_b");
    expect((await getAssignment(created.experiment.id, session.id))?.variant).toBe("variant_b");
  });
});
