import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { createPendingArtwork, markArtworkUploaded } from "@/lib/data/artwork-service";
import { ensureSession, SESSION_COOKIE, type SessionRow } from "@/lib/data/session-service";
import type { ArtworkRef } from "@/types/commerce";

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

/**
 * A durable, server-verified artwork owned by a real session — exactly what
 * the upload flow produces.
 *
 * The launch product prints custom artwork on every order, so almost every
 * commerce test needs one: a printed line without a durable `artworkId` is
 * refused at checkout by design.
 */
export async function uploadedArtwork(session?: SessionRow): Promise<{
  session: SessionRow;
  cookie: string;
  artwork: ArtworkRef & { artworkId: string };
}> {
  const owner = session ?? (await makeSession());
  const row = await createPendingArtwork({
    sessionId: owner.id,
    fileName: "logo.png",
    fileType: "image/png",
    sizeBytes: 2048,
    storageKey: `artwork/test/${owner.id}.png`,
    storageProvider: "fake",
  });
  await markArtworkUploaded({ id: row.id, sizeBytes: 2048, fileType: "image/png" });
  return {
    session: owner,
    cookie: `${SESSION_COOKIE}=${owner.id}`,
    artwork: { artworkId: row.id, fileName: "logo.png", fileType: "image/png", fileSizeBytes: 2048 },
  };
}
