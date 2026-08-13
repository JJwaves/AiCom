import { beforeEach, describe, expect, it } from "vitest";
import { upsertActiveConfiguration } from "@/lib/data/configuration-service";
import { applyNeedProfileUpdate } from "@/lib/data/customer-need-service";
import { recordServerEvent } from "@/lib/data/event-service";
import { createOrder } from "@/lib/data/order-service";
import {
  aggregateObjections,
  aggregateQuestions,
  aggregateRequests,
  buildCustomerIntelligenceReport,
  conversionAssociations,
  loadConversationCorpus,
  loadDemandSignals,
  loadFunnelMetrics,
  periodFromDays,
  productGaps,
} from "@/modules/customer-intelligence";
import { makeSession, resetDb } from "./db-helpers";
import {
  seedClassification,
  seedConversation,
  setConversationOutcome,
  setConversationStartedAt,
  setSessionFirstTouch,
} from "./ci-helpers";

/**
 * Session 08 — deterministic aggregation: conversation-level dedup, period
 * windows, honest denominators, demand-lane separation, funnel counts, and
 * descriptive (never causal) associations. No model anywhere: these tests
 * seed classification rows directly, exactly as a past validated run
 * would have.
 */

beforeEach(async () => {
  await resetDb();
});

const period30 = () => periodFromDays(30);

const config = (quantity: number, overrides: Partial<Record<string, string>> = {}) => ({
  productId: "p-custom-takeout",
  sizeId: overrides.sizeId ?? "l",
  materialId: "standard",
  colorId: overrides.colorId ?? "black",
  printOptionId: (overrides.printOptionId ?? "one-color") as "none" | "one-color" | "two-color" | "full-custom",
  quantity,
  artwork: null,
});

describe("conversation-level deduplication (§8)", () => {
  it("counts one conversation with a shipping question, not four demand signals", async () => {
    const session = await makeSession();
    const { conversation, messages } = await seedConversation(session.id, [
      "How long does shipping take?",
      "Sorry — shipping to Boston, how long?",
      "And shipping time to Canada?",
      "Just to confirm the shipping time?",
    ]);
    await seedClassification(conversation.id, {
      questions: messages.map((m) => ({ theme: "DELIVERY_TIME", messageId: m.id })),
    });

    const corpus = await loadConversationCorpus(period30());
    const [agg] = aggregateQuestions(corpus);
    expect(agg.theme).toBe("DELIVERY_TIME");
    expect(agg.conversations).toBe(1);
    expect(agg.mentions).toBe(4);
  });
});

describe("question vs objection stay separate in aggregation (§5)", () => {
  it("Restaurant D asks about MOQ and purchases — a question, never an objection", async () => {
    // Restaurant B: MOQ question AND a real MOQ objection, no purchase.
    const b = await makeSession();
    const convB = await seedConversation(b.id, ["What is your MOQ?", "500 is too many. I only need 300."]);
    await applyNeedProfileUpdate(b.id, { quantity: 300 }, "USER_STATED");
    await seedClassification(convB.conversation.id, {
      questions: [{ theme: "MOQ", messageId: convB.messages[0].id }],
      objections: [{ type: "MOQ_TOO_HIGH", messageId: convB.messages[1].id }],
    });

    // Restaurant D: asks "what is MOQ?" and buys 5,000 — question only.
    const d = await makeSession();
    const convD = await seedConversation(d.id, ["What is your MOQ?"]);
    await applyNeedProfileUpdate(d.id, { quantity: 5000 }, "USER_STATED");
    await seedClassification(convD.conversation.id, {
      questions: [{ theme: "MOQ", messageId: convD.messages[0].id }],
    });
    await setConversationOutcome(convD.conversation.id, "purchased");

    const corpus = await loadConversationCorpus(period30());
    const moqQuestions = aggregateQuestions(corpus).find((q) => q.theme === "MOQ");
    const moqObjections = aggregateObjections(corpus).find((o) => o.type === "MOQ_TOO_HIGH");

    expect(moqQuestions?.conversations).toBe(2);
    expect(moqObjections?.conversations).toBe(1);
    expect(moqObjections?.conversationIds).toEqual([convB.conversation.id]);
    // D's purchase shows up on the question side without creating an objection.
    expect(moqQuestions?.qualifiedPurchased).toBe(1);
  });
});

describe("period filtering (§13)", () => {
  it("only counts conversations started inside the window", async () => {
    const session = await makeSession();
    const recent = await seedConversation(session.id, ["Recent question"]);
    await seedClassification(recent.conversation.id, {
      questions: [{ theme: "PRICE", messageId: recent.messages[0].id }],
    });

    const old = await seedConversation((await makeSession()).id, ["Old question"]);
    await seedClassification(old.conversation.id, {
      questions: [{ theme: "PRICE", messageId: old.messages[0].id }],
    });
    await setConversationStartedAt(old.conversation.id, new Date(Date.now() - 60 * 24 * 3600 * 1000));

    const corpus30 = await loadConversationCorpus(periodFromDays(30));
    expect(corpus30.totals.conversations).toBe(1);
    const corpus90 = await loadConversationCorpus(periodFromDays(90));
    expect(corpus90.totals.conversations).toBe(2);
  });
});

describe("qualified denominator + corpus totals (§9, §14)", () => {
  it("qualifies via events, outcomes, or trustworthy need provenance — not via chat alone", async () => {
    const chatty = await makeSession();
    await seedConversation(chatty.id, ["hello there"]);

    const pricing = await makeSession();
    await seedConversation(pricing.id, ["how much?"]);
    await recordServerEvent({ sessionId: pricing.id, name: "price_viewed" });

    const stated = await makeSession();
    await seedConversation(stated.id, ["I need bags"]);
    await applyNeedProfileUpdate(stated.id, { quantity: 1000 }, "USER_STATED");

    const inferred = await makeSession();
    await seedConversation(inferred.id, ["nice bags"]);
    await applyNeedProfileUpdate(inferred.id, { quantity: 1000 }, "AI_INFERRED");

    const corpus = await loadConversationCorpus(period30());
    expect(corpus.totals.conversations).toBe(4);
    expect(corpus.totals.qualified).toBe(2); // price_viewed + USER_STATED quantity
  });
});

describe("demand lanes stay separate (§6, §7)", () => {
  it("splits requested (stated vs inferred) from configured and purchased", async () => {
    // REQUESTED: two profiles say insulated-adjacent things; one is only inferred.
    const s1 = await makeSession();
    await seedConversation(s1.id, ["I want kraft bags, 300 of them"]);
    await applyNeedProfileUpdate(s1.id, { colorPreference: "kraft", quantity: 300 }, "USER_STATED");
    const s2 = await makeSession();
    await seedConversation(s2.id, ["maybe navy?"]);
    await applyNeedProfileUpdate(s2.id, { colorPreference: "navy" }, "AI_INFERRED");

    // CONFIGURED: one real configurator row at 1,000.
    const s3 = await makeSession();
    await upsertActiveConfiguration({ sessionId: s3.id, productId: "p-custom-takeout", config: config(1000), source: "configurator" });

    // PURCHASED: one order line at 5,000.
    const s4 = await makeSession();
    await createOrder({
      sessionId: s4.id,
      provider: "mock",
      currency: "USD",
      lines: [
        {
          productId: "p-custom-takeout",
          quantity: 5000,
          unitPriceCents: 42,
          totalCents: 210000,
          title: "Custom bags",
          config: config(5000, { colorId: "white" }),
        },
      ],
    });

    const demand = await loadDemandSignals(period30());

    const kraft = demand.requested.colors.find((c) => c.value === "kraft");
    const navy = demand.requested.colors.find((c) => c.value === "navy");
    expect(kraft).toMatchObject({ stated: 1, inferred: 0 });
    expect(navy).toMatchObject({ stated: 0, inferred: 1 });
    expect(demand.requested.belowMoq).toMatchObject({ stated: 1, inferred: 0 });

    expect(demand.configured.configurations).toBe(1);
    expect(demand.configured.volumeGroups).toEqual([{ value: "standard_small", count: 1 }]);

    expect(demand.purchased.orders).toBe(1);
    expect(demand.purchased.volumeGroups).toEqual([{ value: "standard_medium", count: 1 }]);
    expect(demand.purchased.colors).toEqual([{ value: "white", count: 1 }]);

    // 20-requests / 0-configured / 0-purchased stays visible as unmet demand:
    // the lanes never merge, so kraft appearing in "requested" does not leak
    // into "purchased" (which only shows white).
    expect(demand.purchased.colors.find((c) => c.value === "kraft")).toBeUndefined();
  });
});

describe("unsupported requests → product gaps (§20)", () => {
  it("aggregates catalog-unsupported requests with conversation dedup", async () => {
    for (let i = 0; i < 2; i += 1) {
      const s = await makeSession();
      const { conversation, messages } = await seedConversation(s.id, ["Do you sell insulated bags?", "really need insulated ones"]);
      await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
      await seedClassification(conversation.id, {
        requests: messages.map((m) => ({ kind: "product", normalized: "insulated bag", messageId: m.id, support: "unsupported" })),
      });
    }
    const corpus = await loadConversationCorpus(period30());
    const gaps = productGaps(aggregateRequests(corpus));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ normalized: "insulated bag", conversations: 2, mentions: 4, qualifiedConversations: 2 });
  });
});

describe("AI-assisted funnel (§25)", () => {
  it("counts stages from real events and purchases from the orders table", async () => {
    const s = await makeSession();
    await recordServerEvent({ sessionId: s.id, name: "ai_chat_started" });
    await recordServerEvent({ sessionId: s.id, name: "ai_chat_started" }); // second event, same session
    await recordServerEvent({ sessionId: s.id, name: "ai_product_recommended" });
    await createOrder({
      sessionId: s.id,
      provider: "mock",
      currency: "USD",
      aiAssisted: true,
      lines: [{ productId: "p-custom-takeout", quantity: 1000, unitPriceCents: 54, totalCents: 54000, title: "Bags", config: config(1000) }],
    });
    await createOrder({
      sessionId: (await makeSession()).id,
      provider: "mock",
      currency: "USD",
      lines: [{ productId: "p-custom-takeout", quantity: 1000, unitPriceCents: 54, totalCents: 54000, title: "Bags", config: config(1000) }],
    });

    const funnel = await loadFunnelMetrics(period30());
    const chat = funnel.stages.find((x) => x.name === "ai_chat_started");
    expect(chat).toMatchObject({ sessions: 1, events: 2 });
    expect(funnel.purchases).toEqual({ total: 2, aiAssisted: 1 });
  });
});

describe("conversion associations are gated and descriptive (§24)", () => {
  it("emits an association only when both cells reach the minimum sample", async () => {
    // 5 qualified conversations WITH a shipping question (1 purchased),
    // 5 WITHOUT (4 purchased).
    for (let i = 0; i < 10; i += 1) {
      const s = await makeSession();
      const { conversation, messages } = await seedConversation(s.id, ["hello", "more context"]);
      await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
      const withShipping = i < 5;
      await seedClassification(conversation.id, {
        questions: withShipping ? [{ theme: "SHIPPING", messageId: messages[0].id }] : [],
      });
      const purchased = withShipping ? i === 0 : i >= 6;
      if (purchased) await setConversationOutcome(conversation.id, "purchased");
    }
    const corpus = await loadConversationCorpus(period30());
    const assoc = conversionAssociations(corpus).find((a) => a.dimension === "question" && a.key === "SHIPPING");
    expect(assoc).toBeDefined();
    expect(assoc!.with).toEqual({ conversations: 5, purchased: 1 });
    expect(assoc!.without).toEqual({ conversations: 5, purchased: 4 });
  });

  it("stays silent below the minimum cell size", async () => {
    const s = await makeSession();
    const { conversation, messages } = await seedConversation(s.id, ["shipping?"]);
    await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
    await seedClassification(conversation.id, { questions: [{ theme: "SHIPPING", messageId: messages[0].id }] });
    const corpus = await loadConversationCorpus(period30());
    expect(conversionAssociations(corpus)).toEqual([]);
  });
});

describe("report: trends, attribution, denominators (§27–§28)", () => {
  it("labels a trend only against a meaningful previous-period base", async () => {
    const now = Date.now();
    // Previous period: 5 conversations with MOQ questions; current: 10.
    for (let i = 0; i < 15; i += 1) {
      const s = await makeSession();
      const { conversation, messages } = await seedConversation(s.id, ["What is your MOQ?"]);
      await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
      await seedClassification(conversation.id, { questions: [{ theme: "MOQ", messageId: messages[0].id }] });
      if (i < 5) {
        await setConversationStartedAt(conversation.id, new Date(now - 45 * 24 * 3600 * 1000));
      }
    }
    const report = await buildCustomerIntelligenceReport(periodFromDays(30));
    const moq = report.questions.find((q) => q.theme === "MOQ");
    expect(moq?.conversations).toBe(10);
    expect(moq?.previousConversations).toBe(5);
    expect(moq?.trendPct).toBe(100);
    // Percentage carries its denominator (10 of 10 qualified classified).
    expect(report.overview.qualifiedClassified).toBe(10);
    expect(moq?.percentage).toBe(100);
  });

  it("keeps attribution segments above the sample floor and free of click ids", async () => {
    for (let i = 0; i < 5; i += 1) {
      const s = await makeSession();
      await setSessionFirstTouch(s.id, { utm_source: "google", utm_medium: "cpc", gclid: "SECRET-CLICK-ID" });
      const { conversation, messages } = await seedConversation(s.id, ["What is your MOQ?"]);
      await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
      await seedClassification(conversation.id, { questions: [{ theme: "MOQ", messageId: messages[0].id }] });
    }
    const single = await makeSession();
    await setSessionFirstTouch(single.id, { utm_source: "bing" });
    const c = await seedConversation(single.id, ["hi"]);
    await recordServerEvent({ sessionId: single.id, name: "price_viewed" });
    await seedClassification(c.conversation.id, {});

    const report = await buildCustomerIntelligenceReport(periodFromDays(30));
    expect(report.attribution).toHaveLength(1);
    expect(report.attribution[0]).toMatchObject({ key: "google / cpc", conversations: 5, moqQuestionConversations: 5 });
    expect(JSON.stringify(report.attribution)).not.toContain("SECRET-CLICK-ID");
  });

  it("suppresses percentages under the minimum denominator", async () => {
    const s = await makeSession();
    const { conversation, messages } = await seedConversation(s.id, ["What is your MOQ?"]);
    await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
    await seedClassification(conversation.id, { questions: [{ theme: "MOQ", messageId: messages[0].id }] });
    const report = await buildCustomerIntelligenceReport(periodFromDays(30));
    const moq = report.questions.find((q) => q.theme === "MOQ");
    expect(moq?.conversations).toBe(1);
    expect(moq?.percentage).toBeNull(); // 1 of 1 — denominator too small to claim a rate
    expect(report.overview.purchaseRate.percentage).toBeNull();
  });
});
