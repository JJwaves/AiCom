import { and, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { PRICING_INTELLIGENCE } from "@/config/pricing-intelligence";
import { getDb } from "@/db/client";
import { events, orderLines, orders } from "@/db/schema";

/**
 * Pricing-intelligence data access (Session 12).
 *
 * READ-ONLY. Same doctrine as lib/data/intelligence-service.ts and
 * lib/data/business-intelligence-service.ts: this is the only place pricing
 * analytics touch these tables, nothing here calls a model, and no number is
 * produced by AI. Every count casts ::float8 (int4 sums accumulate as
 * bigint; int8 arrives as a string from both drivers; float8 parses as a JS
 * number and is integer-exact to 2^53).
 *
 * Orders, order lines, configurations, need profiles, conversations and
 * classifications are NOT re-queried here — the Session 08 reads in
 * intelligence-service.ts stay the single bounded path per table (spec §6:
 * no second pricing analytics source of truth).
 */

const periodSchema = z.object({ start: z.date(), end: z.date() });

/**
 * Per-(session, event name) first/last occurrence inside the period, for a
 * bounded list of pricing-relevant event names.
 *
 * This is what makes "after price" honest: a handoff is only counted as
 * happening AFTER a price when its first occurrence is at or after the
 * session's first price view. Without timestamps the same pair of events
 * would silently be reported as a sequence it may not be.
 */
export type SessionEventFact = {
  sessionId: string;
  name: string;
  firstAt: Date;
  lastAt: Date;
  events: number;
};

export async function loadSessionEventFacts(
  start: Date,
  end: Date,
  names: readonly string[],
  limit = PRICING_INTELLIGENCE.MAX_SESSION_EVENT_PAIRS,
): Promise<SessionEventFact[]> {
  periodSchema.parse({ start, end });
  if (names.length === 0) return [];
  const db = await getDb();
  const rows = await db
    .select({
      sessionId: events.sessionId,
      name: events.name,
      firstAt: sql<string | Date>`min(${events.occurredAt})`,
      lastAt: sql<string | Date>`max(${events.occurredAt})`,
      events: sql<number>`count(*)::float8`,
    })
    .from(events)
    .where(and(gte(events.occurredAt, start), lt(events.occurredAt, end), inArray(events.name, [...names])))
    .groupBy(events.sessionId, events.name)
    .limit(Math.min(limit, PRICING_INTELLIGENCE.MAX_SESSION_EVENT_PAIRS));

  return rows.map((r) => ({
    sessionId: r.sessionId,
    name: r.name,
    firstAt: new Date(r.firstAt),
    lastAt: new Date(r.lastAt),
    events: r.events,
  }));
}

/**
 * Product-scoped event facts: the same shape, additionally keyed by the
 * event's `product_id` column. Only events that actually carry one
 * (product_viewed, price_viewed, quantity_selected, add_to_cart,
 * configurator_*) produce rows — events without a product id are simply
 * absent rather than attributed to a guess.
 */
export type ProductEventFact = SessionEventFact & { productId: string };

export async function loadProductEventFacts(
  start: Date,
  end: Date,
  names: readonly string[],
  limit = PRICING_INTELLIGENCE.MAX_SESSION_EVENT_PAIRS,
): Promise<ProductEventFact[]> {
  periodSchema.parse({ start, end });
  if (names.length === 0) return [];
  const db = await getDb();
  const rows = await db
    .select({
      sessionId: events.sessionId,
      productId: events.productId,
      name: events.name,
      firstAt: sql<string | Date>`min(${events.occurredAt})`,
      lastAt: sql<string | Date>`max(${events.occurredAt})`,
      events: sql<number>`count(*)::float8`,
    })
    .from(events)
    .where(
      and(
        gte(events.occurredAt, start),
        lt(events.occurredAt, end),
        inArray(events.name, [...names]),
        sql`${events.productId} is not null`,
      ),
    )
    .groupBy(events.sessionId, events.productId, events.name)
    .limit(Math.min(limit, PRICING_INTELLIGENCE.MAX_SESSION_EVENT_PAIRS));

  return rows
    .filter((r): r is typeof r & { productId: string } => typeof r.productId === "string")
    .map((r) => ({
      sessionId: r.sessionId,
      productId: r.productId,
      name: r.name,
      firstAt: new Date(r.firstAt),
      lastAt: new Date(r.lastAt),
      events: r.events,
    }));
}

/**
 * Quantity-bearing event rows (`quantity_selected`, `add_to_cart`) with
 * their recorded quantity prop. Used to attribute configurator and cart
 * activity to a quantity band; rows whose prop is missing or not a positive
 * integer are DROPPED rather than defaulted to anything.
 */
export type QuantityEventRow = { sessionId: string; productId: string; name: string; quantity: number };

export async function loadQuantityEvents(
  start: Date,
  end: Date,
  names: readonly string[] = ["quantity_selected", "add_to_cart"],
  limit = PRICING_INTELLIGENCE.MAX_ROWS_PER_QUERY,
): Promise<QuantityEventRow[]> {
  periodSchema.parse({ start, end });
  if (names.length === 0) return [];
  const db = await getDb();
  const rows = await db
    .select({
      sessionId: events.sessionId,
      productId: events.productId,
      name: events.name,
      props: events.propsJson,
    })
    .from(events)
    .where(and(gte(events.occurredAt, start), lt(events.occurredAt, end), inArray(events.name, [...names])))
    .limit(Math.min(limit, PRICING_INTELLIGENCE.MAX_ROWS_PER_QUERY));

  const out: QuantityEventRow[] = [];
  for (const r of rows) {
    if (typeof r.productId !== "string" || r.productId.length === 0) continue;
    const raw = (r.props as Record<string, unknown> | null)?.quantity;
    const quantity = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
    if (quantity === null) continue;
    out.push({ sessionId: r.sessionId, productId: r.productId, name: r.name, quantity });
  }
  return out;
}

/**
 * Order lines joined to their order's session/currency/status, for price
 * realization (spec §11) and per-tier revenue. The line's `configJson` and
 * `unitPriceCents` are the IMMUTABLE snapshot taken when the order was
 * created — they are the authority for what the customer actually paid, and
 * are never recomputed here.
 */
export type PricedOrderLine = {
  orderId: string;
  lineId: string;
  sessionId: string | null;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  currency: string;
  orderStatus: string;
  configJson: (typeof orderLines.$inferSelect)["configJson"];
  createdAt: Date;
};

export async function listPricedOrderLines(
  start: Date,
  end: Date,
  limit = PRICING_INTELLIGENCE.MAX_ROWS_PER_QUERY,
): Promise<PricedOrderLine[]> {
  periodSchema.parse({ start, end });
  const db = await getDb();
  const rows = await db
    .select({
      orderId: orders.id,
      lineId: orderLines.id,
      sessionId: orders.sessionId,
      productId: orderLines.productId,
      quantity: orderLines.quantity,
      unitPriceCents: orderLines.unitPriceCents,
      totalCents: orderLines.totalCents,
      currency: orders.currency,
      orderStatus: orders.status,
      configJson: orderLines.configJson,
      createdAt: orders.createdAt,
    })
    .from(orderLines)
    .innerJoin(orders, sql`${orderLines.orderId} = ${orders.id}`)
    .where(and(gte(orders.createdAt, start), lt(orders.createdAt, end)))
    .limit(Math.min(limit, PRICING_INTELLIGENCE.MAX_ROWS_PER_QUERY));

  return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt) }));
}
