import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { checkAdminAuth } from "@/lib/admin/auth";
import { generateCeoReview } from "@/lib/ai/agents/ceo";

/**
 * Explicit CEO-review generation (Session 09 spec §32) — the admin's
 * "Generate / Refresh CEO Review" action. NOT public, NOT scheduled, NOT
 * run on page load: admin Basic auth + feature flag, or the route answers
 * 404 as if it did not exist.
 *
 * Failure policy (§34–§35): budget exhaustion, provider outages, and
 * invalid model output return an honest error here while the
 * deterministic dashboard (and any previously persisted report) keeps
 * working — no fake narrative is ever generated.
 */

export const runtime = "nodejs";

const MAX_BODY_BYTES = 2_000;

const bodySchema = z
  .object({
    periodDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

export async function POST(req: Request) {
  const auth = checkAdminAuth(req.headers.get("authorization"));
  if (auth === "not_configured") return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  if (auth === "unauthorized") return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isFlagEnabled("AI_BUSINESS_INTELLIGENCE")) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_REQUEST" }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, code: "TOO_LARGE" }, { status: 413 });
  let body: unknown = {};
  if (raw.trim().length > 0) {
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ ok: false, code: "BAD_REQUEST" }, { status: 400 });
    }
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });

  try {
    const result = await generateCeoReview({ periodDays: parsed.data.periodDays ?? 7 });
    if (result.status === "unavailable") {
      return NextResponse.json({ ok: false, code: "AI_UNAVAILABLE", reason: result.reason }, { status: 503 });
    }
    if (result.status === "failed") {
      return NextResponse.json({ ok: false, code: "GENERATION_FAILED", reason: result.errorCode }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      reportId: result.report.id,
      generatedAt: result.report.generatedAt.toISOString(),
      recommendations: result.decisions.length,
      created: result.created,
      updated: result.updated,
      droppedInvalid: result.droppedInvalid,
      skippedReviewed: result.skippedReviewed,
    });
  } catch (err) {
    console.error("[admin/business-intelligence] CEO review generation failed", err);
    return NextResponse.json({ ok: false, code: "GENERATION_FAILED" }, { status: 503 });
  }
}
