import type { ExperimentStatus } from "./types";

/**
 * Experiment lifecycle (Session 11 spec §2, §33, §43).
 *
 *   draft ──▶ approved ──▶ running ──▶ stopped ──▶ decided ──▶ archived
 *     │           │           │            │
 *     └───────────┴──▶ archived           └──▶ archived
 *
 * Every transition is explicit and HUMAN-triggered. Transitions are
 * idempotent by design: re-issuing the transition an experiment is already
 * in is a no-op success, never an error and never a second launch.
 */

const ALLOWED_TRANSITIONS: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
  draft: ["approved", "running", "archived"],
  approved: ["running", "archived"],
  running: ["stopped", "decided"],
  stopped: ["decided", "archived"],
  decided: ["archived"],
  archived: [],
};

export type TransitionCheck =
  | { ok: true; noop: boolean }
  | { ok: false; reason: string };

export function canTransition(from: ExperimentStatus, to: ExperimentStatus): TransitionCheck {
  if (from === to) return { ok: true, noop: true };
  if (ALLOWED_TRANSITIONS[from].includes(to)) return { ok: true, noop: false };
  return { ok: false, reason: `An experiment cannot go from ${from} to ${to}.` };
}

/** Only a running experiment enrolls traffic — everything else is control. */
export function enrollsTraffic(status: ExperimentStatus): boolean {
  return status === "running";
}

/**
 * Stopping preserves history (spec §33): assignments, exposures and events
 * are never deleted. New traffic simply stops enrolling, and sessions
 * previously assigned to the variant return to the normal control
 * experience on their next render — the override only exists while the
 * experiment is running.
 */
export const STOP_SEMANTICS =
  "Stopping prevents new assignment and exposure. Existing assignments, exposure events and conversions are preserved " +
  "for the readout; previously assigned sessions see the normal control experience again from their next page view.";
