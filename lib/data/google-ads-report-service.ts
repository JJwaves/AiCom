import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { googleAdsReports } from "@/db/schema";
import { newId } from "./id";

/**
 * Google Ads review persistence (Session 13 spec §37).
 *
 * One row per explicit generation run: the review document (server-validated
 * structured output + the exact deterministic snapshot the model saw +
 * prompt/model versioning). Individual recommendations live as AgentDecision
 * rows and are reviewed in the Action Center; this table links them by id.
 *
 * Same shape and doctrine as `ceo_reports` (S09) and `pricing_reports` (S12):
 * append-only, no scheduled generation, no update or delete path. Nothing
 * here changes a campaign — a report records what an advisor said about
 * advertising, never an instruction to Google.
 */

export const googleAdsReportInputSchema = z.object({
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

export type GoogleAdsReportRow = typeof googleAdsReports.$inferSelect;

export async function createGoogleAdsReport(
  input: z.input<typeof googleAdsReportInputSchema>,
): Promise<GoogleAdsReportRow> {
  const parsed = googleAdsReportInputSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(googleAdsReports)
    .values({
      id: newId("gar"),
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
export async function getLatestGoogleAdsReport(periodDays: number): Promise<GoogleAdsReportRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(googleAdsReports)
    .where(eq(googleAdsReports.periodDays, periodDays))
    .orderBy(desc(googleAdsReports.generatedAt))
    .limit(1);
  return row ?? null;
}

export async function listGoogleAdsReports(limit = 20): Promise<GoogleAdsReportRow[]> {
  const db = await getDb();
  return db.select().from(googleAdsReports).orderBy(desc(googleAdsReports.generatedAt)).limit(Math.min(limit, 100));
}
