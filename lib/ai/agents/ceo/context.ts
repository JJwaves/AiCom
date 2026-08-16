import { BUSINESS_INTELLIGENCE } from "@/config/business-intelligence";
import type { Metric } from "@/modules/business-intelligence/availability";
import type { Trend } from "@/modules/business-intelligence/trend";
import type { BusinessHealthSnapshot } from "@/modules/business-intelligence/snapshot";

/**
 * CEO agent context (Session 09 spec §19, §44).
 *
 * The ONLY quantitative input the model sees: a bounded, PII-FREE text
 * rendering of the deterministic BusinessHealthSnapshot, plus the exact
 * whitelists used to validate the model's references afterwards:
 *  - validMetricRefs: every `metric-ref` key printed in the context;
 *  - validEvidenceRefs: every insight/opportunity id printed.
 *
 * Nothing else is available to cite, so fabricated references cannot
 * survive server validation. The snapshot contains only aggregates by
 * construction (no emails, names, phone numbers, addresses, artwork
 * names, or raw messages) — see tests/ceo-agent.test.ts.
 */

export type CeoContext = {
  text: string;
  validMetricRefs: Set<string>;
  validEvidenceRefs: Set<string>;
};

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const usdMicros = (micros: number): string => `$${(micros / 1_000_000).toFixed(4)}`;

function metricLine(m: Metric<number>, render: (v: number) => string): string {
  switch (m.status) {
    case "AVAILABLE":
      return `${render(m.value)} (AVAILABLE)`;
    case "PARTIAL":
      return `${render(m.value)} (PARTIAL — ${m.reason})`;
    case "UNAVAILABLE":
      return `UNAVAILABLE — ${m.reason}${m.missingInputs?.length ? ` Missing: ${m.missingInputs.slice(0, 5).join(", ")}` : ""}`;
  }
}

const trendLine = (t: Trend): string => {
  switch (t.state) {
    case "TREND":
      return `${t.changePct! >= 0 ? "+" : ""}${t.changePct}% (${t.current} vs ${t.previous} previous)`;
    case "NEW_ACTIVITY":
      return `NEW_ACTIVITY (${t.current} now, none in previous period)`;
    case "LOW_BASELINE":
      return `LOW_BASELINE (${t.current} vs ${t.previous} previous — base too small for a % trend)`;
    case "NO_ACTIVITY":
      return "NO_ACTIVITY (none in either period)";
  }
};

const ratioLine = (r: { numerator: number; denominator: number; percentage: number | null }): string =>
  r.percentage === null
    ? `${r.numerator} of ${r.denominator} (sample too small for %)`
    : `${r.numerator} of ${r.denominator} (${r.percentage}%)`;

export function buildCeoContext(snapshot: BusinessHealthSnapshot): CeoContext {
  const validMetricRefs = new Set<string>();
  const validEvidenceRefs = new Set<string>();
  const lines: string[] = [];

  /** Print one referenceable metric line and register its ref key. */
  const ref = (key: string, label: string, rendered: string) => {
    validMetricRefs.add(key);
    lines.push(`- [${key}] ${label}: ${rendered}`);
  };

  const s = snapshot;
  const cur = s.commerce.revenue.currency ? ` ${s.commerce.revenue.currency}` : "";

  lines.push(`PERIOD: ${s.period.label} (${iso(s.period.start)} → ${iso(s.period.end)}); previous = ${s.previous.label}.`);
  lines.push("");
  lines.push("== COMMERCE ==");
  ref("commerce.revenue", `Revenue${cur}`, metricLine(s.commerce.revenue.revenueCents, usd));
  ref("commerce.orders", "Orders", metricLine(s.commerce.revenue.orders, String));
  ref("commerce.aov", `Average order value${cur}`, metricLine(s.commerce.revenue.aovCents, usd));
  ref("commerce.units", "Units ordered", metricLine(s.commerce.revenue.units, String));
  for (const c of s.commerce.revenue.byCurrency.slice(1)) {
    // Additional currencies (headline metrics are single-currency only).
    ref(`commerce.byCurrency.${c.currency}`, `Revenue in ${c.currency}`, `${usd(c.revenueCents)} across ${c.orders} orders (AVAILABLE)`);
  }
  ref("commerce.sessions", "Sessions started", `${s.commerce.funnel.sessionsStarted} (AVAILABLE)`);
  for (const stage of s.commerce.funnel.stages) {
    ref(`funnel.${stage.name}.sessions`, `${stage.label} (distinct sessions)`, `${stage.sessions} (AVAILABLE)`);
  }
  for (const rate of s.commerce.funnel.rates) {
    ref(`funnel.rate.${rate.name}`, `${rate.label} (denominator: ${rate.denominatorDefinition})`, ratioLine(rate.ratio));
  }

  lines.push("");
  lines.push("== TRENDS (vs previous period) ==");
  for (const t of s.trends) {
    const rendered =
      t.name === "revenue" && t.trend.state === "TREND"
        ? `${t.trend.changePct! >= 0 ? "+" : ""}${t.trend.changePct}% (${usd(t.trend.current)} vs ${usd(t.trend.previous)} previous)`
        : trendLine(t.trend);
    ref(`trend.${t.name}`, t.label, rendered);
  }

  lines.push("");
  lines.push("== AI SALES ==");
  ref("aiSales.conversations", "AI conversations", `${s.aiSales.conversations} (AVAILABLE)`);
  ref("aiSales.qualifiedConversations", "Qualified AI conversations", `${s.aiSales.qualifiedConversations} (AVAILABLE)`);
  ref("aiSales.assistedCartAddSessions", "AI-assisted cart-add sessions", `${s.aiSales.assistedCartAddSessions} (AVAILABLE)`);
  ref("aiSales.assistedCheckoutSessions", "AI-assisted checkout-start sessions", `${s.aiSales.assistedCheckoutStartSessions} (AVAILABLE)`);
  ref("aiSales.assistedOrders", "AI-assisted orders (conservative order flag)", `${s.aiSales.assistedOrders} (AVAILABLE)`);
  ref("aiSales.assistedRevenue", `AI-assisted revenue${cur}`, metricLine(s.commerce.revenue.aiAssistedRevenueCents, usd));
  ref("aiSales.conversationPurchaseRate", "Qualified conversation → purchase", ratioLine(s.aiSales.conversationPurchaseRate));
  ref("aiSales.costPerConversation", "AI cost per conversation", metricLine(s.aiSales.costPerConversationMicros, usdMicros));
  ref("aiSales.costPerAssistedOrder", "AI cost per AI-assisted order", metricLine(s.aiSales.costPerAssistedOrderMicros, usdMicros));

  lines.push("");
  lines.push("== AI COST ==");
  ref("aiCost.spend", "AI spend in period", metricLine(s.aiCost.spendMicros, usdMicros));
  ref("aiCost.calls", "AI calls", `${s.aiCost.totalCalls} (${s.aiCost.failedCalls} failed) (AVAILABLE)`);
  for (const b of s.aiCost.byAgent.slice(0, 6)) {
    ref(`aiCost.byAgent.${b.key}`, `AI spend — agent "${b.key}" (${b.calls} calls)`, metricLine(b.spendMicros, usdMicros));
  }

  lines.push("");
  lines.push("== PROFITABILITY ==");
  ref("profitability.grossProfit", "Gross profit (revenue − product COGS)", metricLine(s.profitability.grossProfitCents, usd));
  ref(
    "profitability.contributionProfitBeforePaidMedia",
    "Contribution profit BEFORE paid media",
    metricLine(s.profitability.contributionProfitBeforePaidMediaCents, usd),
  );
  ref("profitability.grossMargin", "Gross margin", metricLine(s.profitability.grossMarginPct, pct));
  ref(
    "profitability.contributionMarginBeforePaidMedia",
    "Contribution margin BEFORE paid media",
    metricLine(s.profitability.contributionMarginBeforePaidMediaPct, pct),
  );
  for (const note of s.profitability.notes) lines.push(`  note: ${note}`);

  lines.push("");
  lines.push("== PRODUCTS (top by revenue) ==");
  for (const p of s.products) {
    ref(
      `product.${p.productId}.revenue`,
      `"${p.title}" revenue/orders/units`,
      `${usd(p.revenueCents)} / ${p.orders} orders / ${p.units} units (AVAILABLE)`,
    );
    ref(`product.${p.productId}.grossProfit`, `"${p.title}" gross profit`, metricLine(p.grossProfitCents, usd));
  }

  lines.push("");
  lines.push("== SEGMENTS (business type) ==");
  for (const seg of s.segments) {
    ref(
      `segment.${seg.key}`,
      `Segment "${seg.key}"`,
      `${seg.orders} orders, ${usd(seg.revenueCents)} revenue, ${seg.qualifiedConversations} qualified conversations, purchase rate ${ratioLine(seg.conversationPurchaseRate)} (AVAILABLE)`,
    );
  }

  lines.push("");
  lines.push("== ATTRIBUTION (first-party session/order breakdown; this section carries NO ad spend) ==");
  for (const row of s.attribution.firstTouchSourceMedium) {
    ref(
      `attribution.firstTouch.${row.key}`,
      `First touch "${row.key}"`,
      `${row.sessions} sessions, ${row.orders} orders, ${usd(row.revenueCents)} revenue (AVAILABLE)`,
    );
  }

  /* Session 13: ad spend arrives as its own section with its own
   * availability state. UNAVAILABLE means we cannot see advertising — it
   * NEVER means advertising is free, and the CEO agent is told so in the
   * line it can cite. */
  lines.push("");
  lines.push("== ADVERTISING SPEND (Google Ads, Session 13) ==");
  ref(
    "adSpend.googleAds",
    "Google Ads spend",
    s.adSpend.spendCents.status === "UNAVAILABLE"
      ? `UNAVAILABLE — ${s.adSpend.spendCents.reason}`
      : `${(s.adSpend.spendCents.value / 100).toFixed(2)} ${s.adSpend.currencyCode ?? ""} (AVAILABLE)`,
  );
  ref(
    "adSpend.googleConversions",
    "Google-REPORTED conversions (NOT BagDirect orders)",
    s.adSpend.googleConversions.status === "UNAVAILABLE"
      ? "UNAVAILABLE"
      : `${s.adSpend.googleConversions.value} (AVAILABLE)`,
  );
  lines.push(`  ${s.adSpend.statement}`);
  lines.push(
    "  You may recommend REVIEWING advertising (MARKETING_REVIEW). You cannot change a budget, pause a campaign, or " +
      "instruct anyone to; and profit on ad spend does not exist while manufacturing costs are unconfigured, so never " +
      "call advertising profitable.",
  );

  lines.push("");
  lines.push("== CUSTOMER SIGNALS (Session 08 customer intelligence) ==");
  for (const q of s.customerSignals.topQuestions) {
    ref(`signal.question.${q.theme}`, `Question theme ${q.theme}`, `${q.conversations} conversations (${q.qualifiedConversations} qualified) (AVAILABLE)`);
  }
  for (const o of s.customerSignals.topObjections) {
    ref(
      `signal.objection.${o.type}`,
      `Objection ${o.type}`,
      `${o.conversations} conversations (${o.qualifiedConversations} qualified; ${o.purchased} purchased anyway) (AVAILABLE)`,
    );
  }
  for (const g of s.customerSignals.productGaps) {
    ref(`signal.gap.${g.kind}:${g.normalized}`, `Unsupported request "${g.normalized}"`, `${g.conversations} conversations (${g.qualifiedConversations} qualified) (AVAILABLE)`);
  }

  lines.push("");
  lines.push("== EVIDENCE: INSIGHTS (cite by id in evidenceRefs) ==");
  if (s.customerSignals.insights.length === 0) lines.push("  (none)");
  for (const i of s.customerSignals.insights) {
    validEvidenceRefs.add(i.id);
    lines.push(`- id=${i.id} [${i.insightType}, status=${i.status}, evidence=${i.evidenceCount}] ${i.title}`);
  }
  lines.push("");
  lines.push("== EVIDENCE: PRODUCT OPPORTUNITIES (cite by id; ALL require human validation) ==");
  if (s.customerSignals.opportunities.length === 0) lines.push("  (none)");
  for (const o of s.customerSignals.opportunities) {
    validEvidenceRefs.add(o.id);
    lines.push(`- id=${o.id} [${o.opportunityType ?? "other"}, status=${o.status}, evidence=${o.evidenceCount}] ${o.title}`);
  }

  lines.push("");
  lines.push("== DATA QUALITY WARNINGS ==");
  for (const w of s.dataQuality) lines.push(`- ${w.code}: ${w.message}`);

  lines.push("");
  lines.push(
    "Metric references: every [key] above is a valid supportingMetricRef. Copy keys exactly; references outside this list are discarded.",
  );

  let text = lines.join("\n");
  if (text.length > BUSINESS_INTELLIGENCE.CEO_CONTEXT_MAX_CHARS) {
    text = `${text.slice(0, BUSINESS_INTELLIGENCE.CEO_CONTEXT_MAX_CHARS)}\n[context truncated at ${BUSINESS_INTELLIGENCE.CEO_CONTEXT_MAX_CHARS} chars]`;
  }
  return { text, validMetricRefs, validEvidenceRefs };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const pct = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
