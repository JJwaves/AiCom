import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { pricingReports } from "@/db/schema";
import { newId } from "./id";

/**
 * Pricing-review persistence (Session 12 spec §39).
 *
 * One row per explicit generation run: the review document (server-validated
 * structured output + the exact deterministic snapshot the model saw +
 * prompt/model versioning). Individual recommendations live as AgentDecision
 * rows (agent-service) and are reviewed in the Action Center; this table
 * links to them by id.
 *
 * Same shape and doctrine as `ceo_reports`: append-only, no scheduled
 * generation, no update or delete path. Nothing here prices anything — a
 * report records what an advisor said about pricing, never a price.
 */

export const pricingReportInputSchema = z.object({
  periodStart: z.date(),
  periodEnd: z.date(),
  periodDays: z.number().int().min(1).max(365),
  promptId: z.string().max(100).optional(),
  promptVersion: z.string().max(20).optional(),
  model: z.string().max(100).optional(),
  provider: z.string().max(50).optional(),
  snapshot: z.record(z.string(), z.unknown()),
  review: z.record(z.string(), z.unknown()),
  decisionIds: z.array(z.string().min(1).max(64)).max(100),
});

export type PricingReportRow = typeof pricingReports.$inferSelect;

export async function createPricingReport(
  input: z.input<typeof pricingReportInputSchema>,
): Promise<PricingReportRow> {
  const parsed = pricingReportInputSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(pricingReports)
    .values({
      id: newId("prr"),
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      periodDays: parsed.periodDays,
      promptId: parsed.promptId ?? null,
      promptVersion: parsed.promptVersion ?? null,
      model: parsed.model ?? null,
      provider: parsed.provider ?? null,
      snapshotJson: parsed.snapshot,
      reviewJson: parsed.review,
      decisionIdsJson: parsed.decisionIds,
      generatedAt: new Date(),
    })
    .returning();
  return row;
}

/** Latest review generated for a period length (the admin page's view). */
export async function getLatestPricingReport(periodDays: number): Promise<PricingReportRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(pricingReports)
    .where(eq(pricingReports.periodDays, periodDays))
    .orderBy(desc(pricingReports.generatedAt))
    .limit(1);
  return row ?? null;
}

export async function listPricingReports(limit = 20): Promise<PricingReportRow[]> {
  const db = await getDb();
  return db.select().from(pricingReports).orderBy(desc(pricingReports.generatedAt)).limit(Math.min(limit, 100));
}
