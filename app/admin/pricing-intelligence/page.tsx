import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isFlagEnabled } from "@/config/flags";
import { PRICING_PERIOD_DAYS } from "@/config/pricing-intelligence";
import { checkAdminAuth } from "@/lib/admin/auth";
import { pricingReviewSchema, type PricingReview } from "@/lib/ai/agents/pricing/schema";
import { formatMoney, formatQty } from "@/lib/format";
import {
  buildPricingIntelligenceReport,
  customPeriod,
  periodFromDays,
  type PricingIntelligenceReport,
  type PricingRatio,
  type PricingSignal,
} from "@/modules/pricing-intelligence";
import type { Trend } from "@/modules/business-intelligence/trend";
import { GeneratePricingReviewButton } from "./pricing-controls";

/**
 * /admin/pricing-intelligence (Session 12 spec §36) — the owner's pricing
 * surface.
 *
 * Every number on this page is deterministic: real events, orders,
 * configurations, need profiles and classified conversations, over an
 * explicit period, with visible denominators. NO AI is called to render it.
 * The only AI on the page is the persisted pricing review, generated
 * exclusively by the explicit button.
 *
 * The page states what it does not know as loudly as what it does: costs,
 * margin, elasticity and repricing are all reported as unavailable with the
 * reason, never as zero.
 */

export const metadata: Metadata = { title: "Pricing Intelligence — Admin", robots: { index: false, follow: false } };

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

function parsePeriod(params: { period?: string; from?: string; to?: string }) {
  if (params.from && params.to) {
    const from = new Date(`${params.from}T00:00:00Z`);
    const to = new Date(`${params.to}T23:59:59Z`);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from < to) return customPeriod(from, to);
  }
  const days = Number.parseInt(params.period ?? "30", 10);
  return periodFromDays((PRICING_PERIOD_DAYS as readonly number[]).includes(days) ? days : 30);
}

const ratioText = (r: PricingRatio) =>
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

const unitPrice = (cents: number | null, currency: string) =>
  cents === null ? "—" : `${formatMoney(cents, currency as "USD" | "CAD")}/unit`;

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

function SignalCard({ signal }: { signal: PricingSignal }) {
  return (
    <li className="surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base text-ink" style={{ fontWeight: 600 }}>
          {signal.title}
        </h3>
        <p className="label-mono text-right text-xs text-ink-3">
          {signal.strength} confidence
          <br />
          {signal.isPriceFriction ? "price friction" : "not price friction"}
        </p>
      </div>
      <p className="mt-2 text-sm text-ink-2">{signal.description}</p>
      <p className="mt-2 text-xs text-ink-3">
        Evidence: {signal.evidence.map((e) => `${e.label} ${e.value}`).join(" · ")}
      </p>
      <p className="mt-1 text-xs text-ink-3">Worth remembering: {signal.limitations.join(" ")}</p>
      <p className="mt-1 text-xs text-ink-3">
        Where this belongs: {signal.route.replace(/_/g, " ").toLowerCase()}
        {signal.evidenceKind === "BEHAVIORAL" ? " · behavioural only — nobody in this group told us why" : ""}
      </p>
    </li>
  );
}

export default async function PricingIntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  if (!isFlagEnabled("PRICING_INTELLIGENCE")) notFound();
  const h = await headers();
  if (checkAdminAuth(h.get("authorization")) !== "authorized") notFound();

  const params = await searchParams;
  const period = parsePeriod(params);
  const report: PricingIntelligenceReport = await buildPricingIntelligenceReport(period);
  const s = report.snapshot;
  const c = s.funnel.conversations;
  const agentEnabled = isFlagEnabled("AI_PRICING_AGENT");

  const review: PricingReview | null = report.pricingReport
    ? (() => {
        const parsed = pricingReviewSchema.safeParse(report.pricingReport?.reviewJson);
        return parsed.success ? parsed.data : null;
      })()
    : null;

  const priceToCart = s.funnel.rates.find((r) => r.name === "price_view_to_cart");
  const priceToPurchase = s.funnel.rates.find((r) => r.name === "price_view_to_purchase");
  const frictionSignals = s.signals.filter((sig) => sig.isPriceFriction);
  const otherSignals = s.signals.filter((sig) => !sig.isPriceFriction);
  const tierRows = s.tiers.rows.filter(
    (r) =>
      r.quantitySelectedSessions > 0 ||
      r.configuredConfigurations > 0 ||
      r.cartSessions > 0 ||
      r.purchasedLines > 0 ||
      r.conversations > 0,
  );

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <p className="label-mono text-ink-3">Admin · pricing intelligence</p>
      <h1 className="mt-1 text-3xl" style={{ fontWeight: 600 }}>
        Pricing Intelligence
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-2">
        What our pricing is doing, from real first-party data. This page does not set prices and cannot change one —
        the pricing engine remains the only thing that decides what anything costs. Where we lack the information to
        answer a question, it says so instead of guessing.
      </p>

      <nav aria-label="Reporting period" className="mt-6 flex flex-wrap items-center gap-2">
        {PRICING_PERIOD_DAYS.map((d) => (
          <Link
            key={d}
            className="chip"
            data-selected={s.period.days === d && !params.from ? "true" : undefined}
            href={`/admin/pricing-intelligence?period=${d}`}
          >
            Last {d} days
          </Link>
        ))}
        <span className="text-xs text-ink-3">
          {dateOnly(s.period.start)} → {dateOnly(s.period.end)} · custom range via ?from=YYYY-MM-DD&amp;to=YYYY-MM-DD
        </span>
      </nav>

      {/* ---------------- Overview ---------------- */}
      <SectionTitle>Overview — {s.period.label}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Card
          label="Saw a price"
          value={formatQty(s.funnel.priceViewSessions)}
          hint={`${formatQty(s.funnel.productSessions)} sessions viewed a product page`}
        />
        <Card
          label="Price → cart"
          value={priceToCart?.ratio.percentage !== null && priceToCart ? `${priceToCart.ratio.percentage}%` : "—"}
          hint={priceToCart ? ratioText(priceToCart.ratio) : undefined}
        />
        <Card
          label="Price → purchase"
          value={
            priceToPurchase?.ratio.percentage !== null && priceToPurchase ? `${priceToPurchase.ratio.percentage}%` : "—"
          }
          hint={priceToPurchase ? ratioText(priceToPurchase.ratio) : undefined}
        />
        <Card
          label="Asked about price"
          value={formatQty(c.priceQuestion)}
          hint={`conversations · a question, not resistance · ${formatQty(c.repeatedPriceQuestion)} asked more than once`}
        />
        <Card
          label="Said price is too high"
          value={formatQty(c.priceObjection)}
          hint={`conversations · ${formatQty(c.priceObjectionPurchased)} of them bought anyway`}
        />
        <Card
          label="Said minimum is too high"
          value={formatQty(c.moqObjection)}
          hint={`conversations · ${formatQty(c.moqQuestion)} simply asked what the minimum is`}
        />
      </div>

      <SectionTitle>Pricing funnel</SectionTitle>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-3">
            <th className="py-1 font-normal">Step</th>
            <th className="py-1 font-normal">Result</th>
            <th className="py-1 font-normal">Counted over</th>
          </tr>
        </thead>
        <tbody>
          {s.funnel.rates.map((rate) => (
            <tr key={rate.name} className="border-t border-rule align-top">
              <td className="py-2">{rate.label}</td>
              <td className="py-2 font-mono text-xs">{ratioText(rate.ratio)}</td>
              <td className="py-2 text-xs text-ink-3">{rate.denominatorDefinition}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---------------- Quantity demand ---------------- */}
      <SectionTitle>Quantity demand — requested, configured, purchased</SectionTitle>
      <p className="mb-3 max-w-3xl text-sm text-ink-2">
        These are three different questions and are never combined. What prospects <em>say</em> they want, what they{" "}
        <em>build</em> in the configurator, and what they actually <em>buy</em> can differ — and the difference is
        itself the finding.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-3">
            <th className="py-1 font-normal">Quantity band</th>
            <th className="py-1 font-normal">Requested</th>
            <th className="py-1 font-normal">Configured</th>
            <th className="py-1 font-normal">Purchased</th>
          </tr>
        </thead>
        <tbody className="font-mono text-xs">
          {s.demand.buckets.map((bucket) => {
            const req = s.demand.requested.rows.find((r) => r.bucketKey === bucket.key);
            const cfg = s.demand.configured.rows.find((r) => r.bucketKey === bucket.key);
            const buy = s.demand.purchased.rows.find((r) => r.bucketKey === bucket.key);
            return (
              <tr key={bucket.key} className="border-t border-rule">
                <td className="py-2 font-sans">{bucket.label}</td>
                <td className="py-2">
                  {req?.count ?? 0}
                  <span className="text-ink-3"> ({req?.stated ?? 0} stated / {req?.inferred ?? 0} inferred)</span>
                </td>
                <td className="py-2">{cfg?.count ?? 0}</td>
                <td className="py-2">{buy?.count ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-3">
        Bands come from the real pricing tiers and the {formatQty(s.demand.moq)}-bag minimum. &ldquo;Stated&rdquo; means the
        customer said the number themselves; &ldquo;inferred&rdquo; means the AI guessed it, and the two are never added
        together.
      </p>

      {/* ---------------- Tier performance ---------------- */}
      <SectionTitle>Quantity-tier performance</SectionTitle>
      {tierRows.length === 0 ? (
        <p className="text-sm text-ink-3">No activity in any quantity tier during this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="text-left text-ink-3">
                <th className="py-1 font-normal">Product · band</th>
                <th className="py-1 font-normal">Unit price</th>
                <th className="py-1 font-normal">Selected</th>
                <th className="py-1 font-normal">Cart</th>
                <th className="py-1 font-normal">Checkout</th>
                <th className="py-1 font-normal">Purchased</th>
                <th className="py-1 font-normal">Price objections</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {tierRows.map((row) => (
                <tr key={row.bandKey} className="border-t border-rule">
                  <td className="py-2 font-sans">
                    {row.productTitle}
                    <span className="text-ink-3"> · {row.label}</span>
                  </td>
                  <td className="py-2">{unitPrice(row.unitPriceCents, row.currency)}</td>
                  <td className="py-2">{row.quantitySelectedSessions}</td>
                  <td className="py-2">{row.cartSessions}</td>
                  <td className="py-2 text-ink-3">unavailable</td>
                  <td className="py-2">
                    {row.purchasedLines} ({formatQty(row.unitsPurchased)} units)
                  </td>
                  <td className="py-2">{ratioText(row.priceObjectionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ul className="mt-2 space-y-1 text-xs text-ink-3">
        {s.tiers.notes.map((note) => (
          <li key={note}>· {note}</li>
        ))}
      </ul>

      {/* ---------------- Pricing friction ---------------- */}
      <SectionTitle>Pricing friction</SectionTitle>
      {frictionSignals.length === 0 ? (
        <p className="text-sm text-ink-3">
          No evidence-backed price friction in this period. Customers leaving without buying does not count on its own —
          somebody has to have actually said something about price.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {frictionSignals.map((signal) => (
            <SignalCard key={signal.id} signal={signal} />
          ))}
        </ul>
      )}

      {otherSignals.length > 0 ? (
        <>
          <SectionTitle>Other observations (not price problems)</SectionTitle>
          <ul className="flex flex-col gap-3">
            {otherSignals.map((signal) => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </ul>
        </>
      ) : null}

      {/* ---------------- MOQ ---------------- */}
      <SectionTitle>Minimum order quantity</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Our minimum" value={formatQty(s.moq.moq)} hint="bags, across the catalog" />
        <Card
          label="Wanted less"
          value={formatQty(s.moq.requestedBelowMoqStated)}
          hint={`prospects who stated a smaller quantity · ${formatQty(s.moq.requestedBelowMoqInferred)} more were AI-inferred`}
        />
        <Card
          label="Asked what it is"
          value={formatQty(s.moq.moqQuestionConversations)}
          hint="conversations · a question, not an objection"
        />
        <Card
          label="Said it is too high"
          value={formatQty(s.moq.moqObjectionConversations)}
          hint={`conversations · ${formatQty(s.moq.belowMoqHandoffs)} ended with a request for a human`}
        />
      </div>
      {s.moq.opportunityRefs.length > 0 ? (
        <p className="mt-3 text-sm text-ink-2">
          Related opportunities awaiting your validation:{" "}
          {s.moq.opportunityRefs.map((o) => o.title).join("; ")} —{" "}
          <Link className="underline" href="/admin/customer-intelligence">
            Customer Intelligence
          </Link>
        </p>
      ) : null}
      <ul className="mt-2 space-y-1 text-xs text-ink-3">
        {s.moq.notes.map((note) => (
          <li key={note}>· {note}</li>
        ))}
      </ul>

      {/* ---------------- Cost / margin readiness ---------------- */}
      <SectionTitle>Cost and margin readiness</SectionTitle>
      <p className="max-w-3xl text-sm text-ink-2">{s.costs.summary}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="Manufacturing costs"
          value={s.costs.costModelConfigured ? "Configured" : "Not provided"}
          hint={s.costs.costModelConfigured ? undefined : `${s.costs.missingConfiguration.length} inputs unfilled`}
        />
        <Card label="Gross margin" value={s.costs.grossMarginAvailable ? "Available" : "Unavailable"} hint="never shown as 0%" />
        <Card
          label="Contribution margin"
          value={s.costs.contributionMarginAvailable ? "Available" : "Unavailable"}
          hint="needs freight + payment fees too"
        />
        <Card
          label="Margin policy"
          value={s.costs.marginPolicyConfigured ? "Configured" : "Not provided"}
          hint="the price floor fails closed without it"
        />
      </div>
      <details className="surface mt-3 p-4 text-sm">
        <summary className="cursor-pointer">What exactly is missing ({s.costs.missingConfiguration.length})</summary>
        <ul className="mt-2 space-y-1 font-mono text-xs text-ink-3">
          {s.costs.missingConfiguration.map((path) => (
            <li key={path}>{path}</li>
          ))}
          {s.priceLimits
            .filter((l) => !l.configured)
            .map((l) => (
              <li key={l.configPath}>{l.configPath}</li>
            ))}
        </ul>
      </details>

      <SectionTitle>What we can and cannot decide right now</SectionTitle>
      <ul className="space-y-2 text-sm">
        {Object.entries(s.readiness).map(([key, entry]) => (
          <li key={key} className="surface p-3">
            <p>
              <span className="label-mono mr-2 text-ink-3">{key.replace(/_/g, " ")}</span>
              <span className="font-mono text-xs">{entry.state}</span>
            </p>
            <p className="mt-1 text-ink-2">{entry.reason}</p>
            {entry.blockers.length > 0 ? (
              <p className="mt-1 font-mono text-xs text-ink-3">Blocked by: {entry.blockers.slice(0, 4).join(" · ")}</p>
            ) : null}
          </li>
        ))}
      </ul>

      <SectionTitle>Price sensitivity</SectionTitle>
      <div className="surface p-4 text-sm">
        <p className="text-ink-2">{s.elasticity.reason}</p>
        <p className="mt-2 text-xs text-ink-3">
          Before this question could be answered: {s.elasticity.requirements.join(" · ")}
        </p>
      </div>

      {/* ---------------- Trends ---------------- */}
      <SectionTitle>Compared with the previous {s.previous.days} days</SectionTitle>
      <table className="w-full text-sm">
        <tbody>
          {s.trends.map((t) => (
            <tr key={t.name} className="border-t border-rule">
              <td className="py-2">{t.label}</td>
              <td className="py-2 font-mono text-xs">
                {t.trend.previous} → {t.trend.current}
              </td>
              <td className="py-2 font-mono text-xs text-ink-3">{trendText(t.trend)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---------------- Pricing agent review ---------------- */}
      <SectionTitle>Pricing review</SectionTitle>
      <p className="mb-3 max-w-3xl text-sm text-ink-2">
        The pricing agent reads the numbers above and raises things worth looking at. It cannot propose a price — there
        is no field for one — and approving anything it raises changes nothing by itself.
      </p>
      <div className="flex flex-wrap items-start gap-4">
        {agentEnabled ? (
          <GeneratePricingReviewButton periodDays={s.period.days} />
        ) : (
          <p className="text-sm text-ink-3">
            The pricing agent is switched off (AI_PRICING_AGENT). Every number on this page is unaffected.
          </p>
        )}
        <p className="text-sm text-ink-3">
          Review items appear in the{" "}
          <Link className="underline" href="/admin/ai-actions">
            AI Action Center
          </Link>
          .
        </p>
      </div>

      {review === null ? (
        <p className="mt-4 text-sm text-ink-3">
          No pricing review has been generated yet. The numbers above do not depend on it.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {report.pricingReportStale ? (
            <p className="text-xs text-ink-3">
              This review covers an earlier window than the period selected above — regenerate it to match.
            </p>
          ) : null}
          <div className="surface p-4">
            <p className="label-mono text-ink-3">Summary</p>
            <p className="mt-1 text-sm text-ink-2">{review.executiveSummary}</p>
            {review.signals.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm text-ink-2">
                {review.signals.map((note) => (
                  <li key={note.signalId}>
                    <span className="label-mono mr-2 text-ink-3">{note.signalId}</span>
                    {note.note}
                  </li>
                ))}
              </ul>
            ) : null}
            {review.openQuestions.length > 0 ? (
              <p className="mt-3 text-xs text-ink-3">Open questions: {review.openQuestions.join(" · ")}</p>
            ) : null}
          </div>
          {review.recommendations.length === 0 ? (
            <p className="text-sm text-ink-3">The agent raised nothing this run.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {review.recommendations.map((rec) => (
                <li key={rec.title} className="surface p-4">
                  <p className="label-mono text-ink-3">
                    {rec.recommendationType.replace(/_/g, " ").toLowerCase()}
                    {rec.productId ? ` · ${rec.productId}` : ""}
                    {rec.quantityTier ? ` · ${formatQty(rec.quantityTier)}+ band` : ""}
                  </p>
                  <h3 className="mt-1 text-base text-ink" style={{ fontWeight: 600 }}>
                    {rec.title}
                  </h3>
                  <p className="mt-1 text-sm text-ink-2">{rec.observation}</p>
                  <p className="mt-1 text-sm text-ink-2">
                    <span className="text-ink-3">Worth reviewing: </span>
                    {rec.recommendation}
                  </p>
                  <p className="mt-2 text-xs text-ink-3">
                    Evidence: {rec.metricRefs.join(", ")}
                    {rec.evidenceRefs.length > 0 ? ` · records: ${rec.evidenceRefs.join(", ")}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-ink-3">Limitations: {rec.limitations.join(" · ")}</p>
                  <p className="mt-1 text-xs text-ink-3">
                    {rec.requiresCostConfiguration ? "Needs manufacturing costs before any number can follow. " : ""}
                    {rec.requiresExperiment ? "Would need a controlled price test, which the platform cannot run today." : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ---------------- Data quality ---------------- */}
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
        Snapshot generated {s.generatedAt.toISOString()} · thresholds: % needs ≥
        {report.thresholds.MIN_DENOMINATOR_FOR_PERCENTAGE} denominator, a signal needs ≥
        {report.thresholds.MIN_EVIDENCE_FOR_SIGNAL} conversations of explicit evidence, segments need ≥
        {report.thresholds.MIN_SEGMENT_SAMPLE} per cell · prices come from the deterministic pricing engine, which this
        page never changes.
      </p>
    </section>
  );
}
