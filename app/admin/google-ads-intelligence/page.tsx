import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isFlagEnabled } from "@/config/flags";
import { GOOGLE_ADS_PERIOD_DAYS } from "@/config/google-ads";
import { checkAdminAuth } from "@/lib/admin/auth";
import { googleAdsReviewSchema, type GoogleAdsReview } from "@/lib/ai/agents/google-ads/schema";
import { reportingProviderStatus } from "@/lib/google-ads";
import { credentialSnapshotFrom } from "@/lib/google-ads/credential-snapshot";
import { formatQty } from "@/lib/format";
import type { Metric, Ratio } from "@/modules/business-intelligence/availability";
import type { Trend } from "@/modules/business-intelligence/trend";
import {
  buildGoogleAdsIntelligenceReport,
  customPeriod,
  formatMoneyish,
  periodFromDays,
  type GoogleAdsIntelligenceReport,
} from "@/modules/google-ads-intelligence";
import { GoogleAdsControls } from "./google-ads-controls";

/**
 * /admin/google-ads-intelligence (Session 13 spec §31) — the owner's paid
 * media surface.
 *
 * Every number on this page is deterministic and comes from PERSISTED synced
 * data: rendering it makes NO Google Ads API call (spec §10) and NO AI call.
 * The only AI on the page is the persisted review, generated exclusively by
 * the explicit button.
 *
 * The page states what it does not know as loudly as what it does. "Not
 * connected", "sync failed" and "stale" are shown as themselves — never as
 * $0 spend — and Google's numbers are visually and structurally separated
 * from BagDirect's throughout (spec §14, §15, §18, §34).
 */

export const metadata: Metadata = {
  title: "Google Ads Intelligence — Admin",
  robots: { index: false, follow: false },
};

function parsePeriod(params: { period?: string; from?: string; to?: string }) {
  if (params.from && params.to) {
    const from = new Date(`${params.from}T00:00:00Z`);
    const to = new Date(`${params.to}T23:59:59Z`);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from < to) return customPeriod(from, to);
  }
  const days = Number.parseInt(params.period ?? "30", 10);
  return periodFromDays((GOOGLE_ADS_PERIOD_DAYS as readonly number[]).includes(days) ? days : 30);
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

function metricText(m: Metric<number>, render: (v: number) => string): { value: string; hint?: string } {
  if (m.status === "UNAVAILABLE") return { value: "Unavailable", hint: m.reason };
  if (m.status === "PARTIAL") return { value: render(m.value), hint: `Partial — ${m.reason}` };
  return { value: render(m.value) };
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-10 mb-3 text-xl text-ink" style={{ fontWeight: 600 }}>
      {children}
    </h2>
  );
}

export default async function GoogleAdsIntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  if (!isFlagEnabled("GOOGLE_ADS_INTELLIGENCE")) notFound();
  const h = await headers();
  if (checkAdminAuth(h.get("authorization")) !== "authorized") notFound();

  const params = await searchParams;
  const period = parsePeriod(params);
  const credentials = credentialSnapshotFrom(reportingProviderStatus());
  const report: GoogleAdsIntelligenceReport = await buildGoogleAdsIntelligenceReport(period, credentials);
  const s = report.snapshot;
  const agentEnabled = isFlagEnabled("AI_GOOGLE_ADS_AGENT");
  const currency = s.google.currencyCode;
  const money = (cents: number) => formatMoneyish(cents, currency);
  const connected = s.connection.state === "CONNECTED";
  /**
   * Whether there is REAL synced data to render — deliberately independent of
   * whether credentials are currently readable. Data that was synced is real
   * even if the credential has since been rotated away; showing "—" beside a
   * campaign table full of numbers would be the page contradicting itself.
   * The connection panel above already states the credential situation.
   */
  const hasData = s.google.daysWithData > 0;

  const review: GoogleAdsReview | null = report.adsReport
    ? (() => {
        const parsed = googleAdsReviewSchema.safeParse(report.adsReport?.reviewJson);
        return parsed.success ? parsed.data : null;
      })()
    : null;

  const costPerOrder = metricText(s.efficiency.firstPartyCostPerOrderCents, money);
  const firstPartyRoas = metricText(s.efficiency.firstPartyRoas, (v) => `${v}×`);
  const googleCpa = metricText(s.efficiency.googleReportedCostPerConversionCents, money);
  const googleRoas = metricText(s.efficiency.googleReportedRoas, (v) => `${v}×`);
  const poas = metricText(s.efficiency.profitOnAdSpend, (v) => `${v}×`);
  const contributionBefore = metricText(s.efficiency.contributionBeforePaidMediaCents, money);
  const postAdContribution = metricText(s.efficiency.postAdContributionCents, money);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <p className="label-mono text-ink-3">Admin</p>
      <h1 className="mt-1 text-3xl text-ink" style={{ fontWeight: 700 }}>
        Google Ads Intelligence
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-2">
        What advertising costs, what it brings, and how confident we can be about the link between the two. This page is
        strictly read-only: BagDirect can read your Google Ads reporting and can change nothing in it.
      </p>

      {/* ---------------- Period ---------------- */}
      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Reporting period">
        {GOOGLE_ADS_PERIOD_DAYS.map((days) => (
          <Link
            key={days}
            href={`/admin/google-ads-intelligence?period=${days}`}
            className={`btn ${period.days === days ? "btn--primary" : ""}`}
          >
            Last {days} days
          </Link>
        ))}
      </nav>

      {/* ---------------- Connection & sync ---------------- */}
      <SectionTitle>Connection &amp; sync</SectionTitle>
      <div className="surface p-4">
        <p className="text-sm text-ink" style={{ fontWeight: 600 }}>
          {s.connection.state.replace(/_/g, " ")}
        </p>
        <p className="mt-1 text-sm text-ink-2">{s.connection.reason}</p>
        {s.connection.missingConfiguration.length > 0 ? (
          <p className="mt-2 text-xs text-ink-3">
            Server configuration still needed: {s.connection.missingConfiguration.join(", ")} (see .env.example — these
            are server-only variables and are never sent to the browser).
          </p>
        ) : null}
        <dl className="mt-3 grid gap-2 text-xs text-ink-3 sm:grid-cols-2">
          <div>
            <dt className="inline">Account: </dt>
            <dd className="inline">{s.connection.account?.customerId ?? "—"}</dd>
          </div>
          <div>
            <dt className="inline">API version: </dt>
            <dd className="inline">{s.connection.apiVersion ?? "—"}</dd>
          </div>
          <div>
            <dt className="inline">Currency: </dt>
            <dd className="inline">{s.connection.account?.currencyCode ?? "—"}</dd>
          </div>
          <div>
            <dt className="inline">Account time zone: </dt>
            <dd className="inline">{s.connection.account?.timeZone ?? "—"}</dd>
          </div>
          <div>
            <dt className="inline">Last successful sync: </dt>
            <dd className="inline">{s.freshness.lastSuccessfulSyncAt?.toISOString() ?? "never"}</dd>
          </div>
          <div>
            <dt className="inline">Latest reporting day held: </dt>
            <dd className="inline">{s.freshness.latestMetricDate ?? "none"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-ink-2">
          <strong>{s.freshness.state.replace(/_/g, " ")}</strong> — {s.freshness.reason}
        </p>
        <p className="mt-2 text-xs text-ink-3">{s.reportingWindow.explanation}</p>
        <div className="mt-4">
          <GoogleAdsControls periodDays={period.days} agentEnabled={agentEnabled} />
        </div>
      </div>

      {/* ---------------- Google-native overview ---------------- */}
      <SectionTitle>What Google Ads reports</SectionTitle>
      <p className="mb-3 max-w-3xl text-sm text-ink-2">
        Google&rsquo;s own numbers, using Google&rsquo;s attribution. A &ldquo;conversion&rdquo; here is whatever your
        Google Ads conversion actions count — it is <strong>not</strong> a BagDirect order, and its value is{" "}
        <strong>not</strong> BagDirect revenue.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          label="Ad spend"
          value={hasData ? money(s.google.costCents) : "Unavailable"}
          hint={hasData ? `${s.google.daysWithData} day(s) of data` : "No synced data for this window — this is not zero spend."}
        />
        <Card label="Impressions" value={hasData ? formatQty(s.google.impressions) : "—"} />
        <Card
          label="Clicks"
          value={hasData ? formatQty(s.google.clicks) : "—"}
          hint={s.google.ctrPct === null ? "CTR unavailable (too few impressions)" : `CTR ${s.google.ctrPct}%`}
        />
        <Card
          label="Cost per click"
          value={s.google.cpcCents === null ? "Unavailable" : money(s.google.cpcCents)}
          hint={s.google.cpcCents === null ? "No clicks in this window" : undefined}
        />
        <Card label="Google-reported conversions" value={hasData ? String(s.google.googleConversions) : "—"} />
        <Card
          label="Google-reported conversion value"
          value={hasData ? money(s.google.googleConversionValueCents) : "—"}
        />
        <Card label="Google-reported cost / conversion" value={googleCpa.value} hint={googleCpa.hint} />
        <Card label="Google-reported ROAS" value={googleRoas.value} hint={googleRoas.hint} />
      </div>

      {/* ---------------- First-party overview ---------------- */}
      <SectionTitle>What BagDirect measured</SectionTitle>
      <p className="mb-3 max-w-3xl text-sm text-ink-2">
        Our own data about visitors who arrived from a Google Ads click. These are real BagDirect orders and real
        BagDirect revenue — a different measurement from the section above, not a correction of it.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Sessions from Google Ads" value={formatQty(s.firstParty.sessions)} hint={`${s.firstParty.sessionsWithClickId} carried a Google click id`} />
        <Card label="Qualified conversations" value={formatQty(s.firstParty.qualifiedConversations)} hint={`of ${s.firstParty.conversations} conversations`} />
        <Card label="Orders attributed to Google Ads" value={formatQty(s.firstParty.orders)} hint={`${s.firstParty.aiAssistedOrders} AI-assisted`} />
        <Card label="Revenue from those orders" value={money(s.firstParty.revenueCents)} />
        <Card label="First-party cost per attributed order" value={costPerOrder.value} hint={costPerOrder.hint ?? s.efficiency.firstPartyCacDenominator} />
        <Card label="First-party ROAS (revenue ÷ spend)" value={firstPartyRoas.value} hint={firstPartyRoas.hint ?? "Revenue, not profit."} />
        <Card label="Session → order" value={ratioText(s.firstParty.sessionToOrder)} />
      </div>

      {/* ---------------- Profit on ad spend ---------------- */}
      <SectionTitle>Did the advertising make money?</SectionTitle>
      <p className="mb-3 max-w-3xl text-sm text-ink-2">
        ROAS above divides <strong>revenue</strong> by spend. POAS divides{" "}
        <strong>contribution profit before paid media</strong> by spend — what each advertising dollar produced after
        the bags were made, packed, shipped and paid for. A campaign can show a strong ROAS and a POAS below 1×.
        Neither number is ever substituted for the other.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          label="Contribution profit before paid media"
          value={contributionBefore.value}
          hint={contributionBefore.hint ?? "On the orders attributed to Google Ads."}
        />
        <Card
          label="POAS (contribution profit ÷ spend)"
          value={poas.value}
          hint={poas.hint ?? "Above 1× means advertising produced more contribution profit than it cost."}
        />
        <Card
          label="Contribution profit after paid media"
          value={postAdContribution.value}
          hint={postAdContribution.hint ?? "Contribution profit before paid media, minus ad spend."}
        />
      </div>
      {s.efficiency.profitBlockers.length > 0 ? (
        <details className="surface mt-3 p-4 text-sm text-ink-2">
          <summary className="cursor-pointer">
            Why profit is unavailable ({s.efficiency.profitBlockers.length} unfilled cost inputs)
          </summary>
          <ul className="mt-2 space-y-1 font-mono text-xs text-ink-3">
            {s.efficiency.profitBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">
            Until these exist, revenue ROAS is the only efficiency figure available and it is NOT profitability.
          </p>
        </details>
      ) : null}

      {/* ---------------- Funnel ---------------- */}
      <SectionTitle>Google Ads funnel</SectionTitle>
      <div className="surface overflow-x-auto p-4">
        <table className="w-full min-w-[520px] text-sm">
          <tbody>
            {[
              ["Sessions from a Google Ads click", formatQty(s.firstParty.sessions)],
              ["Viewed a product", formatQty(s.firstParty.productViewSessions)],
              ["Saw a price", formatQty(s.firstParty.priceViewSessions)],
              ["Started a conversation", formatQty(s.firstParty.conversations)],
              ["Qualified conversation", formatQty(s.firstParty.qualifiedConversations)],
              ["Added to cart", formatQty(s.firstParty.cartSessions)],
              ["Started checkout", formatQty(s.firstParty.checkoutSessions)],
              ["Ordered", formatQty(s.firstParty.orders)],
            ].map(([label, value]) => (
              <tr key={label} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-normal text-ink-2">
                  {label}
                </th>
                <td className="py-2 text-right font-mono text-ink">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-ink-3">
          Every stage counts DISTINCT sessions, with sessions from a Google Ads click as the denominator throughout.
        </p>
      </div>

      {/* ---------------- Campaigns ---------------- */}
      <SectionTitle>Campaigns</SectionTitle>
      {s.campaigns.length === 0 ? (
        <p className="surface p-4 text-sm text-ink-2">
          No campaign data for this window.{" "}
          {connected
            ? "That may mean no campaigns ran, or simply that this window has never been synced — press “Sync Google Ads”."
            : "Google Ads is not connected, so no campaign has been read at all."}
        </p>
      ) : (
        <div className="surface overflow-x-auto p-4">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="py-2 pr-3">Campaign</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3 text-right">Spend</th>
                <th className="py-2 pr-3 text-right">Clicks</th>
                <th className="py-2 pr-3 text-right">CTR</th>
                <th className="py-2 pr-3 text-right">CPC</th>
                <th className="py-2 pr-3 text-right">Google conv.</th>
                <th className="py-2 pr-3 text-right">Google ROAS</th>
                <th className="py-2 pr-3 text-right">Our sessions</th>
                <th className="py-2 pr-3 text-right">Our orders</th>
                <th className="py-2 pr-3 text-right">Our revenue</th>
                <th className="py-2 pr-3 text-right">Our ROAS</th>
                <th className="py-2 pr-3">Match</th>
              </tr>
            </thead>
            <tbody>
              {s.campaigns.map((c) => {
                const ourRoas = metricText(c.firstPartyRoas, (v) => `${v}×`);
                return (
                  <tr key={c.campaignId} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3 text-ink">{c.campaignName}</td>
                    <td className="py-2 pr-3 text-ink-3">{c.campaignStatus}</td>
                    <td className="py-2 pr-3 text-right font-mono">{money(c.costCents)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{formatQty(c.clicks)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{c.ctrPct === null ? "—" : `${c.ctrPct}%`}</td>
                    <td className="py-2 pr-3 text-right font-mono">{c.cpcCents === null ? "—" : money(c.cpcCents)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{c.googleConversions}</td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {c.googleReportedRoas === null ? "—" : `${c.googleReportedRoas}×`}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{formatQty(c.firstPartySessions)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{formatQty(c.firstPartyOrders)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{money(c.firstPartyRevenueCents)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{ourRoas.value}</td>
                    <td className="py-2 pr-3 text-xs text-ink-3">{c.matchQuality ?? "no sessions"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-ink-3">
            The left half is Google&rsquo;s reporting; the right half is ours. &ldquo;Match&rdquo; says how a
            campaign&rsquo;s visits were identified: EXACT (the campaign id appeared in the landing URL), MAPPED (the
            campaign name matched), or no sessions at all.
          </p>
        </div>
      )}

      {/* ---------------- Attribution coverage ---------------- */}
      <SectionTitle>How well we can tie visits to campaigns</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Google Ads sessions" value={formatQty(s.coverage.googleAdsSessions)} />
        <Card label="Matched by campaign id" value={formatQty(s.coverage.exactSessions)} hint="EXACT" />
        <Card label="Matched by campaign name" value={formatQty(s.coverage.mappedSessions)} hint="MAPPED" />
        <Card label="Not tied to any campaign" value={formatQty(s.coverage.unmatchedSessions)} hint="UNMATCHED — their revenue still counts in the totals above" />
      </div>
      <p className="mt-3 max-w-3xl text-sm text-ink-2">{s.coverage.interpretation}</p>
      {s.coverage.googleClicks > 0 ? (
        <p className="mt-2 max-w-3xl text-xs text-ink-3">
          Google recorded {formatQty(s.coverage.googleClicks)} clicks and we saw{" "}
          {formatQty(s.coverage.googleAdsSessions)} sessions
          {s.coverage.clickToSessionPct === null ? "" : ` (${s.coverage.clickToSessionPct}%)`}. These are not expected to
          match: a visitor who leaves before our tracking runs is a click with no session. The gap is not lost revenue.
        </p>
      ) : null}

      {/* ---------------- Discrepancy ---------------- */}
      <SectionTitle>Where Google and we disagree</SectionTitle>
      <div className="surface p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="label-mono text-ink-3">Google Ads reports</p>
            <p className="mt-1 font-mono text-lg text-ink">
              {s.discrepancy.googleConversions} conversions · {money(s.discrepancy.googleConversionValueCents)}
            </p>
          </div>
          <div>
            <p className="label-mono text-ink-3">BagDirect measured</p>
            <p className="mt-1 font-mono text-lg text-ink">
              {s.discrepancy.firstPartyOrders} orders · {money(s.discrepancy.firstPartyRevenueCents)}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-2">{s.discrepancy.interpretation}</p>
        <ul className="mt-2 list-disc pl-5 text-xs text-ink-3">
          {s.discrepancy.knownCauses.map((cause) => (
            <li key={cause}>{cause}</li>
          ))}
        </ul>
      </div>

      {/* ---------------- Customer signals ---------------- */}
      <SectionTitle>What paid-search visitors asked</SectionTitle>
      {s.customerSignals.qualifiedConversations === 0 ? (
        <p className="surface p-4 text-sm text-ink-2">
          No qualified conversations from Google Ads traffic in this period, so there is nothing to report about what
          these visitors asked.
        </p>
      ) : (
        <div className="surface p-4">
          <p className="text-sm text-ink-2">
            {formatQty(s.customerSignals.qualifiedConversations)} qualified conversations came from Google Ads traffic.{" "}
            {s.customerSignals.moqQuestionConversations} asked about the minimum order and{" "}
            {s.customerSignals.moqObjectionConversations} said the minimum was too high.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="label-mono text-ink-3">Questions</p>
              <ul className="mt-1 text-sm text-ink-2">
                {s.customerSignals.topQuestions.map((q) => (
                  <li key={q.theme}>
                    {q.theme.replace(/_/g, " ").toLowerCase()} — {q.conversations}
                  </li>
                ))}
                {s.customerSignals.topQuestions.length === 0 ? <li>(none classified)</li> : null}
              </ul>
            </div>
            <div>
              <p className="label-mono text-ink-3">Objections</p>
              <ul className="mt-1 text-sm text-ink-2">
                {s.customerSignals.topObjections.map((o) => (
                  <li key={o.type}>
                    {o.type.replace(/_/g, " ").toLowerCase()} — {o.conversations}
                  </li>
                ))}
                {s.customerSignals.topObjections.length === 0 ? <li>(none classified)</li> : null}
              </ul>
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-3">
            Only visitors who used the AI expert appear here — customers who never opened the chat are invisible to
            these counts.
          </p>
        </div>
      )}

      {/* ---------------- Trends ---------------- */}
      <SectionTitle>Trends vs the previous period</SectionTitle>
      <div className="surface overflow-x-auto p-4">
        <table className="w-full min-w-[420px] text-sm">
          <tbody>
            {s.trends.map((t) => (
              <tr key={t.name} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-normal text-ink-2">
                  {t.label}
                </th>
                <td className="py-2 text-right font-mono text-ink">{trendText(t.trend)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------------- Agent review ---------------- */}
      <SectionTitle>Google Ads review (AI)</SectionTitle>
      {review ? (
        <div className="surface p-4">
          <p className="text-xs text-ink-3">
            Generated {report.adsReport?.generatedAt.toISOString()} · {report.adsReport?.model ?? "model unknown"}
            {report.adsReportStale ? " · covers an older window than the figures above" : ""}
          </p>
          <p className="mt-2 text-sm text-ink-2">{review.executiveSummary}</p>
          {review.recommendations.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-3">
              {review.recommendations.map((rec) => (
                <li key={rec.title} className="border-l-2 border-line pl-3">
                  <p className="text-sm text-ink" style={{ fontWeight: 600 }}>
                    {rec.title}
                  </p>
                  <p className="mt-1 text-sm text-ink-2">{rec.observation}</p>
                  <p className="mt-1 text-sm text-ink-2">{rec.recommendation}</p>
                  <p className="mt-1 text-xs text-ink-3">
                    {rec.recommendationType.replace(/_/g, " ").toLowerCase()} · confidence {rec.confidence} ·
                    limitations: {rec.limitations.join(" ")}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-2">The review raised no recommendations.</p>
          )}
          <p className="mt-4 text-xs text-ink-3">
            These are REVIEWS. Approving one in the{" "}
            {isFlagEnabled("AI_ACTION_CENTER") ? <Link href="/admin/ai-actions">AI Action Center</Link> : "AI Action Center"}{" "}
            records your decision to investigate — it changes nothing in Google Ads. No part of this platform can.
          </p>
        </div>
      ) : (
        <p className="surface p-4 text-sm text-ink-2">
          {agentEnabled
            ? "No Google Ads review has been generated yet. Every figure above is computed without AI — a review only adds interpretation."
            : "The Google Ads agent is disabled (AI_GOOGLE_ADS_AGENT_ENABLED). Every figure above is computed without AI and is unaffected."}
        </p>
      )}

      {/* ---------------- Data quality ---------------- */}
      <SectionTitle>What to keep in mind about this data</SectionTitle>
      <ul className="flex flex-col gap-2">
        {s.dataQuality.map((w) => (
          <li key={w.code} className="surface p-3 text-sm text-ink-2">
            <span className="label-mono text-ink-3">{w.code}</span>
            <br />
            {w.message}
          </li>
        ))}
      </ul>

      {/* ---------------- Sync history ---------------- */}
      <SectionTitle>Sync history</SectionTitle>
      {s.recentSyncRuns.length === 0 ? (
        <p className="surface p-4 text-sm text-ink-2">No sync has been attempted yet.</p>
      ) : (
        <div className="surface overflow-x-auto p-4">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="py-2 pr-3">Started</th>
                <th className="py-2 pr-3">Range</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3 text-right">Fetched</th>
                <th className="py-2 pr-3 text-right">New</th>
                <th className="py-2 pr-3 text-right">Restated</th>
                <th className="py-2 pr-3">Problem</th>
              </tr>
            </thead>
            <tbody>
              {s.recentSyncRuns.map((run) => (
                <tr key={run.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs">{run.startedAt.toISOString().slice(0, 16)}</td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {run.requestedStartDate} → {run.requestedEndDate}
                  </td>
                  <td className="py-2 pr-3">{run.status}</td>
                  <td className="py-2 pr-3 text-right font-mono">{run.rowsFetched}</td>
                  <td className="py-2 pr-3 text-right font-mono">{run.rowsInserted}</td>
                  <td className="py-2 pr-3 text-right font-mono">{run.rowsUpdated}</td>
                  <td className="py-2 pr-3 text-xs text-ink-3">{run.errorCode ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-ink-3">
            &ldquo;Restated&rdquo; counts reporting days Google revised — a re-sync UPDATES those days in place and never
            adds a second copy of the spend.
          </p>
        </div>
      )}
    </main>
  );
}
