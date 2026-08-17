import { NextResponse } from "next/server";

/**
 * LIVENESS (Production Launch Session 03 §29, §30).
 *
 * "Is this process responding?" — nothing more. No database, no external
 * API, no configuration reading, no allocation worth mentioning.
 *
 * The distinction from readiness is operationally important: a liveness
 * probe that touched the database would tell the platform to RESTART the
 * application when the DATABASE was down. Restarting a healthy process
 * because a dependency is unhealthy turns a degraded system into an
 * unavailable one, and does it in a loop.
 *
 * Exposes no secret, no configuration and no subsystem detail.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
