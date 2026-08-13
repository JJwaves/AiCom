import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { GUARDRAIL_POLICY_VERSION } from "@/config/guardrails";
import { isFlagEnabled } from "@/config/flags";
import { checkAdminAuth } from "@/lib/admin/auth";
import {
  actionCenterSummary,
  getLatestEvaluation,
  listActions,
  type ActionRow,
  type EvaluationRow,
} from "@/lib/data/agent-action-service";
import { executorRegistry, getActionTypeSpec, type ActionStatus } from "@/modules/guardrails";
import { SyncButton } from "./sync-button";

/**
 * /admin/ai-actions — the AI Action Center (Session 10 spec §17, §40).
 *
 * The owner's question list, answered in one place: what does the AI want
 * to do, why, on what evidence, how risky is it, which rules apply, does it
 * need my approval, and can the system actually DO it yet (almost always:
 * no — approval records intent).
 *
 * Same admin auth as Sessions 08/09 (HTTP Basic via proxy.ts + this
 * re-check), plus the AI_ACTION_CENTER flag. Either missing ⇒ 404.
 */

export const metadata: Metadata = { title: "AI Actions — Admin", robots: { index: false, follow: false } };

const STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: "Awaiting your decision",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  GUARDRAIL_BLOCKED: "Blocked by guardrails",
  SUPERSEDED: "Replaced by your modification",
  PROPOSED: "Proposed",
};

const RISK_HINT: Record<string, string> = {
  LOW: "Low risk",
  MEDIUM: "Medium risk",
  HIGH: "High risk — always needs you",
  CRITICAL: "Critical — permanently human-only",
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-10 mb-3 text-xl text-ink" style={{ fontWeight: 600 }}>
      {children}
    </h2>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="surface p-4">
      <p className="label-mono text-ink-3">{label}</p>
      <p className="mt-1 font-mono text-2xl text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

function ActionRowCard({ action, evaluation }: { action: ActionRow; evaluation: EvaluationRow | null }) {
  const spec = getActionTypeSpec(action.actionType);
  const missing = evaluation?.missingConfigurationJson ?? [];
  const rules = (evaluation?.violatedRulesJson ?? []) as unknown as { id: string; severity: string; message: string }[];
  return (
    <li className="surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="label-mono text-ink-3">
            {action.sourceAgent} · {action.actionType}
            {action.revision > 1 ? ` · revision ${action.revision}` : ""}
          </p>
          <h3 className="mt-1 text-base text-ink" style={{ fontWeight: 600 }}>
            <Link className="underline" href={`/admin/ai-actions/${action.id}`}>
              {action.title}
            </Link>
          </h3>
          <p className="mt-1 text-xs text-ink-3">
            {spec?.label ?? "Unknown action type"} · created {action.createdAt.toISOString().slice(0, 10)}
          </p>
        </div>
        <div className="text-right text-xs">
          <p className="font-mono">{RISK_HINT[action.riskLevel] ?? action.riskLevel}</p>
          <p className="text-ink-3">{STATUS_LABEL[action.status] ?? action.status}</p>
          <p className="text-ink-3">execution: {action.executionStatus}</p>
        </div>
      </div>

      {evaluation ? (
        <p className="mt-2 text-xs text-ink-3">
          Guardrail: {evaluation.allowed ? "allowed" : "blocked"} ·{" "}
          {evaluation.approvalRequired ? "your approval required" : "no approval required"} · policy{" "}
          {evaluation.policyVersion}
        </p>
      ) : null}

      {rules.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-xs text-ink-2">
          {rules.slice(0, 4).map((r) => (
            <li key={r.id}>
              <span className="label-mono">{r.severity}</span> {r.message}
            </li>
          ))}
        </ul>
      ) : null}

      {missing.length > 0 ? (
        <p className="mt-2 text-xs text-error">
          Cannot be approved for automated execution — missing configuration: {missing.join(", ")}
        </p>
      ) : null}

      {action.reviewedBy ? (
        <p className="mt-2 text-xs text-ink-3">
          Reviewed by {action.reviewedBy} on {action.reviewedAt?.toISOString().slice(0, 10)}
          {action.reviewNotes ? ` — “${action.reviewNotes.slice(0, 160)}”` : ""}
        </p>
      ) : null}
    </li>
  );
}

async function withEvaluations(actions: ActionRow[]): Promise<{ action: ActionRow; evaluation: EvaluationRow | null }[]> {
  return Promise.all(actions.map(async (action) => ({ action, evaluation: await getLatestEvaluation(action.id) })));
}

export default async function AiActionsPage() {
  if (!isFlagEnabled("AI_ACTION_CENTER")) notFound();
  const h = await headers();
  if (checkAdminAuth(h.get("authorization")) !== "authorized") notFound();

  const all = await listActions({});
  const summary = await actionCenterSummary();
  const byStatus = (status: ActionStatus) => all.filter((a) => a.status === status);

  const pending = await withEvaluations(byStatus("PENDING_APPROVAL"));
  const blocked = await withEvaluations(byStatus("GUARDRAIL_BLOCKED"));
  const approved = await withEvaluations(byStatus("APPROVED"));
  const rejected = await withEvaluations(byStatus("REJECTED"));
  const superseded = await withEvaluations(byStatus("SUPERSEDED"));

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <p className="label-mono text-ink-3">Admin · AI actions</p>
      <h1 className="mt-1 text-3xl" style={{ fontWeight: 600 }}>
        AI Action Center
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-2">
        Everything the AI wants to do, with the evidence behind it and the deterministic rules that apply. Approving
        an action records <strong>your decision</strong> — it does not perform it: no executor exists for any business
        action yet, so nothing here can change a price, an ad budget, a product, or a payment.
      </p>
      <p className="mt-2 text-xs text-ink-3">
        Guardrail policy version <span className="font-mono">{GUARDRAIL_POLICY_VERSION}</span> · registered executors:{" "}
        <span className="font-mono">{executorRegistry.list().length === 0 ? "none" : executorRegistry.list().join(", ")}</span>
      </p>

      <div className="mt-6">
        <SyncButton />
      </div>

      <SectionTitle>Overview</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Awaiting your decision" value={String(summary.PENDING_APPROVAL)} />
        <Card label="Blocked by guardrails" value={String(summary.GUARDRAIL_BLOCKED)} hint="Recorded, never actionable" />
        <Card label="Approved" value={String(summary.APPROVED)} hint="Decision recorded — not executed" />
        <Card label="Rejected" value={String(summary.REJECTED)} />
      </div>

      <SectionTitle>Pending actions</SectionTitle>
      {pending.length === 0 ? (
        <p className="text-sm text-ink-3">
          Nothing is waiting on you. Generate a CEO review on{" "}
          <Link className="underline" href="/admin/business-intelligence">
            Business Intelligence
          </Link>
          , then press “Refresh proposed actions”.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pending.map(({ action, evaluation }) => (
            <ActionRowCard key={action.id} action={action} evaluation={evaluation} />
          ))}
        </ul>
      )}

      {blocked.length > 0 ? (
        <>
          <SectionTitle>Blocked by guardrails</SectionTitle>
          <p className="mb-3 text-sm text-ink-3">
            These were proposed and refused by policy. They are kept visible on purpose — a blocked proposal is
            information about what an agent tried to do.
          </p>
          <ul className="flex flex-col gap-3">
            {blocked.map(({ action, evaluation }) => (
              <ActionRowCard key={action.id} action={action} evaluation={evaluation} />
            ))}
          </ul>
        </>
      ) : null}

      {approved.length > 0 ? (
        <>
          <SectionTitle>Recently approved</SectionTitle>
          <ul className="flex flex-col gap-3">
            {approved.map(({ action, evaluation }) => (
              <ActionRowCard key={action.id} action={action} evaluation={evaluation} />
            ))}
          </ul>
        </>
      ) : null}

      {rejected.length > 0 ? (
        <>
          <SectionTitle>Rejected</SectionTitle>
          <ul className="flex flex-col gap-3">
            {rejected.map(({ action, evaluation }) => (
              <ActionRowCard key={action.id} action={action} evaluation={evaluation} />
            ))}
          </ul>
        </>
      ) : null}

      {superseded.length > 0 ? (
        <>
          <SectionTitle>Modified (originals preserved)</SectionTitle>
          <ul className="flex flex-col gap-3">
            {superseded.map(({ action, evaluation }) => (
              <ActionRowCard key={action.id} action={action} evaluation={evaluation} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
