import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { guardAdminWrite, readJsonBody } from "@/lib/admin/write-guard";
import { generatePricingReview } from "@/lib/ai/agents/pricing";
import { periodFromDays } from "@/modules/pricing-intelligence";

/**
 * Generate a Pricing Review (Session 12 spec §38, §41–§42).
 *
 * The ONLY trigger for a Pricing Agent model call — page loads never
 * generate, and no scheduler exists. The agent writes a `pricing_reports`
 * document plus AgentDecision rows; those become guardrail-evaluated
 * proposed actions when the owner presses "Refresh proposed actions" in the
 * AI Action Center.
 *
 * Nothing here prices anything. Provider or budget failure returns a typed
 * error and persists NOTHING — the deterministic dashboard and the previous
 * review stay exactly as they were.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ periodDays: z.number().int().min(1).max(365).optional() }).strict();

export async function POST(req: Request) {
  const guard = guardAdminWrite(req);
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });
  if (!isFlagEnabled("PRICING_INTELLIGENCE") || !isFlagEnabled("AI_PRICING_AGENT")) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ ok: false, code: body.code }, { status: body.status });
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });

  try {
    const result = await generatePricingReview({ period: periodFromDays(parsed.data.periodDays ?? 30) });
    if (result.status === "unavailable") {
      return NextResponse.json({ ok: false, code: "AI_UNAVAILABLE", reason: result.reason }, { status: 503 });
    }
    if (result.status === "failed") {
      return NextResponse.json({ ok: false, code: "AI_FAILED", reason: result.errorCode }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      reportId: result.report.id,
      generatedAt: result.report.generatedAt.toISOString(),
      recommendations: result.review.recommendations.length,
      created: result.created,
      updated: result.updated,
      droppedInvalid: result.droppedInvalid,
      droppedReferences: result.droppedReferences,
      skippedReviewed: result.skippedReviewed,
      dropReasons: result.dropReasons.slice(0, 5),
    });
  } catch (err) {
    console.error("[admin/pricing-intelligence] pricing review failed", err);
    return NextResponse.json({ ok: false, code: "PRICING_REVIEW_FAILED" }, { status: 500 });
  }
}
