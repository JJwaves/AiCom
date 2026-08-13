import { BUSINESS_INTELLIGENCE } from "@/config/business-intelligence";
import { listNeedProfilesForSessionIds } from "@/lib/data/intelligence-service";
import type { OrderRow } from "@/lib/data/order-service";
import type { ConversationCorpus } from "@/modules/customer-intelligence/aggregate";
import { ratio, type Ratio } from "./availability";
import { isCountedOrder } from "./revenue";

/**
 * Business-segment metrics (Session 09 spec §11) — descriptive performance
 * by the customer's BUSINESS TYPE (restaurant, cafe, bakery, catering, …)
 * exactly as recorded on need profiles. Never sensitive personal
 * characteristics; unknown stays "unknown". Question/objection patterns
 * per segment live on the Customer Intelligence page (S08) — this view is
 * the commerce side.
 */

export type SegmentMetrics = {
  /** Lowercased businessType from need profiles; "unknown" when absent. */
  key: string;
  qualifiedConversations: number;
  purchasedConversations: number;
  orders: number;
  revenueCents: number;
  aovCents: number | null;
  /** Purchased-outcome conversations ÷ qualified conversations. */
  conversationPurchaseRate: Ratio;
};

const segmentKey = (businessType: string | null | undefined): string =>
  (businessType ?? "unknown").toLowerCase().trim().slice(0, 60) || "unknown";

export async function computeSegmentMetrics(corpus: ConversationCorpus, orders: OrderRow[]): Promise<SegmentMetrics[]> {
  const counted = orders.filter(isCountedOrder);
  const orderSessionIds = [...new Set(counted.map((o) => o.sessionId).filter((s): s is string => s !== null))];
  const orderProfiles = await listNeedProfilesForSessionIds(orderSessionIds);
  const profileBySession = new Map(orderProfiles.map((p) => [p.sessionId, p]));

  type Acc = {
    qualified: number;
    purchased: number;
    orders: number;
    revenueCents: number;
  };
  const acc = new Map<string, Acc>();
  const bump = (key: string): Acc => {
    const a = acc.get(key) ?? { qualified: 0, purchased: 0, orders: 0, revenueCents: 0 };
    acc.set(key, a);
    return a;
  };

  for (const f of corpus.facts) {
    if (!f.qualified) continue;
    const a = bump(segmentKey(f.needProfile?.businessType));
    a.qualified += 1;
    if (f.purchased) a.purchased += 1;
  }
  for (const order of counted) {
    const profile = order.sessionId ? profileBySession.get(order.sessionId) : undefined;
    const a = bump(segmentKey(profile?.businessType));
    a.orders += 1;
    a.revenueCents += order.totalCents;
  }

  return [...acc.entries()]
    .map(([key, a]) => ({
      key,
      qualifiedConversations: a.qualified,
      purchasedConversations: a.purchased,
      orders: a.orders,
      revenueCents: a.revenueCents,
      aovCents: a.orders > 0 ? Math.round(a.revenueCents / a.orders) : null,
      conversationPurchaseRate: ratio(a.purchased, a.qualified),
    }))
    .filter(
      (s) =>
        s.orders > 0 || s.qualifiedConversations >= BUSINESS_INTELLIGENCE.MIN_SEGMENT_SAMPLE || s.key === "unknown",
    )
    .sort((a, b) => b.revenueCents - a.revenueCents || b.qualifiedConversations - a.qualifiedConversations);
}
