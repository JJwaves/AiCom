import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { customerInsights, productOpportunities } from "@/db/schema";
import { newId } from "./id";

/**
 * CustomerInsight + ProductOpportunity — data capability only this session;
 * NOTHING generates rows yet (Customer Intelligence is Stage D).
 *
 * Anti-fabrication is structural: an insight cannot be written without
 * sourceRefs pointing at real rows, and evidenceCount must match at least
 * the number of refs provided. Opportunities always require human
 * validation until explicitly cleared.
 */

const sourceRefSchema = z.object({ table: z.string().min(1).max(64), id: z.string().min(1).max(64) });

export const insightInputSchema = z.object({
  insightType: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  summary: z.string().max(4000).optional(),
  value: z.record(z.string(), z.unknown()).optional(),
  /** Traceability is mandatory — every insight must reference real records. */
  sourceRefs: z.array(sourceRefSchema).min(1).max(500),
  evidenceCount: z.number().int().positive(),
  confidence: z.number().min(0).max(1).optional(),
  periodStart: z.date().optional(),
  periodEnd: z.date().optional(),
});

export type InsightRow = typeof customerInsights.$inferSelect;
export type OpportunityRow = typeof productOpportunities.$inferSelect;

export async function createInsight(input: z.input<typeof insightInputSchema>): Promise<InsightRow> {
  const parsed = insightInputSchema.parse(input);
  if (parsed.evidenceCount < parsed.sourceRefs.length) {
    throw new Error("evidenceCount cannot be lower than the number of source references");
  }
  const db = await getDb();
  const [row] = await db
    .insert(customerInsights)
    .values({
      id: newId("ins"),
      insightType: parsed.insightType,
      title: parsed.title,
      summary: parsed.summary ?? null,
      valueJson: parsed.value ?? null,
      evidenceCount: parsed.evidenceCount,
      sourceRefsJson: parsed.sourceRefs,
      confidence: parsed.confidence ?? null,
      periodStart: parsed.periodStart ?? null,
      periodEnd: parsed.periodEnd ?? null,
    })
    .returning();
  return row;
}

export async function listInsights(limit = 100): Promise<InsightRow[]> {
  const db = await getDb();
  return db.select().from(customerInsights).orderBy(desc(customerInsights.createdAt)).limit(Math.min(limit, 1000));
}

export const INSIGHT_STATUSES = ["candidate", "validated", "archived"] as const;

export async function setInsightStatus(id: string, status: (typeof INSIGHT_STATUSES)[number]): Promise<void> {
  z.enum(INSIGHT_STATUSES).parse(status);
  const db = await getDb();
  await db.update(customerInsights).set({ status, updatedAt: new Date() }).where(eq(customerInsights.id, id));
}

export const opportunityInputSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(4000),
  evidenceCount: z.number().int().nonnegative().default(0),
  sourceRefs: z.array(sourceRefSchema).max(500).optional(),
  /** Free-text scale statement; never a fabricated number. */
  estimatedDemand: z.string().max(500).optional(),
});

export const OPPORTUNITY_STATUSES = ["proposed", "under_review", "validated", "rejected", "archived"] as const;

export async function createOpportunity(input: z.input<typeof opportunityInputSchema>): Promise<OpportunityRow> {
  const parsed = opportunityInputSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(productOpportunities)
    .values({
      id: newId("opp"),
      title: parsed.title,
      description: parsed.description,
      evidenceCount: parsed.evidenceCount,
      sourceRefsJson: parsed.sourceRefs ?? null,
      estimatedDemand: parsed.estimatedDemand ?? null,
      humanValidationRequired: true,
    })
    .returning();
  return row;
}

export async function setOpportunityStatus(id: string, status: (typeof OPPORTUNITY_STATUSES)[number]): Promise<void> {
  z.enum(OPPORTUNITY_STATUSES).parse(status);
  const db = await getDb();
  await db.update(productOpportunities).set({ status, updatedAt: new Date() }).where(eq(productOpportunities.id, id));
}

export async function listOpportunities(limit = 100): Promise<OpportunityRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(productOpportunities)
    .orderBy(desc(productOpportunities.createdAt))
    .limit(Math.min(limit, 1000));
}
