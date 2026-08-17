import { NextResponse } from "next/server";
import { guardAdminWrite } from "@/lib/admin/write-guard";
import { markHandoffHandled } from "@/lib/data/handoff-service";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitedResponse } from "@/lib/rate-limit/http";

/**
 * Mark a handoff handled (Production Launch Session 03 §23).
 *
 * The owner's workflow state, and only the owner's: `handledBy` comes from
 * the authenticated admin identity, never from the request body. This is not
 * a CRM — there is no assignment, no status machine, no notes. It answers
 * one question the list view needs: has someone dealt with this?
 */

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = guardAdminWrite(req);
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });

  const limit = await enforceRateLimit({ route: "admin_write", req, scopes: ["network"] });
  if (!limit.allowed) return rateLimitedResponse(limit);

  const { id } = await ctx.params;
  const row = await markHandoffHandled({ id, handledBy: `admin:${guard.admin}` });
  if (!row) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true, handledAt: row.handledAt?.toISOString() ?? null });
}
