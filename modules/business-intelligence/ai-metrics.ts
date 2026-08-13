import { aiUsageAggregatesBetween, type AiUsageAggregate } from "@/lib/data/business-intelligence-service";
import { countEventsByName } from "@/lib/data/intelligence-service";
import type { ConversationCorpus } from "@/modules/customer-intelligence/aggregate";
import type { Period } from "@/modules/customer-intelligence/period";
import { available, partial, ratio, unavailable, type Metric, type Ratio } from "./availability";

/**
 * AI Sales performance + AI cost metrics (Session 09 spec §7–§8).
 *
 * Attribution stays conservative (Session 07 semantics): AI-assisted
 * purchases/revenue use the order-level aiAssisted flag — a sales
 * conversation plus at least one MATERIAL ai_* commerce event. A loaded
 * chat widget never counts.
 *
 * Cost honesty: AiUsage rows record cost ONLY when the model was priced
 * in config/ai-pricing.ts at call time. Unpriced calls are counted and
 * surfaced — spend is PARTIAL when some calls are unpriced and
 * UNAVAILABLE when none are priced. Unknown token pricing is never
 * treated as $0.
 */

export type CostBucket = {
  key: string;
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  spendMicros: Metric<number>;
  unpricedCalls: number;
};

export type AiCostMetrics = {
  totalCalls: number;
  failedCalls: number;
  unpricedCalls: number;
  spendMicros: Metric<number>;
  byProvider: CostBucket[];
  byModel: CostBucket[];
  byAgent: CostBucket[];
};

const UNPRICED_REASON =
  "AI model pricing is not configured (config/ai-pricing.ts) — call costs were not recorded and are not assumed to be zero.";

function spendMetric(pricedMicros: number, unpriced: number, calls: number): Metric<number> {
  if (calls === 0) return available(0);
  if (unpriced === 0) return available(pricedMicros);
  if (unpriced === calls) return unavailable(UNPRICED_REASON, ["config/ai-pricing.ts"]);
  return partial(
    pricedMicros,
    `${unpriced} of ${calls} calls have no recorded cost (model pricing missing at call time) — the total covers priced calls only.`,
    ["config/ai-pricing.ts"],
  );
}

function bucketize(rows: AiUsageAggregate[], keyOf: (r: AiUsageAggregate) => string): CostBucket[] {
  const map = new Map<string, { calls: number; failed: number; inTok: number; outTok: number; priced: number; unpriced: number }>();
  for (const r of rows) {
    const key = keyOf(r);
    const b = map.get(key) ?? { calls: 0, failed: 0, inTok: 0, outTok: 0, priced: 0, unpriced: 0 };
    b.calls += r.calls;
    b.failed += r.failedCalls;
    b.inTok += r.inputTokens;
    b.outTok += r.outputTokens;
    b.priced += r.pricedCostMicros;
    b.unpriced += r.unpricedCalls;
    map.set(key, b);
  }
  return [...map.entries()]
    .map(([key, b]) => ({
      key,
      calls: b.calls,
      failedCalls: b.failed,
      inputTokens: b.inTok,
      outputTokens: b.outTok,
      spendMicros: spendMetric(b.priced, b.unpriced, b.calls),
      unpricedCalls: b.unpriced,
    }))
    .sort((a, b) => b.calls - a.calls);
}

export function computeAiCostMetrics(rows: AiUsageAggregate[]): AiCostMetrics {
  const totalCalls = rows.reduce((s, r) => s + r.calls, 0);
  const failedCalls = rows.reduce((s, r) => s + r.failedCalls, 0);
  const unpricedCalls = rows.reduce((s, r) => s + r.unpricedCalls, 0);
  const pricedMicros = rows.reduce((s, r) => s + r.pricedCostMicros, 0);
  return {
    totalCalls,
    failedCalls,
    unpricedCalls,
    spendMicros: spendMetric(pricedMicros, unpricedCalls, totalCalls),
    byProvider: bucketize(rows, (r) => r.provider),
    byModel: bucketize(rows, (r) => r.model),
    byAgent: bucketize(rows, (r) => r.agentType ?? "(untagged)"),
  };
}

export type AiSalesMetrics = {
  conversations: number;
  qualifiedConversations: number;
  /** Conversations whose funnel outcome reached `purchased` (S06/S07 stamping). */
  purchasedConversations: number;
  assistedCartAddSessions: number;
  assistedCheckoutStartSessions: number;
  /** Order-level conservative flag — the authoritative AI-assisted counts. */
  assistedOrders: number;
  conversationPurchaseRate: Ratio;
  /** Spend micros ÷ conversations; inherits the spend metric's availability. */
  costPerConversationMicros: Metric<number>;
  costPerAssistedOrderMicros: Metric<number>;
};

function divideSpend(spend: Metric<number>, denominator: number, denominatorLabel: string): Metric<number> {
  if (denominator <= 0) return unavailable(`No ${denominatorLabel} in this period.`);
  if (spend.status === "UNAVAILABLE") return spend;
  const value = Math.round(spend.value / denominator);
  return spend.status === "PARTIAL" ? partial(value, spend.reason, spend.missingInputs) : available(value);
}

/**
 * Assemble AI Sales performance for the period. `corpus` supplies the S08
 * conversation facts (qualified rule, outcomes); event/order counts and
 * usage aggregates are period-bounded SQL.
 */
export async function loadAiSalesMetrics(
  period: Period,
  corpus: ConversationCorpus,
  assistedOrders: number,
): Promise<{ sales: AiSalesMetrics; cost: AiCostMetrics }> {
  const [eventCounts, usageRows] = await Promise.all([
    countEventsByName(period.start, period.end),
    aiUsageAggregatesBetween(period.start, period.end),
  ]);
  const byName = new Map(eventCounts.map((c) => [c.name, c]));
  const cost = computeAiCostMetrics(usageRows);

  const purchasedConversations = corpus.facts.filter((f) => f.purchased).length;
  const salesSpendRows = usageRows.filter((r) => r.agentType === "sales");
  const salesSpend = spendMetric(
    salesSpendRows.reduce((s, r) => s + r.pricedCostMicros, 0),
    salesSpendRows.reduce((s, r) => s + r.unpricedCalls, 0),
    salesSpendRows.reduce((s, r) => s + r.calls, 0),
  );

  const sales: AiSalesMetrics = {
    conversations: corpus.totals.conversations,
    qualifiedConversations: corpus.totals.qualified,
    purchasedConversations,
    assistedCartAddSessions: byName.get("ai_add_to_cart_requested")?.sessions ?? 0,
    assistedCheckoutStartSessions: byName.get("ai_checkout_requested")?.sessions ?? 0,
    assistedOrders,
    conversationPurchaseRate: ratio(purchasedConversations, corpus.totals.qualified),
    costPerConversationMicros: divideSpend(salesSpend, corpus.totals.conversations, "AI conversations"),
    costPerAssistedOrderMicros: divideSpend(salesSpend, assistedOrders, "AI-assisted orders"),
  };
  return { sales, cost };
}
