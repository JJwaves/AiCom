import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { conversations, sessions } from "@/db/schema";
import { appendMessage, startConversation, type ConversationRow, type MessageRow } from "@/lib/data/conversation-service";
import { upsertConversationClassification } from "@/lib/data/intelligence-service";
import { CLASSIFIER_VERSION } from "@/modules/customer-intelligence";

/**
 * Customer-intelligence test fixtures (Session 08). These are TEST-ONLY
 * seeds driving the real services — production intelligence can only ever
 * come from real rows, and nothing here runs outside vitest.
 */

export async function seedConversation(
  sessionId: string,
  userMessages: string[],
): Promise<{ conversation: ConversationRow; messages: MessageRow[] }> {
  const conversation = await startConversation({ sessionId });
  const messages: MessageRow[] = [];
  for (const content of userMessages) {
    messages.push(await appendMessage({ conversationId: conversation.id, role: "user", content }));
    await appendMessage({ conversationId: conversation.id, role: "assistant", content: "Happy to help." });
  }
  return { conversation, messages };
}

/** Persist a classification row directly (aggregation tests don't need a model). */
export async function seedClassification(
  conversationId: string,
  input: {
    questions?: { theme: string; messageId: string }[];
    objections?: { type: string; messageId: string }[];
    requests?: { kind: string; normalized: string; messageId: string; support: string }[];
    sourceUpdatedAt?: Date;
    classifierVersion?: string;
    status?: "classified" | "failed";
  } = {},
) {
  return upsertConversationClassification({
    conversationId,
    status: input.status ?? "classified",
    classifierVersion: input.classifierVersion ?? CLASSIFIER_VERSION,
    questions: input.questions ?? [],
    objections: input.objections ?? [],
    unsupportedRequests: input.requests ?? [],
    userMessageCount: 1,
    sourceUpdatedAt: input.sourceUpdatedAt ?? new Date(),
  });
}

/** Backdate a conversation into a specific period (tests only). */
export async function setConversationStartedAt(conversationId: string, startedAt: Date): Promise<void> {
  const db = await getDb();
  await db.update(conversations).set({ startedAt }).where(eq(conversations.id, conversationId));
}

export async function setConversationOutcome(
  conversationId: string,
  outcome: string | null,
  status?: string,
): Promise<void> {
  const db = await getDb();
  await db
    .update(conversations)
    .set({ outcome, ...(status ? { status } : {}) })
    .where(eq(conversations.id, conversationId));
}

export async function setSessionFirstTouch(
  sessionId: string,
  params: Record<string, string>,
): Promise<void> {
  const db = await getDb();
  await db
    .update(sessions)
    .set({ firstTouchJson: { params, landing_page: "/", referrer: "", ts: new Date().toISOString() } })
    .where(eq(sessions.id, sessionId));
}

export function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}
