import { NextResponse } from "next/server";
import { guardAdminWrite } from "@/lib/admin/write-guard";
import { getHandoff } from "@/lib/data/handoff-service";
import { deliverHandoff } from "@/lib/escalation/delivery";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitedResponse } from "@/lib/rate-limit/http";

/**
 * Retry delivery of a stored handoff (Production Launch Session 03 §22).
 *
 * The handoff itself is never at risk — it is already persisted, and this
 * only re-attempts the outbound notification. Owner-triggered rather than
 * automatic: a webhook that is down usually stays down for minutes, and a
 * background retry loop is a scheduler this session deliberately does not
 * introduce.
 */

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = guardAdminWrite(req);
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });

  const limit = await enforceRateLimit({ route: "admin_write", req, scopes: ["network"] });
  if (!limit.allowed) return rateLimitedResponse(limit);

  const { id } = await ctx.params;
  const row = await getHandoff(id);
  if (!row) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });

  const outcome = await deliverHandoff(row);
  return NextResponse.json({
    ok: outcome.status === "delivered",
    status: outcome.status,
    ...(outcome.status === "failed" ? { error: outcome.error } : {}),
  });
}
