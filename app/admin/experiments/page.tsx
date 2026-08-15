import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { EXPERIMENTS, resolveTrafficCap } from "@/config/experiments";
import { isFlagEnabled } from "@/config/flags";
import { checkAdminAuth } from "@/lib/admin/auth";
import { listExperiments } from "@/lib/data/experiment-service";
import { buildExperimentSummary, type ExperimentSummary } from "@/lib/experiments/readout";
import { EXPERIMENT_TARGETS } from "@/modules/experiments";
import { CreateExperimentForm, GenerateCroReviewButton, MaterializeButton } from "./experiment-controls";

/**
 * /admin/experiments — the owner's experiment surface (Session 11 §31).
 *
 * Answers, in one place: what are we testing, why, how many people actually
 * saw it, what happened, and can we trust the result. Every number comes
 * from the deterministic engine; no AI is called to render this page.
 *
 * Same admin auth as Sessions 08–10 (HTTP Basic via proxy.ts + this
 * re-check) plus the EXPERIMENT_ENGINE flag. Either missing ⇒ 404.
 */

export const metadata: Metadata = { title: "Experiments — Admin", robots: { index: false, follow: false } };

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft — enrolling nobody",
  approved: "Approved — not launched",
  running: "Running on live traffic",
  stopped: "Stopped",
  decided: "Decided",
  archived: "Archived",
};

const RESULT_LABEL: Record<string, string> = {
  RUNNING: "Still collecting",
  INSUFFICIENT_DATA: "Insufficient data",
  CONTROL_WIN: "Control won",
  VARIANT_WIN: "Variant won",
  NO_CLEAR_WINNER: "No clear winner",
  STOPPED: "Stopped before a decision",
  INVALID: "Invalid — do not trust these numbers",
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

function ExperimentCard({ summary }: { summary: ExperimentSummary }) {
  const e = summary.experiment;
  const r = summary.readout;
  return (
    <li className="surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="label-mono text-ink-3">
            {e.targetKey ?? "no target"} · {e.experimentType ?? "?"} · metric {e.primaryMetric}
          </p>
          <h3 className="mt-1 text-base text-ink" style={{ fontWeight: 600 }}>
            <Link className="underline" href={`/admin/experiments/${e.id}`}>
              {e.name}
            </Link>
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-ink-3">{e.hypothesis}</p>
        </div>
        <div className="text-right text-xs">
          <p className="font-mono">{RESULT_LABEL[r.state] ?? r.state}</p>
          <p className="text-ink-3">{STATUS_LABEL[e.status] ?? e.status}</p>
          {e.launchedAt ? <p className="text-ink-3">started {e.launchedAt.toISOString().slice(0, 10)}</p> : null}
          {e.stoppedAt ? <p className="text-ink-3">stopped {e.stoppedAt.toISOString().slice(0, 10)}</p> : null}
        </div>
      </div>

      <table className="mt-3 w-full text-xs">
        <thead>
          <tr className="text-left text-ink-3">
            <th className="py-1 font-normal">Arm</th>
            <th className="py-1 font-normal">Traffic</th>
            <th className="py-1 font-normal">Assigned</th>
            <th className="py-1 font-normal">Exposed sessions</th>
            <th className="py-1 font-normal">{e.primaryMetric}</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {summary.arms.map((arm) => {
            const counts =
              arm.variant === r.control.variant ? r.control : r.variant?.variant === arm.variant ? r.variant : null;
            return (
              <tr key={arm.variant} className="border-t border-rule">
                <td className="py-1">{arm.variant}</td>
                <td className="py-1">{arm.pct}%</td>
                <td className="py-1">{arm.assignments}</td>
                <td className="py-1">{arm.exposedSessions}</td>
                <td className="py-1">{counts ? counts.conversions : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-2 text-xs text-ink-2">{r.explanation}</p>
      {summary.configurationIssues.length > 0 ? (
        <p className="mt-2 text-xs text-error">Configuration problem: {summary.configurationIssues.join("; ")}</p>
      ) : null}
    </li>
  );
}

/** A copy-pasteable starting point for the hand-authored draft form. */
const EXAMPLE_DESIGN = JSON.stringify(
  {
    targetKey: "product.shipping_message",
    experimentType: "SHIPPING_MESSAGE",
    variantKey: "variant_b",
    variantConfig: {
      message: "Production starts once you approve your artwork proof.",
      placement: "above_cta",
    },
    primaryMetric: "add_to_cart",
    secondaryMetrics: ["ai_chat_started"],
    guardrailMetrics: ["purchase_completed"],
    allocation: [
      { variant: "control", pct: 50 },
      { variant: "variant_b", pct: 50 },
    ],
    minimumSampleSize: null,
  },
  null,
  2,
);

export default async function ExperimentsPage() {
  if (!isFlagEnabled("EXPERIMENT_ENGINE")) notFound();
  const h = await headers();
  if (checkAdminAuth(h.get("authorization")) !== "authorized") notFound();

  const rows = await listExperiments({});
  const summaries = await Promise.all(rows.map((row) => buildExperimentSummary(row)));
  const byStatus = (...statuses: string[]) => summaries.filter((s) => statuses.includes(s.experiment.status));

  const running = byStatus("running");
  const drafts = byStatus("draft", "approved");
  const completed = byStatus("decided");
  const stopped = byStatus("stopped");
  const archived = byStatus("archived");

  const cap = resolveTrafficCap();
  const croEnabled = isFlagEnabled("AI_CRO_AGENT");

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <p className="label-mono text-ink-3">Admin · Experiments</p>
      <h1 className="mt-1 text-3xl" style={{ fontWeight: 600 }}>
        Experiment Engine
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-2">
        Controlled tests on a small, closed list of presentation surfaces. Assignment, exposure, counting and the
        statistical result are computed by deterministic software — the AI can propose an experiment and explain a
        finished one, but it never launches, measures, or decides anything.
      </p>
      <p className="mt-2 text-xs text-ink-3">
        Method: two-sided two-proportion z-test at α={EXPERIMENTS.SIGNIFICANCE_ALPHA} · minimum{" "}
        <span className="font-mono">{EXPERIMENTS.DEFAULT_MINIMUM_SAMPLE_PER_VARIANT}</span> exposed sessions per arm
        before any winner · registered targets:{" "}
        <span className="font-mono">{Object.keys(EXPERIMENT_TARGETS).join(", ")}</span>
      </p>
      <p className={`mt-2 text-xs ${cap.ok && cap.source === "guardrail_limit" ? "text-ink-3" : "text-error"}`}>
        {cap.ok ? cap.note : cap.reason}
      </p>

      <div className="mt-6 flex flex-wrap gap-4">
        {croEnabled ? <GenerateCroReviewButton periodDays={30} /> : null}
        <MaterializeButton />
        <CreateExperimentForm example={EXAMPLE_DESIGN} />
      </div>
      <p className="mt-2 text-xs text-ink-3">
        Proposals are approved in the{" "}
        <Link className="underline" href="/admin/ai-actions">
          AI Action Center
        </Link>
        . Approving one records your decision; creating a draft and launching it are separate, explicit steps.
      </p>

      <SectionTitle>Overview</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Running" value={String(running.length)} hint="Enrolling live traffic" />
        <Card label="Drafts" value={String(drafts.length)} hint="Enrolling nobody" />
        <Card label="Stopped" value={String(stopped.length)} />
        <Card label="Completed" value={String(completed.length)} />
      </div>

      <SectionTitle>Running</SectionTitle>
      {running.length === 0 ? (
        <p className="text-sm text-ink-3">
          No experiment is running. The storefront renders its normal control experience everywhere.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {running.map((s) => (
            <ExperimentCard key={s.experiment.id} summary={s} />
          ))}
        </ul>
      )}

      {drafts.length > 0 ? (
        <>
          <SectionTitle>Drafts</SectionTitle>
          <ul className="flex flex-col gap-3">
            {drafts.map((s) => (
              <ExperimentCard key={s.experiment.id} summary={s} />
            ))}
          </ul>
        </>
      ) : null}

      {stopped.length > 0 ? (
        <>
          <SectionTitle>Stopped</SectionTitle>
          <ul className="flex flex-col gap-3">
            {stopped.map((s) => (
              <ExperimentCard key={s.experiment.id} summary={s} />
            ))}
          </ul>
        </>
      ) : null}

      {completed.length > 0 ? (
        <>
          <SectionTitle>Completed</SectionTitle>
          <ul className="flex flex-col gap-3">
            {completed.map((s) => (
              <ExperimentCard key={s.experiment.id} summary={s} />
            ))}
          </ul>
        </>
      ) : null}

      {archived.length > 0 ? (
        <>
          <SectionTitle>Archived</SectionTitle>
          <ul className="flex flex-col gap-3">
            {archived.map((s) => (
              <ExperimentCard key={s.experiment.id} summary={s} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
