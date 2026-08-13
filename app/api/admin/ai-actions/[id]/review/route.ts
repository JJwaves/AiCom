import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { guardAdminWrite, readJsonBody } from "@/lib/admin/write-guard";
import { reviewAction } from "@/lib/data/agent-action-service";

/**
 * Approve / reject one proposed action (Session 10 spec §14, §25, §27–§28).
 *
 * Security posture:
 *  - `reviewedBy` is DERIVED from the authenticated admin. Any reviewedBy /
 *    riskLevel / approvalStatus / status field in the body is rejected
 *    outright by the strict schema — there is no client-writable path to a
 *    verdict, an identity, or a risk level.
 *  - `expectedStateVersion` is mandatory: a double-clicked Approve or a
 *    second reviewer acting on a stale page receives 409 CONFLICT instead
 *    of overwriting the first verdict.
 *  - Approving records a HUMAN DECISION. It executes nothing: no executor
 *    exists for any action type (modules/guardrails/executors.ts).
 */

export const runtime = "nodejs";

const bodySchema = z
  .object({
    outcome: z.enum(["approve", "reject"]),
    expectedStateVersion: z.number().int().min(1).max(1_000_000),
    notes: z.string().max(4000).optional(),
  })
  .strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = guardAdminWrite(req);
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });
  if (!isFlagEnabled("AI_ACTION_CENTER")) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  const body = await readJsonBody(req, 8_000);
  if (!body.ok) return NextResponse.json({ ok: false, code: body.code }, { status: body.status });
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });

  const { id } = await params;
  try {
    const result = await reviewAction({
      actionId: id,
      outcome: parsed.data.outcome,
      // Server-derived identity — the client cannot influence this.
      reviewedBy: guard.admin,
      expectedStateVersion: parsed.data.expectedStateVersion,
      notes: parsed.data.notes,
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
      return NextResponse.json(
        {
          ok: false,
          code: "CONFLICT",
          reason: result.reason,
          currentStatus: result.currentStatus,
          currentStateVersion: result.currentStateVersion,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      id: result.action.id,
      status: result.action.status,
      executionStatus: result.action.executionStatus,
      stateVersion: result.action.stateVersion,
      reviewedBy: result.action.reviewedBy,
    });
  } catch (err) {
    console.error("[admin/ai-actions] review failed", err);
    return NextResponse.json({ ok: false, code: "REVIEW_FAILED" }, { status: 500 });
  }
}
