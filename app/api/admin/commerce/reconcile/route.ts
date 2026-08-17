import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminWrite, readJsonBody } from "@/lib/admin/write-guard";
import {
  MAX_LOOKBACK_HOURS,
  MIN_LOOKBACK_HOURS,
  runShopifyReconciliation,
} from "@/lib/commerce/reconciliation";
import { captureException } from "@/lib/observability/error-tracking";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitedResponse } from "@/lib/rate-limit/http";

/**
 * "Reconcile Shopify orders" (Production Launch Session 03 §24).
 *
 * The manual repair path for payments whose webhook never arrived. It is a
 * READ against Shopify and an IDEMPOTENT repair against BagDirect: running
 * it twice over the same window repairs nothing the second time.
 *
 * No cron, deliberately (§24) — an explicit, authenticated, attended
 * operation. `triggeredBy` is the server-derived admin identity, never a
 * value from the request body.
 */

export const runtime = "nodejs";

const bodySchema = z
  .object({
    lookbackHours: z.number().int().min(MIN_LOOKBACK_HOURS).max(MAX_LOOKBACK_HOURS).optional(),
  })
  .strict();

export async function POST(req: Request) {
  const guard = guardAdminWrite(req);
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });

  const limit = await enforceRateLimit({ route: "admin_write", req, scopes: ["network"] });
  if (!limit.allowed) return rateLimitedResponse(limit);

  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ ok: false, code: body.code }, { status: body.status });
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });

  try {
    const result = await runShopifyReconciliation({
      lookbackHours: parsed.data.lookbackHours,
      triggeredBy: `admin:${guard.admin}`,
    });

    if (result.status === "not_configured") {
      return NextResponse.json({ ok: false, code: "NOT_CONFIGURED", reason: result.reason }, { status: 200 });
    }
    if (result.status === "failed") {
      return NextResponse.json(
        { ok: false, code: result.errorCode, message: result.message, runId: result.run.id },
        { status: 200 },
      );
    }

    return NextResponse.json({
      ok: true,
      status: result.status,
      runId: result.run.id,
      rangeStart: result.run.rangeStart.toISOString(),
      rangeEnd: result.run.rangeEnd.toISOString(),
      ordersInspected: result.ordersInspected,
      repairsPerformed: result.repairsPerformed,
      alreadyConsistent: result.alreadyConsistent,
      unmatched: result.unmatched,
      failures: result.failures,
      truncated: result.truncated,
      repairs: result.repairs,
    });
  } catch (err) {
    captureException(err, { subsystem: "reconciliation", event: "run_failed", code: "RECONCILIATION_FAILED" });
    return NextResponse.json({ ok: false, code: "RECONCILIATION_FAILED" }, { status: 500 });
  }
}
