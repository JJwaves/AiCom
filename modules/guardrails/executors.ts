import { getActionTypeSpec } from "./actions";
import type { ExecutionState, ExecutionSupport } from "./types";

/**
 * Executor registry (Session 10 spec §22–§23) — INTENTIONALLY EMPTY.
 *
 * No dummy executors. A registry entry would mean software can actually
 * carry the change out; pretending otherwise is exactly the failure mode
 * this session exists to prevent. Approving an action in the Action Center
 * records a human decision — it does not mutate prices, ads, products,
 * refunds or the storefront, because there is nothing here to run.
 *
 * The future contract every executor must satisfy before being registered
 * (documented in docs/AI_ACTION_CENTER.md, enforced when the first one is
 * written): validated action → guardrail evaluation → required approval →
 * idempotency key → captured before/after state → audit event → rollback
 * metadata where practical.
 */

export type ActionExecutor = {
  actionType: string;
  /** Stable key so a retried execution can never apply twice. */
  idempotencyKeyFor(actionId: string, revision: number): string;
  execute(input: {
    actionId: string;
    revision: number;
    payload: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{ status: "EXECUTED" | "FAILED"; before?: Record<string, unknown>; after?: Record<string, unknown>; error?: string }>;
};

const EXECUTOR_REGISTRY = new Map<string, ActionExecutor>();

export const executorRegistry = {
  has(actionType: string): boolean {
    return EXECUTOR_REGISTRY.has(actionType);
  },
  get(actionType: string): ActionExecutor | null {
    return EXECUTOR_REGISTRY.get(actionType) ?? null;
  },
  /** Registered action types — empty in Session 10, and asserted so by tests. */
  list(): string[] {
    return [...EXECUTOR_REGISTRY.keys()];
  },
};

/** Real execution capability for a type: registry first, taxonomy second. */
export function executionSupportFor(actionType: string): ExecutionSupport {
  const spec = getActionTypeSpec(actionType);
  if (!spec) return "NOT_IMPLEMENTED";
  if (spec.executionSupport === "REVIEW_ONLY") return "REVIEW_ONLY";
  return executorRegistry.has(actionType) ? "AVAILABLE" : "NOT_IMPLEMENTED";
}

/** The execution state a freshly evaluated action starts in (never EXECUTED). */
export function initialExecutionState(support: ExecutionSupport): ExecutionState {
  switch (support) {
    case "REVIEW_ONLY":
      return "NOT_APPLICABLE";
    case "NOT_IMPLEMENTED":
      return "NOT_SUPPORTED";
    case "AVAILABLE":
      return "READY";
  }
}
