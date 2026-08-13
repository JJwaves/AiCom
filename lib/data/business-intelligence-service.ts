import { and, gte, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { aiUsage, sessions } from "@/db/schema";

/**
 * Business-intelligence data access (Session 09).
 *
 * READ-ONLY aggregates feeding modules/business-intelligence. Same
 * doctrine as lib/data/intelligence-service.ts: this file is the only
 * place BI code touches these tables, nothing here calls a model, and
 * every count/sum casts ::float8 (int4 sums accumulate as bigint; float8
 * parses as a JS number and is integer-exact to 2^53).
 *
 * Orders/lines/events/configurations reuse the S08 queries in
 * intelligence-service.ts — one bounded read path per table.
 */

const periodSchema = z.object({ start: z.date(), end: z.date() });

/** Sessions started in [start, end) — the top of the business funnel. */
export async function countSessionsStartedBetween(start: Date, end: Date): Promise<number> {
  periodSchema.parse({ start, end });
  const db = await getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::float8` })
    .from(sessions)
    .where(and(gte(sessions.startedAt, start), lt(sessions.startedAt, end)));
  return row?.count ?? 0;
}

/** Bounded session rows started in [start, end) — attribution breakdowns. */
export async function listSessionsStartedBetween(start: Date, end: Date, limit = 5000) {
  periodSchema.parse({ start, end });
  const db = await getDb();
  return db
    .select()
    .from(sessions)
    .where(and(gte(sessions.startedAt, start), lt(sessions.startedAt, end)))
    .orderBy(sessions.startedAt)
    .limit(Math.min(limit, 5000));
}

export type AiUsageAggregate = {
  provider: string;
  model: string;
  /** agent_type of the call; null for untagged infra calls. */
  agentType: string | null;
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** Sum of estimatedCostMicros over PRICED rows only. */
  pricedCostMicros: number;
  /** Rows whose cost is unrecorded (model pricing unconfigured at call time). */
  unpricedCalls: number;
};

/**
 * AI usage grouped by (provider, model, agentType) in [start, end).
 * Unpriced rows are COUNTED, never treated as zero cost — the caller
 * surfaces spend as PARTIAL/UNAVAILABLE accordingly (spec §8).
 */
export async function aiUsageAggregatesBetween(start: Date, end: Date): Promise<AiUsageAggregate[]> {
  periodSchema.parse({ start, end });
  const db = await getDb();
  return db
    .select({
      provider: aiUsage.provider,
      model: aiUsage.model,
      agentType: aiUsage.agentType,
      calls: sql<number>`count(*)::float8`,
      failedCalls: sql<number>`count(*) filter (where not ${aiUsage.success})::float8`,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::float8`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::float8`,
      pricedCostMicros: sql<number>`coalesce(sum(${aiUsage.estimatedCostMicros}), 0)::float8`,
      unpricedCalls: sql<number>`count(*) filter (where ${isNull(aiUsage.estimatedCostMicros)})::float8`,
    })
    .from(aiUsage)
    .where(and(gte(aiUsage.createdAt, start), lt(aiUsage.createdAt, end)))
    .groupBy(aiUsage.provider, aiUsage.model, aiUsage.agentType);
}
