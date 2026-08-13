import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { ceoReports } from "@/db/schema";
import { newId } from "./id";

/**
 * CEO business-review persistence (Session 09).
 *
 * One row per explicit generation run — the report document (validated
 * structured output + the exact deterministic snapshot the model saw +
 * prompt/model versioning). Individual recommendations live as
 * AgentDecision rows (agent-service); this table links to them by id.
 *
 * There is NO scheduled generation and NO delete/update path: reports are
 * append-only audit records. The admin page shows the latest report per
 * periodDays; older rows remain queryable history.
 */

export const ceoReportInputSchema = z.object({
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

export type CeoReportRow = typeof ceoReports.$inferSelect;

export async function createCeoReport(input: z.input<typeof ceoReportInputSchema>): Promise<CeoReportRow> {
  const parsed = ceoReportInputSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(ceoReports)
    .values({
      id: newId("cbr"),
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

/** Latest report generated for a period length (the admin page's view). */
export async function getLatestCeoReport(periodDays: number): Promise<CeoReportRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(ceoReports)
    .where(eq(ceoReports.periodDays, periodDays))
    .orderBy(desc(ceoReports.generatedAt))
    .limit(1);
  return row ?? null;
}

export async function listCeoReports(limit = 20): Promise<CeoReportRow[]> {
  const db = await getDb();
  return db.select().from(ceoReports).orderBy(desc(ceoReports.generatedAt)).limit(Math.min(limit, 100));
}
