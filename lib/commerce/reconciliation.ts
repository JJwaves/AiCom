import {
  completeReconciliationRun,
  startReconciliationRun,
  type ReconciliationRunRow,
} from "@/lib/data/reconciliation-run-service";
import { captureException } from "@/lib/observability/error-tracking";
import { describeError, logInfo, logWarn } from "@/lib/observability/logger";
import { resolveCommerceConfiguration, CommerceConfigurationError } from "./config";
import { reconcileOrderSnapshot } from "./order-reconciliation";
import { createShopifyOrderReader, type ShopifyOrderReader } from "./shopify-orders";

/**
 * Shopify lost-webhook recovery (Production Launch Session 03 §24–§28).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FAILURE THIS EXISTS FOR
 * ═══════════════════════════════════════════════════════════════════════════
 * Shopify retries a failed webhook for about 48 hours and then gives up. If
 * the endpoint was down for that window — a bad deploy, an expired
 * certificate, a database outage — the notification for that payment is gone
 * for good. The customer paid. Shopify knows. BagDirect's order sits at
 * `pending_payment` forever: excluded from revenue, missing from fulfilment,
 * and no amount of waiting will fix it, because nothing is going to knock
 * again.
 *
 * This sweep asks Shopify directly, for a bounded recent window, and repairs
 * what it finds.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DESIGN DECISIONS
 * ═══════════════════════════════════════════════════════════════════════════
 * NO CRON (§24). This session introduces no scheduler. It is an explicit,
 * authenticated admin operation, which also means it is never running
 * unattended against a misconfigured store.
 *
 * SAME SERVICE AS THE WEBHOOK (§25). Repairs go through
 * `reconcileOrderSnapshot`, which routes into the same primitives the
 * webhook path uses — including the ONE row-locked `transitioned` flag that
 * fires `purchase_completed`. There is no second order-processing
 * implementation, so a repaired order is indistinguishable from a webhook
 * one.
 *
 * IDEMPOTENT (§28). Running the sweep twice over the same window repairs
 * nothing the second time: every primitive is a no-op when the state already
 * matches, so the second run reports `alreadyConsistent` and changes nothing.
 * The healthy steady state of this feature is a run that repairs zero orders.
 *
 * PARTIAL RUNS ARE HONEST (§27). A per-order failure is counted and the
 * sweep continues; the run is recorded as `partial` rather than `success`. A
 * page cap sets `truncated`, which says the window was NOT fully inspected —
 * silently covering less than asked for would read as "everything is fine".
 */

/** Bounds of the lookback the caller may request. */
export const MIN_LOOKBACK_HOURS = 1;
export const MAX_LOOKBACK_HOURS = 24 * 14;
export const DEFAULT_LOOKBACK_HOURS = 72;

export type ReconciliationResult =
  | {
      status: "not_configured";
      reason: string;
      run: ReconciliationRunRow | null;
    }
  | {
      status: "success" | "partial";
      run: ReconciliationRunRow;
      ordersInspected: number;
      repairsPerformed: number;
      alreadyConsistent: number;
      unmatched: number;
      failures: number;
      truncated: boolean;
      repairs: { providerOrderId: string; orderId: string | null; detail: string }[];
    }
  | {
      status: "failed";
      run: ReconciliationRunRow;
      errorCode: string;
      message: string;
    };

export type RunReconciliationInput = {
  lookbackHours?: number;
  triggeredBy: string;
  /** Test seam — production builds its own reader from configuration. */
  reader?: ShopifyOrderReader;
  now?: Date;
};

export async function runShopifyReconciliation(input: RunReconciliationInput): Promise<ReconciliationResult> {
  const now = input.now ?? new Date();
  const lookbackHours = Math.min(
    MAX_LOOKBACK_HOURS,
    Math.max(MIN_LOOKBACK_HOURS, input.lookbackHours ?? DEFAULT_LOOKBACK_HOURS),
  );
  const rangeEnd = now;
  const rangeStart = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);

  /* ---- Reader: injected, or built from real configuration ---------- */
  let reader = input.reader ?? null;
  if (!reader) {
    try {
      const config = resolveCommerceConfiguration();
      if (config.mode !== "shopify") {
        return {
          status: "not_configured",
          reason:
            "Shopify is not configured, so there are no provider orders to reconcile. " +
            "This operation exists to recover payments whose webhook never arrived.",
          run: null,
        };
      }
      reader = createShopifyOrderReader(config.shopify);
    } catch (err) {
      if (err instanceof CommerceConfigurationError) {
        return { status: "not_configured", reason: err.message, run: null };
      }
      throw err;
    }
  }

  const run = await startReconciliationRun({ rangeStart, rangeEnd, triggeredBy: input.triggeredBy });

  /* ---- Read a bounded window --------------------------------------- */
  let orders;
  let truncated = false;
  try {
    const result = await reader({ start: rangeStart, end: rangeEnd });
    orders = result.orders;
    truncated = result.truncated;
  } catch (err) {
    // A read failure is a FAILED run, never an empty one: "we could not ask"
    // and "there was nothing to find" must never look the same.
    const message = describeError(err);
    captureException(err, {
      subsystem: "reconciliation",
      event: "shopify_order_read_failed",
      code: "PROVIDER_READ_FAILED",
      fields: { runId: run.id, lookbackHours },
    });
    const completed = await completeReconciliationRun({
      id: run.id,
      status: "failed",
      errorCode: "PROVIDER_READ_FAILED",
      errorMessage: message,
      truncated,
    });
    return { status: "failed", run: completed ?? run, errorCode: "PROVIDER_READ_FAILED", message };
  }

  /* ---- Repair ------------------------------------------------------ */
  let repairsPerformed = 0;
  let alreadyConsistent = 0;
  let unmatched = 0;
  let failures = 0;
  const repairs: { providerOrderId: string; orderId: string | null; detail: string }[] = [];

  for (const order of orders) {
    try {
      const outcome = await reconcileOrderSnapshot({
        providerOrderId: order.providerOrderId,
        bagdirectOrderId: order.bagdirectOrderId,
        financialStatus: order.financialStatus,
        cancelledAt: order.cancelledAt,
        refundedTotalCents: order.refundedTotalCents,
        currency: order.currency,
        totalCents: order.totalCents,
      });

      if (outcome.outcome === "ignored") {
        unmatched += 1;
        continue;
      }
      if (outcome.changed) {
        repairsPerformed += 1;
        repairs.push({ providerOrderId: order.providerOrderId, orderId: outcome.orderId, detail: outcome.detail });
        logWarn({
          subsystem: "reconciliation",
          event: "order_repaired",
          code: "WEBHOOK_GAP_REPAIRED",
          runId: run.id,
          providerOrderId: order.providerOrderId,
          orderId: outcome.orderId,
          detail: outcome.detail,
        });
      } else {
        alreadyConsistent += 1;
      }
    } catch (err) {
      failures += 1;
      captureException(err, {
        subsystem: "reconciliation",
        event: "order_repair_failed",
        code: "REPAIR_FAILED",
        fields: { runId: run.id, providerOrderId: order.providerOrderId },
      });
    }
  }

  const status = failures > 0 || truncated ? "partial" : "success";
  const completed = await completeReconciliationRun({
    id: run.id,
    status,
    ordersInspected: orders.length,
    repairsPerformed,
    alreadyConsistent,
    failures,
    truncated,
  });

  logInfo({
    subsystem: "reconciliation",
    event: "run_complete",
    runId: run.id,
    status,
    ordersInspected: orders.length,
    repairsPerformed,
    alreadyConsistent,
    unmatched,
    failures,
    truncated,
  });

  return {
    status,
    run: completed ?? run,
    ordersInspected: orders.length,
    repairsPerformed,
    alreadyConsistent,
    unmatched,
    failures,
    truncated,
    repairs,
  };
}
