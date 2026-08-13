import { BUSINESS_INTELLIGENCE } from "@/config/business-intelligence";
import type { Touch } from "@/lib/attribution/attribution";
import { listSessionsByIds, type SessionRowLite } from "@/lib/data/intelligence-service";
import { listSessionsStartedBetween } from "@/lib/data/business-intelligence-service";
import type { OrderRow } from "@/lib/data/order-service";
import type { Period } from "@/modules/customer-intelligence/period";
import { ratio, type Ratio } from "./availability";
import { isCountedOrder } from "./revenue";

/**
 * First-party attribution performance (Session 09 spec §13).
 *
 * Descriptive breakdowns only: sessions, orders, revenue, and purchase
 * conversion by first/last touch. NO ad-spend ingestion exists (spec §40),
 * so CAC and ROAS are structurally absent — nothing here fabricates cost.
 * Click ids (gclid & co) are never surfaced; only utm_source/utm_medium/
 * utm_campaign and the landing page appear (same posture as S08).
 *
 * Unit definitions:
 *  - sessions: sessions STARTED in the period, keyed by their own touch.
 *  - orders/revenue: orders CREATED in the period, keyed by the touch of
 *    their linked session (which may predate the period); orders without
 *    a session row count under "(no session)".
 *  - purchase conversion: orders ÷ sessions for the same key — rendered
 *    only when the session denominator meets the documented minimum.
 */

export type AttributionRow = {
  key: string;
  sessions: number;
  orders: number;
  revenueCents: number;
  purchaseRate: Ratio;
};

export type AttributionBreakdowns = {
  firstTouchSourceMedium: AttributionRow[];
  firstTouchCampaign: AttributionRow[];
  firstTouchLandingPage: AttributionRow[];
  lastTouchSourceMedium: AttributionRow[];
  /** Always true today — rendered as a data-quality note (no CAC/ROAS). */
  adSpendIntegrated: false;
};

const sourceMediumKey = (touch: Touch | null | undefined): string => {
  const params = touch?.params ?? {};
  const source = (params.utm_source ?? "direct/none").slice(0, 60);
  const medium = params.utm_medium ? ` / ${params.utm_medium.slice(0, 40)}` : "";
  return `${source}${medium}`;
};
const campaignKey = (touch: Touch | null | undefined): string =>
  (touch?.params?.utm_campaign ?? "(no campaign)").slice(0, 80);
const landingKey = (touch: Touch | null | undefined): string => (touch?.landing_page ?? "(unknown)").slice(0, 120);

type KeyFn = (session: SessionRowLite | undefined) => string;

function breakdown(
  sessions: SessionRowLite[],
  orders: OrderRow[],
  sessionById: Map<string, SessionRowLite>,
  keyOf: KeyFn,
): AttributionRow[] {
  const acc = new Map<string, { sessions: number; orders: number; revenueCents: number }>();
  const bump = (key: string) => {
    const a = acc.get(key) ?? { sessions: 0, orders: 0, revenueCents: 0 };
    acc.set(key, a);
    return a;
  };
  for (const s of sessions) bump(keyOf(s)).sessions += 1;
  for (const o of orders) {
    const session = o.sessionId ? sessionById.get(o.sessionId) : undefined;
    const a = bump(session ? keyOf(session) : "(no session)");
    a.orders += 1;
    a.revenueCents += o.totalCents;
  }
  return [...acc.entries()]
    .map(([key, a]) => ({
      key,
      sessions: a.sessions,
      orders: a.orders,
      revenueCents: a.revenueCents,
      purchaseRate: ratio(a.orders, a.sessions),
    }))
    .filter((r) => r.orders > 0 || r.sessions >= BUSINESS_INTELLIGENCE.MIN_ATTRIBUTION_SAMPLE)
    .sort((a, b) => b.revenueCents - a.revenueCents || b.sessions - a.sessions)
    .slice(0, BUSINESS_INTELLIGENCE.MAX_BREAKDOWN_ROWS);
}

export async function computeAttributionBreakdowns(period: Period, orders: OrderRow[]): Promise<AttributionBreakdowns> {
  const counted = orders.filter(isCountedOrder);
  const periodSessions = await listSessionsStartedBetween(period.start, period.end);
  const sessionById = new Map(periodSessions.map((s) => [s.id, s]));
  // Orders may belong to sessions that started before the period — fetch those too.
  const missingSessionIds = [
    ...new Set(
      counted
        .map((o) => o.sessionId)
        .filter((id): id is string => id !== null && !sessionById.has(id)),
    ),
  ];
  for (const s of await listSessionsByIds(missingSessionIds)) sessionById.set(s.id, s);

  return {
    firstTouchSourceMedium: breakdown(periodSessions, counted, sessionById, (s) => sourceMediumKey(s?.firstTouchJson)),
    firstTouchCampaign: breakdown(periodSessions, counted, sessionById, (s) => campaignKey(s?.firstTouchJson)),
    firstTouchLandingPage: breakdown(periodSessions, counted, sessionById, (s) => landingKey(s?.firstTouchJson)),
    lastTouchSourceMedium: breakdown(periodSessions, counted, sessionById, (s) => sourceMediumKey(s?.lastTouchJson)),
    adSpendIntegrated: false,
  };
}
