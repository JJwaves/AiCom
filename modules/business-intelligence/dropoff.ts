import { countEventsByName, countOrdersBetween } from "@/lib/data/intelligence-service";
import { countSessionsStartedBetween } from "@/lib/data/business-intelligence-service";
import type { Period } from "@/modules/customer-intelligence/period";
import { ratio, type Ratio } from "./availability";

/**
 * Deterministic funnel DROP-OFF (Session 11 spec §36–§37).
 *
 * The S09 funnel answers "how many sessions reached each stage?". This
 * answers the CRO question: "between which two consecutive stages do we
 * lose the most sessions?" — as counts with EXPLICIT denominators, never as
 * a causal claim.
 *
 * Each step's denominator is the PREVIOUS stage's distinct-session count,
 * stated on the row. Percentages are suppressed below the documented
 * minimum denominator (same rule as every other rate in the platform), and
 * the ordering is the site's own funnel — it is NOT evidence that a session
 * passed through the earlier stage first. Sessions can enter mid-funnel
 * (a direct link to a product page) and that is exactly why the raw counts
 * are always rendered alongside the rate.
 */

export type FunnelSurface = { name: string; label: string; sessions: number; events: number };

export type DropOffStep = {
  from: string;
  to: string;
  label: string;
  denominatorDefinition: string;
  fromSessions: number;
  toSessions: number;
  /** fromSessions − toSessions, floored at 0 (mid-funnel entries can invert it). */
  droppedSessions: number;
  ratio: Ratio;
};

export type FunnelDropOff = {
  sessionsStarted: number;
  surfaces: FunnelSurface[];
  steps: DropOffStep[];
  /** The step with the largest absolute session loss, or null when there is none. */
  largestDropStep: string | null;
};

/** The site's purchase path, in order. Purchases come from the orders table. */
const SURFACES: { name: string; label: string }[] = [
  { name: "product_viewed", label: "Product views" },
  { name: "configurator_started", label: "Configurator started" },
  { name: "price_viewed", label: "Price viewed" },
  { name: "add_to_cart", label: "Added to cart" },
  { name: "checkout_started", label: "Checkout started" },
];

export async function loadFunnelDropOff(period: Period): Promise<FunnelDropOff> {
  const [sessionsStarted, eventCounts, orders] = await Promise.all([
    countSessionsStartedBetween(period.start, period.end),
    countEventsByName(period.start, period.end),
    countOrdersBetween(period.start, period.end),
  ]);
  const byName = new Map(eventCounts.map((c) => [c.name, c]));

  const surfaces: FunnelSurface[] = SURFACES.map((s) => ({
    ...s,
    sessions: byName.get(s.name)?.sessions ?? 0,
    events: byName.get(s.name)?.events ?? 0,
  }));
  // Purchases are authoritative from the orders table, not from events.
  surfaces.push({ name: "purchase_completed", label: "Purchases", sessions: orders.total, events: orders.total });

  const steps: DropOffStep[] = [];
  for (let i = 0; i < surfaces.length - 1; i += 1) {
    const from = surfaces[i];
    const to = surfaces[i + 1];
    steps.push({
      from: from.name,
      to: to.name,
      label: `${from.label} → ${to.label}`,
      denominatorDefinition: `distinct sessions with ${from.name} in period`,
      fromSessions: from.sessions,
      toSessions: to.sessions,
      droppedSessions: Math.max(0, from.sessions - to.sessions),
      ratio: ratio(to.sessions, from.sessions),
    });
  }

  const largest = steps.reduce<DropOffStep | null>(
    (worst, step) => (worst === null || step.droppedSessions > worst.droppedSessions ? step : worst),
    null,
  );

  return {
    sessionsStarted,
    surfaces,
    steps,
    largestDropStep: largest && largest.droppedSessions > 0 ? largest.label : null,
  };
}
