import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  conversationClassifications,
  conversations,
  customerNeedProfiles,
  events,
  messages,
  orderLines,
  orders,
  productConfigurations,
  quotes,
  sessions,
} from "@/db/schema";
import { newId } from "./id";

/**
 * Customer-intelligence data access (Session 08).
 *
 * READ-ONLY corpus queries + classification persistence. This module is
 * the only place intelligence code touches the database; the deterministic
 * aggregation logic lives in modules/customer-intelligence and receives
 * plain rows from here. Nothing in this file calls a model, and no count
 * or percentage is computed by AI — aggregates are SQL/JS over real rows.
 *
 * All count/sum casts are ::float8 (NOT ::int) — sums over int4 accumulate
 * as bigint, int4 casts overflow, and int8 arrives as a string from both
 * drivers; float8 parses as a JS number and is integer-exact to 2^53
 * (same reasoning as aiUsageTotalsSince).
 *
 * Classification rows store CONTROLLED-taxonomy labels with per-message
 * evidence; enum membership is enforced by the classifier's zod layer
 * before rows get here (this service bounds shapes/lengths only, so the
 * taxonomy can grow without a storage change).
 */

export type ClassificationRow = typeof conversationClassifications.$inferSelect;
export type SessionRowLite = typeof sessions.$inferSelect;

const periodSchema = z.object({ start: z.date(), end: z.date() });

/* ------------------------------------------------------------------ */
/* Conversations & messages                                            */
/* ------------------------------------------------------------------ */

export async function listConversationsStartedBetween(
  start: Date,
  end: Date,
  agentType = "sales",
  limit = 5000,
): Promise<(typeof conversations.$inferSelect)[]> {
  periodSchema.parse({ start, end });
  const db = await getDb();
  return db
    .select()
    .from(conversations)
    .where(and(eq(conversations.agentType, agentType), gte(conversations.startedAt, start), lt(conversations.startedAt, end)))
    .orderBy(asc(conversations.startedAt))
    .limit(Math.min(limit, 5000));
}

/** Customer messages only, oldest first — classifier input and evidence resolution. */
export async function listUserMessages(conversationId: string, limit = 200) {
  const db = await getDb();
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "user")))
    .orderBy(asc(messages.createdAt))
    .limit(Math.min(limit, 500));
}

/* ------------------------------------------------------------------ */
/* Classification persistence (idempotent processing)                  */
/* ------------------------------------------------------------------ */

export const classificationUpsertSchema = z.object({
  conversationId: z.string().min(1).max(64),
  status: z.enum(["classified", "failed"]),
  classifierVersion: z.string().min(1).max(20),
  promptId: z.string().max(100).optional(),
  promptVersion: z.string().max(20).optional(),
  model: z.string().max(100).optional(),
  errorCode: z.string().max(100).optional(),
  questions: z.array(z.object({ theme: z.string().min(1).max(40), messageId: z.string().min(1).max(64) })).max(200),
  objections: z.array(z.object({ type: z.string().min(1).max(40), messageId: z.string().min(1).max(64) })).max(200),
  unsupportedRequests: z
    .array(
      z.object({
        kind: z.string().min(1).max(40),
        normalized: z.string().min(1).max(160),
        messageId: z.string().min(1).max(64),
        support: z.string().min(1).max(30),
      }),
    )
    .max(100),
  userMessageCount: z.number().int().nonnegative(),
  sourceUpdatedAt: z.date(),
});

export async function upsertConversationClassification(
  input: z.input<typeof classificationUpsertSchema>,
): Promise<ClassificationRow> {
  const parsed = classificationUpsertSchema.parse(input);
  const db = await getDb();
  const now = new Date();
  const values = {
    status: parsed.status,
    classifierVersion: parsed.classifierVersion,
    promptId: parsed.promptId ?? null,
    promptVersion: parsed.promptVersion ?? null,
    model: parsed.model ?? null,
    errorCode: parsed.errorCode ?? null,
    questionsJson: parsed.questions,
    objectionsJson: parsed.objections,
    unsupportedRequestsJson: parsed.unsupportedRequests,
    userMessageCount: parsed.userMessageCount,
    sourceUpdatedAt: parsed.sourceUpdatedAt,
    processedAt: now,
    updatedAt: now,
  };
  const [row] = await db
    .insert(conversationClassifications)
    .values({ id: newId("cls"), conversationId: parsed.conversationId, ...values })
    .onConflictDoUpdate({ target: conversationClassifications.conversationId, set: values })
    .returning();
  return row;
}

export async function getClassificationForConversation(conversationId: string): Promise<ClassificationRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(conversationClassifications)
    .where(eq(conversationClassifications.conversationId, conversationId))
    .limit(1);
  return row ?? null;
}

export async function listClassificationsForConversationIds(ids: string[]): Promise<ClassificationRow[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  return db.select().from(conversationClassifications).where(inArray(conversationClassifications.conversationId, ids));
}

export type ClassificationCandidate = {
  conversation: typeof conversations.$inferSelect;
  latestUserMessageAt: Date;
  userMessageCount: number;
};

/**
 * Conversations that still need classification under `classifierVersion`:
 * never processed, processed by an older classifier, failed last time, or
 * grown new customer messages since. Oldest first, bounded — the explicit
 * processing action drains the backlog batch by batch.
 */
export async function listConversationsNeedingClassification(
  classifierVersion: string,
  limit: number,
  agentType = "sales",
): Promise<ClassificationCandidate[]> {
  const db = await getDb();
  const stats = await db
    .select({
      conversationId: messages.conversationId,
      latest: sql<string | Date>`max(${messages.createdAt})`,
      cnt: sql<number>`count(*)::float8`,
    })
    .from(messages)
    .where(eq(messages.role, "user"))
    .groupBy(messages.conversationId);
  if (stats.length === 0) return [];

  const byConversation = new Map(stats.map((s) => [s.conversationId, s]));
  const convRows = await db
    .select()
    .from(conversations)
    .where(and(inArray(conversations.id, [...byConversation.keys()]), eq(conversations.agentType, agentType)))
    .orderBy(asc(conversations.startedAt));
  const classifications = await db
    .select()
    .from(conversationClassifications)
    .where(inArray(conversationClassifications.conversationId, convRows.map((c) => c.id)));
  const classByConv = new Map(classifications.map((c) => [c.conversationId, c]));

  const out: ClassificationCandidate[] = [];
  for (const conversation of convRows) {
    const stat = byConversation.get(conversation.id);
    if (!stat) continue;
    const latestUserMessageAt = new Date(stat.latest);
    const existing = classByConv.get(conversation.id);
    const needsWork =
      !existing ||
      existing.status === "failed" ||
      existing.classifierVersion !== classifierVersion ||
      existing.sourceUpdatedAt.getTime() < latestUserMessageAt.getTime();
    if (!needsWork) continue;
    out.push({ conversation, latestUserMessageAt, userMessageCount: stat.cnt });
    if (out.length >= limit) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Corpus reads for deterministic aggregation                          */
/* ------------------------------------------------------------------ */

export async function listSessionsByIds(ids: string[]): Promise<SessionRowLite[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  return db.select().from(sessions).where(inArray(sessions.id, ids));
}

export async function listNeedProfilesForSessionIds(ids: string[]) {
  if (ids.length === 0) return [];
  const db = await getDb();
  return db.select().from(customerNeedProfiles).where(inArray(customerNeedProfiles.sessionId, ids));
}

export async function listNeedProfilesUpdatedBetween(start: Date, end: Date, limit = 5000) {
  periodSchema.parse({ start, end });
  const db = await getDb();
  return db
    .select()
    .from(customerNeedProfiles)
    .where(and(gte(customerNeedProfiles.updatedAt, start), lt(customerNeedProfiles.updatedAt, end)))
    .orderBy(desc(customerNeedProfiles.updatedAt))
    .limit(Math.min(limit, 5000));
}

export async function listOrdersCreatedBetween(start: Date, end: Date, limit = 5000) {
  periodSchema.parse({ start, end });
  const db = await getDb();
  return db
    .select()
    .from(orders)
    .where(and(gte(orders.createdAt, start), lt(orders.createdAt, end)))
    .orderBy(asc(orders.createdAt))
    .limit(Math.min(limit, 5000));
}

export async function listOrderLinesForOrderIds(ids: string[]) {
  if (ids.length === 0) return [];
  const db = await getDb();
  return db.select().from(orderLines).where(inArray(orderLines.orderId, ids));
}

export async function listConfigurationsUpdatedBetween(start: Date, end: Date, limit = 5000) {
  periodSchema.parse({ start, end });
  const db = await getDb();
  return db
    .select()
    .from(productConfigurations)
    .where(and(gte(productConfigurations.updatedAt, start), lt(productConfigurations.updatedAt, end)))
    .orderBy(asc(productConfigurations.updatedAt))
    .limit(Math.min(limit, 5000));
}

/** Distinct sessions (among `sessionIds`) holding ≥1 event named in `names`. */
export async function sessionIdsWithEvents(sessionIds: string[], names: readonly string[]): Promise<Set<string>> {
  if (sessionIds.length === 0 || names.length === 0) return new Set();
  const db = await getDb();
  const rows = await db
    .selectDistinct({ sessionId: events.sessionId })
    .from(events)
    .where(and(inArray(events.sessionId, sessionIds), inArray(events.name, [...names])));
  return new Set(rows.map((r) => r.sessionId));
}

export type EventNameCount = { name: string; events: number; sessions: number };

/** Deterministic event counts per name in [start, end) — raw count + distinct sessions. */
export async function countEventsByName(start: Date, end: Date): Promise<EventNameCount[]> {
  periodSchema.parse({ start, end });
  const db = await getDb();
  return db
    .select({
      name: events.name,
      events: sql<number>`count(*)::float8`,
      sessions: sql<number>`count(distinct ${events.sessionId})::float8`,
    })
    .from(events)
    .where(and(gte(events.occurredAt, start), lt(events.occurredAt, end)))
    .groupBy(events.name);
}

/** Order counts in [start, end) from the authoritative orders table. */
export async function countOrdersBetween(start: Date, end: Date): Promise<{ total: number; aiAssisted: number }> {
  periodSchema.parse({ start, end });
  const db = await getDb();
  const [row] = await db
    .select({
      total: sql<number>`count(*)::float8`,
      aiAssisted: sql<number>`count(*) filter (where ${orders.aiAssisted})::float8`,
    })
    .from(orders)
    .where(and(gte(orders.createdAt, start), lt(orders.createdAt, end)));
  return { total: row?.total ?? 0, aiAssisted: row?.aiAssisted ?? 0 };
}

/* ------------------------------------------------------------------ */
/* Evidence resolution (admin drill-down)                              */
/* ------------------------------------------------------------------ */

export type EvidenceItem =
  | { table: "conversations"; id: string; startedAt: Date; status: string; outcome: string | null }
  | { table: "messages"; id: string; conversationId: string; role: string; excerpt: string; createdAt: Date }
  | {
      table: "customer_need_profiles";
      id: string;
      businessType: string | null;
      quantity: number | null;
      productInterest: string | null;
      updatedAt: Date;
    }
  | { table: "orders"; id: string; totalCents: number; currency: string; aiAssisted: boolean; createdAt: Date }
  | { table: "quotes"; id: string; status: string; createdAt: Date }
  | {
      table: "product_configurations";
      id: string;
      productId: string;
      quantity: number | null;
      updatedAt: Date;
    };

export type ResolvedEvidence = {
  items: EvidenceItem[];
  /** Refs whose rows no longer exist — deleted data stays deleted; we say so instead of pretending. */
  missing: number;
};

const EXCERPT_MAX = 240;

/**
 * Resolve stored source refs to minimal, PII-conscious views for the admin
 * evidence drill-down. Rows removed by privacy deletion simply don't
 * resolve — they are COUNTED as missing, never reconstructed. Message
 * excerpts are bounded; quote payloads (contact PII) are never exposed.
 */
export async function resolveEvidenceRefs(refs: { table: string; id: string }[]): Promise<ResolvedEvidence> {
  const db = await getDb();
  const byTable = new Map<string, string[]>();
  for (const ref of refs.slice(0, 500)) {
    const list = byTable.get(ref.table) ?? [];
    list.push(ref.id);
    byTable.set(ref.table, list);
  }
  const items: EvidenceItem[] = [];
  let found = 0;

  const convIds = byTable.get("conversations") ?? [];
  if (convIds.length > 0) {
    const rows = await db.select().from(conversations).where(inArray(conversations.id, convIds));
    found += rows.length;
    for (const r of rows) items.push({ table: "conversations", id: r.id, startedAt: r.startedAt, status: r.status, outcome: r.outcome });
  }
  const msgIds = byTable.get("messages") ?? [];
  if (msgIds.length > 0) {
    const rows = await db.select().from(messages).where(inArray(messages.id, msgIds));
    found += rows.length;
    for (const r of rows) {
      const excerpt = r.content.length > EXCERPT_MAX ? `${r.content.slice(0, EXCERPT_MAX)}…` : r.content;
      items.push({ table: "messages", id: r.id, conversationId: r.conversationId, role: r.role, excerpt, createdAt: r.createdAt });
    }
  }
  const profileIds = byTable.get("customer_need_profiles") ?? [];
  if (profileIds.length > 0) {
    const rows = await db.select().from(customerNeedProfiles).where(inArray(customerNeedProfiles.id, profileIds));
    found += rows.length;
    for (const r of rows)
      items.push({
        table: "customer_need_profiles",
        id: r.id,
        businessType: r.businessType,
        quantity: r.quantity,
        productInterest: r.productInterest,
        updatedAt: r.updatedAt,
      });
  }
  const orderIds = byTable.get("orders") ?? [];
  if (orderIds.length > 0) {
    const rows = await db.select().from(orders).where(inArray(orders.id, orderIds));
    found += rows.length;
    for (const r of rows)
      items.push({ table: "orders", id: r.id, totalCents: r.totalCents, currency: r.currency, aiAssisted: r.aiAssisted, createdAt: r.createdAt });
  }
  const quoteIds = byTable.get("quotes") ?? [];
  if (quoteIds.length > 0) {
    const rows = await db.select().from(quotes).where(inArray(quotes.id, quoteIds));
    found += rows.length;
    for (const r of rows) items.push({ table: "quotes", id: r.id, status: r.status, createdAt: r.createdAt });
  }
  const configIds = byTable.get("product_configurations") ?? [];
  if (configIds.length > 0) {
    const rows = await db.select().from(productConfigurations).where(inArray(productConfigurations.id, configIds));
    found += rows.length;
    for (const r of rows)
      items.push({
        table: "product_configurations",
        id: r.id,
        productId: r.productId,
        quantity: r.configJson?.quantity ?? null,
        updatedAt: r.updatedAt,
      });
  }

  const requested = Math.min(refs.length, 500);
  return { items, missing: Math.max(0, requested - found) };
}
