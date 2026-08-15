import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isFlagEnabled } from "@/config/flags";
import { checkAdminAuth } from "@/lib/admin/auth";
import { getExperiment, listExperimentEvents } from "@/lib/data/experiment-service";
import { exposureEventCount } from "@/lib/data/experiment-metrics-service";
import { buildExperimentSummary } from "@/lib/experiments/readout";
import { getExperimentTarget, STOP_SEMANTICS } from "@/modules/experiments";
import { ExperimentControls } from "../experiment-controls";

/**
 * /admin/experiments/[id] — the full story of one experiment (spec §32).
 *
 * "What are we testing?" · "Why?" · "How many people saw it?" ·
 * "What happened?" · "Can we trust the result?" — with the caveats rendered
 * next to the numbers, never underneath them in small print.
 */

export const metadata: Metadata = { title: "Experiment — Admin", robots: { index: false, follow: false } };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-rule py-2">
      <p className="label-mono text-ink-3">{label}</p>
      <div className="mt-1 text-sm text-ink-2">{children}</div>
    </div>
  );
}

export default async function ExperimentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isFlagEnabled("EXPERIMENT_ENGINE")) notFound();
  const h = await headers();
  if (checkAdminAuth(h.get("authorization")) !== "authorized") notFound();

  const { id } = await params;
  const experiment = await getExperiment(id);
  if (!experiment) notFound();

  const [summary, events, exposures] = await Promise.all([
    buildExperimentSummary(experiment),
    listExperimentEvents(experiment.id),
    exposureEventCount(experiment.id),
  ]);
  const readout = summary.readout;
  const target = experiment.targetKey ? getExperimentTarget(experiment.targetKey) : null;
  const control = experiment.controlJson as { summary?: string; config?: Record<string, unknown> } | null;
  const variants = (experiment.variantsJson ?? {}) as Record<string, unknown>;
  const policy = experiment.policySnapshotJson as Record<string, unknown> | null;

  return (
    <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <p className="label-mono text-ink-3">
        <Link className="underline" href="/admin/experiments">
          Admin · Experiments
        </Link>{" "}
        / {experiment.id}
      </p>
      <h1 className="mt-1 text-2xl" style={{ fontWeight: 600 }}>
        {experiment.name}
      </h1>
      <p className="mt-2 text-sm text-ink-2">{experiment.hypothesis}</p>

      <div className="mt-6">
        <ExperimentControls
          experimentId={experiment.id}
          status={experiment.status}
          stateVersion={experiment.stateVersion}
        />
      </div>

      <h2 className="mt-10 mb-2 text-lg" style={{ fontWeight: 600 }}>
        What is being tested
      </h2>
      <Row label="Target">
        {experiment.targetKey ?? "—"}
        {target ? ` — ${target.label} (${target.surface}); rendered by ${target.renderedBy}` : ""}
      </Row>
      <Row label="Control">{control?.summary ?? "The site's normal experience, unchanged."}</Row>
      <Row label="Variant">
        <pre className="overflow-x-auto rounded-[6px] bg-ink/5 p-3 font-mono text-xs">
          {JSON.stringify(variants, null, 2)}
        </pre>
        <p className="mt-1 text-xs text-ink-3">
          Typed presentation values only — validated against the target&apos;s strict schema. Experiments cannot store
          HTML, JavaScript, CSS, or a component path.
        </p>
      </Row>
      <Row label="Traffic split">
        {summary.arms.map((a) => `${a.variant} ${a.pct}%`).join(" · ")}
        {policy?.trafficCap ? ` (ceiling: ${JSON.stringify(policy.trafficCap)})` : ""}
      </Row>
      <Row label="Audience">{experiment.audience ?? "wherever the target renders"}</Row>
      <Row label="Protected fields on this surface">
        {target ? target.protectedFields.join(", ") : "—"}
      </Row>

      <h2 className="mt-10 mb-2 text-lg" style={{ fontWeight: 600 }}>
        How many people saw it
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-3">
            <th className="py-1 font-normal">Arm</th>
            <th className="py-1 font-normal">Assigned sessions</th>
            <th className="py-1 font-normal">Exposed sessions</th>
            <th className="py-1 font-normal">{experiment.primaryMetric}</th>
            <th className="py-1 font-normal">Rate</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {summary.arms.map((arm) => {
            const counts =
              arm.variant === readout.control.variant
                ? readout.control
                : readout.variant?.variant === arm.variant
                  ? readout.variant
                  : null;
            const rate =
              counts && counts.exposedSessions > 0
                ? `${((counts.conversions / counts.exposedSessions) * 100).toFixed(2)}%`
                : "—";
            return (
              <tr key={arm.variant} className="border-t border-rule">
                <td className="py-1">{arm.variant}</td>
                <td className="py-1">{arm.assignments}</td>
                <td className="py-1">{arm.exposedSessions}</td>
                <td className="py-1">{counts ? counts.conversions : "—"}</td>
                <td className="py-1">{rate}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-3">
        Assignment and exposure are counted separately: a session is <em>assigned</em> when it first becomes eligible
        and <em>exposed</em> only when it actually renders the surface. Exposure is stamped once per session, so
        repeat page views never inflate the denominator. First-party <span className="font-mono">experiment_exposed</span>{" "}
        events recorded: <span className="font-mono">{exposures}</span>.
      </p>

      <h2 className="mt-10 mb-2 text-lg" style={{ fontWeight: 600 }}>
        What happened
      </h2>
      <Row label="Result">
        <span className="font-mono">{readout.state}</span> — {readout.explanation}
      </Row>
      <Row label="Minimum sample per arm">
        {readout.minimumSamplePerVariant} exposed sessions ({readout.minimumSampleMet ? "met" : "not yet met"}). No
        winner may be declared below this threshold.
      </Row>
      {readout.statistics ? (
        <Row label="Statistics">
          <span className="font-mono">
            {readout.statistics.method} · z = {readout.statistics.z ?? "—"} · p = {readout.statistics.pValue ?? "—"} ·
            α = {readout.statistics.alpha}
          </span>
          {readout.statistics.relativeLiftPct !== null ? (
            <span className="ml-2">observed relative difference {readout.statistics.relativeLiftPct}%</span>
          ) : null}
        </Row>
      ) : null}
      <Row label="Can we trust this?">
        <ul className="list-disc pl-5">
          {readout.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
          {readout.caveats.length === 0 ? <li>No caveats recorded.</li> : null}
        </ul>
      </Row>

      {summary.secondaryMetrics.length > 0 || summary.guardrailMetrics.length > 0 ? (
        <>
          <h2 className="mt-10 mb-2 text-lg" style={{ fontWeight: 600 }}>
            Secondary &amp; guardrail metrics
          </h2>
          <p className="mb-2 text-xs text-ink-3">
            Reported for context. They never declare a winner — only the primary metric is tested.
          </p>
          {[...summary.secondaryMetrics, ...summary.guardrailMetrics].map((m) => (
            <Row key={m.metric} label={m.metric}>
              {m.arms.map((a) => `${a.variant}: ${a.conversions}/${a.exposedSessions}`).join(" · ") || "no data"}
            </Row>
          ))}
        </>
      ) : null}

      <h2 className="mt-10 mb-2 text-lg" style={{ fontWeight: 600 }}>
        Provenance &amp; history
      </h2>
      <Row label="Created by">{experiment.createdBy ?? "—"}</Row>
      {experiment.sourceActionId ? (
        <Row label="Approved proposal">
          <Link className="underline" href={`/admin/ai-actions/${experiment.sourceActionId}`}>
            {experiment.sourceActionId}
          </Link>
        </Row>
      ) : null}
      <Row label="Guardrail policy at launch">
        {experiment.policyVersion ?? "not launched"}
        {policy?.missingConfiguration && Array.isArray(policy.missingConfiguration) && policy.missingConfiguration.length > 0 ? (
          <span className="ml-2 text-error">
            missing configuration: {(policy.missingConfiguration as string[]).join(", ")}
          </span>
        ) : null}
      </Row>
      <Row label="Stopping semantics">{STOP_SEMANTICS}</Row>
      <Row label="Timeline">
        <ul className="list-disc pl-5 font-mono text-xs">
          {events.map((e) => (
            <li key={e.id}>
              {e.createdAt.toISOString().slice(0, 19).replace("T", " ")} · {e.type} · {e.actor}
            </li>
          ))}
          {events.length === 0 ? <li>no events recorded</li> : null}
        </ul>
      </Row>
    </section>
  );
}
