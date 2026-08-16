import type { LineCogs, LineVariableCosts } from "./cost-model";
import { computeLineCosts, type CostModelConfig } from "./cost-model";
import {
  computeOrderUnitEconomics,
  type EconomicsStatus,
  type OrderCogs,
  type OrderEconomicsInput,
  type OrderShipping,
  type OrderVariableCosts,
  type UnitEconomics,
} from "./unit-economics";

/**
 * ORDER COST SNAPSHOTS (Session 13.5 §28, §29).
 *
 * Historical order economics must not depend on today's configuration. A
 * cost snapshot records what an order ACTUALLY cost under the cost model
 * in force when it was placed, stamped with `costModelVersion` so the
 * question "which configuration produced this number?" stays answerable
 * after the numbers change.
 *
 * Two hard rules:
 *
 *   1. Snapshots are written FORWARD ONLY. Old orders are never
 *      back-filled with fabricated historical costs. An order without a
 *      snapshot reports HISTORICAL_COST_UNAVAILABLE — not zero profit, and
 *      not today's costs wearing a historical date.
 *
 *   2. Capture NEVER blocks a sale (§47). When the cost model is
 *      unconfigured — which is its shipped state — capture returns null,
 *      the order is written without a snapshot, and checkout is unaffected.
 *      No customer-facing path reads this file's output.
 */

/** Per-line product COGS + line variable costs, frozen at order time. */
export type OrderLineCostSnapshot = {
  costModelVersion: string;
  cogs: LineCogs;
  variable: LineVariableCosts;
};

/** Derived order economics, frozen at order time. */
export type OrderCostSnapshot = {
  costModelVersion: string;
  /** ISO-8601 UTC. Injected by the caller — this module has no clock. */
  capturedAt: string;
  currency: string;
  revenueCents: number;
  cogs: OrderCogs;
  grossProfitCents: number;
  grossMarginBps: number | null;
  /** Null when variable selling costs were not configured at order time. */
  variableCosts: OrderVariableCosts | null;
  shipping: OrderShipping | null;
  contributionStatus: EconomicsStatus;
  contributionBeforePaidMediaCents: number | null;
  contributionMarginBeforePaidMediaBps: number | null;
  /** Availability caveats recorded at capture time, verbatim. */
  reasons: string[];
};

export type CapturedOrderCosts = {
  snapshot: OrderCostSnapshot;
  /** Keyed by the caller's line index, in the order given. */
  lineSnapshots: (OrderLineCostSnapshot | null)[];
};

/**
 * Capture a cost snapshot for an order about to be written.
 *
 * Returns null when gross profit cannot be computed — there is nothing
 * truthful to freeze, so nothing is stored and the order reports
 * HISTORICAL_COST_UNAVAILABLE forever. That is the correct outcome, not a
 * failure: it is exactly what "we did not know our costs on that day"
 * means.
 */
export function captureOrderCostSnapshot(
  input: OrderEconomicsInput,
  capturedAt: Date,
): CapturedOrderCosts | null {
  const economics = computeOrderUnitEconomics(input);
  if (economics.grossStatus !== "AVAILABLE" || economics.cogs === null || economics.grossProfitCents === null) {
    return null;
  }

  const lineSnapshots = input.lines.map((line) => {
    if (!line.product) return null;
    const computed = computeLineCosts(line.product, line.config, input.model);
    return computed.status === "configured"
      ? { costModelVersion: input.model.version, cogs: computed.cogs, variable: computed.variable }
      : null;
  });

  return {
    snapshot: {
      costModelVersion: economics.costModelVersion,
      capturedAt: capturedAt.toISOString(),
      currency: economics.currency,
      revenueCents: economics.revenueCents,
      cogs: economics.cogs,
      grossProfitCents: economics.grossProfitCents,
      grossMarginBps: economics.grossMarginBps,
      variableCosts: economics.variableCosts,
      shipping: economics.shipping,
      contributionStatus: economics.contributionStatus,
      contributionBeforePaidMediaCents: economics.contributionBeforePaidMediaCents,
      contributionMarginBeforePaidMediaBps: economics.contributionMarginBeforePaidMediaBps,
      reasons: economics.reasons,
    },
    lineSnapshots,
  };
}

/**
 * Rebuild `UnitEconomics` from a stored snapshot, WITHOUT touching the
 * current cost configuration. This is the read path for historical
 * profitability: the numbers are the ones that were true then.
 */
export function economicsFromSnapshot(snapshot: OrderCostSnapshot): UnitEconomics {
  return {
    costModelVersion: snapshot.costModelVersion,
    revenueCents: snapshot.revenueCents,
    currency: snapshot.currency,
    grossStatus: "AVAILABLE",
    cogs: snapshot.cogs,
    grossProfitCents: snapshot.grossProfitCents,
    grossMarginBps: snapshot.grossMarginBps,
    contributionStatus: snapshot.contributionStatus,
    variableCosts: snapshot.variableCosts,
    shipping: snapshot.shipping,
    contributionBeforePaidMediaCents: snapshot.contributionBeforePaidMediaCents,
    contributionMarginBeforePaidMediaBps: snapshot.contributionMarginBeforePaidMediaBps,
    lines: [],
    status: snapshot.contributionStatus === "AVAILABLE" ? "AVAILABLE" : "PARTIAL",
    missingInputs: [],
    reasons: snapshot.reasons,
  };
}

/** Reason code used wherever an order predates cost snapshots (§28, §48). */
export const HISTORICAL_COST_UNAVAILABLE = "HISTORICAL_COST_UNAVAILABLE" as const;

export const HISTORICAL_COST_UNAVAILABLE_REASON =
  "No cost snapshot was recorded for this order, so its profit is unavailable. Today's cost configuration is deliberately NOT applied backwards — it would report a number that was never true.";

/** Type guard for a stored snapshot, used at the data boundary. */
export function isOrderCostSnapshot(value: unknown, model: CostModelConfig): value is OrderCostSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<OrderCostSnapshot>;
  return (
    typeof s.costModelVersion === "string" &&
    typeof s.revenueCents === "number" &&
    typeof s.grossProfitCents === "number" &&
    s.cogs !== undefined &&
    // A snapshot from an unknown version is still valid history; the model
    // is passed only so callers can compare versions, never to rewrite it.
    typeof model.version === "string"
  );
}
