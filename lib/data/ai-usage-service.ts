import { desc, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { aiUsage } from "@/db/schema";
import { newId } from "./id";

/**
 * AiUsage — one row per model call (provider, model, tokens, estimated cost
 * in MICRO-dollars, latency, outcome). No AI runs yet; Session 04's provider
 * layer records through this interface, and the totals feed the budget caps
 * that disable AI features gracefully (GUARDRAILS.md).
 */

export const aiUsageInputSchema = z.object({
  sessionId: z.string().optional(),
  conversationId: z.string().optional(),
  agentType: z.string().max(50).optional(),
  provider: z.string().min(1).max(50),
  model: z.string().min(1).max(100),
  requestType: z.string().min(1).max(50),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  /** Micro-dollars (1e-6 USD). */
  estimatedCostMicros: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  success: z.boolean(),
  errorCode: z.string().max(100).optional(),
  /** Versioned prompt that produced this call (lib/ai/prompts registry). */
  promptId: z.string().max(100).optional(),
  promptVersion: z.string().max(20).optional(),
});

export type AiUsageRow = typeof aiUsage.$inferSelect;

export async function recordAiUsage(input: z.input<typeof aiUsageInputSchema>): Promise<AiUsageRow> {
  const parsed = aiUsageInputSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(aiUsage)
    .values({
      id: newId("aiu"),
      sessionId: parsed.sessionId ?? null,
      conversationId: parsed.conversationId ?? null,
      agentType: parsed.agentType ?? null,
      provider: parsed.provider,
      model: parsed.model,
      requestType: parsed.requestType,
      inputTokens: parsed.inputTokens ?? null,
      outputTokens: parsed.outputTokens ?? null,
      estimatedCostMicros: parsed.estimatedCostMicros ?? null,
      latencyMs: parsed.latencyMs ?? null,
      success: parsed.success,
      errorCode: parsed.errorCode ?? null,
      promptId: parsed.promptId ?? null,
      promptVersion: parsed.promptVersion ?? null,
    })
    .returning();
  return row;
}

export async function listRecentAiUsage(limit = 100): Promise<AiUsageRow[]> {
  const db = await getDb();
  return db.select().from(aiUsage).orderBy(desc(aiUsage.createdAt)).limit(Math.min(limit, 1000));
}

/**
 * Aggregate spend since a moment — the input for daily/monthly AI budget caps.
 *
 * Overflow safety (Session 03.5): sum() over int4 columns accumulates as
 * bigint, and the previous `::int` result casts blew up past 2^31−1 — only
 * ~$2,147 of cost in micro-dollars (or ~2.1B tokens), well inside a real
 * monthly window. The results are cast to float8 instead: both drivers
 * (node-postgres and PGlite) parse float8 as a JS number (int8 would arrive
 * as a string), and float8 is integer-exact up to 2^53 — around $9 billion
 * in micro-dollars, far beyond any budget cap this feeds.
 */
export async function aiUsageTotalsSince(
  since: Date,
): Promise<{ calls: number; inputTokens: number; outputTokens: number; estimatedCostMicros: number }> {
  const db = await getDb();
  const [row] = await db
    .select({
      calls: sql<number>`count(*)::float8`,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::float8`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::float8`,
      estimatedCostMicros: sql<number>`coalesce(sum(${aiUsage.estimatedCostMicros}), 0)::float8`,
    })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, since));
  return row;
}
