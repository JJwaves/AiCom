import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { checkAdminAuth } from "@/lib/admin/auth";
import { getOpportunity, OPPORTUNITY_STATUSES, setOpportunityStatus } from "@/lib/data/insight-service";

/**
 * Admin opportunity status updates (Session 08 spec §21–§22). This
 * admin-authenticated route is the ONLY path to `validated`/`rejected` —
 * generation code never sets them, so manufacturing feasibility is always
 * a human decision. Nothing autonomous follows a status change; nothing
 * is ever published to the storefront.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ status: z.enum(OPPORTUNITY_STATUSES) }).strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = checkAdminAuth(req.headers.get("authorization"));
  if (auth === "not_configured") return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  if (auth === "unauthorized") return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isFlagEnabled("AI_CUSTOMER_INTELLIGENCE")) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_REQUEST" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });

  const { id } = await params;
  const opportunity = await getOpportunity(id);
  if (!opportunity) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });

  await setOpportunityStatus(id, parsed.data.status);
  return NextResponse.json({ ok: true, id, status: parsed.data.status });
}
