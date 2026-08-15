import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { events, experimentAssignments } from "@/db/schema";
import { PLATFORM_EVENT_NAMES } from "./event-service";

/**
 * Experiment measurement (Session 11 spec §12–§13).
 *
 * READ-ONLY aggregates over first-party rows. Every number here is SQL over
 * real events; nothing in this file calls a model, and no rate is estimated.
 *
 * DEFINITIONS, applied identically to every metric:
 *  - Denominator = distinct EXPOSED sessions in the arm (`exposedAt` set).
 *    Assigned-but-never-exposed sessions are excluded — they never saw the
 *    thing being tested.
 *  - Numerator = distinct exposed sessions with ≥1 event of the metric name
 *    occurring AT OR AFTER that session's exposure timestamp. A conversion
 *    that happened before the customer saw the variant cannot be credited
 *    to it, and repeat conversions in one session count once.
 *
 * All counts cast ::float8 for the same reason as S08/S09 (int8 arrives as a
 * string from both drivers; float8 is integer-exact to 2^53).
 */

const metricNameSchema = z.enum(PLATFORM_EVENT_NAMES);

export type VariantMetricCount = { variant: string; sessions: number };

/** Distinct exposed sessions per arm — the denominator for every metric. */
export async function exposedSessionsByVariant(experimentId: string): Promise<VariantMetricCount[]> {
  const db = await getDb();
  const rows = await db
    .select({
      variant: experimentAssignments.variant,
      sessions: sql<number>`count(*)::float8`,
    })
    .from(experimentAssignments)
    .where(and(eq(experimentAssignments.experimentId, experimentId), isNotNull(experimentAssignments.exposedAt)))
    .groupBy(experimentAssignments.variant);
  return rows.map((r) => ({ variant: r.variant, sessions: Number(r.sessions) || 0 }));
}

/**
 * Distinct exposed sessions per arm that produced `metricName` at or after
 * their exposure. The metric name must belong to the platform event
 * taxonomy — an unknown name throws rather than silently counting zero.
 */
export async function convertedSessionsByVariant(
  experimentId: string,
  metricName: string,
): Promise<VariantMetricCount[]> {
  const metric = metricNameSchema.parse(metricName);
  const db = await getDb();
  const rows = await db
    .select({
      variant: experimentAssignments.variant,
      sessions: sql<number>`count(distinct ${experimentAssignments.sessionId})::float8`,
    })
    .from(experimentAssignments)
    .innerJoin(
      events,
      and(
        eq(events.sessionId, experimentAssignments.sessionId),
        eq(events.name, metric),
        gte(events.occurredAt, experimentAssignments.exposedAt),
      ),
    )
    .where(and(eq(experimentAssignments.experimentId, experimentId), isNotNull(experimentAssignments.exposedAt)))
    .groupBy(experimentAssignments.variant);
  return rows.map((r) => ({ variant: r.variant, sessions: Number(r.sessions) || 0 }));
}

export type MetricByVariant = {
  metric: string;
  arms: { variant: string; exposedSessions: number; conversions: number }[];
};

/** One metric's per-arm counts, with every exposed arm represented (0 included). */
export async function metricByVariant(
  experimentId: string,
  metricName: string,
  exposed?: VariantMetricCount[],
): Promise<MetricByVariant> {
  const denominators = exposed ?? (await exposedSessionsByVariant(experimentId));
  const numerators = await convertedSessionsByVariant(experimentId, metricName);
  const byVariant = new Map(numerators.map((n) => [n.variant, n.sessions]));
  return {
    metric: metricName,
    arms: denominators.map((d) => ({
      variant: d.variant,
      exposedSessions: d.sessions,
      conversions: byVariant.get(d.variant) ?? 0,
    })),
  };
}

/** Total `experiment_exposed` events recorded for an experiment (audit view). */
export async function exposureEventCount(experimentId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::float8` })
    .from(events)
    .where(and(eq(events.name, "experiment_exposed"), eq(events.experimentId, experimentId)));
  return Number(row?.count ?? 0) || 0;
}
