import { NextResponse } from "next/server";
import { buildReadinessReport } from "@/modules/launch-readiness";

/**
 * READINESS (Production Launch Session 03 §29, §31–§33).
 *
 * "Can this application safely accept a sale right now?"
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * It checks the MANDATORY commerce path: the database answers, commerce
 * configuration is valid and complete, artwork storage exists, products have
 * real prices, admin access exists, the domain is set. Those are the things
 * whose absence means a customer's order fails or is wrong.
 *
 * It does NOT depend on Google Ads, the CEO agent, Customer Intelligence,
 * CRO, pricing intelligence or AI Sales (§31). Every one of those is an
 * optional enhancement; a system that refuses traffic because an LLM
 * provider is having a bad afternoon is a system that turns an optional
 * feature into an outage.
 *
 * It makes NO external API call (§32). Shopify readiness is judged from
 * CONFIGURATION VALIDITY, not connectivity — an uptime poller hitting this
 * every ten seconds would otherwise burn Shopify's rate limit forever, and a
 * vendor's slow minute would read as BagDirect being down. Live connectivity
 * checking belongs on an authenticated admin diagnostic, where a human asks
 * for it once.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE RESPONSE CONTAINS (§33)
 * ═══════════════════════════════════════════════════════════════════════════
 * A state, subsystem names, safe categories and owner-readable reasons.
 * Never a database URL, a token, an account id, a bucket credential or a
 * stack trace. `?verbose=1` adds the per-check detail — still built from the
 * same safe fields, because there is no other kind in the report.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const verbose = new URL(req.url).searchParams.get("verbose") === "1";
  const report = await buildReadinessReport();

  const body = {
    status: report.state === "READY" ? "ready" : report.state === "WARNING" ? "degraded" : "not_ready",
    environment: report.environment,
    generatedAt: report.generatedAt,
    counts: report.counts,
    blockers: report.blockers,
    ...(verbose
      ? {
          checks: report.checks.map((check) => ({
            id: check.id,
            category: check.category,
            title: check.title,
            state: check.state,
            summary: check.summary,
            code: check.code,
            mandatory: check.mandatory,
          })),
        }
      : {}),
  };

  // 503 only when a MANDATORY requirement is missing. WARNING is 200:
  // "degraded but sellable" must not take the deployment out of rotation.
  return NextResponse.json(body, {
    status: report.state === "BLOCKED" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
