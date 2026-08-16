import { GOOGLE_ADS } from "@/config/google-ads";
import { formatMoneyish } from "@/modules/google-ads-intelligence/format";
import type { GoogleAdsIntelligenceSnapshot } from "@/modules/google-ads-intelligence";
import type { Metric } from "@/modules/business-intelligence/availability";

/**
 * Google Ads agent context (Session 13 spec §36, §59).
 *
 * The ONLY quantitative input the model sees: a bounded, PII-FREE text
 * rendering of the deterministic GoogleAdsIntelligenceSnapshot. The agent
 * never queries Google Ads (spec §36), never sees a session, never sees an
 * order, and never sees a credential.
 *
 * WHAT IS DELIBERATELY ABSENT (spec §59):
 *   no gclid / gbraid / wbraid value, no OAuth token, no developer token,
 *   no customer email or phone, no customer name, no order id, no session
 *   id, no message text. Click ids are used inside the deterministic module
 *   ONLY as a boolean "this was a paid click" and their values never reach
 *   this file.
 *
 * Three whitelists are built WHILE printing, and the model's output is
 * filtered against exactly them afterwards:
 *   validMetricRefs   — every [key] printed here
 *   validEvidenceRefs — every signal id printed here
 *   validSignalIds    — the deterministic signal ids it may annotate
 * plus `validCampaignIds` for scope validation.
 *
 * Nothing else exists to cite, so "campaign X wasted $4,000" can only
 * survive if this context actually said so.
 */

export type GoogleAdsContext = {
  text: string;
  validMetricRefs: Set<string>;
  validEvidenceRefs: Set<string>;
  validSignalIds: Set<string>;
  validCampaignIds: Set<string>;
};

const metricText = (m: Metric<number>, render: (v: number) => string): string =>
  m.status === "UNAVAILABLE" ? `UNAVAILABLE — ${m.reason}` : `${render(m.value)}${m.status === "PARTIAL" ? ` (PARTIAL — ${m.reason})` : ""}`;

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function buildGoogleAdsContext(snapshot: GoogleAdsIntelligenceSnapshot): GoogleAdsContext {
  const validMetricRefs = new Set<string>();
  const validEvidenceRefs = new Set<string>();
  const validSignalIds = new Set<string>();
  const validCampaignIds = new Set<string>();
  const lines: string[] = [];

  const ref = (key: string, label: string, rendered: string) => {
    validMetricRefs.add(key);
    lines.push(`- [${key}] ${label}: ${rendered}`);
  };

  const s = snapshot;
  const currency = s.google.currencyCode;
  const money = (cents: number) => formatMoneyish(cents, currency);

  lines.push(`PERIOD: ${s.period.label} (${iso(s.period.start)} → ${iso(s.period.end)}).`);
  lines.push(`PREVIOUS PERIOD: ${s.previous.label} (${iso(s.previous.start)} → ${iso(s.previous.end)}).`);

  /* Rules FIRST, deliberately: the context is truncated at a character
   * budget, and the boundaries must survive truncation even when a busy
   * account fills the campaign table. */
  lines.push("");
  lines.push("== RULES THE SERVER ENFORCES (stating them saves you a dropped recommendation) ==");
  lines.push(
    "- You cannot change anything in Google Ads. There is no field for a budget, a bid, a campaign status, a keyword or an ad. Every recommendation is a REVIEW asking a human to look at something.",
  );
  lines.push(
    "- recommendationType must be one of: CAMPAIGN_REVIEW, BUDGET_REVIEW, SEARCH_TERM_REVIEW, KEYWORD_REVIEW, LANDING_PAGE_REVIEW, ATTRIBUTION_REVIEW, DATA_QUALITY_REVIEW.",
  );
  lines.push(
    "- metricRefs: at least one [key] copied EXACTLY from below. Invalid ones are discarded; a recommendation with none surviving is dropped entirely.",
  );
  lines.push("- evidenceRefs and signals[].signalId must be copied exactly from the signal ids below.");
  lines.push("- campaignId must be a campaignId printed below. Anything else is set to null.");
  lines.push(
    "- Every recommendation needs at least one limitation. If you cannot name one, you do not understand the finding well enough to raise it.",
  );

  /* ---------------- Connection & freshness FIRST ---------------- */
  lines.push("");
  lines.push("== CAN THESE NUMBERS BE TRUSTED? (read this before concluding anything) ==");
  ref("gads.connection.state", "Connection", s.connection.state);
  lines.push(`  ${s.connection.reason}`);
  ref("gads.sync.state", "Data freshness", s.freshness.state);
  lines.push(`  ${s.freshness.reason}`);
  ref("gads.sync.lastSuccessfulSyncAt", "Last successful sync", s.freshness.lastSuccessfulSyncAt?.toISOString() ?? "never");
  ref("gads.sync.latestMetricDate", "Latest reporting day held", s.freshness.latestMetricDate ?? "none");
  ref("gads.sync.ageHours", "Hours since last successful sync", s.freshness.ageHours === null ? "never synced" : String(s.freshness.ageHours));
  lines.push(
    `  REPORTING WINDOW: Google Ads account days ${s.reportingWindow.startDate} → ${s.reportingWindow.endDate}${s.reportingWindow.timeZone ? ` (${s.reportingWindow.timeZone})` : ""}. ${s.reportingWindow.explanation}`,
  );
  if (s.connection.state !== "CONNECTED") {
    lines.push(
      "  NOT CONNECTED IS NOT ZERO SPEND. Do not state, imply, or reason from a spend figure of zero. The correct finding here is a DATA_QUALITY_REVIEW.",
    );
  }

  /* ---------------- Profit truth ---------------- */
  lines.push("");
  lines.push("== WHAT WE DO AND DO NOT KNOW ABOUT PROFIT ==");
  ref(
    "gads.profit.poas",
    "Profit on ad spend (POAS)",
    metricText(s.efficiency.profitOnAdSpend, (v) => String(v)),
  );
  ref("gads.profit.blockers", "Unfilled cost inputs", String(s.efficiency.profitBlockers.length));
  lines.push(
    "  Revenue-based ROAS is NOT profitability. A campaign with ROAS 4 can still lose money. Never call a campaign profitable, and never recommend spending more BECAUSE revenue ROAS is high.",
  );

  /* ---------------- Deterministic signals (early, above the tables) -------- */
  lines.push("");
  lines.push("== DETERMINISTIC SIGNALS (computed by software — explain them, never restate or re-grade them) ==");
  if (s.signals.length === 0) lines.push("  (no signals were raised for this period)");
  for (const signal of s.signals) {
    validSignalIds.add(signal.id);
    validEvidenceRefs.add(signal.id);
    for (const item of signal.evidence) validMetricRefs.add(item.metricRef);
    lines.push(
      `- signalId=${signal.id} [${signal.kind}, route=${signal.route}] ${signal.title}\n` +
        `    ${signal.description}\n` +
        `    Evidence: ${signal.evidence.map((e) => `${e.label} ${e.value}`).join(" · ") || "(none)"}\n` +
        `    Limitations: ${signal.limitations.join(" ")}`,
    );
  }

  /* ---------------- Google's lens ---------------- */
  lines.push("");
  lines.push("== GOOGLE ADS REPORTED (Google's own numbers — Google's attribution, not ours) ==");
  ref("gads.google.spend", "Ad spend", s.google.daysWithData === 0 ? "no data synced for this window" : money(s.google.costCents));
  ref("gads.google.currency", "Account currency", currency ?? "unknown");
  ref("gads.google.impressions", "Impressions", String(s.google.impressions));
  ref("gads.google.clicks", "Clicks", String(s.google.clicks));
  ref("gads.google.ctr", "CTR", s.google.ctrPct === null ? "unavailable (too few impressions)" : `${s.google.ctrPct}%`);
  ref("gads.google.cpc", "Cost per click", s.google.cpcCents === null ? "unavailable (no clicks)" : money(s.google.cpcCents));
  ref("gads.google.conversions", "Google-reported conversions", String(s.google.googleConversions));
  ref("gads.google.conversionValue", "Google-reported conversion value", money(s.google.googleConversionValueCents));
  ref(
    "gads.google.costPerConversion",
    "Google-reported cost per conversion",
    metricText(s.efficiency.googleReportedCostPerConversionCents, money),
  );
  ref("gads.google.roas", "Google-reported ROAS", metricText(s.efficiency.googleReportedRoas, (v) => `${v}x`));
  lines.push(
    "  A Google conversion is whatever that account's conversion actions count. It is NOT a BagDirect order, and its value is NOT BagDirect revenue.",
  );

  /* ---------------- Our lens ---------------- */
  lines.push("");
  lines.push("== BAGDIRECT FIRST-PARTY (our own data about visitors who arrived from a Google Ads click) ==");
  ref("gads.firstParty.sessions", "Sessions from Google Ads", String(s.firstParty.sessions));
  ref("gads.firstParty.sessionsWithClickId", "…of which carried a Google click id", String(s.firstParty.sessionsWithClickId));
  ref("gads.firstParty.productViews", "Sessions that viewed a product", String(s.firstParty.productViewSessions));
  ref("gads.firstParty.priceViews", "Sessions that saw a price", String(s.firstParty.priceViewSessions));
  ref("gads.firstParty.cart", "Sessions that added to cart", String(s.firstParty.cartSessions));
  ref("gads.firstParty.checkout", "Sessions that started checkout", String(s.firstParty.checkoutSessions));
  ref("gads.firstParty.conversations", "Conversations with the AI expert", String(s.firstParty.conversations));
  ref("gads.firstParty.qualifiedConversations", "…qualified conversations", String(s.firstParty.qualifiedConversations));
  ref("gads.firstParty.orders", "Orders attributed to Google Ads", String(s.firstParty.orders));
  ref("gads.firstParty.revenue", "Revenue from those orders", money(s.firstParty.revenueCents));
  ref("gads.firstParty.aiAssistedOrders", "…of which the AI expert assisted", String(s.firstParty.aiAssistedOrders));
  ref(
    "gads.firstParty.costPerOrder",
    "First-party cost per attributed order",
    metricText(s.efficiency.firstPartyCostPerOrderCents, money),
  );
  lines.push(`    Denominator: ${s.efficiency.firstPartyCacDenominator}`);
  ref("gads.firstParty.roas", "First-party ROAS (revenue ÷ ad spend)", metricText(s.efficiency.firstPartyRoas, (v) => `${v}x`));

  /* ---------------- Discrepancy ---------------- */
  lines.push("");
  lines.push("== WHERE GOOGLE AND WE DISAGREE ==");
  ref("gads.discrepancy.conversions", "Google conversions vs our orders", `${s.discrepancy.googleConversions} vs ${s.discrepancy.firstPartyOrders}`);
  ref(
    "gads.discrepancy.value",
    "Google conversion value vs our revenue",
    `${money(s.discrepancy.googleConversionValueCents)} vs ${money(s.discrepancy.firstPartyRevenueCents)}`,
  );
  ref("gads.discrepancy.material", "Materially different?", s.discrepancy.material ? "yes" : "no");
  lines.push(`  ${s.discrepancy.interpretation}`);
  lines.push("  A difference is NOT automatically a bug. Do not 'correct' either side, and do not average them.");

  /* ---------------- Attribution coverage ---------------- */
  lines.push("");
  lines.push("== HOW WELL WE CAN TIE VISITS TO CAMPAIGNS ==");
  ref("gads.coverage.googleAdsSessions", "Google Ads sessions", String(s.coverage.googleAdsSessions));
  ref("gads.coverage.exact", "Matched to a campaign id (EXACT)", String(s.coverage.exactSessions));
  ref("gads.coverage.mapped", "Matched by campaign name (MAPPED)", String(s.coverage.mappedSessions));
  ref("gads.coverage.unmatched", "Not tied to any campaign (UNMATCHED)", String(s.coverage.unmatchedSessions));
  ref("gads.coverage.matchedPct", "Match coverage", s.coverage.matchedPct === null ? "unavailable (too few sessions)" : `${s.coverage.matchedPct}%`);
  ref("gads.coverage.campaignsWithNoSessions", "Campaigns with spend but no matched session", String(s.coverage.campaignsWithNoSessions));
  lines.push(`  ${s.coverage.interpretation}`);

  /* ---------------- Campaign table ---------------- */
  lines.push("");
  lines.push("== CAMPAIGNS (Google's numbers | our numbers) ==");
  if (s.campaigns.length === 0) lines.push("  (no campaign data for this window)");
  for (const c of s.campaigns.slice(0, GOOGLE_ADS.MAX_BREAKDOWN_ROWS)) {
    validCampaignIds.add(c.campaignId);
    const prefix = `gads.campaign.${c.campaignId}`;
    validMetricRefs.add(`${prefix}.cost`);
    validMetricRefs.add(`${prefix}.clicks`);
    validMetricRefs.add(`${prefix}.sessions`);
    validMetricRefs.add(`${prefix}.orders`);
    lines.push(
      `- campaignId=${c.campaignId} "${c.campaignName}" [${c.campaignStatus}${c.advertisingChannelType ? `, ${c.advertisingChannelType}` : ""}, match=${c.matchQuality ?? "NO_SESSIONS"}]\n` +
        `    Google: spend ${money(c.costCents)} [${prefix}.cost] · ${c.impressions} impressions · ${c.clicks} clicks [${prefix}.clicks] · ` +
        `CTR ${c.ctrPct === null ? "n/a" : `${c.ctrPct}%`} · CPC ${c.cpcCents === null ? "n/a" : money(c.cpcCents)} · ` +
        `${c.googleConversions} conversions · value ${money(c.googleConversionValueCents)} · ROAS ${c.googleReportedRoas === null ? "n/a" : `${c.googleReportedRoas}x`}\n` +
        `    Ours: ${c.firstPartySessions} sessions [${prefix}.sessions] · ${c.firstPartyQualifiedConversations} qualified conversations · ` +
        `${c.firstPartyCartSessions} carts · ${c.firstPartyCheckoutSessions} checkouts · ${c.firstPartyOrders} orders [${prefix}.orders] · ` +
        `revenue ${money(c.firstPartyRevenueCents)} · cost/order ${metricText(c.firstPartyCostPerOrderCents, money)} · ROAS ${metricText(c.firstPartyRoas, (v) => `${v}x`)}`,
    );
  }

  /* ---------------- Customer signals ---------------- */
  lines.push("");
  lines.push("== WHAT PAID-SEARCH VISITORS ACTUALLY ASKED (from qualified conversations) ==");
  ref("gads.customers.qualifiedConversations", "Qualified conversations from Google Ads", String(s.customerSignals.qualifiedConversations));
  ref("gads.customers.moqQuestions", "…asking about the minimum order", String(s.customerSignals.moqQuestionConversations));
  ref("gads.customers.moqObjections", "…saying the minimum is too high", String(s.customerSignals.moqObjectionConversations));
  for (const q of s.customerSignals.topQuestions.slice(0, 8)) {
    ref(`gads.customers.question.${q.theme}`, `Question: ${q.theme}`, `${q.conversations} conversations`);
  }
  for (const o of s.customerSignals.topObjections.slice(0, 8)) {
    ref(`gads.customers.objection.${o.type}`, `Objection: ${o.type}`, `${o.conversations} conversations`);
  }

  /* ---------------- Trends ---------------- */
  lines.push("");
  lines.push("== TRENDS vs THE PREVIOUS PERIOD ==");
  for (const t of s.trends) {
    ref(
      `gads.trend.${t.name}`,
      t.label,
      t.trend.state === "TREND" ? `${t.trend.changePct! >= 0 ? "+" : ""}${t.trend.changePct}%` : t.trend.state,
    );
  }

  /* ---------------- Not ingested + data quality ---------------- */
  lines.push("");
  lines.push("== WHAT THIS DATA CANNOT ANSWER ==");
  lines.push(`  ${s.notIngested.reason}`);
  for (const w of s.dataQuality) lines.push(`  - ${w.code}: ${w.message}`);

  const text = lines.join("\n").slice(0, GOOGLE_ADS.ADS_CONTEXT_MAX_CHARS);
  return { text, validMetricRefs, validEvidenceRefs, validSignalIds, validCampaignIds };
}
