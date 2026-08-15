import { listActions, type ActionRow } from "@/lib/data/agent-action-service";
import { createExperimentDraft, experimentsBySourceActionIds } from "@/lib/data/experiment-service";
import { resolveTrafficCap } from "@/config/experiments";
import { parseExperimentDesign } from "@/modules/experiments";

/**
 * Approved proposal → DRAFT experiment (Session 11 spec §25–§26).
 *
 * This is the deterministic bridge between the AI Action Center and the
 * experiment engine, and it is deliberately NOT an executor:
 *
 *  - It reads only APPROVED `CRO_EXPERIMENT_PROPOSAL` actions — a human's
 *    recorded decision is its sole input. It performs no model call.
 *  - It creates DRAFTS. A draft enrols nobody and changes nothing about the
 *    storefront. Launching is a separate, explicit human action.
 *  - Every design is re-validated against the CURRENT target registry and
 *    the CURRENT traffic ceiling. An approval given weeks ago cannot smuggle
 *    a target that no longer exists, or traffic above today's limit.
 *  - It is idempotent: one experiment per source action, enforced by a
 *    partial unique index, so re-running creates nothing new.
 *
 * `modules/guardrails/executors.ts` therefore remains EMPTY: no action type
 * in this codebase has an automated executor, and approving an action still
 * mutates nothing on its own.
 */

export type MaterializeResult = {
  created: number;
  skippedExisting: number;
  skippedNoDesign: number;
  skippedInvalid: number;
  experimentIds: string[];
  issues: string[];
};

export async function materializeApprovedProposals(actor: string): Promise<MaterializeResult> {
  const approved = (await listActions({ status: ["APPROVED"] })).filter(
    (a) => a.actionType === "CRO_EXPERIMENT_PROPOSAL",
  );
  const existing = await experimentsBySourceActionIds(approved.map((a) => a.id));
  const cap = resolveTrafficCap();

  const result: MaterializeResult = {
    created: 0,
    skippedExisting: 0,
    skippedNoDesign: 0,
    skippedInvalid: 0,
    experimentIds: [],
    issues: [],
  };

  for (const action of approved) {
    if (existing.has(action.id)) {
      result.skippedExisting += 1;
      continue;
    }
    const design = designOf(action);
    if (design === null) {
      result.skippedNoDesign += 1;
      continue;
    }
    const parsed = parseExperimentDesign(design, cap.ok ? { maxNonControlPct: cap.capPct } : {});
    if (!parsed.ok) {
      result.skippedInvalid += 1;
      result.issues.push(`${action.title.slice(0, 60)}: ${parsed.reason}`);
      continue;
    }

    const created = await createExperimentDraft({
      name: uniqueName(action),
      hypothesis: hypothesisOf(action),
      design: parsed.design,
      createdBy: actor,
      sourceDecisionId: action.sourceDecisionId,
      sourceActionId: action.id,
    });
    if (!created.ok) {
      if (created.code === "DUPLICATE") result.skippedExisting += 1;
      else {
        result.skippedInvalid += 1;
        result.issues.push(`${action.title.slice(0, 60)}: ${created.reason}`);
      }
      continue;
    }
    result.created += 1;
    result.experimentIds.push(created.experiment.id);
  }

  return result;
}

function designOf(action: ActionRow): unknown {
  const payload = action.payloadJson as Record<string, unknown> | null;
  const design = payload?.design;
  return design && typeof design === "object" ? design : null;
}

function hypothesisOf(action: ActionRow): string {
  const payload = action.payloadJson as Record<string, unknown> | null;
  const hypothesis = payload?.hypothesis;
  return typeof hypothesis === "string" && hypothesis.length > 0 ? hypothesis.slice(0, 4000) : action.title;
}

/** Experiment names are unique; the action id keeps a re-proposal distinct. */
function uniqueName(action: ActionRow): string {
  const base = action.title.replace(/\s+/g, " ").trim().slice(0, 90);
  return `${base} (${action.id.slice(-6)})`;
}
