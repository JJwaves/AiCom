import {
  listConfigurationsUpdatedBetween,
  listNeedProfilesUpdatedBetween,
  listOrderLinesForOrderIds,
  listOrdersCreatedBetween,
} from "@/lib/data/intelligence-service";
import type { Period } from "@/modules/customer-intelligence/period";
import type { Product } from "@/types/commerce";
import { bucketForQuantity, catalogMoq, catalogQuantityBuckets, type QuantityBucket } from "./tiers";

/**
 * THREE QUANTITY LANES (spec §7, §14) — requested, configured, purchased.
 *
 * They are never merged, never averaged together, and never presented as
 * one "demand" number. They answer three different questions:
 *
 *   REQUESTED  — what prospects SAY they want (need profiles). Split again
 *                by provenance: USER_STATED vs AI_INFERRED, because a model's
 *                guess is data about our guess (S03 provenance doctrine).
 *   CONFIGURED — what people actually BUILD in the configurator. This is a
 *                live mutating row, so it reflects latest-state-in-period,
 *                not a history (documented S08 limitation, inherited here).
 *   PURCHASED  — what customers actually BUY (immutable order-line snapshots).
 *
 * "Requested 300 · configured 500 · purchased 5,000" is three findings, not
 * one contradiction — and the pricing layer must be able to say so.
 *
 * Buckets come from the REAL tier ladder (modules/pricing-intelligence/tiers),
 * so the distribution lines up with the prices customers were actually shown.
 */

export type QuantityLaneRow = {
  bucketKey: string;
  label: string;
  minQty: number;
  maxQty: number;
  belowMoq: boolean;
  count: number;
  /** Requested lane only: provenance split. Zero elsewhere. */
  stated: number;
  inferred: number;
};

export type QuantityDemand = {
  buckets: QuantityBucket[];
  /** The strictest catalog MOQ — the boundary "below MOQ" refers to. */
  moq: number;
  requested: {
    rows: QuantityLaneRow[];
    profiles: number;
    /** Profiles carrying a quantity at all (the honest denominator). */
    withQuantity: number;
    belowMoqStated: number;
    belowMoqInferred: number;
    refs: { table: string; id: string }[];
  };
  configured: {
    rows: QuantityLaneRow[];
    configurations: number;
    belowMoq: number;
  };
  purchased: {
    rows: QuantityLaneRow[];
    orders: number;
    lines: number;
    units: number;
    belowMoqLines: number;
  };
  /** Which bucket dominates each lane — descriptive, never causal. */
  dominant: { requested: string | null; configured: string | null; purchased: string | null };
};

const MAX_REFS = 50;

function emptyRows(buckets: QuantityBucket[]): QuantityLaneRow[] {
  return buckets.map((b) => ({
    bucketKey: b.key,
    label: b.label,
    minQty: b.minQty,
    maxQty: b.maxQty,
    belowMoq: b.belowMoq,
    count: 0,
    stated: 0,
    inferred: 0,
  }));
}

const dominantOf = (rows: QuantityLaneRow[]): string | null => {
  const best = rows.reduce<QuantityLaneRow | null>((acc, r) => (acc === null || r.count > acc.count ? r : acc), null);
  return best && best.count > 0 ? best.bucketKey : null;
};

export async function loadQuantityDemand(period: Period, products: Product[]): Promise<QuantityDemand> {
  const buckets = catalogQuantityBuckets(products);
  const moq = catalogMoq(products);

  const [profiles, configurations, orders] = await Promise.all([
    listNeedProfilesUpdatedBetween(period.start, period.end),
    listConfigurationsUpdatedBetween(period.start, period.end),
    listOrdersCreatedBetween(period.start, period.end),
  ]);
  const lines = await listOrderLinesForOrderIds(orders.map((o) => o.id));

  /* --- REQUESTED (need profiles, provenance-split) --- */
  const requestedRows = emptyRows(buckets);
  const refs: { table: string; id: string }[] = [];
  let withQuantity = 0;
  let belowMoqStated = 0;
  let belowMoqInferred = 0;

  for (const profile of profiles) {
    if (profile.quantity === null) continue;
    const source = profile.fieldSourcesJson?.quantity?.source ?? null;
    // CONFIGURATOR / ORDER_DATA provenance belongs to the configured and
    // purchased lanes — counting it here would double-count the same fact.
    if (source !== "USER_STATED" && source !== "AI_INFERRED") continue;
    withQuantity += 1;
    const bucket = bucketForQuantity(buckets, profile.quantity);
    if (bucket) {
      const row = requestedRows.find((r) => r.bucketKey === bucket.key)!;
      row.count += 1;
      if (source === "USER_STATED") row.stated += 1;
      else row.inferred += 1;
    }
    if (profile.quantity < moq) {
      if (source === "USER_STATED") belowMoqStated += 1;
      else belowMoqInferred += 1;
      if (refs.length < MAX_REFS) refs.push({ table: "customer_need_profiles", id: profile.id });
    }
  }

  /* --- CONFIGURED (live configurator rows) --- */
  const configuredRows = emptyRows(buckets);
  let configuredBelowMoq = 0;
  for (const config of configurations) {
    const quantity = config.configJson?.quantity;
    if (typeof quantity !== "number") continue;
    const bucket = bucketForQuantity(buckets, quantity);
    if (bucket) configuredRows.find((r) => r.bucketKey === bucket.key)!.count += 1;
    if (quantity < moq) configuredBelowMoq += 1;
  }

  /* --- PURCHASED (immutable order lines) --- */
  const purchasedRows = emptyRows(buckets);
  let units = 0;
  let purchasedBelowMoq = 0;
  for (const line of lines) {
    const bucket = bucketForQuantity(buckets, line.quantity);
    if (bucket) purchasedRows.find((r) => r.bucketKey === bucket.key)!.count += 1;
    units += line.quantity;
    if (line.quantity < moq) purchasedBelowMoq += 1;
  }

  return {
    buckets,
    moq,
    requested: {
      rows: requestedRows,
      profiles: profiles.length,
      withQuantity,
      belowMoqStated,
      belowMoqInferred,
      refs,
    },
    configured: { rows: configuredRows, configurations: configurations.length, belowMoq: configuredBelowMoq },
    purchased: {
      rows: purchasedRows,
      orders: orders.length,
      lines: lines.length,
      units,
      belowMoqLines: purchasedBelowMoq,
    },
    dominant: {
      requested: dominantOf(requestedRows),
      configured: dominantOf(configuredRows),
      purchased: dominantOf(purchasedRows),
    },
  };
}
