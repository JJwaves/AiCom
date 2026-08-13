import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { checkAdminAuth } from "@/lib/admin/auth";
import { processCustomerIntelligence } from "@/lib/ai/agents/customer-intelligence/process";
import {
  buildOpportunityCandidates,
  generateInsightsForPeriod,
  loadConversationCorpus,
  loadDemandSignals,
  periodFromDays,
  persistOpportunities,
} from "@/modules/customer-intelligence";

/**
 * Explicit customer-intelligence processing (Session 08 spec §17) — the
 * admin's "Process new conversations" action. NOT public, NOT scheduled,
 * NOT autonomous: admin Basic auth + feature flag, or the route answers
 * 404 as if it did not exist.
 *
 * Order of operations mirrors the failure policy (§33–§34): AI
 * classification runs first and may come back "unavailable" (flags off,
 * no key, budget exhausted, provider down) — deterministic insight and
 * opportunity generation still runs over whatever classifications already
 * exist, so the dashboard never depends on a live provider.
 */

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4_000;

const bodySchema = z
  .object({
    periodDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

export async function POST(req: Request) {
  const auth = checkAdminAuth(req.headers.get("authorization"));
  if (auth === "not_configured") return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  if (auth === "unauthorized") return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isFlagEnabled("AI_CUSTOMER_INTELLIGENCE")) {
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
    const classification = await processCustomerIntelligence();

    const period = periodFromDays(parsed.data.periodDays ?? 30);
    const corpus = await loadConversationCorpus(period);
    const insights = await generateInsightsForPeriod(corpus);
    const demand = await loadDemandSignals(period);
    const opportunities = await persistOpportunities(buildOpportunityCandidates(corpus, demand));

    return NextResponse.json({
      ok: true,
      classification,
      insights,
      opportunities,
      period: { start: period.start.toISOString(), end: period.end.toISOString(), days: period.days },
    });
  } catch (err) {
    console.error("[admin/customer-intelligence] processing failed", err);
    return NextResponse.json({ ok: false, code: "PROCESSING_FAILED" }, { status: 503 });
  }
}
