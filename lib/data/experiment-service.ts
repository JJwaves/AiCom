import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { EXPERIMENTS, resolveTrafficCap } from "@/config/experiments";
import { GUARDRAIL_POLICY_VERSION } from "@/config/guardrails";
import { getDb } from "@/db/client";
import { experimentAssignments, experimentEvents, experiments } from "@/db/schema";
import {
  canTransition,
  effectiveMinimumSample,
  getExperimentTarget,
  normalizeAllocation,
  parseExperimentDesign,
  validateAllocation,
  variantKeyOf,
  type Allocation,
  type ExperimentDesign,
  type ExperimentStatus,
} from "@/modules/experiments";
import { evaluateAgentAction } from "@/modules/guardrails";
import { newId } from "./id";

/**
 * Experiment persistence + lifecycle (Session 11).
 *
 * This is the ONLY place experiment rows are written. Guarantees implemented
 * here and asserted by tests:
 *  - Launch is HUMAN-triggered, guardrail-evaluated, traffic-capped, and
 *    IDEMPOTENT: launching a running experiment is a no-op success, and a
 *    second experiment on the same target is refused by a database unique
 *    index, not by a hopeful pre-check alone.
 *  - Every lifecycle transition runs inside a row-locked transaction with a
 *    `stateVersion` check, so a double-click or a stale second admin gets a
 *    CONFLICT rather than a rewritten history.
 *  - Stopping preserves ALL history — assignments, exposures and events are
 *    never deleted.
 *  - Assignment rows are sticky: the first arm recorded for a session wins
 *    forever (and the arm is deterministic anyway — see modules/experiments).
 *  - `exposedAt` is stamped ONCE per (experiment, session): assignments and
 *    unique exposed sessions stay countable separately, with no write per
 *    page view.
 */

export type ExperimentRow = typeof experiments.$inferSelect;
export type AssignmentRow = typeof experimentAssignments.$inferSelect;
export type ExperimentEventRow = typeof experimentEvents.$inferSelect;

export const EXPERIMENT_EVENT_TYPES = [
  "experiment_created",
  "experiment_approved",
  "experiment_launched",
  "experiment_stopped",
  "experiment_decided",
  "experiment_archived",
] as const;
export type ExperimentEventType = (typeof EXPERIMENT_EVENT_TYPES)[number];

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

/* ------------------------------------------------------------------ */
/* Creation                                                            */
/* ------------------------------------------------------------------ */

export const experimentCreateSchema = z.object({
  name: z.string().min(3).max(120),
  hypothesis: z.string().min(1).max(4000),
  design: z.unknown(),
  createdBy: z.string().min(1).max(200),
  sourceDecisionId: z.string().max(64).nullable().optional(),
  sourceActionId: z.string().max(64).nullable().optional(),
});

export type CreateExperimentResult =
  | { ok: true; experiment: ExperimentRow }
  | { ok: false; code: "INVALID"; reason: string }
  | { ok: false; code: "DUPLICATE"; reason: string };

/**
 * Create a DRAFT experiment from a fully-specified design. A draft enrolls
 * nobody: only an explicit human launch starts traffic.
 */
export async function createExperimentDraft(
  input: z.input<typeof experimentCreateSchema>,
): Promise<CreateExperimentResult> {
  const parsed = experimentCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID", reason: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const cap = resolveTrafficCap();
  const design = parseExperimentDesign(parsed.data.design, cap.ok ? { maxNonControlPct: cap.capPct } : {});
  if (!design.ok) return { ok: false, code: "INVALID", reason: design.reason };

  const target = getExperimentTarget(design.design.targetKey)!;
  const control = target.describeControl();
  const id = newId("exp");
  const allocation = normalizeAllocation(design.design.allocation);

  const db = await getDb();
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(experiments)
        .values({
          id,
          name: parsed.data.name,
          hypothesis: parsed.data.hypothesis,
          status: "draft",
          primaryMetric: design.design.primaryMetric,
          guardrailMetricsJson: design.design.guardrailMetrics,
          controlJson: { summary: control.summary, config: control.config },
          variantsJson: { [design.design.variantKey]: design.design.variantConfig },
          trafficSplitJson: Object.fromEntries(allocation.map((a) => [a.variant, a.pct])),
          audience: describeAudience(design.design),
          audienceJson: design.design.audience as unknown as Record<string, unknown>,
          minimumSampleSize: effectiveMinimumSample(design.design.minimumSampleSize),
          experimentType: design.design.experimentType,
          targetKey: design.design.targetKey,
          variantKey: design.design.variantKey,
          targetVersion: target.targetVersion,
          secondaryMetricsJson: design.design.secondaryMetrics,
          assignmentSalt: newId("salt"),
          sourceDecisionId: parsed.data.sourceDecisionId ?? null,
          sourceActionId: parsed.data.sourceActionId ?? null,
          createdBy: parsed.data.createdBy.slice(0, 200),
        })
        .returning();
      await insertExperimentEvent(tx, {
        experimentId: row.id,
        type: "experiment_created",
        actor: parsed.data.createdBy,
        detail: {
          targetKey: row.targetKey,
          experimentType: row.experimentType,
          primaryMetric: row.primaryMetric,
          sourceActionId: row.sourceActionId,
        },
      });
      return { ok: true as const, experiment: row };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        code: "DUPLICATE",
        reason: "An experiment with this name (or from this approved action) already exists.",
      };
    }
    throw err;
  }
}

/**
 * Postgres unique-violation detection across the driver's wrapped errors.
 * Drizzle wraps the driver error, so the SQLSTATE and constraint name live
 * on `err.cause` — matching only the outer message would silently miss the
 * race this check exists for.
 */
function isUniqueViolation(err: unknown, constraint?: string): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as { code?: string; constraint?: string; message?: string; cause?: unknown };
    const isUnique = candidate.code === "23505" || /unique constraint|duplicate key/i.test(candidate.message ?? "");
    if (isUnique && (!constraint || candidate.constraint === constraint || (candidate.message ?? "").includes(constraint))) {
      return true;
    }
    if (isUnique && constraint && candidate.constraint && candidate.constraint !== constraint) return false;
    current = candidate.cause;
  }
  return false;
}

const describeAudience = (design: ExperimentDesign): string => {
  const parts: string[] = [];
  const a = design.audience;
  parts.push(a.routes.length > 0 ? `routes ${a.routes.join(", ")}` : "wherever the target renders");
  if (a.trafficSources.length > 0) parts.push(`sources ${a.trafficSources.join(", ")}`);
  if (a.campaigns.length > 0) parts.push(`campaigns ${a.campaigns.join(", ")}`);
  if (a.device !== "any") parts.push(`${a.device} only`);
  if (a.visitor !== "any") parts.push(`${a.visitor} sessions only`);
  return parts.join(" · ").slice(0, 500);
};

/* ------------------------------------------------------------------ */
/* Configuration validation (used by launch AND by every readout)      */
/* ------------------------------------------------------------------ */

export type ExperimentConfig = {
  ok: boolean;
  issues: string[];
  targetKey: string | null;
  variantKey: string | null;
  allocation: Allocation | null;
  variantConfig: Record<string, unknown> | null;
};

/**
 * Re-validate a stored experiment against the CURRENT target registry and
 * allocation rules. A row that no longer validates reads as INVALID in the
 * readout instead of quietly producing numbers.
 */
export function validateStoredExperiment(row: ExperimentRow): ExperimentConfig {
  const issues: string[] = [];
  const targetKey = row.targetKey;
  const variantKey = row.variantKey;
  const target = targetKey ? getExperimentTarget(targetKey) : null;
  if (!target) issues.push(`Unknown experiment target "${targetKey ?? "(none)"}"`);
  if (!variantKey) issues.push("No variant arm recorded");

  const split = row.trafficSplitJson ?? {};
  const allocationInput = Object.entries(split).map(([variant, pct]) => ({ variant, pct }));
  const allocation = validateAllocation(allocationInput);
  if (!allocation.ok) issues.push(...allocation.errors);

  let variantConfig: Record<string, unknown> | null = null;
  if (target && variantKey) {
    const stored = (row.variantsJson ?? {}) as Record<string, unknown>;
    const parsed = target.variantSchema.safeParse(stored[variantKey]);
    if (!parsed.success) issues.push(`Stored variant config for "${variantKey}" no longer validates`);
    else variantConfig = parsed.data as unknown as Record<string, unknown>;
  }

  return {
    ok: issues.length === 0,
    issues,
    targetKey,
    variantKey,
    allocation: allocation.ok ? allocation.allocation : null,
    variantConfig,
  };
}

/* ------------------------------------------------------------------ */
/* Launch / stop / archive                                             */
/* ------------------------------------------------------------------ */

export type LaunchResult =
  | { ok: true; experiment: ExperimentRow; alreadyRunning: boolean }
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "INVALID"; reason: string; missingConfiguration?: string[] }
  | { ok: false; code: "TARGET_BUSY"; reason: string }
  | { ok: false; code: "CONFLICT"; reason: string; currentStatus: string; currentStateVersion: number };

/**
 * Launch an experiment onto live traffic (spec §25–§27).
 *
 * This is an EXPLICIT HUMAN action, never an agent capability — the CRO
 * agent has no path to this function (see tests/experiments-separation).
 * Preconditions, all enforced here:
 *   1. the stored configuration still validates against the target registry;
 *   2. the traffic ceiling resolves (a missing business limit BLOCKS in
 *      production and is never read as 100%);
 *   3. the allocation fits under that ceiling;
 *   4. the Guardrail Engine allows a HUMAN_ADMIN CRO_EXPERIMENT_LAUNCH for
 *      this configuration — its verdict, policy version and missing
 *      configuration are snapshotted on the row;
 *   5. no other experiment is running on the same target (unique index).
 *
 * Idempotent: launching an already-running experiment returns success with
 * `alreadyRunning: true` and writes nothing.
 */
export async function launchExperiment(input: {
  experimentId: string;
  /** SERVER-DERIVED admin identity. Never from a request body. */
  actor: string;
  expectedStateVersion: number;
}): Promise<LaunchResult> {
  const db = await getDb();
  const existing = await getExperiment(input.experimentId);
  if (!existing) return { ok: false, code: "NOT_FOUND" };
  if (existing.status === "running") {
    return { ok: true, experiment: existing, alreadyRunning: true };
  }

  const config = validateStoredExperiment(existing);
  if (!config.ok || !config.allocation || !config.variantConfig || !config.targetKey) {
    return { ok: false, code: "INVALID", reason: config.issues.join("; ") };
  }

  const cap = resolveTrafficCap();
  if (!cap.ok) {
    return { ok: false, code: "INVALID", reason: cap.reason, missingConfiguration: cap.missingConfiguration };
  }
  const capped = validateAllocation(config.allocation, { maxNonControlPct: cap.capPct });
  if (!capped.ok) return { ok: false, code: "INVALID", reason: capped.errors.join("; ") };

  /* The Guardrail Engine evaluates the launch as a HUMAN_ADMIN action. It
   * cannot be bypassed and its verdict is stored with the experiment. */
  const verdict = evaluateAgentAction({
    source: "HUMAN_ADMIN",
    actionType: "CRO_EXPERIMENT_LAUNCH",
    autonomyMode: "RECOMMEND",
    payload: {
      experimentName: existing.name,
      experimentId: existing.id,
      page: config.targetKey,
      trafficPct: capped.nonControlPct,
      primaryMetric: existing.primaryMetric,
      metricRefs: [],
      evidenceRefs: [],
    },
  });
  if (!verdict.decision.allowed) {
    return { ok: false, code: "INVALID", reason: verdict.decision.reason };
  }

  const now = new Date();
  const policySnapshot = {
    policyVersion: verdict.decision.policyVersion,
    riskLevel: verdict.decision.riskLevel,
    violatedRules: verdict.decision.violatedRules,
    missingConfiguration: verdict.decision.missingConfiguration,
    limitsSnapshot: verdict.decision.limitsSnapshot,
    trafficCap: { capPct: cap.capPct, source: cap.source, note: cap.note },
    nonControlPct: capped.nonControlPct,
    executionSupport: verdict.decision.executionSupport,
    launchMode: "human_admin_route",
  };

  try {
    return await db.transaction(async (tx) => {
      const locked = await lockExperiment(tx, input.experimentId);
      if (!locked) return { ok: false as const, code: "NOT_FOUND" as const };
      if (locked.status === "running") return { ok: true as const, experiment: locked, alreadyRunning: true };

      const transition = canTransition(locked.status as ExperimentStatus, "running");
      if (!transition.ok) {
        return conflict(locked, transition.reason);
      }
      if (locked.stateVersion !== input.expectedStateVersion) {
        return conflict(locked, "The experiment changed since it was loaded — reload before launching.");
      }

      const [updated] = await tx
        .update(experiments)
        .set({
          status: "running",
          startAt: locked.startAt ?? now,
          launchedAt: now,
          launchedBy: input.actor.slice(0, 200),
          policyVersion: GUARDRAIL_POLICY_VERSION,
          policySnapshotJson: policySnapshot as unknown as Record<string, unknown>,
          stateVersion: locked.stateVersion + 1,
          updatedAt: now,
        })
        .where(and(eq(experiments.id, locked.id), eq(experiments.stateVersion, locked.stateVersion)))
        .returning();
      if (!updated) return conflict(locked, "Concurrent update detected.");

      await insertExperimentEvent(tx, {
        experimentId: updated.id,
        type: "experiment_launched",
        actor: input.actor,
        detail: policySnapshot as unknown as Record<string, unknown>,
      });
      return { ok: true as const, experiment: updated, alreadyRunning: false };
    });
  } catch (err) {
    // The one-running-experiment-per-target rule is enforced by a partial
    // unique index, so a race loses at the DATABASE, not at a pre-check.
    if (isUniqueViolation(err, "experiments_running_target_idx")) {
      return {
        ok: false,
        code: "TARGET_BUSY",
        reason: `Another experiment is already running on target "${config.targetKey}". Stop it before launching this one.`,
      };
    }
    throw err;
  }
}

export type StopResult =
  | { ok: true; experiment: ExperimentRow; alreadyStopped: boolean }
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "CONFLICT"; reason: string; currentStatus: string; currentStateVersion: number };

/**
 * Stop a running experiment (spec §33). Idempotent, and destructive of
 * nothing: assignments, exposures, events and conversions are preserved,
 * and the final readout is frozen onto the row so later config changes
 * cannot rewrite history.
 */
export async function stopExperiment(input: {
  experimentId: string;
  actor: string;
  reason?: string;
  expectedStateVersion: number;
  /** Deterministically computed readout, frozen at stop time. */
  finalReadout?: Record<string, unknown>;
}): Promise<StopResult> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const locked = await lockExperiment(tx, input.experimentId);
    if (!locked) return { ok: false as const, code: "NOT_FOUND" as const };
    if (locked.status === "stopped") return { ok: true as const, experiment: locked, alreadyStopped: true };

    const transition = canTransition(locked.status as ExperimentStatus, "stopped");
    if (!transition.ok) return conflict(locked, transition.reason);
    if (locked.stateVersion !== input.expectedStateVersion) {
      return conflict(locked, "The experiment changed since it was loaded — reload before stopping.");
    }

    const now = new Date();
    const [updated] = await tx
      .update(experiments)
      .set({
        status: "stopped",
        endAt: now,
        stoppedAt: now,
        stoppedBy: input.actor.slice(0, 200),
        stopReason: input.reason?.slice(0, 1000) ?? null,
        resultJson: input.finalReadout ?? locked.resultJson,
        stateVersion: locked.stateVersion + 1,
        updatedAt: now,
      })
      .where(and(eq(experiments.id, locked.id), eq(experiments.stateVersion, locked.stateVersion)))
      .returning();
    if (!updated) return conflict(locked, "Concurrent update detected.");

    await insertExperimentEvent(tx, {
      experimentId: updated.id,
      type: "experiment_stopped",
      actor: input.actor,
      detail: { reason: input.reason ?? null, resultState: (input.finalReadout?.state as string) ?? null },
    });
    return { ok: true as const, experiment: updated, alreadyStopped: false };
  });
}

export async function archiveExperiment(input: {
  experimentId: string;
  actor: string;
  expectedStateVersion: number;
}): Promise<StopResult> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const locked = await lockExperiment(tx, input.experimentId);
    if (!locked) return { ok: false as const, code: "NOT_FOUND" as const };
    if (locked.status === "archived") return { ok: true as const, experiment: locked, alreadyStopped: true };

    const transition = canTransition(locked.status as ExperimentStatus, "archived");
    if (!transition.ok) return conflict(locked, transition.reason);
    if (locked.stateVersion !== input.expectedStateVersion) {
      return conflict(locked, "The experiment changed since it was loaded — reload before archiving.");
    }
    const now = new Date();
    const [updated] = await tx
      .update(experiments)
      .set({ status: "archived", archivedAt: now, stateVersion: locked.stateVersion + 1, updatedAt: now })
      .where(and(eq(experiments.id, locked.id), eq(experiments.stateVersion, locked.stateVersion)))
      .returning();
    if (!updated) return conflict(locked, "Concurrent update detected.");
    await insertExperimentEvent(tx, { experimentId: updated.id, type: "experiment_archived", actor: input.actor });
    return { ok: true as const, experiment: updated, alreadyStopped: false };
  });
}

const conflict = (row: ExperimentRow, reason: string) =>
  ({
    ok: false as const,
    code: "CONFLICT" as const,
    reason,
    currentStatus: row.status,
    currentStateVersion: row.stateVersion,
  });

async function lockExperiment(tx: Tx, id: string): Promise<ExperimentRow | null> {
  const [row] = await tx.select().from(experiments).where(eq(experiments.id, id)).limit(1).for("update");
  return row ?? null;
}

async function insertExperimentEvent(
  tx: Tx,
  input: { experimentId: string; type: ExperimentEventType; actor: string; detail?: Record<string, unknown> },
): Promise<void> {
  await tx.insert(experimentEvents).values({
    id: newId("xev"),
    experimentId: input.experimentId,
    type: input.type,
    actor: input.actor.slice(0, 200),
    detailJson: input.detail ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* Assignment + exposure                                               */
/* ------------------------------------------------------------------ */

/**
 * Record the (deterministically computed) arm for a session. Sticky: the
 * first row wins and later calls return it unchanged, so a mid-experiment
 * allocation edit could never move a customer between arms.
 */
export async function recordAssignment(
  experimentId: string,
  sessionId: string,
  variant: string,
): Promise<AssignmentRow | null> {
  const db = await getDb();
  await db
    .insert(experimentAssignments)
    .values({ experimentId, sessionId, variant })
    .onConflictDoNothing({ target: [experimentAssignments.experimentId, experimentAssignments.sessionId] });
  return getAssignment(experimentId, sessionId);
}

export async function getAssignment(experimentId: string, sessionId: string): Promise<AssignmentRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(experimentAssignments)
    .where(
      and(eq(experimentAssignments.experimentId, experimentId), eq(experimentAssignments.sessionId, sessionId)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Stamp the FIRST exposure for a session. Returns true only when this call
 * performed the stamp — the caller emits the `experiment_exposed` event
 * exactly then, so exposures can never inflate on repeat page views.
 */
export async function markExposed(experimentId: string, sessionId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(experimentAssignments)
    .set({ exposedAt: new Date() })
    .where(
      and(
        eq(experimentAssignments.experimentId, experimentId),
        eq(experimentAssignments.sessionId, sessionId),
        isNull(experimentAssignments.exposedAt),
      ),
    )
    .returning({ sessionId: experimentAssignments.sessionId });
  return rows.length > 0;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function getExperiment(id: string): Promise<ExperimentRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(experiments).where(eq(experiments.id, id)).limit(1);
  return row ?? null;
}

export async function listExperiments(filter: { status?: ExperimentStatus[]; limit?: number } = {}): Promise<ExperimentRow[]> {
  const db = await getDb();
  const limit = Math.min(filter.limit ?? EXPERIMENTS.MAX_ROWS, EXPERIMENTS.MAX_ROWS);
  const base = db.select().from(experiments);
  const query = filter.status?.length ? base.where(inArray(experiments.status, filter.status)) : base;
  return query.orderBy(desc(experiments.createdAt)).limit(limit);
}

/** The ONE running experiment for a target, or null (spec §45). */
export async function findRunningExperimentForTarget(targetKey: string): Promise<ExperimentRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(experiments)
    .where(and(eq(experiments.status, "running"), eq(experiments.targetKey, targetKey)))
    .limit(1);
  return row ?? null;
}

export async function listExperimentEvents(experimentId: string): Promise<ExperimentEventRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(experimentEvents)
    .where(eq(experimentEvents.experimentId, experimentId))
    .orderBy(experimentEvents.createdAt);
}

export type ArmTotals = { variant: string; assignments: number; exposedSessions: number };

/** Assignment count and unique exposed sessions — reported SEPARATELY (spec §12). */
export async function armTotals(experimentId: string): Promise<ArmTotals[]> {
  const db = await getDb();
  const rows = await db
    .select({
      variant: experimentAssignments.variant,
      assignments: sql<number>`count(*)::float8`,
      exposedSessions: sql<number>`count(*) filter (where ${isNotNull(experimentAssignments.exposedAt)})::float8`,
    })
    .from(experimentAssignments)
    .where(eq(experimentAssignments.experimentId, experimentId))
    .groupBy(experimentAssignments.variant);
  return rows.map((r) => ({
    variant: r.variant,
    assignments: Number(r.assignments) || 0,
    exposedSessions: Number(r.exposedSessions) || 0,
  }));
}

/** Experiments already materialized from approved actions (sync idempotency). */
export async function experimentsBySourceActionIds(actionIds: string[]): Promise<Map<string, ExperimentRow>> {
  if (actionIds.length === 0) return new Map();
  const db = await getDb();
  const rows = await db.select().from(experiments).where(inArray(experiments.sourceActionId, actionIds));
  const map = new Map<string, ExperimentRow>();
  for (const row of rows) if (row.sourceActionId) map.set(row.sourceActionId, row);
  return map;
}

/** Convenience for the admin surface + readouts. */
export function allocationOf(row: ExperimentRow): Allocation {
  return normalizeAllocation(Object.entries(row.trafficSplitJson ?? {}).map(([variant, pct]) => ({ variant, pct })));
}

export function variantKeyOfRow(row: ExperimentRow): string | null {
  return row.variantKey ?? variantKeyOf(allocationOf(row));
}
