import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { commerceReconciliationRuns } from "@/db/schema";
import { newId } from "./id";

/**
 * Reconciliation run records (Production Launch Session 03 §27).
 *
 * Lightweight operational metadata, mirroring `google_ads_sync_runs`: what
 * range was inspected, what was found, what was repaired, what failed. No
 * Shopify credential, no payment data, no customer data.
 *
 * The row is written BEFORE the sweep and completed after, so a run that
 * crashes mid-way leaves a visible `running` row rather than no evidence
 * that anything was attempted.
 */

export type ReconciliationRunRow = typeof commerceReconciliationRuns.$inferSelect;
export type ReconciliationRunStatus = "running" | "success" | "partial" | "failed" | "not_configured";

export async function startReconciliationRun(input: {
  provider?: string;
  rangeStart: Date;
  rangeEnd: Date;
  triggeredBy: string;
}): Promise<ReconciliationRunRow> {
  const db = await getDb();
  const [row] = await db
    .insert(commerceReconciliationRuns)
    .values({
      id: newId("recon"),
      provider: input.provider ?? "shopify",
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      triggeredBy: input.triggeredBy,
      status: "running",
    })
    .returning();
  return row;
}

export async function completeReconciliationRun(input: {
  id: string;
  status: ReconciliationRunStatus;
  ordersInspected?: number;
  repairsPerformed?: number;
  alreadyConsistent?: number;
  failures?: number;
  truncated?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<ReconciliationRunRow | null> {
  const db = await getDb();
  const [row] = await db
    .update(commerceReconciliationRuns)
    .set({
      status: input.status,
      completedAt: new Date(),
      ordersInspected: input.ordersInspected ?? 0,
      repairsPerformed: input.repairsPerformed ?? 0,
      alreadyConsistent: input.alreadyConsistent ?? 0,
      failures: input.failures ?? 0,
      truncated: input.truncated ?? false,
      errorCode: input.errorCode ?? null,
      // Bounded and already redacted by the caller — never a raw provider body.
      errorMessage: input.errorMessage ? input.errorMessage.slice(0, 500) : null,
    })
    .where(eq(commerceReconciliationRuns.id, input.id))
    .returning();
  return row ?? null;
}

export async function listReconciliationRuns(limit = 20): Promise<ReconciliationRunRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(commerceReconciliationRuns)
    .orderBy(desc(commerceReconciliationRuns.startedAt))
    .limit(Math.min(limit, 200));
}

export async function latestReconciliationRun(): Promise<ReconciliationRunRow | null> {
  const [row] = await listReconciliationRuns(1);
  return row ?? null;
}
