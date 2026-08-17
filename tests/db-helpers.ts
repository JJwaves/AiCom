import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureSession, type SessionRow } from "@/lib/data/session-service";

/** Wipe every table — deterministic isolation regardless of worker reuse. */
export async function resetDb(): Promise<void> {
  const db = await getDb();
  await db.execute(sql`
    TRUNCATE TABLE
      "google_ads_sync_runs", "ad_campaign_daily_metrics", "ad_accounts",
      "google_ads_reports",
      "experiment_assignments", "experiments",
      "product_opportunities", "customer_insights",
      "conversation_classifications", "ceo_reports", "pricing_reports",
      "agent_action_events", "guardrail_evaluations", "agent_actions",
      "agent_configs", "approvals", "agent_decisions", "ai_usage",
      "customer_need_profiles", "messages", "conversations",
      "human_handoffs", "commerce_reconciliation_runs", "rate_limit_counters",
      "events", "artworks", "quotes", "provider_webhook_events", "order_lines", "orders",
      "product_configurations", "sessions", "customers", "businesses"
    CASCADE
  `);
}

export async function makeSession(): Promise<SessionRow> {
  const { session } = await ensureSession({ userAgent: "vitest" });
  return session;
}
