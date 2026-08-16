import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ACTION_CENTER_MAX_ROWS } from "@/config/guardrails";
import { getDb } from "@/db/client";
import { agentActionEvents, agentActions, agentConfigs, agentDecisions, approvals, guardrailEvaluations } from "@/db/schema";
import {
  evaluateAgentAction,
  getActionTypeSpec,
  mapAgentDecisionToAction,
  policyDefaultAutonomy,
  type ActionSource,
  type ActionStatus,
  type AutonomyMode,
  type GuardrailDecision,
} from "@/modules/guardrails";
import { getAgentConfig, AGENT_TYPES } from "./agent-service";
import { newId } from "./id";

/**
 * Proposed-action persistence + the human approval workflow (Session 10).
 *
 * Everything financially or operationally meaningful enters the system HERE
 * and only here: propose → evaluate (deterministic) → record → human
 * approve/reject/modify. There is no execution path — see
 * modules/guardrails/executors.ts (deliberately empty).
 *
 * Guarantees implemented in this file and asserted by tests:
 *  - Every stored action carries a guardrail evaluation, including blocked
 *    ones (blocked proposals stay visible; they are not swallowed).
 *  - `reviewedBy` is ALWAYS server-derived; callers pass an identity the
 *    route obtained from the authenticated admin context, never from a body.
 *  - State transitions are guarded by `stateVersion` inside a row-locked
 *    transaction: a double-clicked Approve or a stale second reviewer gets
 *    a CONFLICT, never a silently rewritten history.
 *  - Modification never edits a payload in place: the original is
 *    SUPERSEDED and a new revision is inserted and re-evaluated.
 */

export type ActionRow = typeof agentActions.$inferSelect;
export type EvaluationRow = typeof guardrailEvaluations.$inferSelect;
export type ActionEventRow = typeof agentActionEvents.$inferSelect;

export const ACTION_EVENT_TYPES = [
  "ai_action_proposed",
  "ai_action_guardrail_blocked",
  "ai_action_approved",
  "ai_action_rejected",
  "ai_action_modified",
] as const;
export type ActionEventType = (typeof ACTION_EVENT_TYPES)[number];

/** Map the guardrail source enum onto the existing AgentConfig agent types. */
const SOURCE_TO_AGENT_TYPE: Record<ActionSource, (typeof AGENT_TYPES)[number] | null> = {
  CEO_AGENT: "ceo",
  PRICING_AGENT: "pricing",
  CRO_AGENT: "cro",
  GOOGLE_ADS_AGENT: "google_ads",
  META_ADS_AGENT: "meta_ads",
  HUMAN_ADMIN: null,
};

/**
 * The inverse map, for materializing a persisted decision into an action.
 * A decision from an agent type absent here is never materialized (the
 * decision query already restricts to the mapped set) — a new agent gets no
 * proposal authority by accident.
 */
const DECISION_AGENT_TO_SOURCE: Record<string, ActionSource> = {
  ceo: "CEO_AGENT",
  cro: "CRO_AGENT",
  pricing: "PRICING_AGENT",
};

/**
 * Effective autonomy for a source: the stored AgentConfig row when one
 * exists, otherwise the designed default from policy. The evaluator clamps
 * the result to the policy ceiling regardless — this function can only ever
 * propose a mode, never grant one.
 */
export async function resolveAutonomyMode(source: ActionSource): Promise<AutonomyMode> {
  const agentType = SOURCE_TO_AGENT_TYPE[source];
  if (!agentType) return policyDefaultAutonomy(source);
  // An absent row reads as OBSERVE at the data layer (S03 fail-safe). For a
  // source with a DESIGNED mode that would silently disable it, so policy
  // supplies the default and an EXPLICIT row overrides — still clamped to
  // the policy ceiling by the evaluator, so this can never grant authority.
  const db = await getDb();
  const [row] = await db.select().from(agentConfigs).where(eq(agentConfigs.agentType, agentType)).limit(1);
  if (!row) return policyDefaultAutonomy(source);
  const config = await getAgentConfig(agentType);
  return config.autonomyMode;
}

/* ------------------------------------------------------------------ */
/* Proposal                                                            */
/* ------------------------------------------------------------------ */

export type ProposeActionInput = {
  source: ActionSource;
  actionType: string;
  payload: unknown;
  title: string;
  createdBy: string;
  sourceDecisionId?: string | null;
  identityKey?: string | null;
  modelSuggestedRiskLevel?: string | null;
  /** Original action id when this is a human modification revision. */
  originActionId?: string | null;
  revision?: number;
};

export type ProposeActionResult = {
  action: ActionRow;
  evaluation: EvaluationRow;
  decision: GuardrailDecision;
};

/**
 * Evaluate and persist a proposed action. A BLOCKED verdict still produces
 * a row (status GUARDRAIL_BLOCKED) so the owner can see what an agent tried
 * to do — silence would be the worse failure mode.
 */
export async function proposeAction(input: ProposeActionInput): Promise<ProposeActionResult> {
  const autonomyMode = await resolveAutonomyMode(input.source);
  const { decision, validatedPayload } = evaluateAgentAction({
    source: input.source,
    actionType: input.actionType,
    payload: input.payload,
    autonomyMode,
    modelSuggestedRiskLevel: input.modelSuggestedRiskLevel ?? null,
  });

  const status: ActionStatus = !decision.allowed
    ? "GUARDRAIL_BLOCKED"
    : decision.approvalRequired
      ? "PENDING_APPROVAL"
      : "APPROVED"; // unreachable today: nothing is execution-eligible

  const db = await getDb();
  return db.transaction(async (tx) => {
    const actionId = newId("act");
    const [action] = await tx
      .insert(agentActions)
      .values({
        id: actionId,
        sourceAgent: input.source,
        sourceDecisionId: input.sourceDecisionId ?? null,
        actionType: input.actionType.slice(0, 100),
        title: input.title.slice(0, 200),
        // A blocked action stores what was ATTEMPTED (unvalidated, bounded)
        // so the record is honest about what the agent asked for.
        payloadJson: validatedPayload ?? boundedRawPayload(input.payload),
        identityKey: input.identityKey ?? null,
        revision: input.revision ?? 1,
        originActionId: input.originActionId ?? null,
        status,
        executionStatus: decision.executionState,
        riskLevel: decision.riskLevel,
        modelSuggestedRisk: decision.modelSuggestedRiskLevel,
        approvalRequired: decision.allowed ? decision.approvalRequired : false,
        createdBy: input.createdBy.slice(0, 200),
      })
      .returning();

    const evaluation = await insertEvaluation(tx, action, decision);
    await tx.update(agentActions).set({ latestEvaluationId: evaluation.id }).where(eq(agentActions.id, action.id));

    await insertEvent(tx, {
      actionId: action.id,
      type: decision.allowed ? "ai_action_proposed" : "ai_action_guardrail_blocked",
      actor: input.createdBy,
      detail: {
        actionType: input.actionType,
        riskLevel: decision.riskLevel,
        policyVersion: decision.policyVersion,
        violatedRules: decision.violatedRules.map((r) => r.id),
      },
    });

    // Keep the decision-level Approval spine in sync when this proposal came
    // from an AgentDecision (S03/S09 model preserved, not duplicated).
    if (decision.allowed && input.sourceDecisionId) {
      await linkOrCreateApproval(tx, input.sourceDecisionId, action.id);
    }

    return { action: { ...action, latestEvaluationId: evaluation.id }, evaluation, decision };
  });
}

/** Bounded, non-executable copy of a rejected payload (audit only). */
function boundedRawPayload(payload: unknown): Record<string, unknown> {
  try {
    const json = JSON.stringify(payload ?? null);
    return { rejectedPayloadPreview: json.slice(0, 4000) };
  } catch {
    return { rejectedPayloadPreview: "[unserializable]" };
  }
}

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

async function insertEvaluation(tx: Tx, action: ActionRow, decision: GuardrailDecision): Promise<EvaluationRow> {
  const [row] = await tx
    .insert(guardrailEvaluations)
    .values({
      id: newId("gev"),
      actionId: action.id,
      actionRevision: action.revision,
      policyVersion: decision.policyVersion,
      sourceAgent: decision.source ?? action.sourceAgent,
      actionType: decision.actionType ?? action.actionType,
      autonomyMode: decision.autonomyMode,
      allowed: decision.allowed,
      executionEligible: decision.executionEligible,
      approvalRequired: decision.approvalRequired,
      riskLevel: decision.riskLevel,
      violatedRulesJson: decision.violatedRules as unknown as Record<string, unknown>[],
      missingConfigurationJson: decision.missingConfiguration,
      reason: decision.reason,
      executionSupport: decision.executionSupport,
      limitsSnapshotJson: decision.limitsSnapshot,
    })
    .returning();
  return row;
}

async function insertEvent(
  tx: Tx,
  input: { actionId: string; type: ActionEventType; actor: string; detail?: Record<string, unknown> },
): Promise<void> {
  await tx.insert(agentActionEvents).values({
    id: newId("aev"),
    actionId: input.actionId,
    type: input.type,
    actor: input.actor.slice(0, 200),
    detailJson: input.detail ?? null,
  });
}

/** Reuse the decision's pending approval row when one exists; else create it. */
async function linkOrCreateApproval(tx: Tx, decisionId: string, actionId: string): Promise<void> {
  const [pending] = await tx
    .select()
    .from(approvals)
    .where(and(eq(approvals.decisionId, decisionId), eq(approvals.status, "pending"), isNull(approvals.actionId)))
    .limit(1);
  if (pending) {
    await tx.update(approvals).set({ actionId }).where(eq(approvals.id, pending.id));
    return;
  }
  await tx.insert(approvals).values({ id: newId("apr"), decisionId, actionId });
}

/* ------------------------------------------------------------------ */
/* Human review                                                        */
/* ------------------------------------------------------------------ */

export type ReviewOutcome = "approve" | "reject";

export type ReviewResult =
  | { ok: true; action: ActionRow }
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "CONFLICT"; reason: string; currentStatus: ActionStatus; currentStateVersion: number };

const reviewNotesSchema = z.string().max(4000).optional();

/**
 * Approve or reject a pending action.
 *
 * IDEMPOTENCY / CONCURRENCY (spec §27–§28): the row is locked, the caller's
 * `expectedStateVersion` must match, and only PENDING_APPROVAL may
 * transition. A second click, or a second admin acting on a stale page,
 * receives CONFLICT with the current state — history is never rewritten.
 *
 * APPROVAL ≠ EXECUTION (spec §16): this sets approvalStatus only.
 * `executionStatus` keeps whatever the guardrail evaluation assigned
 * (NOT_APPLICABLE / NOT_SUPPORTED) because no executor exists.
 */
export async function reviewAction(input: {
  actionId: string;
  outcome: ReviewOutcome;
  /** SERVER-DERIVED admin identity. Never accept this from a request body. */
  reviewedBy: string;
  expectedStateVersion: number;
  notes?: string;
}): Promise<ReviewResult> {
  reviewNotesSchema.parse(input.notes);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const current = await lockAction(tx, input.actionId);
    if (!current) return { ok: false, code: "NOT_FOUND" } as const;

    if (current.status !== "PENDING_APPROVAL") {
      return conflict(current, `Action is ${current.status}; only PENDING_APPROVAL can be reviewed.`);
    }
    if (current.stateVersion !== input.expectedStateVersion) {
      return conflict(current, "The action changed since it was loaded — reload and review the current version.");
    }

    const nextStatus: ActionStatus = input.outcome === "approve" ? "APPROVED" : "REJECTED";
    const reviewedAt = new Date();
    const [updated] = await tx
      .update(agentActions)
      .set({
        status: nextStatus,
        reviewedBy: input.reviewedBy.slice(0, 200),
        reviewedAt,
        reviewNotes: input.notes?.slice(0, 4000) ?? null,
        stateVersion: current.stateVersion + 1,
        updatedAt: reviewedAt,
      })
      .where(and(eq(agentActions.id, current.id), eq(agentActions.stateVersion, current.stateVersion)))
      .returning();
    if (!updated) return conflict(current, "Concurrent update detected.");

    await syncApprovalAndDecision(tx, updated, input.outcome === "approve" ? "approved" : "rejected", input);
    await insertEvent(tx, {
      actionId: updated.id,
      type: input.outcome === "approve" ? "ai_action_approved" : "ai_action_rejected",
      actor: input.reviewedBy,
      detail: { revision: updated.revision, executionStatus: updated.executionStatus },
    });
    return { ok: true, action: updated } as const;
  });
}

const conflict = (current: ActionRow, reason: string) =>
  ({
    ok: false,
    code: "CONFLICT",
    reason,
    currentStatus: current.status as ActionStatus,
    currentStateVersion: current.stateVersion,
  }) as const;

async function lockAction(tx: Tx, actionId: string): Promise<ActionRow | null> {
  const [row] = await tx.select().from(agentActions).where(eq(agentActions.id, actionId)).limit(1).for("update");
  return row ?? null;
}

/** Mirror the verdict onto the decision-level Approval + AgentDecision rows. */
async function syncApprovalAndDecision(
  tx: Tx,
  action: ActionRow,
  status: "approved" | "rejected" | "modified",
  input: { reviewedBy: string; notes?: string },
): Promise<void> {
  const [approval] = await tx.select().from(approvals).where(eq(approvals.actionId, action.id)).limit(1);
  if (approval) {
    await tx
      .update(approvals)
      .set({
        status,
        reviewedAt: new Date(),
        reviewedBy: input.reviewedBy.slice(0, 200),
        reviewNotes: input.notes?.slice(0, 4000) ?? null,
        beforeJson: { status: "pending", actionStatus: "PENDING_APPROVAL" },
        afterJson: { status, actionStatus: action.status, actionRevision: action.revision },
      })
      .where(eq(approvals.id, approval.id));
  }
  if (action.sourceDecisionId) {
    await tx
      .update(agentDecisions)
      .set({ approvalStatus: status })
      .where(eq(agentDecisions.id, action.sourceDecisionId));
  }
}

/* ------------------------------------------------------------------ */
/* Human modification                                                  */
/* ------------------------------------------------------------------ */

export type ModifyResult =
  | { ok: true; original: ActionRow; revision: ActionRow; decision: GuardrailDecision }
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "INVALID"; reason: string }
  | { ok: false; code: "CONFLICT"; reason: string; currentStatus: ActionStatus; currentStateVersion: number };

/**
 * Modify a proposal (spec §15, §29). The original is preserved and marked
 * SUPERSEDED; a NEW revision carrying the admin's payload is validated and
 * RE-EVALUATED from scratch. A human edit never inherits the previous
 * verdict and never bypasses a guardrail — if the edited action violates a
 * rule, the revision is stored as GUARDRAIL_BLOCKED.
 *
 * Evidence cannot be invented in a modification: the revision may drop
 * references but never add ones the original did not carry (spec §19).
 */
export async function modifyAction(input: {
  actionId: string;
  payload: unknown;
  /** SERVER-DERIVED admin identity. */
  reviewedBy: string;
  expectedStateVersion: number;
  notes?: string;
}): Promise<ModifyResult> {
  const db = await getDb();
  const precheck: { failure: ModifyResult | null; current: ActionRow | null } = await db.transaction(async (tx) => {
    const row = await lockAction(tx, input.actionId);
    if (!row) return { failure: { ok: false as const, code: "NOT_FOUND" as const }, current: null };
    if (row.status !== "PENDING_APPROVAL") {
      return {
        failure: conflict(row, `Action is ${row.status}; only PENDING_APPROVAL can be modified.`),
        current: null,
      };
    }
    if (row.stateVersion !== input.expectedStateVersion) {
      return {
        failure: conflict(row, "The action changed since it was loaded — reload and modify the current version."),
        current: null,
      };
    }
    const refCheck = refsWithinOriginal(row, input.payload);
    if (!refCheck.ok) {
      return { failure: { ok: false as const, code: "INVALID" as const, reason: refCheck.reason }, current: null };
    }
    return { failure: null, current: row };
  });
  if (precheck.failure || !precheck.current) {
    return precheck.failure ?? { ok: false, code: "NOT_FOUND" };
  }
  const current = precheck.current;

  // Evaluate + insert the revision, then supersede the original atomically.
  const autonomyMode = await resolveAutonomyMode(current.sourceAgent as ActionSource);
  const { decision, validatedPayload } = evaluateAgentAction({
    source: current.sourceAgent,
    actionType: current.actionType,
    payload: input.payload,
    autonomyMode,
    modelSuggestedRiskLevel: current.modelSuggestedRisk,
  });

  const status: ActionStatus = !decision.allowed
    ? "GUARDRAIL_BLOCKED"
    : decision.approvalRequired
      ? "PENDING_APPROVAL"
      : "APPROVED";

  return db.transaction(async (tx) => {
    const locked = await lockAction(tx, current.id);
    if (!locked) return { ok: false as const, code: "NOT_FOUND" as const };
    if (locked.status !== "PENDING_APPROVAL" || locked.stateVersion !== input.expectedStateVersion) {
      return conflict(locked, "The action changed while the modification was being evaluated.");
    }

    const revisionId = newId("act");
    const now = new Date();
    const [revision] = await tx
      .insert(agentActions)
      .values({
        id: revisionId,
        sourceAgent: locked.sourceAgent,
        sourceDecisionId: locked.sourceDecisionId,
        actionType: locked.actionType,
        title: locked.title,
        payloadJson: validatedPayload ?? boundedRawPayload(input.payload),
        identityKey: locked.identityKey,
        revision: locked.revision + 1,
        originActionId: locked.originActionId ?? locked.id,
        status,
        executionStatus: decision.executionState,
        riskLevel: decision.riskLevel,
        modelSuggestedRisk: locked.modelSuggestedRisk,
        approvalRequired: decision.allowed ? decision.approvalRequired : false,
        createdBy: `admin:${input.reviewedBy}`.slice(0, 200),
      })
      .returning();

    const evaluation = await insertEvaluation(tx, revision, decision);
    await tx.update(agentActions).set({ latestEvaluationId: evaluation.id }).where(eq(agentActions.id, revision.id));

    const [original] = await tx
      .update(agentActions)
      .set({
        status: "SUPERSEDED",
        supersededByActionId: revision.id,
        reviewedBy: input.reviewedBy.slice(0, 200),
        reviewedAt: now,
        reviewNotes: input.notes?.slice(0, 4000) ?? null,
        stateVersion: locked.stateVersion + 1,
        updatedAt: now,
      })
      .where(and(eq(agentActions.id, locked.id), eq(agentActions.stateVersion, locked.stateVersion)))
      .returning();
    if (!original) return conflict(locked, "Concurrent update detected.");

    await syncApprovalAndDecision(tx, original, "modified", input);
    // The revision needs its own pending approval record when it is reviewable.
    if (decision.allowed && locked.sourceDecisionId) {
      await tx.insert(approvals).values({ id: newId("apr"), decisionId: locked.sourceDecisionId, actionId: revision.id });
    }
    await insertEvent(tx, {
      actionId: original.id,
      type: "ai_action_modified",
      actor: input.reviewedBy,
      detail: { supersededBy: revision.id, newRevision: revision.revision },
    });
    await insertEvent(tx, {
      actionId: revision.id,
      type: decision.allowed ? "ai_action_proposed" : "ai_action_guardrail_blocked",
      actor: `admin:${input.reviewedBy}`,
      detail: {
        modifiedFrom: original.id,
        riskLevel: decision.riskLevel,
        policyVersion: decision.policyVersion,
        violatedRules: decision.violatedRules.map((r) => r.id),
      },
    });

    return { ok: true as const, original, revision: { ...revision, latestEvaluationId: evaluation.id }, decision };
  });
}

/** A modification may narrow evidence, never invent it (spec §19). */
function refsWithinOriginal(original: ActionRow, payload: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof payload !== "object" || payload === null) return { ok: true };
  const before = original.payloadJson as Record<string, unknown>;
  const after = payload as Record<string, unknown>;
  for (const key of ["metricRefs", "evidenceRefs"] as const) {
    const allowed = new Set(Array.isArray(before[key]) ? (before[key] as unknown[]).map(String) : []);
    const proposed = Array.isArray(after[key]) ? (after[key] as unknown[]).map(String) : [];
    const invented = proposed.filter((r) => !allowed.has(r));
    if (invented.length > 0) {
      return {
        ok: false,
        reason: `${key} may not introduce references the original proposal did not carry: ${invented.slice(0, 3).join(", ")}`,
      };
    }
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function getAction(id: string): Promise<ActionRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(agentActions).where(eq(agentActions.id, id)).limit(1);
  return row ?? null;
}

export async function listActions(
  filter: { status?: ActionStatus[]; limit?: number } = {},
): Promise<ActionRow[]> {
  const db = await getDb();
  const limit = Math.min(filter.limit ?? ACTION_CENTER_MAX_ROWS, ACTION_CENTER_MAX_ROWS);
  const base = db.select().from(agentActions);
  const query = filter.status?.length ? base.where(inArray(agentActions.status, filter.status)) : base;
  return query.orderBy(desc(agentActions.createdAt)).limit(limit);
}

export async function listEvaluations(actionId: string): Promise<EvaluationRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(guardrailEvaluations)
    .where(eq(guardrailEvaluations.actionId, actionId))
    .orderBy(desc(guardrailEvaluations.evaluatedAt));
}

export async function getLatestEvaluation(actionId: string): Promise<EvaluationRow | null> {
  const [row] = await listEvaluations(actionId);
  return row ?? null;
}

export async function listActionEvents(actionId: string): Promise<ActionEventRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(agentActionEvents)
    .where(eq(agentActionEvents.actionId, actionId))
    .orderBy(agentActionEvents.createdAt);
}

/** The full modification chain for an action (original + every revision). */
export async function listActionRevisions(action: ActionRow): Promise<ActionRow[]> {
  const db = await getDb();
  const rootId = action.originActionId ?? action.id;
  const rows = await db
    .select()
    .from(agentActions)
    .where(
      sql`${agentActions.id} = ${rootId} or ${agentActions.originActionId} = ${rootId}`,
    )
    .orderBy(agentActions.revision);
  return rows;
}

/* ------------------------------------------------------------------ */
/* CEO decision → Action Center                                        */
/* ------------------------------------------------------------------ */

export type SyncResult = {
  created: number;
  blocked: number;
  skippedExisting: number;
  skippedUnmappable: number;
  actionIds: string[];
};

/**
 * Materialize proposed actions from persisted agent recommendations
 * (S10 spec §20; extended to CRO decisions in S11 spec §24 and to PRICING
 * decisions in S12 spec §27). Deterministic and idempotent: no AI call
 * happens here, and a decision that already has a root action is skipped
 * (also enforced by a unique index, so a race cannot duplicate).
 *
 * Only decisions that still await a verdict are materialized — an already
 * approved/rejected recommendation is history, not a pending question.
 *
 * The mapping is agent-scoped and closed: CEO categories map to *_REVIEW
 * types, CRO proposals map to CRO_EXPERIMENT_PROPOSAL / CRO_REVIEW, pricing
 * recommendations map to PRICING_REVIEW / MOQ_REVIEW / DATA_QUALITY_REVIEW
 * (never to PRICE_CHANGE or PRICE_EXPERIMENT), and any other agent type maps
 * to nothing at all.
 */
export async function syncDecisionsToActions(actor = "system:decision_sync"): Promise<SyncResult> {
  const db = await getDb();
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(
      and(
        inArray(agentDecisions.agentType, ["ceo", "cro", "pricing"]),
        eq(agentDecisions.approvalStatus, "pending"),
      ),
    )
    .orderBy(desc(agentDecisions.createdAt))
    .limit(ACTION_CENTER_MAX_ROWS);

  const existing = await db
    .select({ decisionId: agentActions.sourceDecisionId })
    .from(agentActions)
    .where(isNull(agentActions.originActionId));
  const alreadyMaterialized = new Set(existing.map((r) => r.decisionId).filter((v): v is string => Boolean(v)));

  const result: SyncResult = { created: 0, blocked: 0, skippedExisting: 0, skippedUnmappable: 0, actionIds: [] };

  for (const decision of decisions) {
    if (alreadyMaterialized.has(decision.id)) {
      result.skippedExisting += 1;
      continue;
    }
    const mapped = mapAgentDecisionToAction({
      id: decision.id,
      agentType: decision.agentType,
      observation: decision.observation,
      reasoningSummary: decision.reasoningSummary,
      riskLevel: decision.riskLevel,
      supportingDataJson: decision.supportingDataJson,
      proposedActionJson: decision.proposedActionJson,
    });
    if (!mapped) {
      // Purely informational recommendation — no action record is invented.
      result.skippedUnmappable += 1;
      continue;
    }

    const { action, decision: verdict } = await proposeAction({
      source: DECISION_AGENT_TO_SOURCE[decision.agentType] ?? "CEO_AGENT",
      actionType: mapped.actionType,
      payload: mapped.payload,
      title: mapped.title,
      createdBy: actor,
      sourceDecisionId: decision.id,
      identityKey: mapped.identityKey,
      modelSuggestedRiskLevel: mapped.modelSuggestedRiskLevel,
    });
    result.actionIds.push(action.id);
    if (verdict.allowed) result.created += 1;
    else result.blocked += 1;
  }

  return result;
}

/** Owner-facing summary for the Action Center header. */
export async function actionCenterSummary(): Promise<Record<ActionStatus, number>> {
  const rows = await listActions({});
  const summary = {
    PROPOSED: 0,
    GUARDRAIL_BLOCKED: 0,
    PENDING_APPROVAL: 0,
    APPROVED: 0,
    REJECTED: 0,
    SUPERSEDED: 0,
  } as Record<ActionStatus, number>;
  for (const row of rows) {
    const status = row.status as ActionStatus;
    if (status in summary) summary[status] += 1;
  }
  return summary;
}

/** Executable action types, for the honest "can this actually run?" answer. */
export function executionCapabilityLabel(actionType: string): string {
  const spec = getActionTypeSpec(actionType);
  if (!spec) return "Unknown action type";
  return spec.executionSupport === "REVIEW_ONLY"
    ? "Review only — approving records a decision to investigate; nothing is executed"
    : "No executor implemented — approving records intent only";
}
