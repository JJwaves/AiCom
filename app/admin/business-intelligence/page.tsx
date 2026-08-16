import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BI_PERIOD_DAYS } from "@/config/business-intelligence";
import { isFlagEnabled } from "@/config/flags";
import Link from "next/link";
import { checkAdminAuth } from "@/lib/admin/auth";
import { ceoReviewSchema, type CeoReview } from "@/lib/ai/agents/ceo/schema";
import { formatMoney, formatQty } from "@/lib/format";
import {
  buildBusinessIntelligenceReport,
  customPeriod,
  periodFromDays,
  type BusinessIntelligenceReport,
  type Metric,
  type Ratio,
} from "@/modules/business-intelligence";
import type { Trend } from "@/modules/business-intelligence/trend";
import { COST_MODEL } from "@/config/costs";
import { listCatalogProducts } from "@/lib/commerce/catalog";
import { assessCostReadiness } from "@/modules/pricing";
import { CostReadinessPanel } from "@/components/admin/cost-readiness";
import { GenerateReviewButton } from "./generate-review-button";

/**
 * /admin/business-intelligence (Session 09 spec §29–§31) — the business
 * owner's dashboard. Every number is deterministic (real orders, events,
 * usage rows; explicit periods; visible denominators). The ONLY AI on
 * this page is the persisted CEO review, generated exclusively by the
 * explicit button. Flag off or auth missing ⇒ the page does not exist.
 */

export const metadata: Metadata = { title: "Business Intelligence — Admin", robots: { index: false, follow: false } };

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

function parsePeriod(params: { period?: string; from?: string; to?: string }) {
  if (params.from && params.to) {
    const from = new Date(`${params.from}T00:00:00Z`);
    const to = new Date(`${params.to}T23:59:59Z`);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from < to) return customPeriod(from, to);
  }
  const days = Number.parseInt(params.period ?? "30", 10);
  return periodFromDays((BI_PERIOD_DAYS as readonly number[]).includes(days) ? days : 30);
}

const periodLabel = (days: number) => (days === 1 ? "Last 24 hours" : `Last ${days} days`);

/** Money metric → owner-friendly text. Unavailable NEVER renders as $0. */
function moneyMetric(m: Metric<number>, currency: string | null): { value: string; hint?: string } {
  const cur = (currency ?? "USD") as "USD" | "CAD";
  switch (m.status) {
    case "AVAILABLE":
      return { value: formatMoney(m.value, cur) };
    case "PARTIAL":
      return { value: `${formatMoney(m.value, cur)}*`, hint: m.reason };
    case "UNAVAILABLE":
      return { value: "Unavailable", hint: m.reason };
  }
}

function countMetric(m: Metric<number>): { value: string; hint?: string } {
  switch (m.status) {
    case "AVAILABLE":
      return { value: formatQty(m.value) };
    case "PARTIAL":
      return { value: `${formatQty(m.value)}*`, hint: m.reason };
    case "UNAVAILABLE":
      return { value: "Unavailable", hint: m.reason };
  }
}

function marginMetric(m: Metric<number>): { value: string; hint?: string } {
  switch (m.status) {
    case "AVAILABLE":
      return { value: `${(m.value * 100).toFixed(1)}%` };
    case "PARTIAL":
      return { value: `${(m.value * 100).toFixed(1)}%*`, hint: m.reason };
    case "UNAVAILABLE":
      return { value: "Unavailable", hint: m.reason };
  }
}

/** AI spend micros → dollars; availability preserved. */
function spendMetric(m: Metric<number>): { value: string; hint?: string } {
  switch (m.status) {
    case "AVAILABLE":
      return { value: `$${(m.value / 1_000_000).toFixed(4)}` };
    case "PARTIAL":
      return { value: `$${(m.value / 1_000_000).toFixed(4)}*`, hint: m.reason };
    case "UNAVAILABLE":
      return { value: "Unavailable", hint: m.reason };
  }
}

const ratioText = (r: Ratio) =>
  r.percentage === null
    ? `${formatQty(r.numerator)} of ${formatQty(r.denominator)} (sample too small for %)`
    : `${formatQty(r.numerator)} of ${formatQty(r.denominator)} (${r.percentage}%)`;

function trendText(t: Trend): string {
  switch (t.state) {
    case "TREND":
      return `${t.changePct! >= 0 ? "+" : ""}${t.changePct}%`;
    case "NEW_ACTIVITY":
      return "New activity";
    case "LOW_BASELINE":
      return "Baseline too small";
    case "NO_ACTIVITY":
      return "No activity";
  }
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

export default async function BusinessIntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  if (!isFlagEnabled("AI_BUSINESS_INTELLIGENCE")) notFound();
  const h = await headers();
  if (checkAdminAuth(h.get("authorization")) !== "authorized") notFound();

  const params = await searchParams;
  const period = parsePeriod(params);
  const report: BusinessIntelligenceReport = await buildBusinessIntelligenceReport(period);
  const costReadiness = assessCostReadiness(COST_MODEL, await listCatalogProducts());
  const s = report.snapshot;
  const revenue = s.commerce.revenue;
  const funnel = s.commerce.funnel;
  const currency = revenue.currency;

  const rev = moneyMetric(revenue.revenueCents, currency);
  const aov = moneyMetric(revenue.aovCents, currency);
  const orders = countMetric(revenue.orders);
  const aiRevenue = moneyMetric(revenue.aiAssistedRevenueCents, currency);
  const sessionPurchase = funnel.rates.find((r) => r.name === "session_to_purchase");

  const ceoReview: CeoReview | null = report.ceoReport
    ? (() => {
        const parsed = ceoReviewSchema.safeParse(report.ceoReport?.reviewJson);
        return parsed.success ? parsed.data : null;
      })()
    : null;

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <p className="label-mono text-ink-3">Admin · business intelligence</p>
      <h1 className="mt-1 text-3xl" style={{ fontWeight: 600 }}>
        Business Intelligence
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-2">
        Deterministic business metrics from real orders, sessions, and conversations. Metrics that need missing
        configuration say so honestly — nothing here substitutes zero for unknown. The CEO review below is
        AI-generated ONLY when you press the button, and it can recommend, never act.
      </p>

      {/* Period selector */}
      <nav aria-label="Reporting period" className="mt-6 flex flex-wrap items-center gap-2">
        {BI_PERIOD_DAYS.map((d) => (
          <Link
            key={d}
            className="chip"
            data-selected={s.period.days === d && !params.from ? "true" : undefined}
            href={`/admin/business-intelligence?period=${d}`}
          >
            {periodLabel(d)}
          </Link>
        ))}
        <span className="text-xs text-ink-3">
          {dateOnly(s.period.start)} → {dateOnly(s.period.end)} · custom range via ?from=YYYY-MM-DD&amp;to=YYYY-MM-DD
        </span>
      </nav>

      {/* Overview */}
      <SectionTitle>Overview — {s.period.label}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label={`Revenue${currency ? ` (${currency})` : ""}`} value={rev.value} hint={rev.hint} />
        <Card label="Orders" value={orders.value} hint={revenue.excludedOrders > 0 ? `${revenue.excludedOrders} cancelled/refunded excluded` : orders.hint} />
        <Card label="Average order value" value={aov.value} hint={aov.hint} />
        <Card
          label="Purchase conversion"
          value={sessionPurchase && sessionPurchase.ratio.percentage !== null ? `${sessionPurchase.ratio.percentage}%` : "—"}
          hint={sessionPurchase ? `${ratioText(sessionPurchase.ratio)} · orders ÷ sessions started` : undefined}
        />
      </div>
      {revenue.byCurrency.length > 1 ? (
        <p className="mt-2 text-xs text-ink-3">
          Orders span multiple currencies — headline metrics are unavailable without a conversion model. Per currency:{" "}
          {revenue.byCurrency
            .map((c) => `${c.currency}: ${formatMoney(c.revenueCents, c.currency as "USD" | "CAD")} (${formatQty(c.orders)} orders)`)
            .join(" · ")}
        </p>
      ) : null}

      {/* Funnel */}
      <SectionTitle>Funnel</SectionTitle>
      <div className="table-scroll surface">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Business funnel stages</caption>
          <thead>
            <tr className="border-b border-rule">
              <th scope="col" className="label-mono p-3 text-left">Stage</th>
              <th scope="col" className="label-mono p-3 text-right">Sessions</th>
              <th scope="col" className="label-mono p-3 text-right">Events</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-rule">
              <td className="p-3">Sessions started</td>
              <td className="p-3 text-right font-mono">{formatQty(funnel.sessionsStarted)}</td>
              <td className="p-3 text-right font-mono text-ink-3">—</td>
            </tr>
            {funnel.stages.map((st) => (
              <tr key={st.name} className="border-b border-rule">
                <td className="p-3">{st.label}</td>
                <td className="p-3 text-right font-mono">{formatQty(st.sessions)}</td>
                <td className="p-3 text-right font-mono text-ink-3">{formatQty(st.events)}</td>
              </tr>
            ))}
            <tr>
              <td className="p-3">Purchases (orders table · AI-assisted / total)</td>
              <td className="p-3 text-right font-mono" colSpan={2}>
                {formatQty(funnel.purchases.aiAssisted)} / {formatQty(funnel.purchases.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {funnel.rates.map((r) => (
          <div key={r.name} className="surface flex items-center justify-between gap-2 p-3">
            <dt>
              {r.label}
              <span className="block text-xs text-ink-3">denominator: {r.denominatorDefinition}</span>
            </dt>
            <dd className="font-mono">{ratioText(r.ratio)}</dd>
          </div>
        ))}
      </dl>

      {/* AI Sales */}
      <SectionTitle>AI Sales</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="AI conversations"
          value={formatQty(s.aiSales.conversations)}
          hint={`${formatQty(s.aiSales.qualifiedConversations)} qualified`}
        />
        <Card
          label="AI-assisted orders"
          value={countMetric(revenue.aiAssistedOrders).value}
          hint="conservative order flag — a loaded chat widget never counts"
        />
        <Card label="AI-assisted revenue" value={aiRevenue.value} hint={aiRevenue.hint} />
        <Card
          label="Conversation → purchase"
          value={s.aiSales.conversationPurchaseRate.percentage === null ? "—" : `${s.aiSales.conversationPurchaseRate.percentage}%`}
          hint={`${ratioText(s.aiSales.conversationPurchaseRate)} · purchased outcomes ÷ qualified conversations`}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="AI spend (period)"
          value={spendMetric(s.aiCost.spendMicros).value}
          hint={spendMetric(s.aiCost.spendMicros).hint ?? `${formatQty(s.aiCost.totalCalls)} calls`}
        />
        <Card label="AI calls" value={formatQty(s.aiCost.totalCalls)} hint={s.aiCost.failedCalls > 0 ? `${formatQty(s.aiCost.failedCalls)} failed` : undefined} />
        <Card
          label="Cost / conversation"
          value={spendMetric(s.aiSales.costPerConversationMicros).value}
          hint={spendMetric(s.aiSales.costPerConversationMicros).hint}
        />
        <Card
          label="Cost / AI-assisted order"
          value={spendMetric(s.aiSales.costPerAssistedOrderMicros).value}
          hint={spendMetric(s.aiSales.costPerAssistedOrderMicros).hint}
        />
      </div>
      {s.aiCost.byAgent.length > 0 ? (
        <p className="mt-2 text-xs text-ink-3">
          Spend by agent:{" "}
          {s.aiCost.byAgent
            .map((b) => `${b.key}: ${spendMetric(b.spendMicros).value} (${formatQty(b.calls)} calls)`)
            .join(" · ")}
        </p>
      ) : null}

      {/* Profitability */}
      <SectionTitle>Profitability</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="Gross profit"
          value={moneyMetric(s.profitability.grossProfitCents, currency).value}
          hint={moneyMetric(s.profitability.grossProfitCents, currency).hint}
        />
        <Card label="Gross margin" value={marginMetric(s.profitability.grossMarginPct).value} hint={marginMetric(s.profitability.grossMarginPct).hint} />
        <Card
          label="Contribution profit (before paid media)"
          value={moneyMetric(s.profitability.contributionProfitBeforePaidMediaCents, currency).value}
          hint={moneyMetric(s.profitability.contributionProfitBeforePaidMediaCents, currency).hint}
        />
        <Card
          label="Contribution margin (before paid media)"
          value={marginMetric(s.profitability.contributionMarginBeforePaidMediaPct).value}
          hint={marginMetric(s.profitability.contributionMarginBeforePaidMediaPct).hint}
        />
      </div>
      <ul className="mt-2 space-y-1 text-xs text-ink-3">
        {s.profitability.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
        {s.profitability.ordersWithoutCostSnapshot > 0 ? (
          <li>
            {s.profitability.ordersWithoutCostSnapshot} of {s.profitability.ordersTotal} orders carry no cost snapshot,
            so their profit is unavailable. Today&rsquo;s costs are deliberately not applied to past orders — that
            would report a number that was never true.
          </li>
        ) : null}
        {s.profitability.ordersWithoutContribution > 0 ? (
          <li>
            {s.profitability.ordersWithoutContribution} costed{" "}
            {s.profitability.ordersWithoutContribution === 1 ? "order has" : "orders have"} gross profit but no
            contribution profit: the variable selling costs were not known when they were placed.
          </li>
        ) : null}
        {s.profitability.missingCostInputs.length > 0 ? (
          <li>
            Missing cost inputs ({s.profitability.missingCostInputs.length}):{" "}
            {s.profitability.missingCostInputs.slice(0, 6).join(", ")}
            {s.profitability.missingCostInputs.length > 6 ? ", …" : ""} — fill config/costs.ts (see
            BUSINESS_CONFIG_TODO.md).
          </li>
        ) : null}
      </ul>

      <CostReadinessPanel readiness={costReadiness} />

      {/* Customer signals */}
      <SectionTitle>Customer signals</SectionTitle>
      {s.customerSignals.topQuestions.length === 0 && s.customerSignals.topObjections.length === 0 && s.customerSignals.productGaps.length === 0 ? (
        <Empty>
          No classified customer signals in this period. Run “Process new conversations” on the{" "}
          <Link className="underline" href="/admin/customer-intelligence">
            Customer Intelligence page
          </Link>{" "}
          after customers have chatted.
        </Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="surface p-4">
            <p className="label-mono text-ink-3">Top questions</p>
            {s.customerSignals.topQuestions.length === 0 ? (
              <Empty>None classified in this period.</Empty>
            ) : (
              <dl className="mt-2 space-y-2 text-sm">
                {s.customerSignals.topQuestions.map((q) => (
                  <div key={q.theme} className="flex justify-between">
                    <dt>{q.theme}</dt>
                    <dd className="font-mono">
                      {formatQty(q.conversations)} conversation{q.conversations === 1 ? "" : "s"}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <div className="surface p-4">
            <p className="label-mono text-ink-3">Top objections</p>
            {s.customerSignals.topObjections.length === 0 ? (
              <Empty>None classified in this period.</Empty>
            ) : (
              <dl className="mt-2 space-y-2 text-sm">
                {s.customerSignals.topObjections.map((o) => (
                  <div key={o.type} className="flex justify-between">
                    <dt>{o.type}</dt>
                    <dd className="font-mono">
                      {formatQty(o.conversations)} · {formatQty(o.purchased)} purchased anyway
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <div className="surface p-4">
            <p className="label-mono text-ink-3">Product gaps</p>
            {s.customerSignals.productGaps.length === 0 ? (
              <Empty>No catalog-unsupported requests in this period.</Empty>
            ) : (
              <dl className="mt-2 space-y-2 text-sm">
                {s.customerSignals.productGaps.map((g) => (
                  <div key={`${g.kind}:${g.normalized}`} className="flex justify-between">
                    <dt>
                      “{g.normalized}” <span className="text-ink-3">({g.kind})</span>
                    </dt>
                    <dd className="font-mono">{formatQty(g.conversations)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-3">
        Full evidence drill-downs live on the{" "}
        <Link className="underline" href="/admin/customer-intelligence">
          Customer Intelligence page
        </Link>
        .
      </p>

      {/* Trends */}
      <SectionTitle>What’s changing — vs {s.previous.label}</SectionTitle>
      <div className="table-scroll surface">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Period-over-period trends</caption>
          <thead>
            <tr className="border-b border-rule">
              <th scope="col" className="label-mono p-3 text-left">Metric</th>
              <th scope="col" className="label-mono p-3 text-right">Current</th>
              <th scope="col" className="label-mono p-3 text-right">Previous</th>
              <th scope="col" className="label-mono p-3 text-right">Change</th>
            </tr>
          </thead>
          <tbody>
            {s.trends.map((t) => (
              <tr key={t.name} className="border-b border-rule">
                <td className="p-3">{t.label}</td>
                <td className="p-3 text-right font-mono">
                  {t.name === "revenue" ? formatMoney(t.trend.current, (currency ?? "USD") as "USD" | "CAD") : formatQty(t.trend.current)}
                </td>
                <td className="p-3 text-right font-mono text-ink-3">
                  {t.name === "revenue" ? formatMoney(t.trend.previous, (currency ?? "USD") as "USD" | "CAD") : formatQty(t.trend.previous)}
                </td>
                <td className="p-3 text-right font-mono">{trendText(t.trend)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Products */}
      <SectionTitle>Products</SectionTitle>
      {s.products.length === 0 ? (
        <Empty>No completed orders in this period.</Empty>
      ) : (
        <div className="table-scroll surface">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Product performance</caption>
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className="label-mono p-3 text-left">Product</th>
                <th scope="col" className="label-mono p-3 text-right">Orders</th>
                <th scope="col" className="label-mono p-3 text-right">Units</th>
                <th scope="col" className="label-mono p-3 text-right">Revenue</th>
                <th scope="col" className="label-mono p-3 text-left">Top configurations</th>
                <th scope="col" className="label-mono p-3 text-right">Gross profit</th>
              </tr>
            </thead>
            <tbody>
              {s.products.map((p) => {
                const gp = moneyMetric(p.grossProfitCents, currency);
                const topOf = (vals: { value: string; count: number }[]) => vals.slice(0, 2).map((v) => `${v.value} (${v.count})`).join(", ");
                return (
                  <tr key={p.productId} className="border-b border-rule">
                    <td className="p-3">{p.title}</td>
                    <td className="p-3 text-right font-mono">{formatQty(p.orders)}</td>
                    <td className="p-3 text-right font-mono">{formatQty(p.units)}</td>
                    <td className="p-3 text-right font-mono">{formatMoney(p.revenueCents, (currency ?? "USD") as "USD" | "CAD")}</td>
                    <td className="p-3 text-xs text-ink-2">
                      qty: {topOf(p.quantities) || "—"} · size: {topOf(p.sizes) || "—"} · color: {topOf(p.colors) || "—"} · print: {topOf(p.printing) || "—"}
                    </td>
                    <td className="p-3 text-right font-mono" title={gp.hint}>
                      {gp.value}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Segments + attribution */}
      <SectionTitle>Segments &amp; acquisition</SectionTitle>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="surface p-4">
          <p className="label-mono text-ink-3">Business segments</p>
          {s.segments.length === 0 ? (
            <Empty>Not enough data — segments need {report.thresholds.MIN_SEGMENT_SAMPLE}+ qualified conversations or an order.</Empty>
          ) : (
            <dl className="mt-2 space-y-2 text-sm">
              {s.segments.map((seg) => (
                <div key={seg.key} className="flex justify-between gap-2">
                  <dt>{seg.key}</dt>
                  <dd className="text-right font-mono">
                    {formatQty(seg.orders)} orders · {formatMoney(seg.revenueCents, (currency ?? "USD") as "USD" | "CAD")}
                    {seg.aovCents !== null ? ` · AOV ${formatMoney(seg.aovCents, (currency ?? "USD") as "USD" | "CAD")}` : ""}
                    <span className="block text-xs text-ink-3">{ratioText(seg.conversationPurchaseRate)} conv → purchase</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="surface p-4">
          <p className="label-mono text-ink-3">First-touch sources (no ad-spend data — no CAC/ROAS)</p>
          {s.attribution.firstTouchSourceMedium.length === 0 ? (
            <Empty>Below minimum sample ({report.thresholds.MIN_ATTRIBUTION_SAMPLE} sessions) per source in this period.</Empty>
          ) : (
            <dl className="mt-2 space-y-2 text-sm">
              {s.attribution.firstTouchSourceMedium.map((row) => (
                <div key={row.key} className="flex justify-between gap-2">
                  <dt>{row.key}</dt>
                  <dd className="text-right font-mono">
                    {formatQty(row.sessions)} sessions · {formatQty(row.orders)} orders ·{" "}
                    {formatMoney(row.revenueCents, (currency ?? "USD") as "USD" | "CAD")}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {s.attribution.firstTouchLandingPage.length > 0 ? (
            <p className="mt-3 text-xs text-ink-3">
              Top landing pages:{" "}
              {s.attribution.firstTouchLandingPage
                .slice(0, 3)
                .map((r) => `${r.key} (${formatQty(r.sessions)})`)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      </div>

      {/* Advertising spend (Session 13) */}
      <SectionTitle>Advertising spend</SectionTitle>
      <div className="surface p-4">
        <p className="text-sm text-ink-2">{s.adSpend.statement}</p>
        {s.adSpend.spendCents.status !== "UNAVAILABLE" ? (
          <p className="mt-2 font-mono text-2xl text-ink">
            {(s.adSpend.spendCents.value / 100).toFixed(2)} {s.adSpend.currencyCode}
          </p>
        ) : (
          <p className="mt-2 font-mono text-2xl text-ink">Unavailable</p>
        )}
        <p className="mt-2 text-xs text-ink-3">
          The attribution breakdown above is first-party only and still computes no CAC or ROAS — those live, with
          their denominators and their attribution coverage, on the{" "}
          {isFlagEnabled("GOOGLE_ADS_INTELLIGENCE") ? (
            <Link className="underline" href="/admin/google-ads-intelligence">
              Google Ads Intelligence
            </Link>
          ) : (
            "Google Ads Intelligence"
          )}{" "}
          page. Profit on ad spend remains unavailable while manufacturing costs are unconfigured.
        </p>
      </div>

      {/* CEO review */}
      <SectionTitle>CEO review</SectionTitle>
      <div className="surface flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <p className="label-mono text-ink-3">Recommendation-only</p>
          <p className="mt-1 text-sm text-ink-2">
            The CEO agent reads the deterministic snapshot above and returns observations and recommendations. It has
            no tools, cannot touch prices, products, ads, or orders, and every recommendation awaits your review.
            {report.ceoReport
              ? ` Last generated ${report.ceoReport.generatedAt.toISOString()} (prompt v${report.ceoReport.promptVersion ?? "?"}, ${report.ceoReport.model ?? "model unknown"}).`
              : " No review has been generated yet."}
            {report.ceoReportStale ? " This review predates the latest data — refresh it for current numbers." : ""}
          </p>
          {isFlagEnabled("AI_ACTION_CENTER") ? (
            <p className="mt-2 text-sm text-ink-3">
              Review and approve these recommendations in the{" "}
              <Link className="underline" href="/admin/ai-actions">
                AI Action Center
              </Link>
              , where each one is guardrail-evaluated before you decide.
            </p>
          ) : null}
        </div>
        <GenerateReviewButton periodDays={s.period.days} hasReport={report.ceoReport !== null} />
      </div>

      {ceoReview ? (
        <div className="mt-4 space-y-4">
          <div className="surface p-4">
            <p className="label-mono text-ink-3">Executive summary</p>
            <p className="mt-2 whitespace-pre-line text-sm text-ink-2">{ceoReview.executiveSummary}</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {(
              [
                ["Highlights", ceoReview.highlights],
                ["Concerns", ceoReview.concerns],
                ["Opportunities", ceoReview.opportunities],
              ] as const
            ).map(([label, items]) => (
              <div key={label} className="surface p-4">
                <p className="label-mono text-ink-3">{label}</p>
                {items.length === 0 ? (
                  <Empty>None noted.</Empty>
                ) : (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-ink-2">
                    {items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <div>
            <p className="label-mono mb-2 text-ink-3">Recommendations ({ceoReview.recommendations.length})</p>
            {ceoReview.recommendations.length === 0 ? (
              <Empty>No recommendations — the agent found the current evidence too thin to act on. That is a valid answer.</Empty>
            ) : (
              <ul className="space-y-3">
                {ceoReview.recommendations.map((rec) => (
                  <li key={rec.title} className="surface p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm" style={{ fontWeight: 600 }}>
                        {rec.title}
                      </p>
                      <span className="label-mono text-xs text-ink-3">
                        {rec.actionCategory} · confidence {rec.confidence} · risk {rec.riskLevel} · needs your approval
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-ink-2">
                      <span className="text-ink-3">Observed: </span>
                      {rec.observation}
                    </p>
                    <p className="mt-1 text-sm text-ink-2">
                      <span className="text-ink-3">Recommendation: </span>
                      {rec.recommendation}
                    </p>
                    {rec.expectedImpact ? (
                      <p className="mt-1 text-sm text-ink-2">
                        <span className="text-ink-3">Expected impact: </span>
                        {rec.expectedImpact}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-ink-3">
                      Evidence: {rec.supportingMetricRefs.join(", ")}
                      {rec.evidenceRefs.length > 0 ? ` · records: ${rec.evidenceRefs.join(", ")}` : ""}
                    </p>
                    {rec.limitations.length > 0 ? (
                      <p className="mt-1 text-xs text-ink-3">Limitations: {rec.limitations.join(" · ")}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {/* Data quality */}
      <SectionTitle>Data quality</SectionTitle>
      <ul className="space-y-2 text-sm">
        {s.dataQuality.map((w) => (
          <li key={w.code} className="surface p-3">
            <span className="label-mono mr-2 text-ink-3">{w.code}</span>
            {w.message}
          </li>
        ))}
      </ul>

      <p className="mt-10 text-xs text-ink-3">
        Snapshot generated {s.generatedAt.toISOString()} · thresholds: % needs ≥{report.thresholds.MIN_DENOMINATOR_FOR_PERCENTAGE}{" "}
        denominator, trends need ≥{report.thresholds.MIN_TREND_BASE} previous-period base, segments need ≥
        {report.thresholds.MIN_SEGMENT_SAMPLE} per cell · purchases come from the orders table · AI-assisted uses the
        conservative Session-07 order flag.
      </p>
    </section>
  );
}
