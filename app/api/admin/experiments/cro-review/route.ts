import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { guardAdminWrite, readJsonBody } from "@/lib/admin/write-guard";
import { generateCroReview } from "@/lib/ai/agents/cro";
import { periodFromDays } from "@/modules/business-intelligence";

/**
 * Generate CRO proposals (Session 11 spec §20–§24).
 *
 * The ONLY trigger for a CRO model call — page loads never generate. The
 * agent writes AgentDecision rows; those become guardrail-evaluated
 * proposed actions when the owner presses "Refresh proposed actions" in the
 * AI Action Center. Nothing here launches, measures, or changes the site.
 *
 * Provider or budget failure returns a typed error and persists NOTHING:
 * running experiments, assignment, exposure and measurement are unaffected
 * (spec §47–§48).
 */

export const runtime = "nodejs";

const bodySchema = z.object({ periodDays: z.number().int().min(1).max(365).optional() }).strict();

export async function POST(req: Request) {
  const guard = guardAdminWrite(req);
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });
  if (!isFlagEnabled("EXPERIMENT_ENGINE") || !isFlagEnabled("AI_CRO_AGENT")) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ ok: false, code: body.code }, { status: body.status });
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });

  try {
    const result = await generateCroReview({ period: periodFromDays(parsed.data.periodDays ?? 30) });
    if (result.status === "unavailable") {
      return NextResponse.json({ ok: false, code: "AI_UNAVAILABLE", reason: result.reason }, { status: 503 });
    }
    if (result.status === "failed") {
      return NextResponse.json({ ok: false, code: "AI_FAILED", reason: result.errorCode }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      proposals: result.review.proposals.length,
      created: result.created,
      updated: result.updated,
      droppedInvalid: result.droppedInvalid,
      skippedReviewed: result.skippedReviewed,
      dropReasons: result.dropReasons.slice(0, 5),
    });
  } catch (err) {
    console.error("[admin/experiments] CRO review failed", err);
    return NextResponse.json({ ok: false, code: "CRO_REVIEW_FAILED" }, { status: 500 });
  }
}
