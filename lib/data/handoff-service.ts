import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { humanHandoffs } from "@/db/schema";
import { newId } from "./id";

/**
 * Human handoff records (Production Launch Session 03 §20–§23).
 *
 * PERSISTENCE IS PRIMARY. The row is written before any delivery is
 * attempted, and a delivery failure updates the row rather than losing it.
 * That ordering is the whole design: the AI may tell a customer their
 * request has been RECORDED (which this makes true), and must never tell
 * them a human has been NOTIFIED (which depends on a system BagDirect does
 * not own).
 */

export const HANDOFF_DELIVERY_STATUSES = ["pending", "delivered", "failed", "not_configured"] as const;
export type HandoffDeliveryStatus = (typeof HANDOFF_DELIVERY_STATUSES)[number];

export type HumanHandoffRow = typeof humanHandoffs.$inferSelect;

export type CreateHandoffInput = {
  conversationId: string;
  sessionId: string | null;
  customerId?: string | null;
  reason: string;
  requirementSummary: string;
  customerQuestion?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  productId?: string | null;
};

export async function createHandoff(input: CreateHandoffInput): Promise<HumanHandoffRow> {
  const db = await getDb();
  const [row] = await db
    .insert(humanHandoffs)
    .values({
      id: newId("hand"),
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      customerId: input.customerId ?? null,
      reason: input.reason,
      requirementSummary: input.requirementSummary,
      customerQuestion: input.customerQuestion ?? null,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      productId: input.productId ?? null,
      deliveryStatus: "pending",
    })
    .returning();
  return row;
}

export async function getHandoff(id: string): Promise<HumanHandoffRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(humanHandoffs).where(eq(humanHandoffs.id, id)).limit(1);
  return row ?? null;
}

/**
 * Record the outcome of a delivery ATTEMPT.
 *
 * `attempts` is incremented in SQL rather than read-then-written: a retry
 * from the admin surface and an automatic attempt can overlap, and an
 * attempt count that silently loses one is a count nobody can trust.
 */
export async function recordHandoffDelivery(input: {
  id: string;
  status: HandoffDeliveryStatus;
  error?: string | null;
  at?: Date;
}): Promise<HumanHandoffRow | null> {
  const db = await getDb();
  const at = input.at ?? new Date();
  const [row] = await db
    .update(humanHandoffs)
    .set({
      deliveryStatus: input.status,
      deliveryAttempts: sql`${humanHandoffs.deliveryAttempts} + 1`,
      lastAttemptAt: at,
      deliveredAt: input.status === "delivered" ? at : undefined,
      // A safe, bounded description. Cleared on success so a stale failure
      // never sits next to a delivered row.
      lastError: input.status === "delivered" ? null : (input.error ?? null)?.slice(0, 500) ?? null,
      updatedAt: at,
    })
    .where(eq(humanHandoffs.id, input.id))
    .returning();
  return row ?? null;
}

/** Owner workflow: "I have dealt with this." Never set by the AI or the customer. */
export async function markHandoffHandled(input: { id: string; handledBy: string }): Promise<HumanHandoffRow | null> {
  const db = await getDb();
  const now = new Date();
  const [row] = await db
    .update(humanHandoffs)
    .set({ handledAt: now, handledBy: input.handledBy, updatedAt: now })
    .where(eq(humanHandoffs.id, input.id))
    .returning();
  return row ?? null;
}

export async function listHandoffs(options: { limit?: number; status?: HandoffDeliveryStatus } = {}): Promise<HumanHandoffRow[]> {
  const db = await getDb();
  const limit = Math.min(options.limit ?? 100, 500);
  const where = options.status ? and(eq(humanHandoffs.deliveryStatus, options.status)) : undefined;
  return db
    .select()
    .from(humanHandoffs)
    .where(where)
    .orderBy(desc(humanHandoffs.createdAt))
    .limit(limit);
}

/** Counts for the admin header and the readiness surface. */
export async function handoffCounts(): Promise<{
  total: number;
  pending: number;
  delivered: number;
  failed: number;
  notConfigured: number;
  unhandled: number;
}> {
  const db = await getDb();
  const rows = await db
    .select({ status: humanHandoffs.deliveryStatus, count: sql<number>`count(*)::int` })
    .from(humanHandoffs)
    .groupBy(humanHandoffs.deliveryStatus);
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.count)])) as Record<string, number>;
  const [unhandledRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(humanHandoffs)
    .where(sql`${humanHandoffs.handledAt} is null`);
  return {
    total: Object.values(by).reduce((sum, n) => sum + n, 0),
    pending: by.pending ?? 0,
    delivered: by.delivered ?? 0,
    failed: by.failed ?? 0,
    notConfigured: by.not_configured ?? 0,
    unhandled: Number(unhandledRow?.count ?? 0),
  };
}
