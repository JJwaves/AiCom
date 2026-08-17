import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { checkAdminAuth } from "@/lib/admin/auth";
import { handoffCounts } from "@/lib/data/handoff-service";
import { listReconciliationRuns } from "@/lib/data/reconciliation-run-service";
import {
  buildReadinessReport,
  READINESS_CATEGORIES,
  type ReadinessCategory,
  type ReadinessCheck,
} from "@/modules/launch-readiness";
import { ReconcileButton } from "./readiness-controls";

/**
 * /admin/launch-readiness — the owner's preflight dashboard (Production
 * Launch Session 03 §46, §47).
 *
 * Every line is computed from the running system, not remembered from a
 * checklist, so it cannot drift from what production actually does.
 *
 * OWNER-FRIENDLY FIRST (§47): "12 Shopify variants are unmapped" is the
 * headline; `SHOPIFY_MERCHANDISE_MAP` is small grey text beside it. The
 * person reading this page is deciding whether to switch on advertising —
 * not debugging a config parser.
 *
 * NO CREDENTIALS. The readiness service reports which variables are missing
 * and never their values, and this page renders only what it is given.
 */

export const metadata: Metadata = { title: "Launch readiness — Admin", robots: { index: false, follow: false } };

const CATEGORY_LABEL: Record<ReadinessCategory, string> = {
  COMMERCE: "Commerce",
  DATABASE: "Database",
  PRODUCT: "Products",
  ARTWORK: "Artwork",
  AI: "AI",
  ANALYTICS: "Analytics",
  ADMIN: "Admin",
  MONITORING: "Monitoring",
  OPERATIONS: "Operations",
  BUSINESS_CONFIG: "Business details",
};

const STATE_STYLE = {
  READY: { label: "Ready", tone: "text-ok", dot: "bg-ok" },
  WARNING: { label: "Needs attention", tone: "text-warn", dot: "bg-warn" },
  BLOCKED: { label: "Blocked", tone: "text-error", dot: "bg-error" },
} as const;

function CheckRow({ check }: { check: ReadinessCheck }) {
  const style = STATE_STYLE[check.state];
  return (
    <li className="border-t border-rule py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm text-ink" style={{ fontWeight: 600 }}>
          <span className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${style.dot}`} aria-hidden="true" />
          {check.title}
        </h3>
        <p className={`label-mono text-xs ${style.tone}`}>
          {check.ownerVerified && check.state === "WARNING" ? "Owner verification required" : style.label}
          {!check.mandatory ? " · optional" : ""}
        </p>
      </div>
      <p className="mt-1 text-sm text-ink-2">{check.summary}</p>
      {check.action ? <p className="mt-1 text-sm text-ink-3">→ {check.action}</p> : null}
      <p className="mt-1 font-mono text-[11px] text-ink-3">{check.code}</p>
    </li>
  );
}

export default async function LaunchReadinessPage() {
  const h = await headers();
  if (checkAdminAuth(h.get("authorization")) !== "authorized") notFound();

  const [report, handoffs, runs] = await Promise.all([
    buildReadinessReport(),
    handoffCounts().catch(() => null),
    listReconciliationRuns(5).catch(() => []),
  ]);

  const headline = STATE_STYLE[report.state];
  const byCategory = READINESS_CATEGORIES.map((category) => ({
    category,
    checks: report.checks.filter((c) => c.category === category),
  })).filter((group) => group.checks.length > 0);

  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl" style={{ fontWeight: 600 }}>
        Launch readiness
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-2">
        Computed from the running system right now — configuration, catalog and database, with no AI and no calls to
        Shopify, Google or your AI provider. Some items can only be closed by a person; those say so.
      </p>

      <div className={`mt-6 surface p-5 ${report.state === "BLOCKED" ? "border-error" : ""}`}>
        <p className={`label-mono ${headline.tone}`}>{headline.label}</p>
        <p className="mt-1 text-lg text-ink" style={{ fontWeight: 600 }}>
          {report.state === "READY"
            ? "Everything this system can check is in place."
            : report.state === "WARNING"
              ? "Sellable, with items that need your attention."
              : `${report.blockers.length} thing${report.blockers.length === 1 ? "" : "s"} would break a real order.`}
        </p>
        {report.blockers.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-2">
            {report.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}
        <p className="mt-3 font-mono text-xs text-ink-3">
          {report.counts.ready} ready · {report.counts.warning} needs attention · {report.counts.blocked} blocked ·{" "}
          {report.environment}
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-start gap-4">
        <ReconcileButton />
        <Link href="/admin/handoffs" className="btn btn--ghost text-sm">
          Human handoffs
          {handoffs && handoffs.unhandled > 0 ? ` (${handoffs.unhandled} unhandled)` : ""}
        </Link>
      </div>

      {runs.length > 0 && (
        <div className="mt-6 surface p-4">
          <p className="label-mono text-ink-3">Recent reconciliation runs</p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-ink-2">
            {runs.map((run) => (
              <li key={run.id}>
                {new Date(run.startedAt).toLocaleString()} · {run.status} · inspected {run.ordersInspected} · repaired{" "}
                {run.repairsPerformed}
                {run.failures > 0 ? ` · ${run.failures} failed` : ""}
                {run.truncated ? " · window truncated" : ""}
                {run.errorCode ? ` · ${run.errorCode}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {byCategory.map(({ category, checks }) => (
        <div key={category} className="mt-8">
          <h2 className="mb-2 text-xl text-ink" style={{ fontWeight: 600 }}>
            {CATEGORY_LABEL[category]}
          </h2>
          <ul className="surface px-4 py-1">
            {checks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
