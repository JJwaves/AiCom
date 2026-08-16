import { NextResponse } from "next/server";
import { isFlagEnabled } from "@/config/flags";
import { guardAdminWrite, readJsonBody } from "@/lib/admin/write-guard";
import { GOOGLE_ADS_ERROR_EXPLANATION, testGoogleAdsConnection, type GoogleAdsErrorCode } from "@/lib/google-ads";

/**
 * Test Google Ads Connection (Session 13 spec §47).
 *
 * Performs the SMALLEST read-only call that proves the credentials work: one
 * `customer` row. No metrics are fetched, essentially no quota is consumed,
 * and NO MUTATION IS POSSIBLE — the adapter has no method that could perform
 * one and no URL builder that could address one.
 *
 * The customer id comes from SERVER CONFIGURATION (spec §48). This route
 * accepts NO body fields at all, so a client cannot ask the platform to
 * probe an arbitrary Google Ads account.
 *
 * Returns account identity metadata that is safe to display. A failure
 * returns a normalized code plus a fixed explanation; no OAuth detail, token
 * or raw provider payload ever reaches the browser (spec §42).
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const guard = guardAdminWrite(req);
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });
  if (!isFlagEnabled("GOOGLE_ADS_INTELLIGENCE")) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  // Deliberately no schema fields: the request carries no parameters, so
  // there is nothing for a client to influence.
  const body = await readJsonBody(req, 1_000);
  if (!body.ok) return NextResponse.json({ ok: false, code: body.code }, { status: body.status });

  try {
    const result = await testGoogleAdsConnection();
    if (result.status === "not_configured") {
      return NextResponse.json(
        {
          ok: false,
          code: "NOT_CONFIGURED",
          missing: result.missing,
          invalid: result.invalid,
          explanation: GOOGLE_ADS_ERROR_EXPLANATION.NOT_CONFIGURED,
        },
        { status: 200 },
      );
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
      customerId: result.customerId,
      descriptiveName: result.descriptiveName,
      currencyCode: result.currencyCode,
      timeZone: result.timeZone,
      isManager: result.isManager,
      isTestAccount: result.isTestAccount,
      loginCustomerId: result.loginCustomerId,
      apiVersion: result.apiVersion,
    });
  } catch (err) {
    console.error("[admin/google-ads] connection test failed", err);
    return NextResponse.json({ ok: false, code: "CONNECTION_TEST_FAILED" }, { status: 500 });
  }
}
