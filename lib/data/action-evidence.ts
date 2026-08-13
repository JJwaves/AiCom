import { getInsight, getOpportunity } from "./insight-service";

/**
 * Server-side evidence resolution for proposed actions (Session 10 §19).
 *
 * A proposal's evidenceRefs are insight / product-opportunity ids that the
 * Session 09 CEO agent could only cite because the context actually printed
 * them. Before the Action Center DISPLAYS any of it, each reference is
 * resolved against the real row:
 *
 *  - resolved  → the persisted title/type/status/evidence count (real data)
 *  - missing   → reported as unavailable, never reconstructed or estimated
 *
 * The Action Center therefore cannot show a fabricated number as validated
 * evidence: numbers come from rows, not from the proposal payload.
 */

export type ResolvedEvidence =
  | {
      kind: "insight";
      id: string;
      title: string;
      insightType: string;
      status: string;
      evidenceCount: number;
    }
  | {
      kind: "opportunity";
      id: string;
      title: string;
      opportunityType: string | null;
      status: string;
      evidenceCount: number;
      humanValidationRequired: boolean;
    };

export type EvidenceResolution = {
  items: ResolvedEvidence[];
  /** Ids that no longer resolve to a row (deleted data stays deleted). */
  unresolved: string[];
};

export async function resolveActionEvidence(refs: readonly string[]): Promise<EvidenceResolution> {
  const items: ResolvedEvidence[] = [];
  const unresolved: string[] = [];

  for (const ref of refs.slice(0, 32)) {
    const insight = await getInsight(ref);
    if (insight) {
      items.push({
        kind: "insight",
        id: insight.id,
        title: insight.title,
        insightType: insight.insightType,
        status: insight.status,
        evidenceCount: insight.evidenceCount,
      });
      continue;
    }
    const opportunity = await getOpportunity(ref);
    if (opportunity) {
      items.push({
        kind: "opportunity",
        id: opportunity.id,
        title: opportunity.title,
        opportunityType: opportunity.opportunityType,
        status: opportunity.status,
        evidenceCount: opportunity.evidenceCount,
        humanValidationRequired: opportunity.humanValidationRequired,
      });
      continue;
    }
    unresolved.push(ref);
  }

  return { items, unresolved };
}
