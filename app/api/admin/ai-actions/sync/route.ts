import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { guardAdminWrite, readJsonBody } from "@/lib/admin/write-guard";
import { syncDecisionsToActions } from "@/lib/data/agent-action-service";

/**
 * Materialize proposed actions from pending CEO recommendations
 * (Session 10 spec §20) — the admin's "Refresh proposed actions" button.
 *
 * Deterministic: NO model call happens here. It reads persisted
 * AgentDecision rows, maps the controlled category to a review-only action
 * type, runs the Guardrail Engine, and stores the verdict. Idempotent — a
 * decision that already has an action is skipped (and a unique index makes
 * a concurrent double-run impossible to duplicate).
 */

export const runtime = "nodejs";

const bodySchema = z.object({}).strict();

export async function POST(req: Request) {
  const guard = guardAdminWrite(req);
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });
  if (!isFlagEnabled("AI_ACTION_CENTER")) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ ok: false, code: body.code }, { status: body.status });
  if (!bodySchema.safeParse(body.body).success) {
    return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });
  }

  try {
    const result = await syncDecisionsToActions(`admin:${guard.admin}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[admin/ai-actions] sync failed", err);
    return NextResponse.json({ ok: false, code: "SYNC_FAILED" }, { status: 500 });
  }
}
