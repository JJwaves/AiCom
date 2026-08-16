import { PRICING_INTELLIGENCE } from "@/config/pricing-intelligence";
import type { PricingIntelligenceSnapshot } from "@/modules/pricing-intelligence";

/**
 * Pricing Agent context (Session 12 spec §24, §33, §40).
 *
 * The ONLY quantitative input the model sees: a bounded, PII-FREE text
 * rendering of the deterministic PricingIntelligenceSnapshot. The agent
 * never re-reads the raw customer corpus — it reads counts that
 * `modules/pricing-intelligence` already computed.
 *
 * Three whitelists are built WHILE printing, and the model's output is
 * filtered against exactly them afterwards:
 *   validMetricRefs   — every [key] printed here
 *   validEvidenceRefs — every signal / insight / opportunity id printed here
 *   validSignalIds    — the deterministic signal ids it may annotate
 *
 * Nothing else exists to cite, so "23 customers complained about price" can
 * only survive if this context actually said 23.
 */

export type PricingContext = {
  text: string;
  validMetricRefs: Set<string>;
  validEvidenceRefs: Set<string>;
  validSignalIds: Set<string>;
  /** Catalog products and their real tier ladders — for server validation. */
  validTiersByProduct: Map<string, Set<number>>;
};

const money = (cents: number | null, currency: string): string =>
  cents === null ? "—" : `${(cents / 100).toFixed(2)} ${currency}`;

const ratioLine = (r: { numerator: number; denominator: number; percentage: number | null }): string =>
  r.percentage === null
    ? `${r.numerator} of ${r.denominator} (sample too small for a %)`
    : `${r.numerator} of ${r.denominator} (${r.percentage}%)`;

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function buildPricingContext(snapshot: PricingIntelligenceSnapshot): PricingContext {
  const validMetricRefs = new Set<string>();
  const validEvidenceRefs = new Set<string>();
  const validSignalIds = new Set<string>();
  const validTiersByProduct = new Map<string, Set<number>>();
  const lines: string[] = [];

  const ref = (key: string, label: string, rendered: string) => {
    validMetricRefs.add(key);
    lines.push(`- [${key}] ${label}: ${rendered}`);
  };

  const s = snapshot;
  lines.push(`PERIOD: ${s.period.label} (${iso(s.period.start)} → ${iso(s.period.end)}).`);
  lines.push(`PREVIOUS PERIOD: ${s.previous.label} (${iso(s.previous.start)} → ${iso(s.previous.end)}).`);

  /* Rules come FIRST, deliberately: the context is truncated at a character
   * budget, and the boundaries must survive truncation even when a busy
   * period fills the data sections. */
  lines.push("");
  lines.push("== RULES THE SERVER ENFORCES (stating them saves you a dropped recommendation) ==");
  lines.push("- You cannot propose a price. There is no field for one, and no recommendation type that sets one.");
  lines.push(
    "- recommendationType must be one of: PRICING_REVIEW, MOQ_REVIEW, TIER_STRUCTURE_REVIEW, PRICE_PRESENTATION_REVIEW, PRICE_EXPERIMENT_REVIEW, DATA_QUALITY.",
  );
  lines.push(
    "- metricRefs: at least one [key] copied EXACTLY from below. Invalid ones are discarded; a recommendation with none surviving is dropped entirely.",
  );
  lines.push("- evidenceRefs and signals[].signalId must be copied exactly from below.");
  lines.push(
    "- productId must be a productId printed below; quantityTier must be a quantityTier printed for THAT product. Anything else is set to null.",
  );
  lines.push("- requiresCostConfiguration and requiresExperiment are recomputed by the server. Your values are recorded, not used.");
  lines.push(
    "- Every recommendation needs at least one limitation. If you cannot name one, you do not understand the finding well enough to raise it.",
  );

  /* ---------------- Cost & margin availability FIRST ---------------- */
  lines.push("");
  lines.push("== WHAT WE DO AND DO NOT KNOW ABOUT COST (read this before recommending anything) ==");
  lines.push(`  ${s.costs.summary}`);
  ref(
    "pricing.costs.configured",
    "Manufacturing cost model configured",
    s.costs.costModelConfigured ? "yes" : "NO — margin, profit impact and the minimum safe price are UNAVAILABLE",
  );
  ref(
    "pricing.costs.marginPolicyConfigured",
    "Minimum margin policy configured",
    s.costs.marginPolicyConfigured ? "yes" : "NO — the deterministic price floor fails closed",
  );
  ref("pricing.costs.missingConfiguration", "Unfilled cost inputs", String(s.costs.missingConfiguration.length));
  for (const limit of s.priceLimits) {
    ref(
      `pricing.limit.${limit.configPath.split(".").pop()}`,
      limit.label,
      limit.configured ? String(limit.value) : "NOT CONFIGURED",
    );
  }

  lines.push("");
  lines.push("== PRICE ELASTICITY ==");
  lines.push(`  NOT ESTIMABLE. ${s.elasticity.reason}`);
  lines.push("  Do not state, imply, or reason from an elasticity figure. There is none.");

  /* ---------------- Deterministic signals ----------------
   * Printed EARLY, above the long tables: these are the findings worth
   * annotating, and the character budget must not be able to cut them. */
  lines.push("");
  lines.push("== DETERMINISTIC PRICING SIGNALS (computed by software — explain them, never restate or re-grade them) ==");
  if (s.signals.length === 0) lines.push("  (none reached the evidence threshold in this period)");
  for (const signal of s.signals) {
    validSignalIds.add(signal.id);
    validEvidenceRefs.add(signal.id);
    for (const item of signal.evidence) validMetricRefs.add(item.metricRef);
    for (const evidenceRef of signal.evidenceRefs) validEvidenceRefs.add(evidenceRef);
    lines.push(
      `- signalId=${signal.id} [${signal.kind}, strength=${signal.strength}, evidence=${signal.evidenceKind}, ` +
        `isPriceFriction=${signal.isPriceFriction}, route=${signal.route}] ${signal.title}\n` +
        `    ${signal.description}\n` +
        `    limitations: ${signal.limitations.join(" ")}`,
    );
  }

  /* ---------------- Readiness ---------------- */
  lines.push("");
  lines.push("== WHAT KIND OF RECOMMENDATION IS EVEN POSSIBLE RIGHT NOW ==");
  for (const [key, value] of Object.entries(s.readiness)) {
    lines.push(`- ${key}: ${value.state} — ${value.reason}`);
    for (const blocker of value.blockers.slice(0, 4)) lines.push(`    blocked by: ${blocker}`);
  }

  /* ---------------- Pricing funnel ---------------- */
  lines.push("");
  lines.push("== PRICING FUNNEL (distinct sessions; denominators stated) ==");
  ref("pricing.funnel.productSessions", "Sessions that viewed a product page", String(s.funnel.productSessions));
  ref("pricing.funnel.priceViewSessions", "Sessions that saw a computed price", String(s.funnel.priceViewSessions));
  ref("pricing.funnel.priceViewAndCart", "…that also added to cart", String(s.funnel.priceViewAndCart));
  ref("pricing.funnel.priceViewAndCheckout", "…that also started checkout", String(s.funnel.priceViewAndCheckout));
  ref("pricing.funnel.priceViewAndPurchase", "…that also purchased", String(s.funnel.priceViewAndPurchase));
  ref("pricing.funnel.quoteAfterPrice", "…that requested a custom quote at or after the price view", String(s.funnel.quoteAfterPrice));
  ref("pricing.funnel.handoffAfterPrice", "…that asked for a human at or after the price view", String(s.funnel.handoffAfterPrice));
  ref("pricing.funnel.priceViewNoAction", "…that did nothing further (behavioural only)", String(s.funnel.priceViewNoAction));
  for (const rate of s.funnel.rates) {
    ref(`pricing.rate.${rate.name}`, `${rate.label} (denominator: ${rate.denominatorDefinition})`, ratioLine(rate.ratio));
  }

  /* ---------------- Questions vs objections ---------------- */
  const c = s.funnel.conversations;
  lines.push("");
  lines.push("== WHAT CUSTOMERS ASKED vs WHAT THEY OBJECTED TO (never the same thing) ==");
  lines.push('  "How much is 5,000?" is a QUESTION. "That is too expensive" is an OBJECTION. Do not treat an inquiry as resistance.');
  ref("pricing.conversations.classified", "Classified conversations", String(c.classified));
  ref("pricing.conversations.qualifiedClassified", "…of which qualified", String(c.qualifiedClassified));
  ref("pricing.conversations.priceQuestion", "Conversations ASKING about price", String(c.priceQuestion));
  ref("pricing.conversations.repeatedPriceQuestion", "…asking about price more than once", String(c.repeatedPriceQuestion));
  ref("pricing.conversations.priceObjection", "Conversations SAYING the price is too high", String(c.priceObjection));
  ref("pricing.conversations.priceObjectionPurchased", "…that purchased anyway", String(c.priceObjectionPurchased));
  ref("pricing.conversations.moqQuestion", "Conversations ASKING what the minimum is", String(c.moqQuestion));
  ref("pricing.conversations.moqObjection", "Conversations SAYING the minimum is too high", String(c.moqObjection));
  ref("pricing.conversations.handoffWithPriceTopic", "Price conversations ending in a human handoff", String(c.handoffWithPriceTopic));

  /* ---------------- Three quantity lanes ---------------- */
  lines.push("");
  lines.push("== THREE QUANTITY LANES — never merge these ==");
  lines.push("  REQUESTED = what prospects say they want · CONFIGURED = what they build · PURCHASED = what they buy.");
  ref("pricing.demand.moq", "Catalog minimum order quantity", String(s.demand.moq));
  ref("pricing.demand.requestedProfiles", "Prospects who named a quantity", String(s.demand.requested.withQuantity));
  ref("pricing.demand.configurations", "Configurator rows in period", String(s.demand.configured.configurations));
  ref("pricing.demand.purchasedLines", "Purchased order lines", String(s.demand.purchased.lines));
  ref("pricing.demand.purchasedUnits", "Units purchased", String(s.demand.purchased.units));
  for (const bucket of s.demand.buckets) {
    const req = s.demand.requested.rows.find((r) => r.bucketKey === bucket.key);
    const cfg = s.demand.configured.rows.find((r) => r.bucketKey === bucket.key);
    const buy = s.demand.purchased.rows.find((r) => r.bucketKey === bucket.key);
    ref(
      `pricing.demand.bucket.${bucket.key}`,
      `Quantity band ${bucket.label}`,
      `requested ${req?.count ?? 0} (${req?.stated ?? 0} stated / ${req?.inferred ?? 0} inferred), configured ${cfg?.count ?? 0}, purchased ${buy?.count ?? 0}`,
    );
  }
  lines.push(
    `  Dominant band — requested: ${s.demand.dominant.requested ?? "none"} · configured: ${s.demand.dominant.configured ?? "none"} · purchased: ${s.demand.dominant.purchased ?? "none"}. ` +
      "A gap between these three is a finding in itself, not a contradiction to resolve.",
  );

  /* ---------------- Tier performance ---------------- */
  lines.push("");
  lines.push("== QUANTITY-TIER PERFORMANCE (descriptive — never causal) ==");
  for (const row of s.tiers.rows) {
    if (!validTiersByProduct.has(row.productId)) validTiersByProduct.set(row.productId, new Set());
    if (row.tierMinQty !== null) validTiersByProduct.get(row.productId)!.add(row.tierMinQty);
    if (
      row.quantitySelectedSessions === 0 &&
      row.configuredConfigurations === 0 &&
      row.cartSessions === 0 &&
      row.purchasedLines === 0 &&
      row.conversations === 0
    ) {
      continue;
    }
    ref(
      `pricing.tier.${row.bandKey}`,
      `${row.productTitle} · band ${row.label} at ${money(row.unitPriceCents, row.currency)}/unit (productId=${row.productId}, quantityTier=${row.tierMinQty ?? "none"})`,
      `quantity selected by ${row.quantitySelectedSessions} sessions · ${row.configuredConfigurations} configurations · ${row.cartSessions} cart sessions · ` +
        `checkout: unavailable per tier · ${row.purchasedLines} purchased lines (${row.unitsPurchased} units) · ` +
        `${row.conversations} conversations attributed (${row.priceQuestionConversations} asked about price, ${row.priceObjectionConversations} objected, ${row.moqObjectionConversations} objected to the minimum)`,
    );
  }
  for (const note of s.tiers.notes) lines.push(`  NOTE: ${note}`);
  ref("pricing.tier.unattributedConversations", "Conversations with no quantity (absent from every tier row)", String(s.tiers.unattributedConversations));

  /* ---------------- MOQ ---------------- */
  lines.push("");
  lines.push("== MINIMUM ORDER QUANTITY (a quantity question, NOT a price question) ==");
  ref("pricing.moq.requestedBelowMoqStated", "Prospects who stated a below-minimum quantity", String(s.moq.requestedBelowMoqStated));
  ref("pricing.moq.requestedBelowMoqInferred", "…inferred rather than stated (weaker)", String(s.moq.requestedBelowMoqInferred));
  ref("pricing.moq.configuredBelowMoq", "Configurator rows below the minimum", String(s.moq.configuredBelowMoq));
  ref("pricing.moq.moqQuestionConversations", "Conversations asking what the minimum is", String(s.moq.moqQuestionConversations));
  ref("pricing.moq.moqObjectionConversations", "Conversations saying the minimum is too high", String(s.moq.moqObjectionConversations));
  ref("pricing.moq.belowMoqHandoffs", "Below-minimum demand that ended with a human handoff", String(s.moq.belowMoqHandoffs));
  ref("pricing.moq.purchasedBelowMoqLines", "Purchased lines below the minimum", String(s.moq.purchasedBelowMoqLines));
  for (const note of s.moq.notes) lines.push(`  NOTE: ${note}`);

  /* ---------------- Product pricing ---------------- */
  lines.push("");
  lines.push("== PRODUCT PRICING PERFORMANCE ==");
  for (const p of s.products.rows) {
    ref(
      `pricing.product.${p.productId}`,
      `${p.title} (productId=${p.productId}; entry ${money(p.entryUnitPriceCents, p.currency)}/unit, best ${money(p.bestUnitPriceCents, p.currency)}/unit, MOQ ${p.moq}, ${p.tierCount} tiers)`,
      `${p.productViewSessions} product-view sessions · ${p.priceViewSessions} price-view sessions · ${p.cartSessions} cart sessions · ` +
        `${p.orders} purchased lines (${p.unitsPurchased} units, revenue ${money(p.revenueCents, p.currency)}) · ` +
        `purchase after price view ${ratioLine(p.purchaseRateAfterPriceView)} · gross margin: UNAVAILABLE (${p.grossMargin.available ? "configured" : "manufacturing costs not configured"})`,
    );
  }
  lines.push("  NOTE: Revenue is not profit. Do not call a product profitable, or recommend anything on the basis of revenue alone.");

  /* ---------------- Price realization ---------------- */
  lines.push("");
  lines.push("== PRICE REALIZATION ==");
  ref("pricing.realization.linesChecked", "Order lines re-checked against today's catalog", String(s.realization.linesChecked));
  ref("pricing.realization.linesMatching", "…matching today's catalog exactly", String(s.realization.linesMatchingCurrentCatalog));
  ref("pricing.realization.variances", "Lines differing from today's catalog", String(s.realization.variances.length));
  lines.push("  NOTE: There are no discounts. A difference means the price list changed after the order — legitimate repricing, never leakage.");
  ref("pricing.realization.repricingInstrumented", "Checkout repricing instrumented", "no");
  lines.push(`  ${s.realization.repricing.reason}`);

  /* ---------------- Segments & attribution ---------------- */
  if (s.segments.length > 0) {
    lines.push("");
    lines.push("== BUSINESS SEGMENTS (descriptive; segments are NEVER priced differently) ==");
    for (const seg of s.segments) {
      ref(
        `pricing.segment.${seg.segment}`,
        `Segment "${seg.segment}"`,
        `${seg.conversations} qualified conversations · price questions ${ratioLine(seg.priceQuestionRate)} · price objections ${ratioLine(seg.priceObjectionRate)} · ${seg.purchased} purchased`,
      );
    }
  }
  if (s.attribution.length > 0) {
    lines.push("");
    lines.push("== TRAFFIC SOURCES (descriptive; prices never vary by source) ==");
    for (const row of s.attribution) {
      ref(
        `pricing.attribution.${row.key}`,
        `First touch "${row.key}"`,
        `${row.conversations} qualified conversations · price questions ${ratioLine(row.priceQuestionRate)} · ${row.purchased} purchased`,
      );
    }
  }

  /* ---------------- AI sales ---------------- */
  lines.push("");
  lines.push("== AI SALES × PRICING ==");
  ref("pricing.aiSales.conversationsReachingPricing", "Conversations where pricing came up", String(s.aiSales.conversationsReachingPricing));
  ref("pricing.aiSales.priceConversationsWithCartAdd", "…whose session added to cart", String(s.aiSales.priceConversationsWithCartAdd));
  ref("pricing.aiSales.priceConversationsWithPurchase", "…whose session purchased", String(s.aiSales.priceConversationsWithPurchase));
  ref("pricing.aiSales.priceConversationsHandedOff", "…that ended with a human handoff", String(s.aiSales.priceConversationsHandedOff));
  lines.push("  NOTE: The sales agent has no discount tool and cannot promise negotiated pricing. Do not recommend that it offer one.");

  /* ---------------- Trends ---------------- */
  lines.push("");
  lines.push("== TRENDS vs THE PREVIOUS PERIOD ==");
  for (const t of s.trends) {
    ref(
      `pricing.trend.${t.name}`,
      t.label,
      t.trend.state === "TREND"
        ? `${t.trend.previous} → ${t.trend.current} (${t.trend.changePct}%)`
        : `${t.trend.previous} → ${t.trend.current} (${t.trend.state} — no percentage is meaningful)`,
    );
  }

  /* ---------------- Data quality ---------------- */
  lines.push("");
  lines.push("== DATA QUALITY ==");
  for (const warning of s.dataQuality) lines.push(`- ${warning.code}: ${warning.message}`);

  let text = lines.join("\n");
  if (text.length > PRICING_INTELLIGENCE.PRICING_CONTEXT_MAX_CHARS) {
    text = `${text.slice(0, PRICING_INTELLIGENCE.PRICING_CONTEXT_MAX_CHARS)}\n[context truncated at ${PRICING_INTELLIGENCE.PRICING_CONTEXT_MAX_CHARS} chars]`;
  }
  return { text, validMetricRefs, validEvidenceRefs, validSignalIds, validTiersByProduct };
}
