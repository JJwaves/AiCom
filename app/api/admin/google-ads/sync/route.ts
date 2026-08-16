import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { GOOGLE_ADS } from "@/config/google-ads";
import { guardAdminWrite, readJsonBody } from "@/lib/admin/write-guard";
import { GOOGLE_ADS_ERROR_EXPLANATION, runGoogleAdsSync, type GoogleAdsErrorCode } from "@/lib/google-ads";

/**
 * Sync Google Ads (Session 13 spec §11, §12).
 *
 * The ONLY path that calls the Google Ads API for reporting data. There is no
 * scheduler and no page render that triggers it (spec §10) — the dashboard
 * reads persisted rows.
 *
 * The operation is READ-ONLY against Google and IDEMPOTENT against our
 * database: syncing the same range twice updates the same (account, campaign,
 * day) rows and cannot double spend (spec §44). A partial or failed run
 * leaves previously synced data untouched with its original timestamp
 * (spec §46) — a failure never turns into zeros.
 *
 * Deliberately does NOT generate an AI review (spec §54): deterministic
 * figures refresh immediately, and the owner decides when to spend tokens.
 */

export const runtime = "nodejs";

const bodySchema = z
  .object({
    /** Optional explicit range, account-calendar days. */
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    lookbackDays: z.number().int().min(1).max(GOOGLE_ADS.MAX_SYNC_RANGE_DAYS).optional(),
  })
  .strict();

export async function POST(req: Request) {
  const guard = guardAdminWrite(req);
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });
  if (!isFlagEnabled("GOOGLE_ADS_INTELLIGENCE")) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ ok: false, code: body.code }, { status: body.status });
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });
  if ((parsed.data.startDate === undefined) !== (parsed.data.endDate === undefined)) {
    return NextResponse.json({ ok: false, code: "INVALID_RANGE" }, { status: 422 });
  }

  try {
    const result = await runGoogleAdsSync({
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      lookbackDays: parsed.data.lookbackDays,
      // Server-derived actor — never taken from the request body.
      triggeredBy: `admin:${guard.admin}`,
    });

    if (result.status === "not_connected") {
      return NextResponse.json({ ok: false, code: "NOT_CONNECTED", reason: result.reason }, { status: 200 });
    }
    if (result.status === "failed") {
      return NextResponse.json(
        {
          ok: false,
          code: result.errorCode,
          message: result.message,
          explanation: GOOGLE_ADS_ERROR_EXPLANATION[result.errorCode as GoogleAdsErrorCode] ?? null,
        },
        { status: 200 },
      );
    }

    return NextResponse.json({
      ok: true,
      status: result.status,
      startDate: result.startDate,
      endDate: result.endDate,
      rowsFetched: result.rowsFetched,
      rowsInserted: result.rowsInserted,
      rowsUpdated: result.rowsUpdated,
      truncated: result.truncated,
      customerId: result.account.customerId,
      currencyCode: result.account.currencyCode,
      timeZone: result.account.timeZone,
      isTestAccount: result.account.isTestAccount,
    });
  } catch (err) {
    console.error("[admin/google-ads] sync failed", err);
    return NextResponse.json({ ok: false, code: "SYNC_FAILED" }, { status: 500 });
  }
}
