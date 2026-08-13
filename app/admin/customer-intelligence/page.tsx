import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isFlagEnabled } from "@/config/flags";
import { VOLUME_GROUPS } from "@/config/customer-intelligence";
import { checkAdminAuth } from "@/lib/admin/auth";
import { formatQty } from "@/lib/format";
import { INSIGHT_STATUSES, OPPORTUNITY_STATUSES } from "@/lib/data/insight-service";
import {
  buildCustomerIntelligenceReport,
  customPeriod,
  periodFromDays,
  STANDARD_PERIOD_DAYS,
  type CustomerIntelligenceReport,
} from "@/modules/customer-intelligence";
import { ProcessButton } from "./process-button";
import { StatusButtons } from "./status-buttons";

/**
 * /admin/customer-intelligence (Session 08 spec §29) — the first admin
 * surface. Every number on this page is deterministic (real rows, explicit
 * periods, denominators shown); AI only ever contributed message LABELS,
 * and only via the explicit processing action. Flag off or auth missing ⇒
 * the page does not exist (404).
 */

export const metadata: Metadata = { title: "Customer Intelligence — Admin", robots: { index: false, follow: false } };

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

function parsePeriod(params: { period?: string; from?: string; to?: string }) {
  if (params.from && params.to) {
    const from = new Date(`${params.from}T00:00:00Z`);
    const to = new Date(`${params.to}T23:59:59Z`);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from < to) return customPeriod(from, to);
  }
  const days = Number.parseInt(params.period ?? "30", 10);
  return periodFromDays((STANDARD_PERIOD_DAYS as readonly number[]).includes(days) ? days : 30);
}

const pctText = (n: number, d: number, pct: number | null) =>
  pct === null ? `${formatQty(n)} of ${formatQty(d)} (sample too small for %)` : `${formatQty(n)} of ${formatQty(d)} (${pct}%)`;

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="surface p-4">
      <p className="label-mono text-ink-3">{label}</p>
      <p className="mt-1 font-mono text-2xl text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-3">{children}</p>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-10 mb-3 text-xl text-ink" style={{ fontWeight: 600 }}>
      {children}
    </h2>
  );
}

export default async function CustomerIntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  if (!isFlagEnabled("AI_CUSTOMER_INTELLIGENCE")) notFound();
  const h = await headers();
  if (checkAdminAuth(h.get("authorization")) !== "authorized") notFound();

  const params = await searchParams;
  const period = parsePeriod(params);
  const report: CustomerIntelligenceReport = await buildCustomerIntelligenceReport(period);
  const t = report.thresholds;
  const { overview } = report;

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <p className="label-mono text-ink-3">Admin · read-only intelligence</p>
      <h1 className="mt-1 text-3xl" style={{ fontWeight: 600 }}>
        Customer Intelligence
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-2">
        Evidence-backed patterns from real conversations, configurations, quotes, and orders. Counts are deterministic;
        AI only labels messages with controlled categories via the explicit processing action below. Nothing here acts
        on its own.
      </p>

      {/* Period selector */}
      <nav aria-label="Reporting period" className="mt-6 flex flex-wrap items-center gap-2">
        {STANDARD_PERIOD_DAYS.map((d) => (
          <Link
            key={d}
            className="chip"
            data-selected={report.period.days === d && !params.from ? "true" : undefined}
            href={`/admin/customer-intelligence?period=${d}`}
          >
            Last {d} days
          </Link>
        ))}
        <span className="text-xs text-ink-3">
          {dateOnly(report.period.start)} → {dateOnly(report.period.end)} · custom range via ?from=YYYY-MM-DD&amp;to=YYYY-MM-DD
        </span>
      </nav>

      {/* Processing */}
      <div className="surface mt-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label-mono text-ink-3">Classification status</p>
          <p className="mt-1 text-sm text-ink-2">
            {formatQty(overview.classifiedConversations)} of {formatQty(overview.totalConversations)} conversations in
            this period classified (pipeline v{report.processing.classifierVersion}) ·{" "}
            {formatQty(report.processing.pendingClassification)} pending overall
            {report.processing.failedClassifications > 0
              ? ` · ${formatQty(report.processing.failedClassifications)} failed (retried next run)`
              : ""}
          </p>
        </div>
        <ProcessButton periodDays={report.period.days} />
      </div>

      {/* Overview */}
      <SectionTitle>Overview — {report.period.label}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="Qualified conversations"
          value={formatQty(overview.qualifiedConversations)}
          hint={`of ${formatQty(overview.totalConversations)} total`}
        />
        <Card
          label="AI-assisted purchases"
          value={formatQty(overview.aiAssistedPurchases)}
          hint={`of ${formatQty(overview.totalOrders)} orders`}
        />
        <Card label="Human handoffs" value={formatQty(overview.humanHandoffs)} />
        <Card
          label="Purchase conversion"
          value={overview.purchaseRate.percentage === null ? "—" : `${overview.purchaseRate.percentage}%`}
          hint={pctText(overview.purchaseRate.numerator, overview.purchaseRate.denominator, overview.purchaseRate.percentage)}
        />
      </div>

      {/* AI-assisted funnel */}
      <SectionTitle>AI-assisted funnel</SectionTitle>
      <p className="mb-2 max-w-3xl text-xs text-ink-3">
        Distinct sessions per stage (raw event counts alongside). A loaded chat widget alone never counts as AI-assisted
        commerce — purchases use the conservative order-level aiAssisted flag.
      </p>
      <div className="table-scroll surface">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">AI-assisted funnel stages</caption>
          <thead>
            <tr className="border-b border-rule">
              <th scope="col" className="label-mono p-3 text-left">Stage</th>
              <th scope="col" className="label-mono p-3 text-right">Sessions</th>
              <th scope="col" className="label-mono p-3 text-right">Events</th>
            </tr>
          </thead>
          <tbody>
            {report.funnel.stages.map((s) => (
              <tr key={s.name} className="border-b border-rule">
                <td className="p-3">{s.label}</td>
                <td className="p-3 text-right font-mono">{formatQty(s.sessions)}</td>
                <td className="p-3 text-right font-mono text-ink-3">{formatQty(s.events)}</td>
              </tr>
            ))}
            <tr>
              <td className="p-3">Purchases (AI-assisted / total)</td>
              <td className="p-3 text-right font-mono" colSpan={2}>
                {formatQty(report.funnel.purchases.aiAssisted)} / {formatQty(report.funnel.purchases.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Top questions */}
      <SectionTitle>Top questions</SectionTitle>
      {report.questions.length === 0 ? (
        <Empty>
          No classified customer questions in this period yet. Run “Process new conversations” after customers have
          chatted — insights generate once a theme reaches {t.MIN_EVIDENCE_FOR_INSIGHT} qualified conversations.
        </Empty>
      ) : (
        <div className="table-scroll surface">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Question themes by conversation count</caption>
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className="label-mono p-3 text-left">Theme</th>
                <th scope="col" className="label-mono p-3 text-right">Conversations</th>
                <th scope="col" className="label-mono p-3 text-right">Mentions</th>
                <th scope="col" className="label-mono p-3 text-right">Of qualified</th>
                <th scope="col" className="label-mono p-3 text-right">Trend</th>
              </tr>
            </thead>
            <tbody>
              {report.questions.map((q) => (
                <tr key={q.theme} className="border-b border-rule">
                  <td className="p-3">{q.theme}</td>
                  <td className="p-3 text-right font-mono">{formatQty(q.conversations)}</td>
                  <td className="p-3 text-right font-mono text-ink-3">{formatQty(q.mentions)}</td>
                  <td className="p-3 text-right font-mono">
                    {pctText(q.qualifiedConversations, report.overview.qualifiedClassified, q.percentage)}
                  </td>
                  <td className="p-3 text-right font-mono">
                    {q.trendPct === null ? <span className="text-ink-3">n/a</span> : `${q.trendPct > 0 ? "+" : ""}${q.trendPct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Top objections */}
      <SectionTitle>Top objections</SectionTitle>
      {report.objections.length === 0 ? (
        <Empty>No classified objections in this period. Questions and objections are tracked separately — an MOQ question is not an MOQ objection.</Empty>
      ) : (
        <div className="table-scroll surface">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Objections by conversation count</caption>
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className="label-mono p-3 text-left">Objection</th>
                <th scope="col" className="label-mono p-3 text-right">Conversations</th>
                <th scope="col" className="label-mono p-3 text-right">Purchased anyway</th>
                <th scope="col" className="label-mono p-3 text-right">Trend</th>
              </tr>
            </thead>
            <tbody>
              {report.objections.map((o) => (
                <tr key={o.type} className="border-b border-rule">
                  <td className="p-3">{o.type}</td>
                  <td className="p-3 text-right font-mono">{formatQty(o.conversations)}</td>
                  <td className="p-3 text-right font-mono">
                    {o.purchaseRatePct === null ? `${formatQty(o.purchased)} (n too small for %)` : `${formatQty(o.purchased)} (${o.purchaseRatePct}%)`}
                  </td>
                  <td className="p-3 text-right font-mono">
                    {o.trendPct === null ? <span className="text-ink-3">n/a</span> : `${o.trendPct > 0 ? "+" : ""}${o.trendPct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Demand */}
      <SectionTitle>Demand — requested vs configured vs purchased</SectionTitle>
      <p className="mb-3 max-w-3xl text-sm text-ink-2">
        Requested = what prospects say they want (customer-stated counted separately from AI-inferred). Configured =
        what users set up in the configurator. Purchased = order lines. The lanes are never merged.
      </p>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="surface p-4">
          <p className="label-mono text-ink-3">Requested ({formatQty(report.demand.requested.profiles)} profiles)</p>
          {report.demand.requested.volumeGroups.length === 0 &&
          report.demand.requested.colors.length === 0 &&
          report.demand.requested.businessTypes.length === 0 ? (
            <Empty>No stated demand captured in this period.</Empty>
          ) : (
            <dl className="mt-2 space-y-2 text-sm">
              {report.demand.requested.volumeGroups.map((v) => (
                <div key={v.value} className="flex justify-between">
                  <dt>{VOLUME_GROUPS.find((g) => g.id === v.value)?.label ?? v.value}</dt>
                  <dd className="font-mono">
                    {formatQty(v.stated)} stated{v.inferred > 0 ? ` · ${formatQty(v.inferred)} inferred` : ""}
                  </dd>
                </div>
              ))}
              {report.demand.requested.colors.slice(0, 5).map((v) => (
                <div key={`c-${v.value}`} className="flex justify-between">
                  <dt>Color: {v.value}</dt>
                  <dd className="font-mono">
                    {formatQty(v.stated)} stated{v.inferred > 0 ? ` · ${formatQty(v.inferred)} inferred` : ""}
                  </dd>
                </div>
              ))}
              {report.demand.requested.printing.slice(0, 3).map((v) => (
                <div key={`p-${v.value}`} className="flex justify-between">
                  <dt>Printing: {v.value}</dt>
                  <dd className="font-mono">
                    {formatQty(v.stated)} stated{v.inferred > 0 ? ` · ${formatQty(v.inferred)} inferred` : ""}
                  </dd>
                </div>
              ))}
              {report.demand.requested.businessTypes.slice(0, 5).map((v) => (
                <div key={`b-${v.value}`} className="flex justify-between">
                  <dt>Business: {v.value}</dt>
                  <dd className="font-mono">
                    {formatQty(v.stated)} stated{v.inferred > 0 ? ` · ${formatQty(v.inferred)} inferred` : ""}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="surface p-4">
          <p className="label-mono text-ink-3">
            Configured ({formatQty(report.demand.configured.configurations)} configurations)
          </p>
          {report.demand.configured.configurations === 0 ? (
            <Empty>No configurator activity in this period.</Empty>
          ) : (
            <dl className="mt-2 space-y-2 text-sm">
              {report.demand.configured.volumeGroups.map((v) => (
                <div key={v.value} className="flex justify-between">
                  <dt>{VOLUME_GROUPS.find((g) => g.id === v.value)?.label ?? v.value}</dt>
                  <dd className="font-mono">{formatQty(v.count)}</dd>
                </div>
              ))}
              {report.demand.configured.sizes.map((v) => (
                <div key={`s-${v.value}`} className="flex justify-between">
                  <dt>Size: {v.value}</dt>
                  <dd className="font-mono">{formatQty(v.count)}</dd>
                </div>
              ))}
              {report.demand.configured.colors.slice(0, 5).map((v) => (
                <div key={`c-${v.value}`} className="flex justify-between">
                  <dt>Color: {v.value}</dt>
                  <dd className="font-mono">{formatQty(v.count)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="surface p-4">
          <p className="label-mono text-ink-3">
            Purchased ({formatQty(report.demand.purchased.orders)} orders · {formatQty(report.demand.purchased.lines)} lines)
          </p>
          {report.demand.purchased.lines === 0 ? (
            <Empty>No orders in this period.</Empty>
          ) : (
            <dl className="mt-2 space-y-2 text-sm">
              {report.demand.purchased.volumeGroups.map((v) => (
                <div key={v.value} className="flex justify-between">
                  <dt>{VOLUME_GROUPS.find((g) => g.id === v.value)?.label ?? v.value}</dt>
                  <dd className="font-mono">{formatQty(v.count)}</dd>
                </div>
              ))}
              {report.demand.purchased.sizes.map((v) => (
                <div key={`s-${v.value}`} className="flex justify-between">
                  <dt>Size: {v.value}</dt>
                  <dd className="font-mono">{formatQty(v.count)}</dd>
                </div>
              ))}
              {report.demand.purchased.colors.slice(0, 5).map((v) => (
                <div key={`c-${v.value}`} className="flex justify-between">
                  <dt>Color: {v.value}</dt>
                  <dd className="font-mono">{formatQty(v.count)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      {/* Product gaps */}
      <SectionTitle>Product gaps — requested but unsupported</SectionTitle>
      {report.gaps.length === 0 ? (
        <Empty>
          No catalog-unsupported requests classified in this period. Support verdicts come from the real catalog —
          custom colors, custom sizes, and below-MOQ requests route to the quote flow and are not listed as gaps.
        </Empty>
      ) : (
        <ul className="space-y-2">
          {report.gaps.map((g) => (
            <li key={`${g.kind}:${g.normalized}`} className="surface flex items-center justify-between p-3 text-sm">
              <span>
                “{g.normalized}” <span className="text-ink-3">({g.kind})</span>
              </span>
              <span className="font-mono">
                {formatQty(g.conversations)} conversations · {formatQty(g.mentions)} mentions ·{" "}
                {formatQty(g.qualifiedConversations)} qualified
              </span>
            </li>
          ))}
        </ul>
      )}
      {report.customQuoteRequests.length > 0 ? (
        <p className="mt-2 text-xs text-ink-3">
          Also requested (covered by custom-quote paths, not gaps):{" "}
          {report.customQuoteRequests.map((r) => `“${r.normalized}” (${formatQty(r.conversations)})`).join(" · ")}
        </p>
      ) : null}

      {/* Lost opportunities */}
      <SectionTitle>Lost opportunities (conservative)</SectionTitle>
      {report.lostOpportunities.unsupportedQualified.length === 0 &&
      report.lostOpportunities.belowMoqStated === 0 &&
      report.lostOpportunities.escalatedConversations === 0 ? (
        <Empty>No commercially meaningful unmet demand detected in this period. Non-purchases alone are never counted as lost revenue.</Empty>
      ) : (
        <ul className="space-y-2 text-sm">
          {report.lostOpportunities.unsupportedQualified.map((g) => (
            <li key={`${g.kind}:${g.normalized}`} className="surface p-3">
              Unsupported “{g.normalized}” requested in {formatQty(g.qualifiedConversations)} qualified conversation
              {g.qualifiedConversations === 1 ? "" : "s"}.
            </li>
          ))}
          {report.lostOpportunities.belowMoqStated > 0 ? (
            <li className="surface p-3">
              {formatQty(report.lostOpportunities.belowMoqStated)} customer-stated below-MOQ quantities (currently
              routed to custom quotes).
            </li>
          ) : null}
          {report.lostOpportunities.escalatedConversations > 0 ? (
            <li className="surface p-3">
              {formatQty(report.lostOpportunities.escalatedConversations)} conversations escalated to a human in this
              period (follow-up outcome tracked outside this dashboard).
            </li>
          ) : null}
        </ul>
      )}

      {/* Product opportunities */}
      <SectionTitle>Product opportunities</SectionTitle>
      {report.opportunities.length === 0 ? (
        <Empty>
          No evidence-backed opportunities yet — they generate from {t.MIN_EVIDENCE_FOR_INSIGHT}+ distinct evidence
          records and always require human validation before any action.
        </Empty>
      ) : (
        <ul className="space-y-3">
          {report.opportunities.map((o) => (
            <li key={o.id} className="surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm" style={{ fontWeight: 600 }}>
                    {o.title}
                    {o.opportunityType ? <span className="ml-2 label-mono text-ink-3">{o.opportunityType}</span> : null}
                  </p>
                  <p className="mt-1 max-w-2xl text-sm text-ink-2">{o.description}</p>
                  <p className="mt-1 text-xs text-ink-3">
                    Evidence: {formatQty(o.evidenceCount)} records
                    {o.estimatedDemand ? ` · ${o.estimatedDemand}` : ""} · human validation required ·{" "}
                    <Link className="underline" href={`/admin/customer-intelligence/opportunities/${o.id}`}>
                      view evidence
                    </Link>
                  </p>
                </div>
                <StatusButtons kind="opportunities" id={o.id} current={o.status} statuses={OPPORTUNITY_STATUSES} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Insights */}
      <SectionTitle>Recent insights</SectionTitle>
      {report.insights.length === 0 ? (
        <Empty>
          Not enough qualified conversations yet to generate customer insights — a pattern needs{" "}
          {t.MIN_EVIDENCE_FOR_INSIGHT}+ distinct conversations before it is persisted. Raw metrics above still reflect
          everything recorded so far.
        </Empty>
      ) : (
        <ul className="space-y-3">
          {report.insights.map((i) => (
            <li key={i.id} className="surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm" style={{ fontWeight: 600 }}>
                    <span className="label-mono mr-2 text-ink-3">{i.insightType}</span>
                    {i.title}
                  </p>
                  {i.summary ? <p className="mt-1 max-w-2xl text-sm text-ink-2">{i.summary}</p> : null}
                  <p className="mt-1 text-xs text-ink-3">
                    Evidence: {formatQty(i.evidenceCount)} records
                    {i.periodStart && i.periodEnd ? ` · ${dateOnly(i.periodStart)} → ${dateOnly(i.periodEnd)}` : ""} ·{" "}
                    <Link className="underline" href={`/admin/customer-intelligence/insights/${i.id}`}>
                      view evidence
                    </Link>
                  </p>
                </div>
                <StatusButtons kind="insights" id={i.id} current={i.status} statuses={INSIGHT_STATUSES} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Associations + segments */}
      {report.associations.length > 0 ? (
        <>
          <SectionTitle>Observed conversion associations</SectionTitle>
          <p className="mb-2 max-w-3xl text-xs text-ink-3">
            Descriptive comparisons among qualified conversations — observational only, never causal claims.
          </p>
          <ul className="space-y-2 text-sm">
            {report.associations.map((a) => (
              <li key={`${a.dimension}:${a.key}`} className="surface p-3">
                With {a.dimension} “{a.key}”: {formatQty(a.with.purchased)} of {formatQty(a.with.conversations)}{" "}
                purchased · without: {formatQty(a.without.purchased)} of {formatQty(a.without.conversations)}.
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {(report.businessSegments.length > 0 || report.attribution.length > 0) ? (
        <>
          <SectionTitle>Segments</SectionTitle>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="surface p-4">
              <p className="label-mono text-ink-3">Business types (qualified conversations)</p>
              {report.businessSegments.length === 0 ? (
                <Empty>Below minimum sample ({t.MIN_SEGMENT_SAMPLE}) in this period.</Empty>
              ) : (
                <dl className="mt-2 space-y-2 text-sm">
                  {report.businessSegments.map((s) => (
                    <div key={s.key} className="flex justify-between">
                      <dt>{s.key}</dt>
                      <dd className="font-mono">
                        {formatQty(s.conversations)} · {formatQty(s.purchased)} purchased
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <div className="surface p-4">
              <p className="label-mono text-ink-3">First-touch source (qualified conversations)</p>
              {report.attribution.length === 0 ? (
                <Empty>Below minimum sample ({t.MIN_SEGMENT_SAMPLE}) per source in this period.</Empty>
              ) : (
                <dl className="mt-2 space-y-2 text-sm">
                  {report.attribution.map((s) => (
                    <div key={s.key} className="flex justify-between">
                      <dt>{s.key}</dt>
                      <dd className="font-mono">
                        {formatQty(s.conversations)} · {formatQty(s.purchased)} purchased · {formatQty(s.moqQuestionConversations)} MOQ&nbsp;Q
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        </>
      ) : null}

      <p className="mt-10 text-xs text-ink-3">
        Report generated {report.generatedAt.toISOString()} · classification pipeline v
        {report.processing.classifierVersion} · thresholds: insight ≥{t.MIN_EVIDENCE_FOR_INSIGHT} evidence, % needs ≥
        {t.MIN_DENOMINATOR_FOR_PERCENTAGE} denominator, trend needs ≥{t.MIN_TREND_BASE} previous-period base, segments
        need ≥{t.MIN_SEGMENT_SAMPLE} per cell.
      </p>
    </section>
  );
}
