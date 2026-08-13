import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { approvals } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getAction,
  listActionEvents,
  listActionRevisions,
  listActions,
  listEvaluations,
  modifyAction,
  proposeAction,
  reviewAction,
  syncDecisionsToActions,
} from "@/lib/data/agent-action-service";
import { getDecision, recordDecision, setAgentConfig } from "@/lib/data/agent-service";
import { createInsight } from "@/lib/data/insight-service";
import { resolveActionEvidence } from "@/lib/data/action-evidence";
import { resetDb } from "./db-helpers";

/**
 * Session 10 — the proposal → guardrail → approval workflow against the
 * real database. No AI provider is constructed anywhere in this file: the
 * Action Center is deterministic by design.
 */

beforeEach(async () => {
  await resetDb();
});

const reviewPayload = (overrides: Record<string, unknown> = {}) => ({
  title: "Investigate MOQ",
  observation: "12 of 40 qualified conversations asked about a lower minimum.",
  question: "Review whether a lower MOQ is economically feasible.",
  metricRefs: ["funnel.qualified_conversations"],
  evidenceRefs: [],
  ...overrides,
});

async function seedCeoDecision(overrides: Record<string, unknown> = {}) {
  return recordDecision({
    agentType: "ceo",
    decisionType: "ceo_recommendation",
    observation: "12 of 40 qualified conversations asked about a lower minimum.",
    reasoningSummary: "Review whether a lower MOQ is economically feasible.",
    supportingData: {
      title: "Investigate MOQ",
      actionCategory: "PRODUCT",
      supportingMetricRefs: ["funnel.qualified_conversations"],
      evidenceRefs: [],
      periodDays: 30,
      ...overrides,
    },
    confidence: 0.5,
    riskLevel: "medium",
    proposedAction: {
      agentType: "ceo",
      actionType: "recommend_product",
      params: { identityKey: "PRODUCT:funnel.qualified_conversations:30d", title: "Investigate MOQ" },
    },
    approvalRequired: true,
  });
}

describe("proposing actions", () => {
  it("stores an allowed proposal as PENDING_APPROVAL with its evaluation and event", async () => {
    const { action, decision } = await proposeAction({
      source: "CEO_AGENT",
      actionType: "MOQ_REVIEW",
      payload: reviewPayload(),
      title: "Investigate MOQ",
      createdBy: "system:test",
    });

    expect(decision.allowed).toBe(true);
    expect(action.status).toBe("PENDING_APPROVAL");
    expect(action.executionStatus).toBe("NOT_APPLICABLE");
    expect(action.approvalRequired).toBe(true);
    expect(action.latestEvaluationId).toBeTruthy();

    const evaluations = await listEvaluations(action.id);
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0].policyVersion).toBeTruthy();

    const events = await listActionEvents(action.id);
    expect(events.map((e) => e.type)).toEqual(["ai_action_proposed"]);
    expect(events[0].actor).toBe("system:test");
  });

  it("records a blocked proposal instead of swallowing it", async () => {
    const { action, decision } = await proposeAction({
      source: "CEO_AGENT",
      actionType: "PRICE_CHANGE",
      payload: { productId: "p", currentUnitPriceCents: 100, proposedUnitPriceCents: 10, currency: "USD", reason: "x" },
      title: "Cut prices 90%",
      createdBy: "system:test",
    });
    expect(decision.allowed).toBe(false);
    expect(action.status).toBe("GUARDRAIL_BLOCKED");
    expect(action.approvalRequired).toBe(false);
    const events = await listActionEvents(action.id);
    expect(events.map((e) => e.type)).toEqual(["ai_action_guardrail_blocked"]);
  });

  it("blocks proposals from an agent whose stored autonomy is OBSERVE", async () => {
    await setAgentConfig({ agentType: "ceo", autonomyMode: "OBSERVE" });
    const { action } = await proposeAction({
      source: "CEO_AGENT",
      actionType: "MOQ_REVIEW",
      payload: reviewPayload(),
      title: "Investigate MOQ",
      createdBy: "system:test",
    });
    expect(action.status).toBe("GUARDRAIL_BLOCKED");
  });

  it("clamps a tampered AUTONOMOUS agent_configs row back to RECOMMEND", async () => {
    await setAgentConfig({ agentType: "ceo", autonomyMode: "AUTONOMOUS" });
    const { action } = await proposeAction({
      source: "CEO_AGENT",
      actionType: "MOQ_REVIEW",
      payload: reviewPayload(),
      title: "Investigate MOQ",
      createdBy: "system:test",
    });
    expect(action.status).toBe("PENDING_APPROVAL");
    expect(action.approvalRequired).toBe(true);
    const [evaluation] = await listEvaluations(action.id);
    expect(evaluation.autonomyMode).toBe("RECOMMEND");
    expect(evaluation.executionEligible).toBe(false);
  });
});

describe("CEO decision integration (spec §20)", () => {
  it("materializes pending CEO recommendations once, idempotently", async () => {
    const { decision } = await seedCeoDecision();
    const first = await syncDecisionsToActions();
    expect(first.created).toBe(1);
    const second = await syncDecisionsToActions();
    expect(second.created).toBe(0);
    expect(second.skippedExisting).toBe(1);

    const actions = await listActions({});
    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe("PRODUCT_REVIEW");
    expect(actions[0].sourceDecisionId).toBe(decision.id);
    expect(actions[0].identityKey).toBe("PRODUCT:funnel.qualified_conversations:30d");
  });

  it("creates no action for a recommendation with no structured category", async () => {
    await recordDecision({
      agentType: "ceo",
      decisionType: "ceo_recommendation",
      observation: "Things look fine.",
      reasoningSummary: "No action needed.",
      riskLevel: "low",
      proposedAction: { agentType: "ceo", actionType: "recommend_none", params: {} },
      approvalRequired: true,
    });
    const result = await syncDecisionsToActions();
    expect(result.created).toBe(0);
    expect(result.skippedUnmappable).toBe(1);
    expect(await listActions({})).toHaveLength(0);
  });

  it("reuses the decision's existing pending approval row rather than creating a second", async () => {
    const { decision } = await seedCeoDecision();
    await syncDecisionsToActions();
    const db = await getDb();
    const rows = await db.select().from(approvals).where(eq(approvals.decisionId, decision.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].actionId).toBeTruthy();
  });
});

describe("human approval (spec §14, §16, §25)", () => {
  it("records the verdict, keeps execution untouched, and syncs the source decision", async () => {
    const { decision } = await seedCeoDecision();
    await syncDecisionsToActions();
    const [action] = await listActions({});

    const result = await reviewAction({
      actionId: action.id,
      outcome: "approve",
      reviewedBy: "owner",
      expectedStateVersion: action.stateVersion,
      notes: "Worth investigating.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.action.status).toBe("APPROVED");
    // Approval is NOT execution.
    expect(result.action.executionStatus).toBe("NOT_APPLICABLE");
    expect(result.action.reviewedBy).toBe("owner");

    const refreshed = await getDecision(decision.id);
    expect(refreshed?.approvalStatus).toBe("approved");
    expect(refreshed?.executionStatus).toBe("none");

    const events = await listActionEvents(action.id);
    expect(events.map((e) => e.type)).toEqual(["ai_action_proposed", "ai_action_approved"]);
  });

  it("records a rejection the same way", async () => {
    const { decision } = await seedCeoDecision();
    await syncDecisionsToActions();
    const [action] = await listActions({});
    const result = await reviewAction({
      actionId: action.id,
      outcome: "reject",
      reviewedBy: "owner",
      expectedStateVersion: action.stateVersion,
    });
    expect(result.ok).toBe(true);
    expect((await getAction(action.id))?.status).toBe("REJECTED");
    expect((await getDecision(decision.id))?.approvalStatus).toBe("rejected");
  });

  it("is idempotent under a double click: the second attempt conflicts", async () => {
    await seedCeoDecision();
    await syncDecisionsToActions();
    const [action] = await listActions({});

    const first = await reviewAction({
      actionId: action.id,
      outcome: "approve",
      reviewedBy: "owner",
      expectedStateVersion: action.stateVersion,
    });
    const second = await reviewAction({
      actionId: action.id,
      outcome: "approve",
      reviewedBy: "owner",
      expectedStateVersion: action.stateVersion,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok || second.code !== "CONFLICT") throw new Error("expected a conflict");
    expect(second.currentStatus).toBe("APPROVED");

    // Exactly one approval event, one verdict.
    const events = await listActionEvents(action.id);
    expect(events.filter((e) => e.type === "ai_action_approved")).toHaveLength(1);
  });

  it("gives a second reviewer on a stale page a conflict, not a rewritten history", async () => {
    await seedCeoDecision();
    await syncDecisionsToActions();
    const [action] = await listActions({});
    const staleVersion = action.stateVersion;

    await reviewAction({ actionId: action.id, outcome: "approve", reviewedBy: "adminA", expectedStateVersion: staleVersion });
    const stale = await reviewAction({
      actionId: action.id,
      outcome: "reject",
      reviewedBy: "adminB",
      expectedStateVersion: staleVersion,
    });
    expect(stale.ok).toBe(false);
    const current = await getAction(action.id);
    expect(current?.status).toBe("APPROVED");
    expect(current?.reviewedBy).toBe("adminA");
  });

  it("refuses to review a guardrail-blocked action", async () => {
    const { action } = await proposeAction({
      source: "CEO_AGENT",
      actionType: "PRICE_CHANGE",
      payload: { productId: "p", currentUnitPriceCents: 100, proposedUnitPriceCents: 10, currency: "USD", reason: "x" },
      title: "Cut prices",
      createdBy: "system:test",
    });
    const result = await reviewAction({
      actionId: action.id,
      outcome: "approve",
      reviewedBy: "owner",
      expectedStateVersion: action.stateVersion,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CONFLICT");
  });

  it("returns NOT_FOUND for an unknown action id", async () => {
    const result = await reviewAction({
      actionId: "act_missing",
      outcome: "approve",
      reviewedBy: "owner",
      expectedStateVersion: 1,
    });
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("human modification (spec §15, §29)", () => {
  it("preserves the original, creates a re-evaluated revision, and records who changed it", async () => {
    await seedCeoDecision();
    await syncDecisionsToActions();
    const [action] = await listActions({});
    const originalPayload = action.payloadJson as Record<string, unknown>;

    const result = await modifyAction({
      actionId: action.id,
      payload: { ...originalPayload, question: "Only review MOQ for the catering bag." },
      reviewedBy: "owner",
      expectedStateVersion: action.stateVersion,
      notes: "Narrowed the scope.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.original.status).toBe("SUPERSEDED");
    expect(result.original.supersededByActionId).toBe(result.revision.id);
    // The original payload is untouched.
    expect((result.original.payloadJson as Record<string, unknown>).question).toBe(originalPayload.question);
    expect(result.revision.revision).toBe(2);
    expect(result.revision.status).toBe("PENDING_APPROVAL");
    expect(result.revision.createdBy).toBe("admin:owner");
    expect(result.original.reviewedBy).toBe("owner");

    // The revision has its OWN evaluation — approval is never inherited.
    const revisionEvaluations = await listEvaluations(result.revision.id);
    expect(revisionEvaluations).toHaveLength(1);
    expect(result.revision.approvalRequired).toBe(true);

    const chain = await listActionRevisions(result.revision);
    expect(chain.map((r) => r.revision)).toEqual([1, 2]);
  });

  it("re-evaluates the modified payload rather than inheriting the original verdict", async () => {
    await seedCeoDecision();
    await syncDecisionsToActions();
    const [action] = await listActions({});

    // An empty question fails the review payload schema → blocked revision.
    const result = await modifyAction({
      actionId: action.id,
      payload: { ...(action.payloadJson as Record<string, unknown>), question: "" },
      reviewedBy: "owner",
      expectedStateVersion: action.stateVersion,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision.status).toBe("GUARDRAIL_BLOCKED");
    expect(result.decision.allowed).toBe(false);
    expect(result.revision.approvalRequired).toBe(false);
  });

  it("refuses a modification that invents evidence references (spec §19)", async () => {
    await seedCeoDecision();
    await syncDecisionsToActions();
    const [action] = await listActions({});
    const result = await modifyAction({
      actionId: action.id,
      payload: { ...(action.payloadJson as Record<string, unknown>), evidenceRefs: ["ins_fabricated"] },
      reviewedBy: "owner",
      expectedStateVersion: action.stateVersion,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID");
    expect((await getAction(action.id))?.status).toBe("PENDING_APPROVAL");
  });

  it("conflicts on a stale modification instead of overwriting", async () => {
    await seedCeoDecision();
    await syncDecisionsToActions();
    const [action] = await listActions({});
    await reviewAction({ actionId: action.id, outcome: "approve", reviewedBy: "owner", expectedStateVersion: action.stateVersion });
    const result = await modifyAction({
      actionId: action.id,
      payload: action.payloadJson as Record<string, unknown>,
      reviewedBy: "owner",
      expectedStateVersion: action.stateVersion,
    });
    expect(result.ok).toBe(false);
  });
});

describe("evidence validation (spec §19)", () => {
  it("resolves real insight references and reports fabricated ones as unavailable", async () => {
    const insight = await createInsight({
      insightType: "MOQ_SIGNAL",
      title: "Buyers ask for 250-unit minimums",
      sourceRefs: [{ table: "messages", id: "msg_1" }],
      evidenceCount: 3,
    });
    const resolution = await resolveActionEvidence([insight.id, "ins_does_not_exist"]);
    expect(resolution.items).toHaveLength(1);
    expect(resolution.items[0].title).toBe("Buyers ask for 250-unit minimums");
    expect(resolution.unresolved).toEqual(["ins_does_not_exist"]);
  });
});
