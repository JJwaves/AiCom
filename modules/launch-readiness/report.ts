import { getDb } from "@/db/client";
import { sql } from "drizzle-orm";
import { captureException } from "@/lib/observability/error-tracking";
import {
  adminChecks,
  aiChecks,
  analyticsChecks,
  artworkChecks,
  businessConfigChecks,
  commerceChecks,
  databaseChecks,
  monitoringChecks,
  operationsChecks,
  productChecks,
} from "./checks";
import type { ReadinessCheck, ReadinessReport, ReadinessState } from "./types";

/**
 * Assemble the launch-readiness report (Production Launch Session 03 §45).
 *
 * ONE rule decides the overall state: only MANDATORY checks can block. That
 * rule is applied HERE, once, so it cannot be forgotten by a caller — an
 * optional check that computes BLOCKED is downgraded to WARNING, because
 * commerce must remain sellable with every AI, intelligence and advertising
 * subsystem switched off (§31).
 */

const WORST: Record<ReadinessState, number> = { READY: 0, WARNING: 1, BLOCKED: 2 };

function applyMandatoryRule(checks: ReadinessCheck[]): ReadinessCheck[] {
  return checks.map((check) =>
    !check.mandatory && check.state === "BLOCKED" ? { ...check, state: "WARNING" as const } : check,
  );
}

export type BuildReportOptions = {
  /**
   * Include the live database probe. Skipped by liveness and by tests that
   * assert pure configuration behaviour.
   */
  probeDatabase?: boolean;
};

/**
 * The one live probe in the whole report: can we reach the database?
 *
 * Deliberately `select 1` and nothing else. Readiness must never call
 * Shopify, the AI provider, Google Ads or object storage (§32): an uptime
 * poller hitting readiness every ten seconds would otherwise burn a third
 * party's rate limit forever, and a vendor's slow day would read as
 * BagDirect being down.
 */
async function databaseProbe(): Promise<ReadinessCheck> {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return {
      id: "database.reachable",
      category: "DATABASE",
      title: "Database connection",
      state: "READY",
      summary: "The database answered.",
      action: null,
      mandatory: true,
      code: "DATABASE_REACHABLE",
    };
  } catch (err) {
    captureException(err, { subsystem: "health", event: "database_probe_failed", code: "DATABASE_UNREACHABLE" });
    return {
      id: "database.reachable",
      category: "DATABASE",
      title: "Database connection",
      state: "BLOCKED",
      summary: "The database did not answer. Orders, sessions and artwork records cannot be written, so nothing can be sold.",
      action: "Check the database provider's status and DATABASE_URL.",
      mandatory: true,
      code: "DATABASE_UNREACHABLE",
    };
  }
}

export async function buildReadinessReport(options: BuildReportOptions = {}): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [
    ...commerceChecks(),
    ...databaseChecks(),
    ...productChecksSafe(),
    ...artworkChecks(),
    ...aiChecks(),
    ...analyticsChecks(),
    ...adminChecks(),
    ...monitoringChecks(),
    ...operationsChecks(),
    ...businessConfigChecks(),
  ];

  if (options.probeDatabase !== false) checks.push(await databaseProbe());

  const resolved = applyMandatoryRule(checks);
  const mandatoryWorst = resolved
    .filter((c) => c.mandatory)
    .reduce<ReadinessState>((worst, c) => (WORST[c.state] > WORST[worst] ? c.state : worst), "READY");

  return {
    state: mandatoryWorst,
    generatedAt: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? "development",
    checks: resolved,
    counts: {
      ready: resolved.filter((c) => c.state === "READY").length,
      warning: resolved.filter((c) => c.state === "WARNING").length,
      blocked: resolved.filter((c) => c.state === "BLOCKED").length,
    },
    blockers: resolved.filter((c) => c.state === "BLOCKED" && c.mandatory).map((c) => c.summary),
  };
}

/**
 * A malformed catalog must degrade to a REPORTED problem rather than a 500
 * from the endpoint whose job is to report problems.
 */
function productChecksSafe(): ReadinessCheck[] {
  try {
    return productChecks();
  } catch (err) {
    return [
      {
        id: "product.readable",
        category: "PRODUCT",
        title: "Product catalog",
        state: "BLOCKED",
        summary: "The product catalog could not be read, so nothing can be priced or sold.",
        action: `Fix config/products.ts: ${err instanceof Error ? err.message : String(err)}`,
        mandatory: true,
        code: "PRODUCT_CATALOG_UNREADABLE",
      },
    ];
  }
}
