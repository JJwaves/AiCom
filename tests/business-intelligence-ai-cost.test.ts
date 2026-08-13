import { beforeEach, describe, expect, it } from "vitest";
import { recordAiUsage } from "@/lib/data/ai-usage-service";
import { aiUsageAggregatesBetween } from "@/lib/data/business-intelligence-service";
import { createOrder } from "@/lib/data/order-service";
import { recordServerEvent } from "@/lib/data/event-service";
import { loadConversationCorpus, periodFromDays } from "@/modules/customer-intelligence";
import { computeAiCostMetrics, loadAiSalesMetrics } from "@/modules/business-intelligence";
import { makeSession, resetDb } from "./db-helpers";
import { seedConversation, setConversationOutcome } from "./ci-helpers";

/**
 * Session 09 §7–§8 — AI cost honesty. AiUsage rows only carry a cost when
 * the model was priced at call time (config/ai-pricing.ts ships null), so
 * spend must surface as UNAVAILABLE/PARTIAL — an unpriced call is never
 * $0. AI-assisted purchase metrics preserve S07's conservative semantics.
 */

beforeEach(async () => {
  await resetDb();
});

// End the window slightly in the future: DB rows are stamped with microsecond
// precision, so a same-millisecond JS Date can exclude a just-created row.
const period30 = () => periodFromDays(30, new Date(Date.now() + 60_000));

const usage = (over: Partial<Parameters<typeof recordAiUsage>[0]> = {}) =>
  recordAiUsage({
    provider: "anthropic",
    model: "claude-sonnet-5",
    requestType: "tool_conversation",
    agentType: "sales",
    inputTokens: 1000,
    outputTokens: 200,
    success: true,
    ...over,
  });

describe("AI spend availability (§8)", () => {
  it("is UNAVAILABLE when no call has a recorded cost (pricing unconfigured)", async () => {
    await usage();
    await usage();
    const cost = computeAiCostMetrics(await aiUsageAggregatesBetween(period30().start, period30().end));
    expect(cost.totalCalls).toBe(2);
    expect(cost.unpricedCalls).toBe(2);
    expect(cost.spendMicros.status).toBe("UNAVAILABLE");
    expect(cost.spendMicros.status === "UNAVAILABLE" && cost.spendMicros.reason).toContain("config/ai-pricing.ts");
  });

  it("is PARTIAL when only some calls were priced, and AVAILABLE when all were", async () => {
    await usage({ estimatedCostMicros: 1500 });
    await usage(); // unpriced
    let cost = computeAiCostMetrics(await aiUsageAggregatesBetween(period30().start, period30().end));
    expect(cost.spendMicros.status).toBe("PARTIAL");
    expect(cost.spendMicros.status === "PARTIAL" && cost.spendMicros.value).toBe(1500);

    await resetDb();
    await usage({ estimatedCostMicros: 1500 });
    await usage({ estimatedCostMicros: 2500, model: "claude-haiku-4-5", agentType: "customer_intelligence" });
    cost = computeAiCostMetrics(await aiUsageAggregatesBetween(period30().start, period30().end));
    expect(cost.spendMicros).toEqual({ status: "AVAILABLE", value: 4000 });
    expect(cost.byModel.map((b) => b.key).sort()).toEqual(["claude-haiku-4-5", "claude-sonnet-5"]);
    expect(cost.byAgent.find((b) => b.key === "sales")?.spendMicros).toEqual({ status: "AVAILABLE", value: 1500 });
    expect(cost.byProvider[0]).toMatchObject({ key: "anthropic", calls: 2 });
  });

  it("reports zero spend as a real zero only when there were zero calls", async () => {
    const cost = computeAiCostMetrics(await aiUsageAggregatesBetween(period30().start, period30().end));
    expect(cost.totalCalls).toBe(0);
    expect(cost.spendMicros).toEqual({ status: "AVAILABLE", value: 0 });
  });
});

describe("AI sales performance (§7)", () => {
  it("computes conversation→purchase and cost-per denominators with conservative aiAssisted semantics", async () => {
    // 5 qualified conversations, 1 purchased outcome; 1 conservative AI-assisted order.
    for (let i = 0; i < 5; i += 1) {
      const s = await makeSession();
      const { conversation } = await seedConversation(s.id, ["What is your MOQ?"]);
      await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
      if (i === 0) {
        await setConversationOutcome(conversation.id, "purchased");
        await recordServerEvent({ sessionId: s.id, name: "ai_add_to_cart_requested" });
        await createOrder({
          sessionId: s.id,
          provider: "mock",
          currency: "USD",
          aiAssisted: true,
          lines: [
            {
              productId: "p-custom-takeout",
              quantity: 1000,
              unitPriceCents: 54,
              totalCents: 54_000,
              title: "Bags",
              config: {
                productId: "p-custom-takeout",
                sizeId: "l",
                materialId: "standard",
                colorId: "black",
                printOptionId: "one-color",
                quantity: 1000,
                artwork: null,
              },
            },
          ],
        });
      }
    }
    await usage({ estimatedCostMicros: 10_000 });

    const corpus = await loadConversationCorpus(period30());
    const { sales } = await loadAiSalesMetrics(period30(), corpus, 1);

    expect(sales.conversations).toBe(5);
    expect(sales.qualifiedConversations).toBe(5);
    expect(sales.purchasedConversations).toBe(1);
    expect(sales.assistedOrders).toBe(1);
    expect(sales.assistedCartAddSessions).toBe(1);
    expect(sales.conversationPurchaseRate).toMatchObject({ numerator: 1, denominator: 5, percentage: 20 });
    // Sales spend is fully priced here → cost per conversation available.
    expect(sales.costPerConversationMicros).toEqual({ status: "AVAILABLE", value: 2_000 });
    expect(sales.costPerAssistedOrderMicros).toEqual({ status: "AVAILABLE", value: 10_000 });
  });

  it("keeps cost-per metrics honest when spend is unpriced or the denominator is zero", async () => {
    const s = await makeSession();
    await seedConversation(s.id, ["hello"]);
    await usage(); // unpriced sales call

    const corpus = await loadConversationCorpus(period30());
    const { sales } = await loadAiSalesMetrics(period30(), corpus, 0);
    expect(sales.costPerConversationMicros.status).toBe("UNAVAILABLE"); // unpriced ≠ $0
    expect(sales.costPerAssistedOrderMicros.status).toBe("UNAVAILABLE"); // no denominator
  });
});
