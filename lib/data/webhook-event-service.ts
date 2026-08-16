import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { providerWebhookEvents } from "@/db/schema";
import { newId } from "./id";

/**
 * Exactly-once webhook processing (Production Launch Session 02 §15).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE IDEMPOTENCY KEY IS NOT THE DELIVERY ID
 * ─────────────────────────────────────────────────────────────────────────
 * Shopify sends `X-Shopify-Webhook-Id`, and it is tempting to dedupe on it.
 * It is the wrong key. A merchant re-sending the same event from the admin
 * gets a NEW delivery id for the SAME business fact, so delivery-id dedupe
 * would process that order's payment twice — double revenue, double
 * purchase event, double attribution.
 *
 * The key is instead (provider, topic, SUBJECT id): the order id for order
 * topics, the refund id for refund topics. That is stable across retries,
 * across manual re-sends, and across Shopify changing its delivery
 * infrastructure. The delivery id is stored anyway, for diagnostics only.
 *
 * The claim is a UNIQUE INSERT, not a read-then-write: two deliveries racing
 * each other cannot both observe "not processed yet", because the database
 * decides which one wins.
 */

export type WebhookClaim =
  | { claimed: true; id: string }
  | { claimed: false; reason: "already_processed" };

export async function claimWebhookEvent(input: {
  provider: string;
  topic: string;
  providerEventId: string;
  deliveryId?: string | null;
}): Promise<WebhookClaim> {
  const db = await getDb();
  const id = newId("whe");
  const inserted = await db
    .insert(providerWebhookEvents)
    .values({
      id,
      provider: input.provider,
      topic: input.topic,
      providerEventId: input.providerEventId,
      deliveryId: input.deliveryId ?? null,
      outcome: "processing",
    })
    .onConflictDoNothing({
      target: [providerWebhookEvents.provider, providerWebhookEvents.topic, providerWebhookEvents.providerEventId],
    })
    .returning();

  return inserted.length > 0 ? { claimed: true, id } : { claimed: false, reason: "already_processed" };
}

export async function completeWebhookEvent(input: {
  id: string;
  outcome: "processed" | "ignored" | "failed";
  orderId?: string | null;
  detail?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db
    .update(providerWebhookEvents)
    .set({
      outcome: input.outcome,
      orderId: input.orderId ?? null,
      detail: input.detail ? input.detail.slice(0, 500) : null,
    })
    .where(eq(providerWebhookEvents.id, input.id));
}

/**
 * Release a claim whose processing threw. Without this a transient database
 * blip would permanently swallow the event: the claim row would exist, so
 * Shopify's retry would be treated as a duplicate and skipped, and the order
 * would never be reconciled. Releasing makes the retry work as intended.
 */
export async function releaseWebhookEvent(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(providerWebhookEvents).where(eq(providerWebhookEvents.id, id));
}

export async function findWebhookEvent(input: {
  provider: string;
  topic: string;
  providerEventId: string;
}): Promise<typeof providerWebhookEvents.$inferSelect | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(providerWebhookEvents)
    .where(
      and(
        eq(providerWebhookEvents.provider, input.provider),
        eq(providerWebhookEvents.topic, input.topic),
        eq(providerWebhookEvents.providerEventId, input.providerEventId),
      ),
    )
    .limit(1);
  return row ?? null;
}
