import {
  allocationOf,
  armTotals,
  validateStoredExperiment,
  variantKeyOfRow,
  type ExperimentRow,
} from "@/lib/data/experiment-service";
import { exposedSessionsByVariant, metricByVariant, type MetricByVariant } from "@/lib/data/experiment-metrics-service";
import {
  computeReadout,
  CONTROL_VARIANT_KEY,
  isExperimentStatus,
  type ArmCounts,
  type ExperimentReadout,
  type ExperimentStatus,
} from "@/modules/experiments";

/**
 * Experiment readout composition (Session 11 spec §17, §31–§32).
 *
 * Loads the deterministic counts and hands them to the pure result engine.
 * No AI is involved at any point: this module reads rows, the module layer
 * decides the state, and the admin page renders what it is told.
 *
 * A readout is computed on demand, so it is always consistent with the
 * current data. When an experiment is STOPPED the readout is additionally
 * frozen onto `experiments.result_json`, so a later config change cannot
 * rewrite what was concluded at the time.
 */

export type ExperimentSummary = {
  experiment: ExperimentRow;
  readout: ExperimentReadout;
  /** Assignment counts vs unique exposed sessions — reported separately. */
  arms: { variant: string; pct: number; assignments: number; exposedSessions: number }[];
  secondaryMetrics: MetricByVariant[];
  guardrailMetrics: MetricByVariant[];
  configurationIssues: string[];
};

export async function buildExperimentSummary(
  experiment: ExperimentRow,
  /**
   * Evaluate as if the experiment already had this status. The stop route
   * uses it so the readout it FREEZES describes the experiment as stopped —
   * without it, a run that never reached its minimum sample would be frozen
   * as "RUNNING" forever.
   */
  opts: { statusOverride?: ExperimentStatus } = {},
): Promise<ExperimentSummary> {
  const config = validateStoredExperiment(experiment);
  const allocation = allocationOf(experiment);
  const variantKey = variantKeyOfRow(experiment);

  const [totals, exposed] = await Promise.all([
    armTotals(experiment.id),
    exposedSessionsByVariant(experiment.id),
  ]);
  const primary = await metricByVariant(experiment.id, experiment.primaryMetric, exposed);

  const armCounts = (variant: string): ArmCounts => {
    const row = primary.arms.find((a) => a.variant === variant);
    return {
      variant,
      exposedSessions: row?.exposedSessions ?? 0,
      conversions: row?.conversions ?? 0,
    };
  };

  const arms = allocation.map((a) => {
    const total = totals.find((t) => t.variant === a.variant);
    return {
      variant: a.variant,
      pct: a.pct,
      assignments: total?.assignments ?? 0,
      exposedSessions: total?.exposedSessions ?? 0,
    };
  });

  const readout = computeReadout({
    status: opts.statusOverride ?? ((isExperimentStatus(experiment.status) ? experiment.status : "draft") as ExperimentStatus),
    primaryMetric: experiment.primaryMetric,
    minimumSampleSize: experiment.minimumSampleSize,
    arms: [armCounts(CONTROL_VARIANT_KEY), ...(variantKey ? [armCounts(variantKey)] : [])],
    configurationValid: config.ok,
    configurationIssues: config.issues,
  });

  const secondaryNames = (experiment.secondaryMetricsJson ?? []).slice(0, 5);
  const guardrailNames = (experiment.guardrailMetricsJson ?? []).slice(0, 5);
  const [secondaryMetrics, guardrailMetrics] = await Promise.all([
    Promise.all(secondaryNames.map((name) => metricByVariant(experiment.id, name, exposed))),
    Promise.all(guardrailNames.map((name) => metricByVariant(experiment.id, name, exposed))),
  ]);

  return {
    experiment,
    readout,
    arms,
    secondaryMetrics,
    guardrailMetrics,
    configurationIssues: config.issues,
  };
}

/** A JSON-serializable copy of a readout, for freezing onto the row. */
export function freezeReadout(readout: ExperimentReadout): Record<string, unknown> {
  return JSON.parse(JSON.stringify(readout)) as Record<string, unknown>;
}
