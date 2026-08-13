import { countEventsByName, countOrdersBetween } from "@/lib/data/intelligence-service";
import { countSessionsStartedBetween } from "@/lib/data/business-intelligence-service";
import type { Period } from "@/modules/customer-intelligence/period";
import { ratio, type Ratio } from "./availability";

/**
 * DETERMINISTIC business funnel (Session 09 spec §6).
 *
 * Stage counts are DISTINCT SESSIONS per first-party event name (raw event
 * counts kept alongside); purchases come from the authoritative orders
 * table, not from events (purchase_completed rows mirror order creation —
 * the order row is the source of truth). Denominator definitions are
 * explicit on every rate; percentages are suppressed below the documented
 * minimum denominator instead of rendering misleading numbers.
 */

export type FunnelStage = { name: string; label: string; sessions: number; events: number };

export type ConversionRate = {
  name: string;
  label: string;
  /** What the denominator counts — rendered with the rate, always. */
  denominatorDefinition: string;
  ratio: Ratio;
};

export type BusinessFunnel = {
  /** Sessions started in period (sessions table). */
  sessionsStarted: number;
  stages: FunnelStage[];
  purchases: { total: number; aiAssisted: number };
  rates: ConversionRate[];
};

const FUNNEL_STAGES: { name: string; label: string }[] = [
  { name: "product_viewed", label: "Product views" },
  { name: "ai_chat_started", label: "AI chats started" },
  { name: "configurator_started", label: "Configurator started" },
  { name: "configurator_updated", label: "Configurator updates" },
  { name: "price_viewed", label: "Price views" },
  { name: "add_to_cart", label: "Add to cart" },
  { name: "checkout_started", label: "Checkout started" },
  { name: "quote_started", label: "Quote started" },
  { name: "human_handoff_requested", label: "Human handoffs" },
];

export async function loadBusinessFunnel(period: Period): Promise<BusinessFunnel> {
  const [sessionsStarted, eventCounts, purchases] = await Promise.all([
    countSessionsStartedBetween(period.start, period.end),
    countEventsByName(period.start, period.end),
    countOrdersBetween(period.start, period.end),
  ]);
  const byName = new Map(eventCounts.map((c) => [c.name, c]));
  const stageSessions = (name: string) => byName.get(name)?.sessions ?? 0;

  const stages = FUNNEL_STAGES.map((s) => ({
    ...s,
    sessions: stageSessions(s.name),
    events: byName.get(s.name)?.events ?? 0,
  }));

  const rates: ConversionRate[] = [
    {
      name: "session_to_purchase",
      label: "Session → purchase",
      denominatorDefinition: "sessions started in period",
      ratio: ratio(purchases.total, sessionsStarted),
    },
    {
      name: "price_view_to_cart",
      label: "Price view → add to cart",
      denominatorDefinition: "distinct sessions with a price view",
      ratio: ratio(stageSessions("add_to_cart"), stageSessions("price_viewed")),
    },
    {
      name: "cart_to_checkout",
      label: "Add to cart → checkout started",
      denominatorDefinition: "distinct sessions with an add to cart",
      ratio: ratio(stageSessions("checkout_started"), stageSessions("add_to_cart")),
    },
    {
      name: "checkout_to_purchase",
      label: "Checkout started → purchase",
      denominatorDefinition: "distinct sessions that started checkout",
      ratio: ratio(purchases.total, stageSessions("checkout_started")),
    },
  ];

  return { sessionsStarted, stages, purchases, rates };
}
