import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureSession, type SessionRow } from "@/lib/data/session-service";

/** Wipe every table — deterministic isolation regardless of worker reuse. */
export async function resetDb(): Promise<void> {
  const db = await getDb();
  await db.execute(sql`
    TRUNCATE TABLE
      "experiment_assignments", "experiments",
      "product_opportunities", "customer_insights",
      "conversation_classifications",
      "agent_configs", "approvals", "agent_decisions", "ai_usage",
      "customer_need_profiles", "messages", "conversations",
      "events", "artworks", "quotes", "order_lines", "orders",
      "product_configurations", "sessions", "customers", "businesses"
    CASCADE
  `);
}

export async function makeSession(): Promise<SessionRow> {
  const { session } = await ensureSession({ userAgent: "vitest" });
  return session;
}
