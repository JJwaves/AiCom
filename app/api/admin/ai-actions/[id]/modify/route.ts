import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { guardAdminWrite, readJsonBody } from "@/lib/admin/write-guard";
import { modifyAction } from "@/lib/data/agent-action-service";

/**
 * Modify a proposed action (Session 10 spec §15, §29).
 *
 * The submitted payload is UNTRUSTED and takes the same road as an agent's:
 * strict per-type schema validation, then a FULL re-evaluation by the
 * Guardrail Engine. A human edit inherits no verdict and bypasses no rule —
 * if the edited action violates a hard rule, the new revision is stored as
 * GUARDRAIL_BLOCKED. The original proposal is preserved (SUPERSEDED) with
 * the modifying admin recorded.
 */

export const runtime = "nodejs";

const bodySchema = z
  .object({
    /** The full replacement payload for this action type. */
    payload: z.record(z.string().max(64), z.unknown()),
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

  const body = await readJsonBody(req, 16_000);
  if (!body.ok) return NextResponse.json({ ok: false, code: body.code }, { status: body.status });
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });

  const { id } = await params;
  try {
    const result = await modifyAction({
      actionId: id,
      payload: parsed.data.payload,
      reviewedBy: guard.admin,
      expectedStateVersion: parsed.data.expectedStateVersion,
      notes: parsed.data.notes,
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
      if (result.code === "INVALID") {
        return NextResponse.json({ ok: false, code: "INVALID", reason: result.reason }, { status: 422 });
      }
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
      originalId: result.original.id,
      originalStatus: result.original.status,
      revisionId: result.revision.id,
      revision: result.revision.revision,
      // The re-evaluation of the MODIFIED action — never the inherited one.
      status: result.revision.status,
      riskLevel: result.revision.riskLevel,
      executionStatus: result.revision.executionStatus,
      stateVersion: result.revision.stateVersion,
      guardrail: {
        allowed: result.decision.allowed,
        approvalRequired: result.decision.approvalRequired,
        violatedRules: result.decision.violatedRules.map((r) => r.id),
        missingConfiguration: result.decision.missingConfiguration,
        policyVersion: result.decision.policyVersion,
      },
    });
  } catch (err) {
    console.error("[admin/ai-actions] modify failed", err);
    return NextResponse.json({ ok: false, code: "MODIFY_FAILED" }, { status: 500 });
  }
}
