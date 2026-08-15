import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { guardAdminWrite, readJsonBody } from "@/lib/admin/write-guard";
import { materializeApprovedProposals } from "@/lib/experiments/materialize";

/**
 * "Create drafts from approved proposals" (Session 11 spec §25).
 *
 * Deterministic: no model call. It reads APPROVED CRO_EXPERIMENT_PROPOSAL
 * actions, re-validates each design against the CURRENT target registry and
 * traffic ceiling, and creates DRAFT experiments — which enrol nobody.
 * Idempotent (one experiment per source action, enforced by a unique index).
 */

export const runtime = "nodejs";

const bodySchema = z.object({}).strict();

export async function POST(req: Request) {
  const guard = guardAdminWrite(req);
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });
  if (!isFlagEnabled("EXPERIMENT_ENGINE")) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ ok: false, code: body.code }, { status: body.status });
  if (!bodySchema.safeParse(body.body).success) {
    return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });
  }

  try {
    const result = await materializeApprovedProposals(`admin:${guard.admin}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[admin/experiments] materialize failed", err);
    return NextResponse.json({ ok: false, code: "MATERIALIZE_FAILED" }, { status: 500 });
  }
}
