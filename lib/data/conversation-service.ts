import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { conversations, messages } from "@/db/schema";
import type { ProductConfiguration } from "@/types/commerce";
import { newId } from "./id";

/**
 * Conversation + Message persistence for the upcoming AI Sales Agent
 * (Session 04+ wires the model; this session lands storage only).
 *
 * Raw transcript vs structured intelligence stay SEPARATE: messages are the
 * evidence and are never destroyed by extraction (CustomerNeedProfile and
 * conversation summaries are derived views). Privacy deletion is the
 * explicit exception — deleting a conversation/session cascades messages.
 *
 * `system` rows are internal. No customer-facing API may return them —
 * enforce at every future read surface (none exists yet).
 */

export const MESSAGE_ROLES = ["user", "assistant", "tool", "system"] as const;

export const conversationStartSchema = z.object({
  sessionId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  agentType: z.string().min(1).max(50).default("sales"),
  productId: z.string().max(100).optional(),
  configurationId: z.string().max(100).optional(),
});

export const messageInputSchema = z.object({
  conversationId: z.string().min(1),
  role: z.enum(MESSAGE_ROLES),
  content: z.string().min(1).max(20_000),
  structured: z.record(z.string(), z.unknown()).optional(),
  toolName: z.string().max(100).optional(),
  toolCallId: z.string().max(100).optional(),
  toolResult: z.record(z.string(), z.unknown()).optional(),
  model: z.string().max(100).optional(),
  configSnapshot: z.custom<ProductConfiguration>().optional(),
});

export const CONVERSATION_OUTCOMES = [
  "abandoned",
  "quote_started",
  "checkout_started",
  "purchased",
  "escalated",
] as const;

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

export async function startConversation(input: z.input<typeof conversationStartSchema>): Promise<ConversationRow> {
  const parsed = conversationStartSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(conversations)
    .values({
      id: newId("conv"),
      sessionId: parsed.sessionId,
      customerId: parsed.customerId ?? null,
      agentType: parsed.agentType,
      productId: parsed.productId ?? null,
      configurationId: parsed.configurationId ?? null,
    })
    .returning();
  return row;
}

export async function appendMessage(input: z.input<typeof messageInputSchema>): Promise<MessageRow> {
  const parsed = messageInputSchema.parse(input);
  const db = await getDb();
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, parsed.conversationId))
    .limit(1);
  if (!conversation) throw new Error(`Unknown conversation "${parsed.conversationId}"`);

  const [row] = await db
    .insert(messages)
    .values({
      id: newId("msg"),
      conversationId: parsed.conversationId,
      role: parsed.role,
      content: parsed.content,
      structuredJson: parsed.structured ?? null,
      toolName: parsed.toolName ?? null,
      toolCallId: parsed.toolCallId ?? null,
      toolResultJson: parsed.toolResult ?? null,
      model: parsed.model ?? null,
      configSnapshotJson: parsed.configSnapshot ?? null,
    })
    .returning();
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, parsed.conversationId));
  return row;
}

export async function endConversation(input: {
  conversationId: string;
  outcome?: (typeof CONVERSATION_OUTCOMES)[number];
  status?: "ended" | "escalated";
  summary?: Record<string, unknown>;
}): Promise<void> {
  if (input.outcome && !CONVERSATION_OUTCOMES.includes(input.outcome)) {
    throw new Error(`Invalid conversation outcome "${input.outcome}"`);
  }
  const db = await getDb();
  await db
    .update(conversations)
    .set({
      status: input.status ?? "ended",
      outcome: input.outcome ?? null,
      summaryJson: input.summary ?? null,
      endedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, input.conversationId));
}

/**
 * The session's current conversation for an agent: the most recent one that
 * is still `active` — or `escalated`, so a customer keeps chatting in the
 * same thread after a human handoff instead of silently forking a new one.
 * `ended` conversations are never resumed.
 */
export async function findActiveConversation(
  sessionId: string,
  agentType = "sales",
): Promise<ConversationRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.sessionId, sessionId),
        eq(conversations.agentType, agentType),
        inArray(conversations.status, ["active", "escalated"]),
      ),
    )
    .orderBy(desc(conversations.startedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Stamp a commerce outcome on the session's active sales conversation
 * WITHOUT ending it (S06): a customer who starts checkout or a quote after
 * chatting can keep chatting. Escalated conversations keep their escalated
 * outcome (a handoff in motion outranks a funnel stamp). No-op when the
 * session has no live conversation.
 */
export async function markConversationOutcomeForSession(
  sessionId: string,
  outcome: Extract<(typeof CONVERSATION_OUTCOMES)[number], "quote_started" | "checkout_started" | "purchased">,
): Promise<void> {
  const conversation = await findActiveConversation(sessionId, "sales");
  if (!conversation || conversation.status === "escalated") return;
  // purchased outranks checkout_started; never downgrade.
  if (conversation.outcome === "purchased" && outcome !== "purchased") return;
  const db = await getDb();
  await db
    .update(conversations)
    .set({ outcome, updatedAt: new Date() })
    .where(eq(conversations.id, conversation.id));
}

/**
 * Human-handoff state: the conversation is marked escalated but NOT ended —
 * the customer can keep talking while a human follows up. endConversation
 * remains the terminal transition.
 */
export async function markConversationEscalated(conversationId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(conversations)
    .set({ status: "escalated", outcome: "escalated", updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

/** Derived rolling summary — never a substitute for raw messages (they are kept verbatim). */
export async function updateConversationSummary(
  conversationId: string,
  summary: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  await db
    .update(conversations)
    .set({ summaryJson: summary, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

export async function getConversation(id: string): Promise<ConversationRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return row ?? null;
}

export async function listMessages(conversationId: string): Promise<MessageRow[]> {
  const db = await getDb();
  return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));
}

/** Privacy deletion — removes the conversation AND its raw messages (FK cascade). */
export async function deleteConversation(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(conversations).where(eq(conversations.id, id));
}
