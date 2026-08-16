import { beforeEach, describe, expect, it } from "vitest";
import { COST_MODEL } from "@/config/costs";
import { GUARDRAIL_LIMITS } from "@/config/guardrails";
import { PRODUCTS } from "@/config/products";
import { listCatalogProducts } from "@/lib/commerce/catalog";
import { loadConversationCorpus } from "@/modules/customer-intelligence/aggregate";
import {
  assessCostReadiness,
  assessElasticity,
  assessPriceLimits,
  assessPricingReadiness,
  bandForQuantity,
  bandsForCatalog,
  bandsForProduct,
  buildMoqIntelligence,
  buildPricingIntelligenceSnapshot,
  buildPricingSignals,
  catalogQuantityBuckets,
  loadPriceRealization,
  loadPricingFunnel,
  loadQuantityDemand,
  loadTierPerformance,
  periodFromDays,
  PRICE_EXPERIMENT_SUPPORTED,
} from "@/modules/pricing-intelligence";
import { listOpportunities } from "@/lib/data/insight-service";
import { makeSession, resetDb } from "./db-helpers";
import { seedClassification, seedConversation } from "./ci-helpers";
import { HERO, seedConfiguredQuantity, seedOrder, seedPricingSession, seedRequestedQuantity } from "./pi-helpers";

/**
 * Session 12 — deterministic pricing analytics.
 *
 * Every assertion here runs with NO AI provider, NO credentials and NO
 * network. The whole point of `modules/pricing-intelligence` is that these
 * numbers exist without a model, so the tests must too.
 */

beforeEach(async () => {
  await resetDb();
});

const period = () => periodFromDays(7, new Date(Date.now() + 60_000));

/* ------------------------------------------------------------------ */
/* Tier bands derived from the REAL catalog (spec §14)                 */
/* ------------------------------------------------------------------ */

describe("quantity bands come from the real pricing tiers", () => {
  it("builds one band per configured tier plus a below-MOQ band", () => {
    const bands = bandsForProduct(HERO);
    expect(bands[0].belowMoq).toBe(true);
    expect(bands[0].maxQty).toBe(HERO.minQuantity);
    expect(bands[0].unitPriceCents).toBeNull();

    const tierBands = bands.filter((b) => !b.belowMoq);
    expect(tierBands).toHaveLength(HERO.pricingTiers.length);
    expect(tierBands.map((b) => b.tierMinQty)).toEqual(HERO.pricingTiers.map((t) => t.minQty));
    expect(tierBands[0].unitPriceCents).toBe(HERO.pricingTiers[0].unitPriceCents);
    // Bands are half-open and contiguous; the last is open-ended.
    expect(tierBands[0].maxQty).toBe(HERO.pricingTiers[1].minQty);
    expect(tierBands.at(-1)!.maxQty).toBe(Number.POSITIVE_INFINITY);
  });

  it("places a quantity in exactly one band, and none for an unknown product", () => {
    const bands = bandsForCatalog(PRODUCTS);
    expect(bandForQuantity(bands, HERO.id, 5000)!.tierMinQty).toBe(5000);
    expect(bandForQuantity(bands, HERO.id, 4999)!.tierMinQty).toBe(2500);
    expect(bandForQuantity(bands, HERO.id, 200)!.belowMoq).toBe(true);
    expect(bandForQuantity(bands, "p-does-not-exist", 5000)).toBeNull();
  });

  it("derives catalog-wide buckets from real breakpoints, not invented ranges", () => {
    const buckets = catalogQuantityBuckets(PRODUCTS);
    const catalogBreakpoints = [...new Set(PRODUCTS.flatMap((p) => p.pricingTiers.map((t) => t.minQty)))].sort(
      (a, b) => a - b,
    );
    expect(buckets.filter((b) => !b.belowMoq).map((b) => b.minQty)).toEqual(catalogBreakpoints);
    expect(buckets[0].belowMoq).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Pricing funnel + question vs objection (spec §8, §9)                */
/* ------------------------------------------------------------------ */

describe("pricing funnel", () => {
  it("counts co-occurrence over a documented denominator, not two independent stage totals", async () => {
    for (let i = 0; i < 6; i += 1) {
      const s = await makeSession();
      await seedPricingSession(s.id, { cart: i < 2, purchase: i < 1 });
    }
    // A cart-add WITHOUT a price view must not inflate the price→cart rate.
    const noPrice = await makeSession();
    const { recordServerEvent } = await import("@/lib/data/event-service");
    await recordServerEvent({ sessionId: noPrice.id, name: "add_to_cart", productId: HERO.id, props: { quantity: 5000 } });

    const p = period();
    const funnel = await loadPricingFunnel(p, await loadConversationCorpus(p));

    expect(funnel.priceViewSessions).toBe(6);
    expect(funnel.priceViewAndCart).toBe(2);
    expect(funnel.priceViewAndPurchase).toBe(1);
    const rate = funnel.rates.find((r) => r.name === "price_view_to_cart")!;
    expect(rate.ratio).toEqual({ numerator: 2, denominator: 6, percentage: 33 });
    expect(rate.denominatorDefinition).toMatch(/sessions that saw a price/);
  });

  it("suppresses a percentage below the documented minimum denominator", async () => {
    const s = await makeSession();
    await seedPricingSession(s.id, { cart: true });
    const p = period();
    const funnel = await loadPricingFunnel(p, await loadConversationCorpus(p));
    const rate = funnel.rates.find((r) => r.name === "price_view_to_cart")!;
    expect(rate.ratio.numerator).toBe(1);
    expect(rate.ratio.percentage).toBeNull();
  });

  it('only counts a handoff or quote as "after price" when it actually happened after', async () => {
    const after = await makeSession();
    await seedPricingSession(after.id, { handoff: true, quote: true });

    const before = await makeSession();
    const { recordServerEvent } = await import("@/lib/data/event-service");
    await recordServerEvent({ sessionId: before.id, name: "human_handoff_requested" });
    await new Promise((r) => setTimeout(r, 5));
    await recordServerEvent({ sessionId: before.id, name: "price_viewed", productId: HERO.id });

    const p = period();
    const funnel = await loadPricingFunnel(p, await loadConversationCorpus(p));
    expect(funnel.priceViewSessions).toBe(2);
    expect(funnel.handoffAfterPrice).toBe(1);
    expect(funnel.quoteAfterPrice).toBe(1);
  });

  it("counts sessions that saw a price and did nothing further", async () => {
    for (let i = 0; i < 3; i += 1) {
      const s = await makeSession();
      await seedPricingSession(s.id);
    }
    const acted = await makeSession();
    await seedPricingSession(acted.id, { cart: true });

    const p = period();
    const funnel = await loadPricingFunnel(p, await loadConversationCorpus(p));
    expect(funnel.priceViewNoAction).toBe(3);
  });
});

describe("a price QUESTION is never a price OBJECTION (spec §8)", () => {
  it("counts inquiries and resistance in separate buckets", async () => {
    const asker = await makeSession();
    const { conversation: askConv, messages: askMsgs } = await seedConversation(asker.id, ["How much is 5,000?"]);
    await seedClassification(askConv.id, { questions: [{ theme: "PRICE", messageId: askMsgs[0].id }] });

    const objector = await makeSession();
    const { conversation: objConv, messages: objMsgs } = await seedConversation(objector.id, ["That's too expensive."]);
    await seedClassification(objConv.id, { objections: [{ type: "PRICE_TOO_HIGH", messageId: objMsgs[0].id }] });

    const p = period();
    const funnel = await loadPricingFunnel(p, await loadConversationCorpus(p));
    expect(funnel.conversations.priceQuestion).toBe(1);
    expect(funnel.conversations.priceObjection).toBe(1);
    // The two are never summed into one "price sensitivity" figure.
    expect(funnel.conversations.priceQuestion + funnel.conversations.priceObjection).toBe(2);
  });

  it("keeps the same distinction for MOQ (spec §45)", async () => {
    const asker = await makeSession();
    const { conversation: a, messages: am } = await seedConversation(asker.id, ["What is your MOQ?"]);
    await seedClassification(a.id, { questions: [{ theme: "MOQ", messageId: am[0].id }] });

    const objector = await makeSession();
    const { conversation: o, messages: om } = await seedConversation(objector.id, ["500 is too many, I need 200."]);
    await seedClassification(o.id, { objections: [{ type: "MOQ_TOO_HIGH", messageId: om[0].id }] });

    const p = period();
    const funnel = await loadPricingFunnel(p, await loadConversationCorpus(p));
    expect(funnel.conversations.moqQuestion).toBe(1);
    expect(funnel.conversations.moqObjection).toBe(1);
    // Asking about the minimum is not a price signal of any kind.
    expect(funnel.conversations.priceObjection).toBe(0);
    expect(funnel.conversations.priceQuestion).toBe(0);
  });

  it("counts repeated price questions separately from single ones", async () => {
    const s = await makeSession();
    const { conversation, messages } = await seedConversation(s.id, ["How much?", "And for 10,000?"]);
    await seedClassification(conversation.id, {
      questions: [
        { theme: "PRICE", messageId: messages[0].id },
        { theme: "PRICE", messageId: messages[1].id },
      ],
    });
    const p = period();
    const funnel = await loadPricingFunnel(p, await loadConversationCorpus(p));
    // One conversation, counted once — with the repetition tracked separately.
    expect(funnel.conversations.priceQuestion).toBe(1);
    expect(funnel.conversations.repeatedPriceQuestion).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Three quantity lanes (spec §7)                                      */
/* ------------------------------------------------------------------ */

describe("requested, configured and purchased demand stay separate", () => {
  it("never merges the three lanes, and splits requested by provenance", async () => {
    const a = await makeSession();
    await seedRequestedQuantity(a.id, 300, "USER_STATED");
    const b = await makeSession();
    await seedRequestedQuantity(b.id, 800, "AI_INFERRED");
    const c = await makeSession();
    await seedConfiguredQuantity(c.id, 1000);
    const d = await makeSession();
    await seedOrder(d.id, { quantity: 5000 });

    const demand = await loadQuantityDemand(period(), await listCatalogProducts());

    const requestedBelow = demand.requested.rows.find((r) => r.belowMoq)!;
    expect(requestedBelow.stated).toBe(1);
    expect(requestedBelow.inferred).toBe(0);
    expect(demand.requested.belowMoqStated).toBe(1);

    const requested800 = demand.requested.rows.find((r) => r.bucketKey === "q_500")!;
    expect(requested800.inferred).toBe(1);
    expect(requested800.stated).toBe(0);
    // Configured 1,000 and purchased 5,000 land in their own lanes only.
    expect(requested800.count).toBe(1);
    expect(demand.configured.rows.find((r) => r.bucketKey === "q_1000")!.count).toBe(1);
    expect(demand.configured.rows.find((r) => r.bucketKey === "q_5000")!.count).toBe(0);
    expect(demand.purchased.rows.find((r) => r.bucketKey === "q_5000")!.count).toBe(1);
    expect(demand.purchased.units).toBe(5000);

    expect(demand.dominant).toEqual({ requested: "below_moq", configured: "q_1000", purchased: "q_5000" });
  });

  it("excludes CONFIGURATOR/ORDER_DATA provenance from the requested lane (no double counting)", async () => {
    const s = await makeSession();
    const { applyNeedProfileUpdate } = await import("@/lib/data/customer-need-service");
    await applyNeedProfileUpdate(s.id, { quantity: 5000 }, "ORDER_DATA");
    const demand = await loadQuantityDemand(period(), await listCatalogProducts());
    expect(demand.requested.withQuantity).toBe(0);
    expect(demand.requested.rows.every((r) => r.count === 0)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Tier performance + multi-line orders (spec §10)                     */
/* ------------------------------------------------------------------ */

describe("tier performance", () => {
  it("aggregates per band and handles a multi-line order without double counting", async () => {
    const s = await makeSession();
    const { createOrder } = await import("@/lib/data/order-service");
    const { config } = await import("./pi-helpers");
    await createOrder({
      sessionId: s.id,
      provider: "mock",
      currency: "USD",
      lines: [
        {
          productId: HERO.id,
          quantity: 5000,
          unitPriceCents: 47,
          totalCents: 235_000,
          title: "Bag",
          config: config({ quantity: 5000 }),
        },
        {
          productId: HERO.id,
          quantity: 1000,
          unitPriceCents: 59,
          totalCents: 59_000,
          title: "Bag",
          config: config({ quantity: 1000 }),
        },
      ],
    });

    const p = period();
    const tiers = await loadTierPerformance(p, await listCatalogProducts(), await loadConversationCorpus(p));
    const band5000 = tiers.rows.find((r) => r.bandKey === `${HERO.id}:5000`)!;
    const band1000 = tiers.rows.find((r) => r.bandKey === `${HERO.id}:1000`)!;
    expect(band5000.purchasedLines).toBe(1);
    expect(band5000.unitsPurchased).toBe(5000);
    expect(band5000.revenueCents).toBe(235_000);
    expect(band1000.purchasedLines).toBe(1);
    expect(band1000.unitsPurchased).toBe(1000);
    // The two lines land in DIFFERENT bands; neither is counted twice.
    expect(tiers.rows.reduce((n, r) => n + r.purchasedLines, 0)).toBe(2);
  });

  it("excludes cancelled orders from tier revenue", async () => {
    const s = await makeSession();
    await seedOrder(s.id, { quantity: 5000, status: "cancelled" });
    const p = period();
    const tiers = await loadTierPerformance(p, await listCatalogProducts(), await loadConversationCorpus(p));
    expect(tiers.rows.find((r) => r.bandKey === `${HERO.id}:5000`)!.revenueCents).toBe(0);
  });

  it("reports checkout as unavailable per tier rather than zero", async () => {
    const p = period();
    const tiers = await loadTierPerformance(p, await listCatalogProducts(), await loadConversationCorpus(p));
    expect(tiers.rows.every((r) => r.checkoutSessions === null)).toBe(true);
    expect(tiers.notes.join(" ")).toMatch(/never as zero/);
  });

  it("attributes a conversation to the band of its configured quantity, and counts the rest as unattributed", async () => {
    const configured = await makeSession();
    await seedConfiguredQuantity(configured.id, 5000);
    const { conversation, messages } = await seedConversation(configured.id, ["Too expensive."]);
    await seedClassification(conversation.id, { objections: [{ type: "PRICE_TOO_HIGH", messageId: messages[0].id }] });

    const unknown = await makeSession();
    const { conversation: c2, messages: m2 } = await seedConversation(unknown.id, ["Too expensive."]);
    await seedClassification(c2.id, { objections: [{ type: "PRICE_TOO_HIGH", messageId: m2[0].id }] });

    const p = period();
    const tiers = await loadTierPerformance(p, await listCatalogProducts(), await loadConversationCorpus(p));
    const band = tiers.rows.find((r) => r.bandKey === `${HERO.id}:5000`)!;
    expect(band.conversations).toBe(1);
    expect(band.priceObjectionConversations).toBe(1);
    expect(tiers.unattributedConversations).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Price realization + repricing (spec §11–§12)                        */
/* ------------------------------------------------------------------ */

describe("price realization", () => {
  it("matches an engine-priced order against today's catalog with no variance", async () => {
    const s = await makeSession();
    await seedOrder(s.id, { quantity: 5000, unitPriceCents: 47 });
    const realization = await loadPriceRealization(period(), await listCatalogProducts());
    expect(realization.linesChecked).toBe(1);
    expect(realization.linesMatchingCurrentCatalog).toBe(1);
    expect(realization.variances).toHaveLength(0);
    expect(realization.allMatch).toBe(true);
  });

  it("explains a difference as a catalog price change, never as leakage", async () => {
    const s = await makeSession();
    await seedOrder(s.id, { quantity: 5000, unitPriceCents: 52 });
    const realization = await loadPriceRealization(period(), await listCatalogProducts());
    expect(realization.variances).toHaveLength(1);
    expect(realization.variances[0].explanation).toBe("catalog_price_changed");
    expect(realization.notes.join(" ")).toMatch(/never revenue leakage/);
  });

  it("reports checkout repricing as NOT instrumented rather than deriving a number", async () => {
    const realization = await loadPriceRealization(period(), await listCatalogProducts());
    expect(realization.repricing.instrumented).toBe(false);
    expect(realization.repricing.reason).toMatch(/no first-party event records/);
    expect(realization.repricing.requirements.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* MOQ intelligence (spec §13, §45)                                    */
/* ------------------------------------------------------------------ */

describe("MOQ intelligence", () => {
  it("separates below-MOQ demand from price resistance", async () => {
    const s = await makeSession();
    await seedRequestedQuantity(s.id, 200, "USER_STATED", { businessType: "cafe" });
    const { conversation, messages } = await seedConversation(s.id, ["I only need 200 bags."]);
    await seedClassification(conversation.id, { objections: [{ type: "MOQ_TOO_HIGH", messageId: messages[0].id }] });

    const p = period();
    const products = await listCatalogProducts();
    const corpus = await loadConversationCorpus(p);
    const moq = buildMoqIntelligence({
      demand: await loadQuantityDemand(p, products),
      corpus,
      opportunities: await listOpportunities(10),
    });

    expect(moq.moq).toBe(500);
    expect(moq.requestedBelowMoqStated).toBe(1);
    expect(moq.moqObjectionConversations).toBe(1);
    expect(moq.moqQuestionConversations).toBe(0);
    expect(moq.purchasedBelowMoqLines).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Signals: friction requires EXPLICIT evidence (spec §20–§21)         */
/* ------------------------------------------------------------------ */

async function buildSignals() {
  const p = period();
  const products = await listCatalogProducts();
  const corpus = await loadConversationCorpus(p);
  const funnel = await loadPricingFunnel(p, corpus);
  const demand = await loadQuantityDemand(p, products);
  const tiers = await loadTierPerformance(p, products, corpus);
  const moq = buildMoqIntelligence({ demand, corpus, opportunities: await listOpportunities(10) });
  const realization = await loadPriceRealization(p, products);
  return buildPricingSignals({
    funnel,
    tiers,
    moq,
    realization,
    costs: assessCostReadiness(),
    pricingInsightRefs: [],
  });
}

describe("price friction needs someone to have actually said something", () => {
  it("does NOT call a wall of non-purchases price friction (spec §20)", async () => {
    for (let i = 0; i < 30; i += 1) {
      const s = await makeSession();
      await seedPricingSession(s.id);
    }
    const signals = await buildSignals();
    const behavioral = signals.find((s) => s.kind === "PRICE_VIEW_NO_ACTION");
    expect(behavioral).toBeDefined();
    expect(behavioral!.isPriceFriction).toBe(false);
    expect(behavioral!.evidenceKind).toBe("BEHAVIORAL");
    expect(behavioral!.strength).toBe("LOW");
    // Nothing at all is classified as price friction.
    expect(signals.filter((s) => s.isPriceFriction)).toHaveLength(0);
  });

  it("emits a price-friction signal once explicit objections reach the threshold", async () => {
    for (let i = 0; i < 4; i += 1) {
      const s = await makeSession();
      const { conversation, messages } = await seedConversation(s.id, ["That is far too expensive."]);
      await seedClassification(conversation.id, {
        objections: [{ type: "PRICE_TOO_HIGH", messageId: messages[0].id }],
      });
    }
    const signals = await buildSignals();
    const objection = signals.find((s) => s.kind === "PRICE_OBJECTION")!;
    expect(objection.isPriceFriction).toBe(true);
    expect(objection.evidenceKind).toBe("EXPLICIT");
    expect(objection.limitations.length).toBeGreaterThan(0);
    expect(objection.description).toMatch(/4 qualified conversations/);
  });

  it("stays silent below the evidence threshold", async () => {
    const s = await makeSession();
    const { conversation, messages } = await seedConversation(s.id, ["Too expensive."]);
    await seedClassification(conversation.id, { objections: [{ type: "PRICE_TOO_HIGH", messageId: messages[0].id }] });
    const signals = await buildSignals();
    expect(signals.find((s) => s.kind === "PRICE_OBJECTION")).toBeUndefined();
  });

  it("grades strength by counted evidence and evidence diversity, never a probability", async () => {
    for (let i = 0; i < 12; i += 1) {
      const s = await makeSession();
      await seedPricingSession(s.id, { quote: true });
      const { conversation, messages } = await seedConversation(s.id, ["Too expensive.", "How much for 10,000?"]);
      await seedClassification(conversation.id, {
        objections: [{ type: "PRICE_TOO_HIGH", messageId: messages[0].id }],
        questions: [
          { theme: "PRICE", messageId: messages[0].id },
          { theme: "PRICE", messageId: messages[1].id },
        ],
      });
    }
    const signals = await buildSignals();
    const objection = signals.find((s) => s.kind === "PRICE_OBJECTION")!;
    expect(objection.strength).toBe("HIGH");
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(objection.strength);
    // No fabricated probability anywhere in the payload.
    expect(JSON.stringify(objection)).not.toMatch(/0\.\d{2,}/);
  });

  it("routes MOQ friction away from pricing (spec §45)", async () => {
    for (let i = 0; i < 4; i += 1) {
      const s = await makeSession();
      await seedRequestedQuantity(s.id, 200, "USER_STATED");
      const { conversation, messages } = await seedConversation(s.id, ["I only need 200."]);
      await seedClassification(conversation.id, {
        objections: [{ type: "MOQ_TOO_HIGH", messageId: messages[0].id }],
      });
    }
    const signals = await buildSignals();
    const moq = signals.find((s) => s.kind === "MOQ_FRICTION")!;
    expect(moq.route).toBe("MOQ_REVIEW");
    expect(moq.isPriceFriction).toBe(false);
    expect(moq.description).toMatch(/not a price question/);
  });

  it("routes a product gap away from pricing entirely (spec §46)", async () => {
    for (let i = 0; i < 5; i += 1) {
      const s = await makeSession();
      const { conversation, messages } = await seedConversation(s.id, ["Do you sell insulated bags?"]);
      await seedClassification(conversation.id, {
        requests: [
          { kind: "product", normalized: "insulated bags", messageId: messages[0].id, support: "unsupported" },
        ],
      });
    }
    const signals = await buildSignals();
    // A product we do not make produces NO pricing signal of any kind.
    expect(signals.filter((s) => s.isPriceFriction)).toHaveLength(0);
    expect(signals.find((s) => s.kind === "MOQ_FRICTION")).toBeUndefined();
  });

  it("always reports the missing cost model as a data gap", async () => {
    const signals = await buildSignals();
    const gap = signals.find((s) => s.id === "DATA_GAP:cost_model")!;
    expect(gap.route).toBe("DATA_QUALITY");
    expect(gap.isPriceFriction).toBe(false);
    expect(gap.description).toMatch(/never as zero/);
  });
});

/* ------------------------------------------------------------------ */
/* Cost / margin / elasticity / readiness (spec §3, §4, §22, §44)      */
/* ------------------------------------------------------------------ */

describe("cost and margin availability", () => {
  it("treats every null cost as UNKNOWN, never as zero", () => {
    const costs = assessCostReadiness();
    expect(costs.costModelConfigured).toBe(false);
    expect(costs.marginPolicyConfigured).toBe(false);
    expect(costs.grossMarginAvailable).toBe(false);
    expect(costs.contributionMarginAvailable).toBe(false);
    expect(costs.missingConfiguration.length).toBeGreaterThan(0);
    expect(costs.summary).toMatch(/never as zero/);
    // Nothing in the readiness payload carries a numeric cost.
    expect(costs.inputs.every((i) => !i.configured)).toBe(true);
  });

  it("keeps the production cost model entirely unfilled", () => {
    expect(COST_MODEL.paymentFee.percentBps).toBeNull();
    expect(COST_MODEL.marginPolicy.minimumGrossMarginBps).toBeNull();
    for (const pc of Object.values(COST_MODEL.products)) {
      expect(pc.baseManufacturingCentsPerUnit).toBeNull();
    }
  });

  it("reports a configured cost model when one is supplied (test-only fixture)", () => {
    const costs = assessCostReadiness({
      version: "test-fixture-pi",
      products: {
        "p-test": {
          baseManufacturingCentsPerUnit: 20,
          sizeAdjustmentCentsPerUnit: { m: 0 },
          materialAdjustmentCentsPerUnit: { standard: 0 },
          printing: { "one-color": { centsPerUnit: 2, setupFeeCents: 5000 } },
          packagingCentsPerUnit: 1,
          shipping: { kind: "per_unit", centsPerUnit: 3 },
          otherVariableCentsPerUnit: 0,
        },
      },
      orderCosts: { packagingCentsPerOrder: 0, handlingCentsPerOrder: 0 },
      paymentFee: { percentBps: 290, fixedCents: 30 },
      shippingPolicy: { customerCharge: { kind: "not_collected" } },
      marginPolicy: {
        minimumGrossMarginBps: 3000,
        minimumContributionMarginBps: 1500,
        targetGrossMarginBps: 4000,
        targetContributionMarginBps: 2500,
      },
    });
    expect(costs.costModelConfigured).toBe(true);
    expect(costs.marginPolicyConfigured).toBe(true);
    expect(costs.grossMarginAvailable).toBe(true);
    expect(costs.missingConfiguration).toHaveLength(0);
  });

  it("reports price-movement limits as missing, never as no limit", () => {
    const limits = assessPriceLimits();
    expect(limits.every((l) => !l.configured && l.value === null)).toBe(true);
    expect(GUARDRAIL_LIMITS.maximumPriceDecreasePct).toBeNull();
    expect(GUARDRAIL_LIMITS.maximumPriceIncreasePct).toBeNull();
  });
});

describe("price elasticity is not estimable and no number is produced", () => {
  it("returns a refusal with a plain-language reason", () => {
    const elasticity = assessElasticity(0);
    expect(elasticity.estimable).toBe(false);
    expect(elasticity.controlledPriceVariationSources).toBe(0);
    expect(elasticity.reason).toMatch(/never shown two different prices/);
    expect(elasticity.requirements.length).toBeGreaterThan(0);
    // There is no coefficient field at all.
    expect(Object.keys(elasticity)).not.toContain("coefficient");
    expect(Object.keys(elasticity)).not.toContain("value");
  });

  it("still refuses when controlled variation exists but no method is implemented", () => {
    const elasticity = assessElasticity(3);
    expect(elasticity.estimable).toBe(false);
    expect(elasticity.reason).toMatch(/no causal estimation method/);
  });
});

describe("PricingReadiness", () => {
  const readiness = () =>
    assessPricingReadiness({
      costs: assessCostReadiness(),
      limits: assessPriceLimits(),
      hasBehavioralEvidence: true,
      priceExperimentSupported: PRICE_EXPERIMENT_SUPPORTED,
    });

  it("allows a review, blocks a specific price change, and never supports automation", () => {
    const r = readiness();
    expect(r.PRICING_REVIEW.state).toBe("AVAILABLE");
    expect(r.SPECIFIC_PRICE_CHANGE.state).toBe("BLOCKED");
    expect(r.SPECIFIC_PRICE_CHANGE.blockers.some((b) => b.includes("config/costs.ts"))).toBe(true);
    expect(r.SPECIFIC_PRICE_CHANGE.blockers.some((b) => b.includes("maximumPriceDecreasePct"))).toBe(true);
    expect(r.PRICE_EXPERIMENT.state).toBe("BLOCKED");
    expect(r.AUTOMATED_PRICE_CHANGE.state).toBe("NOT_SUPPORTED");
  });

  it("blocks a review when no pricing evidence exists at all", () => {
    const r = assessPricingReadiness({
      costs: assessCostReadiness(),
      limits: assessPriceLimits(),
      hasBehavioralEvidence: false,
      priceExperimentSupported: false,
    });
    expect(r.PRICING_REVIEW.state).toBe("BLOCKED");
  });

  it("keeps price experiments unsupported by the experiment engine (spec §30)", () => {
    expect(PRICE_EXPERIMENT_SUPPORTED).toBe(false);
    expect(readiness().PRICE_EXPERIMENT.reason).toMatch(/does not support real price variants/);
  });
});

/* ------------------------------------------------------------------ */
/* Snapshot assembly + trends (spec §33–§35)                           */
/* ------------------------------------------------------------------ */

describe("PricingIntelligenceSnapshot", () => {
  it("assembles every section without any AI configuration", async () => {
    const s = await makeSession();
    await seedPricingSession(s.id, { quantity: 5000, cart: true, purchase: true });
    await seedOrder(s.id, { quantity: 5000 });

    const snapshot = await buildPricingIntelligenceSnapshot(period());
    expect(snapshot.funnel.priceViewSessions).toBe(1);
    expect(snapshot.demand.purchased.units).toBe(5000);
    expect(snapshot.tiers.rows.length).toBeGreaterThan(0);
    expect(snapshot.readiness.AUTOMATED_PRICE_CHANGE.state).toBe("NOT_SUPPORTED");
    expect(snapshot.elasticity.estimable).toBe(false);
    expect(snapshot.dataQuality.map((w) => w.code)).toContain("COST_MODEL_UNCONFIGURED");
    expect(snapshot.dataQuality.map((w) => w.code)).toContain("NO_CONTROLLED_PRICE_VARIATION");
    // Product margin is unavailable — never a number, never 0.
    expect(snapshot.products.rows.every((r) => r.grossMargin.available === false)).toBe(true);
  });

  it("uses explicit trend states instead of an infinite percentage", async () => {
    const s = await makeSession();
    await seedPricingSession(s.id);
    const snapshot = await buildPricingIntelligenceSnapshot(period());
    const trend = snapshot.trends.find((t) => t.name === "price_view_sessions")!;
    expect(trend.trend.state).toBe("NEW_ACTIVITY");
    expect(trend.trend.changePct).toBeNull();
    expect(snapshot.trends.every((t) => t.trend.changePct === null || Number.isFinite(t.trend.changePct))).toBe(true);
  });

  it("is JSON-serializable and free of contact PII", async () => {
    const s = await makeSession();
    await seedRequestedQuantity(s.id, 5000, "USER_STATED", { businessType: "cafe" });
    const { conversation, messages } = await seedConversation(s.id, ["Email me at owner@example.com — too expensive."]);
    await seedClassification(conversation.id, { objections: [{ type: "PRICE_TOO_HIGH", messageId: messages[0].id }] });

    const snapshot = await buildPricingIntelligenceSnapshot(period());
    const json = JSON.stringify(snapshot);
    expect(json).not.toMatch(/owner@example\.com/);
    expect(json).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});

/* ------------------------------------------------------------------ */
/* Descriptive breakdowns (spec §16, §18, §19)                         */
/* ------------------------------------------------------------------ */

describe("segment, attribution and AI-sales pricing signals", () => {
  it("gates segment rows below the sample floor and never attaches a price to one", async () => {
    for (let i = 0; i < 6; i += 1) {
      const s = await makeSession();
      await seedRequestedQuantity(s.id, 500, "USER_STATED", { businessType: "cafe" });
      const { conversation, messages } = await seedConversation(s.id, ["How much?"]);
      await seedClassification(conversation.id, { questions: [{ theme: "PRICE", messageId: messages[0].id }] });
    }
    const lonely = await makeSession();
    await seedRequestedQuantity(lonely.id, 500, "USER_STATED", { businessType: "bakery" });
    const { conversation, messages } = await seedConversation(lonely.id, ["How much?"]);
    await seedClassification(conversation.id, { questions: [{ theme: "PRICE", messageId: messages[0].id }] });

    const snapshot = await buildPricingIntelligenceSnapshot(period());
    expect(snapshot.segments.map((s) => s.segment)).toContain("cafe");
    expect(snapshot.segments.map((s) => s.segment)).not.toContain("bakery");
    // No segment row carries anything price-like.
    for (const segment of snapshot.segments) {
      expect(Object.keys(segment)).not.toContain("unitPriceCents");
      expect(Object.keys(segment)).not.toContain("suggestedPriceCents");
    }
  });

  it("counts AI-sales pricing conversions from real session events", async () => {
    const s = await makeSession();
    await seedPricingSession(s.id, { cart: true, purchase: true });
    const { conversation, messages } = await seedConversation(s.id, ["How much for 5,000?"]);
    await seedClassification(conversation.id, { questions: [{ theme: "PRICE", messageId: messages[0].id }] });

    const snapshot = await buildPricingIntelligenceSnapshot(period());
    expect(snapshot.aiSales.conversationsReachingPricing).toBe(1);
    expect(snapshot.aiSales.priceConversationsWithCartAdd).toBe(1);
    expect(snapshot.aiSales.priceConversationsWithPurchase).toBe(1);
  });
});
