import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { experimentAssignments, experiments } from "@/db/schema";
import { newId } from "./id";

/**
 * Experiment foundation — persistence only. There is NO experiment runtime,
 * no traffic splitting, no variant rendering until Stage F. Exposures are
 * recorded as `experiment_exposed` events; assignments here keep a variant
 * sticky per session.
 */

export const experimentCreateSchema = z.object({
  name: z.string().min(1).max(200),
  hypothesis: z.string().min(1).max(4000),
  primaryMetric: z.string().min(1).max(100),
  guardrailMetrics: z.array(z.string().max(100)).max(20).optional(),
  control: z.record(z.string(), z.unknown()).optional(),
  variants: z.record(z.string(), z.unknown()).optional(),
  trafficSplit: z.record(z.string(), z.number().min(0).max(1)).optional(),
  audience: z.string().max(500).optional(),
  minimumSampleSize: z.number().int().positive().optional(),
});

export const EXPERIMENT_STATUSES = ["draft", "running", "stopped", "decided"] as const;

export type ExperimentRow = typeof experiments.$inferSelect;
export type AssignmentRow = typeof experimentAssignments.$inferSelect;

export async function createExperiment(input: z.input<typeof experimentCreateSchema>): Promise<ExperimentRow> {
  const parsed = experimentCreateSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(experiments)
    .values({
      id: newId("exp"),
      name: parsed.name,
      hypothesis: parsed.hypothesis,
      primaryMetric: parsed.primaryMetric,
      guardrailMetricsJson: parsed.guardrailMetrics ?? null,
      controlJson: parsed.control ?? null,
      variantsJson: parsed.variants ?? null,
      trafficSplitJson: parsed.trafficSplit ?? null,
      audience: parsed.audience ?? null,
      minimumSampleSize: parsed.minimumSampleSize ?? null,
    })
    .returning();
  return row;
}

export async function setExperimentStatus(id: string, status: (typeof EXPERIMENT_STATUSES)[number]): Promise<void> {
  z.enum(EXPERIMENT_STATUSES).parse(status);
  const db = await getDb();
  await db.update(experiments).set({ status, updatedAt: new Date() }).where(eq(experiments.id, id));
}

/** Sticky assignment: the first variant recorded for a session wins; later calls return it unchanged. */
export async function assignVariant(experimentId: string, sessionId: string, variant: string): Promise<AssignmentRow> {
  z.string().min(1).max(100).parse(variant);
  const db = await getDb();
  await db
    .insert(experimentAssignments)
    .values({ experimentId, sessionId, variant })
    .onConflictDoNothing({ target: [experimentAssignments.experimentId, experimentAssignments.sessionId] });
  const [row] = await db
    .select()
    .from(experimentAssignments)
    .where(and(eq(experimentAssignments.experimentId, experimentId), eq(experimentAssignments.sessionId, sessionId)))
    .limit(1);
  return row;
}

export async function getAssignment(experimentId: string, sessionId: string): Promise<AssignmentRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(experimentAssignments)
    .where(and(eq(experimentAssignments.experimentId, experimentId), eq(experimentAssignments.sessionId, sessionId)))
    .limit(1);
  return row ?? null;
}
