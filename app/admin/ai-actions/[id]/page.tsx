import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isFlagEnabled } from "@/config/flags";
import { checkAdminAuth } from "@/lib/admin/auth";
import { resolveActionEvidence } from "@/lib/data/action-evidence";
import {
  executionCapabilityLabel,
  getAction,
  listActionEvents,
  listActionRevisions,
  listEvaluations,
} from "@/lib/data/agent-action-service";
import { getDecision } from "@/lib/data/agent-service";
import { getActionTypeSpec } from "@/modules/guardrails";
import { ReviewControls } from "../review-controls";

/**
 * One proposed action, in full (Session 10 spec §18).
 *
 * Shows the recommendation, the structured action, the AI's reasoning, the
 * server-resolved evidence, the deterministic guardrail evaluation with the
 * exact rules and limits it consulted, missing configuration, the approval
 * history, and an honest statement of execution capability.
 *
 * Never shown: system prompts, API keys, secret config, payment data, or
 * customer PII — evidence is rendered from aggregate insight/opportunity
 * rows only.
 */

export const metadata: Metadata = { title: "AI action — Admin", robots: { index: false, follow: false } };

const dateTime = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16);

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="surface flex flex-wrap items-baseline justify-between gap-2 p-3">
      <span className="label-mono text-ink-3">{label}</span>
      <span className="text-sm text-ink">{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 mb-3 text-lg text-ink" style={{ fontWeight: 600 }}>
      {children}
    </h2>
  );
}

export default async function AiActionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isFlagEnabled("AI_ACTION_CENTER")) notFound();
  const h = await headers();
  if (checkAdminAuth(h.get("authorization")) !== "authorized") notFound();

  const { id } = await params;
  const action = await getAction(id);
  if (!action) notFound();

  const spec = getActionTypeSpec(action.actionType);
  const evaluations = await listEvaluations(action.id);
  const latest = evaluations[0] ?? null;
  const events = await listActionEvents(action.id);
  const revisions = await listActionRevisions(action);
  const decision = action.sourceDecisionId ? await getDecision(action.sourceDecisionId) : null;

  const payload = action.payloadJson as Record<string, unknown>;
  const evidenceRefs = Array.isArray(payload.evidenceRefs) ? (payload.evidenceRefs as string[]) : [];
  const metricRefs = Array.isArray(payload.metricRefs) ? (payload.metricRefs as string[]) : [];
  const evidence = await resolveActionEvidence(evidenceRefs);

  const rules = (latest?.violatedRulesJson ?? []) as unknown as {
    id: string;
    severity: string;
    blocks: string;
    message: string;
  }[];
  const missing = latest?.missingConfigurationJson ?? [];
  const canReview = action.status === "PENDING_APPROVAL";

  return (
    <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link className="text-sm underline" href="/admin/ai-actions">
        ← AI Action Center
      </Link>
      <p className="label-mono mt-4 text-ink-3">
        {action.sourceAgent} · {action.actionType} · revision {action.revision}
      </p>
      <h1 className="mt-1 text-2xl" style={{ fontWeight: 600 }}>
        {action.title}
      </h1>
      <p className="mt-2 text-sm text-ink-2">{spec?.label ?? "Unknown action type"}</p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Row label="Status" value={action.status} />
        <Row label="Risk (policy-derived)" value={action.riskLevel} />
        <Row label="Approval required" value={action.approvalRequired ? "Yes" : "No"} />
        <Row label="Execution status" value={action.executionStatus} />
        <Row label="Created" value={dateTime(action.createdAt)} />
        <Row label="Proposed by" value={action.createdBy} />
      </div>

      {action.modelSuggestedRisk && action.modelSuggestedRisk !== action.riskLevel ? (
        <p className="mt-2 text-xs text-ink-3">
          The model suggested risk <span className="font-mono">{action.modelSuggestedRisk}</span>; policy assigned{" "}
          <span className="font-mono">{action.riskLevel}</span>. Policy wins — a model never sets its own risk level.
        </p>
      ) : null}

      <SectionTitle>Can the system actually do this?</SectionTitle>
      <p className="text-sm text-ink-2">{executionCapabilityLabel(action.actionType)}.</p>
      {missing.length > 0 ? (
        <p className="mt-2 text-sm text-error">
          Cannot be approved for automated execution — missing configuration:
          <br />
          {missing.map((m) => (
            <span key={m} className="font-mono text-xs">
              {m}
              <br />
            </span>
          ))}
        </p>
      ) : null}

      <SectionTitle>What the AI observed</SectionTitle>
      <p className="text-sm text-ink-2">{String(payload.observation ?? decision?.observation ?? "—")}</p>

      <SectionTitle>What it recommends</SectionTitle>
      <p className="text-sm text-ink-2">{String(payload.question ?? decision?.reasoningSummary ?? "—")}</p>
      {payload.expectedImpact ? (
        <p className="mt-2 text-sm text-ink-3">Expected impact (claimed): {String(payload.expectedImpact)}</p>
      ) : null}
      {Array.isArray(payload.limitations) && payload.limitations.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-ink-3">
          {(payload.limitations as string[]).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}

      <SectionTitle>Evidence</SectionTitle>
      {metricRefs.length > 0 ? (
        <p className="text-xs text-ink-3">
          Deterministic metrics cited: <span className="font-mono">{metricRefs.join(", ")}</span> (from the business
          snapshot the agent was shown — see{" "}
          <Link className="underline" href="/admin/business-intelligence">
            Business Intelligence
          </Link>
          )
        </p>
      ) : null}
      <div className="mt-3 space-y-2">
        {evidence.items.length === 0 && evidenceRefs.length === 0 ? (
          <p className="text-sm text-ink-3">No insight or opportunity records were cited.</p>
        ) : null}
        {evidence.items.map((item) => (
          <div key={item.id} className="surface p-3">
            <p className="label-mono text-ink-3">
              {item.kind === "insight" ? item.insightType : (item.opportunityType ?? "opportunity")} · {item.status} ·{" "}
              {item.evidenceCount} evidence record(s)
            </p>
            <p className="mt-1 text-sm text-ink-2">{item.title}</p>
            {item.kind === "insight" ? (
              <Link className="text-xs underline" href={`/admin/customer-intelligence/insights/${item.id}`}>
                View underlying evidence
              </Link>
            ) : (
              <Link className="text-xs underline" href={`/admin/customer-intelligence/opportunities/${item.id}`}>
                View underlying evidence
              </Link>
            )}
          </div>
        ))}
        {evidence.unresolved.length > 0 ? (
          <p className="text-xs text-error">
            {evidence.unresolved.length} cited reference(s) no longer resolve to a record and are NOT shown as
            evidence: <span className="font-mono">{evidence.unresolved.join(", ")}</span>
          </p>
        ) : null}
      </div>

      <SectionTitle>Structured action</SectionTitle>
      <pre className="table-scroll surface p-3 font-mono text-xs">{JSON.stringify(payload, null, 2)}</pre>

      <SectionTitle>Guardrail evaluation</SectionTitle>
      {latest ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Row label="Policy version" value={<span className="font-mono">{latest.policyVersion}</span>} />
            <Row label="Evaluated" value={dateTime(latest.evaluatedAt)} />
            <Row label="Autonomy mode applied" value={latest.autonomyMode} />
            <Row label="Allowed" value={latest.allowed ? "Yes" : "No"} />
            <Row label="Execution eligible" value={latest.executionEligible ? "Yes" : "No"} />
            <Row label="Executor support" value={latest.executionSupport} />
          </div>
          <p className="mt-2 text-sm text-ink-2">{latest.reason}</p>
          {rules.length > 0 ? (
            <>
              <p className="label-mono mt-3 text-ink-3">Rules that applied</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-2">
                {rules.map((r) => (
                  <li key={r.id}>
                    <span className="label-mono">
                      {r.severity} · blocks {r.blocks.toLowerCase()}
                    </span>{" "}
                    {r.message}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-3">
                HARD rules cannot be waived by approving. SOFT rules are what your approval decides.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-3">No rules were violated.</p>
          )}
          <p className="label-mono mt-3 text-ink-3">Limits consulted</p>
          {Object.keys(latest.limitsSnapshotJson).length === 0 ? (
            <p className="text-sm text-ink-3">This action type depends on no configurable limit.</p>
          ) : (
            <ul className="mt-1 text-sm text-ink-2">
              {Object.entries(latest.limitsSnapshotJson).map(([key, value]) => (
                <li key={key} className="font-mono text-xs">
                  {key}: {value === null ? "not configured" : value}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-sm text-ink-3">No evaluation recorded.</p>
      )}

      <SectionTitle>Your decision</SectionTitle>
      {canReview ? (
        <p className="mb-3 text-sm text-ink-3">
          Approving records that you approved this proposal. It does not execute anything: no executor exists for this
          action type.
        </p>
      ) : null}
      <ReviewControls
        actionId={action.id}
        stateVersion={action.stateVersion}
        payloadJson={JSON.stringify(payload, null, 2)}
        canReview={canReview}
      />

      <SectionTitle>History</SectionTitle>
      <ul className="space-y-2">
        {events.map((event) => (
          <li key={event.id} className="surface p-3 text-sm">
            <span className="label-mono text-ink-3">{dateTime(event.createdAt)}</span>{" "}
            <span className="font-mono text-xs">{event.type}</span> by {event.actor}
          </li>
        ))}
      </ul>
      {revisions.length > 1 ? (
        <>
          <p className="label-mono mt-4 text-ink-3">Revisions (originals are never rewritten)</p>
          <ul className="mt-1 space-y-1 text-sm">
            {revisions.map((r) => (
              <li key={r.id}>
                <Link className="underline" href={`/admin/ai-actions/${r.id}`}>
                  revision {r.revision}
                </Link>{" "}
                <span className="text-ink-3">
                  — {r.status}
                  {r.id === action.id ? " (viewing)" : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
