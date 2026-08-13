import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { agentConfigs, agentDecisions, approvals } from "@/db/schema";
import { newId } from "./id";

/**
 * Agent decision infrastructure — records only, no autonomous agents exist.
 *
 * AgentDecision is the audit spine: what an agent observed, reasoned, and
 * proposes. The proposed action is a typed AgentAction (below) — the same
 * structure the future guardrail engine's evaluateAgentAction() consumes
 * (GUARDRAILS.md). Financially meaningful actions require an Approval row;
 * every review is logged with reviewer + before/after.
 *
 * Autonomy is data, not prompts: getAgentConfig() returns OBSERVE when no
 * row exists — the fail-safe floor.
 */

export const AGENT_TYPES = ["sales", "customer_intelligence", "pricing", "cro", "google_ads", "meta_ads", "ceo"] as const;
export const AUTONOMY_MODES = ["OBSERVE", "RECOMMEND", "GUARDED_AUTO", "AUTONOMOUS"] as const;
export const RISK_LEVELS = ["low", "medium", "high"] as const;
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "modified"] as const;
export const EXECUTION_STATUSES = ["none", "scheduled", "executed", "rolled_back", "failed"] as const;

/**
 * AgentAction — the lightweight typed structure every proposed action must
 * fit. Deliberately NOT a table: an action lives inside its decision record
 * (and later inside the guardrail verdict log) — one audit trail, no
 * duplicate concepts.
 */
export const agentActionSchema = z.object({
  agentType: z.enum(AGENT_TYPES),
  actionType: z.string().min(1).max(100),
  params: z.record(z.string().max(64), z.unknown()).refine((p) => Object.keys(p).length <= 40, "Too many params"),
  expectedEffect: z.string().max(2000).optional(),
});

export type AgentAction = z.infer<typeof agentActionSchema>;

export const decisionInputSchema = z.object({
  agentType: z.enum(AGENT_TYPES),
  decisionType: z.string().min(1).max(100),
  observation: z.string().min(1).max(8000),
  reasoningSummary: z.string().min(1).max(8000),
  supportingData: z.record(z.string(), z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  riskLevel: z.enum(RISK_LEVELS),
  proposedAction: agentActionSchema,
  approvalRequired: z.boolean().default(true),
});

export type DecisionRow = typeof agentDecisions.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;

/** Record a decision; when approval is required a pending Approval row is created with it. */
export async function recordDecision(
  input: z.input<typeof decisionInputSchema>,
): Promise<{ decision: DecisionRow; approval: ApprovalRow | null }> {
  const parsed = decisionInputSchema.parse(input);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [decision] = await tx
      .insert(agentDecisions)
      .values({
        id: newId("dec"),
        agentType: parsed.agentType,
        decisionType: parsed.decisionType,
        observation: parsed.observation,
        reasoningSummary: parsed.reasoningSummary,
        supportingDataJson: parsed.supportingData ?? null,
        confidence: parsed.confidence ?? null,
        riskLevel: parsed.riskLevel,
        proposedActionJson: parsed.proposedAction,
        approvalRequired: parsed.approvalRequired,
        approvalStatus: parsed.approvalRequired ? "pending" : "none",
      })
      .returning();

    let approval: ApprovalRow | null = null;
    if (parsed.approvalRequired) {
      const [a] = await tx.insert(approvals).values({ id: newId("apr"), decisionId: decision.id }).returning();
      approval = a;
    }
    return { decision, approval };
  });
}

/** Human review of a pending approval — updates the approval and its parent decision atomically. */
export async function reviewApproval(input: {
  approvalId: string;
  status: "approved" | "rejected" | "modified";
  reviewedBy: string;
  reviewNotes?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}): Promise<void> {
  z.enum(APPROVAL_STATUSES).parse(input.status);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [approval] = await tx.select().from(approvals).where(eq(approvals.id, input.approvalId)).limit(1);
    if (!approval) throw new Error(`Unknown approval "${input.approvalId}"`);
    await tx
      .update(approvals)
      .set({
        status: input.status,
        reviewedAt: new Date(),
        reviewedBy: input.reviewedBy.slice(0, 200),
        reviewNotes: input.reviewNotes?.slice(0, 4000) ?? null,
        beforeJson: input.before ?? null,
        afterJson: input.after ?? null,
      })
      .where(eq(approvals.id, input.approvalId));
    await tx
      .update(agentDecisions)
      .set({ approvalStatus: input.status })
      .where(eq(agentDecisions.id, approval.decisionId));
  });
}

export async function setExecutionStatus(
  decisionId: string,
  executionStatus: (typeof EXECUTION_STATUSES)[number],
  result?: Record<string, unknown>,
): Promise<void> {
  z.enum(EXECUTION_STATUSES).parse(executionStatus);
  const db = await getDb();
  await db
    .update(agentDecisions)
    .set({
      executionStatus,
      resultJson: result ?? null,
      executedAt: executionStatus === "executed" ? new Date() : undefined,
    })
    .where(eq(agentDecisions.id, decisionId));
}

/**
 * Refresh a PENDING, never-executed recommendation in place (Session 09
 * CEO dedup, spec §24): when the same recommendation identity regenerates
 * with fresh evidence, its decision row is updated rather than duplicated.
 * Reviewed decisions (approved/rejected/modified) are frozen — a human
 * verdict is never overwritten by regeneration. Returns false when the
 * row is missing or no longer updatable.
 */
export async function updateDecisionRecommendation(
  decisionId: string,
  input: {
    observation: string;
    reasoningSummary: string;
    supportingData?: Record<string, unknown>;
    confidence?: number;
    riskLevel: (typeof RISK_LEVELS)[number];
    proposedAction: AgentAction;
  },
): Promise<boolean> {
  z.enum(RISK_LEVELS).parse(input.riskLevel);
  agentActionSchema.parse(input.proposedAction);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(agentDecisions).where(eq(agentDecisions.id, decisionId)).limit(1);
    if (!row || row.approvalStatus !== "pending" || row.executionStatus !== "none") return false;
    await tx
      .update(agentDecisions)
      .set({
        observation: input.observation.slice(0, 8000),
        reasoningSummary: input.reasoningSummary.slice(0, 8000),
        supportingDataJson: input.supportingData ?? null,
        confidence: input.confidence ?? null,
        riskLevel: input.riskLevel,
        proposedActionJson: input.proposedAction,
      })
      .where(eq(agentDecisions.id, decisionId));
    return true;
  });
}

export async function getDecision(id: string): Promise<DecisionRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(agentDecisions).where(eq(agentDecisions.id, id)).limit(1);
  return row ?? null;
}

export async function listDecisions(agentType?: (typeof AGENT_TYPES)[number], limit = 100): Promise<DecisionRow[]> {
  const db = await getDb();
  const base = db.select().from(agentDecisions);
  const query = agentType ? base.where(eq(agentDecisions.agentType, agentType)) : base;
  return query.orderBy(desc(agentDecisions.createdAt)).limit(Math.min(limit, 1000));
}

/** Missing config row reads as OBSERVE — least autonomy is the default, always. */
export async function getAgentConfig(
  agentType: (typeof AGENT_TYPES)[number],
): Promise<{ agentType: string; autonomyMode: (typeof AUTONOMY_MODES)[number]; limitsJson: Record<string, unknown> | null }> {
  const db = await getDb();
  const [row] = await db.select().from(agentConfigs).where(eq(agentConfigs.agentType, agentType)).limit(1);
  if (!row) return { agentType, autonomyMode: "OBSERVE", limitsJson: null };
  return {
    agentType: row.agentType,
    autonomyMode: (AUTONOMY_MODES as readonly string[]).includes(row.autonomyMode)
      ? (row.autonomyMode as (typeof AUTONOMY_MODES)[number])
      : "OBSERVE",
    limitsJson: row.limitsJson,
  };
}

export async function setAgentConfig(input: {
  agentType: (typeof AGENT_TYPES)[number];
  autonomyMode: (typeof AUTONOMY_MODES)[number];
  limits?: Record<string, unknown>;
}): Promise<void> {
  z.enum(AGENT_TYPES).parse(input.agentType);
  z.enum(AUTONOMY_MODES).parse(input.autonomyMode);
  const db = await getDb();
  await db
    .insert(agentConfigs)
    .values({ agentType: input.agentType, autonomyMode: input.autonomyMode, limitsJson: input.limits ?? null })
    .onConflictDoUpdate({
      target: agentConfigs.agentType,
      set: { autonomyMode: input.autonomyMode, limitsJson: input.limits ?? null, updatedAt: new Date() },
    });
}
