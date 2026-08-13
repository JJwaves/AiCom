import { z } from "zod";
import { CUSTOMER_INTELLIGENCE } from "@/config/customer-intelligence";
import type { MessageRow } from "@/lib/data/conversation-service";
import {
  OBJECTION_TYPES,
  QUESTION_THEMES,
  REQUEST_KINDS,
} from "@/modules/customer-intelligence/taxonomy";
import type { AiRuntime } from "../../runtime";
import { aiLog } from "../../log";

/**
 * LOW_COST controlled-taxonomy classification of one conversation's
 * CUSTOMER messages (Session 08 spec §11).
 *
 * The model may only LABEL — enums are closed (zod-enforced), and every
 * label must point at a real customer message: a messageId that is not in
 * the transcript we actually sent is DROPPED server-side, so fabricated
 * evidence cannot survive into storage. Duplicated (message, label) pairs
 * collapse to one. Counting, deduplication to conversation level, catalog
 * support, and every percentage happen deterministically elsewhere
 * (modules/customer-intelligence) — never here, never in the model.
 */

export const classifierOutputSchema = z.object({
  questions: z.array(z.object({ theme: z.enum(QUESTION_THEMES), messageId: z.string().max(64) })).max(60),
  objections: z.array(z.object({ type: z.enum(OBJECTION_TYPES), messageId: z.string().max(64) })).max(60),
  requests: z
    .array(
      z.object({
        kind: z.enum(REQUEST_KINDS),
        normalized: z.string().min(1).max(120),
        messageId: z.string().max(64),
      }),
    )
    .max(20),
});

export type ClassifierOutput = z.infer<typeof classifierOutputSchema>;

export type ValidatedClassification = {
  questions: { theme: (typeof QUESTION_THEMES)[number]; messageId: string }[];
  objections: { type: (typeof OBJECTION_TYPES)[number]; messageId: string }[];
  requests: { kind: (typeof REQUEST_KINDS)[number]; normalized: string; messageId: string }[];
  /** Labels the server dropped because their messageId was not in the transcript sent. */
  droppedLabels: number;
  userMessageCount: number;
  sourceUpdatedAt: Date;
  model: string | null;
};

/** Bounded classifier input: "[msg_…] first 500 chars" per customer message. */
export function buildClassifierInput(userMessages: MessageRow[]): { text: string; included: MessageRow[] } {
  const included = userMessages.slice(0, CUSTOMER_INTELLIGENCE.MAX_USER_MESSAGES_PER_CLASSIFICATION);
  const lines = included.map((m) => {
    const content =
      m.content.length > CUSTOMER_INTELLIGENCE.MAX_MESSAGE_CHARS
        ? `${m.content.slice(0, CUSTOMER_INTELLIGENCE.MAX_MESSAGE_CHARS)}…`
        : m.content;
    return `[${m.id}] ${content.replace(/\n+/g, " ")}`;
  });
  return { text: lines.join("\n"), included };
}

/**
 * Classify one conversation's customer messages. Throws AiError on
 * provider/budget/validation failure — the caller decides how each error
 * class affects the batch (lib/ai/agents/customer-intelligence/process.ts).
 */
export async function classifyConversation(
  runtime: AiRuntime,
  input: { conversationId: string; sessionId?: string; userMessages: MessageRow[] },
): Promise<ValidatedClassification> {
  const { text, included } = buildClassifierInput(input.userMessages);
  const latest = included[included.length - 1]?.createdAt ?? new Date(0);

  const raw = await runtime.generateStructuredObject({
    workload: "LOW_COST",
    prompt: { id: "ai_customer_intelligence_classifier" },
    messages: [{ role: "user", content: text.length > 0 ? text : "(no customer messages)" }],
    schema: classifierOutputSchema,
    agentType: "customer_intelligence",
    sessionId: input.sessionId,
    conversationId: input.conversationId,
  });

  // Server-side evidence validation: only labels pointing at messages we
  // actually sent survive; duplicates collapse.
  const validIds = new Set(included.map((m) => m.id));
  let dropped = 0;

  const seenQ = new Set<string>();
  const questions: ValidatedClassification["questions"] = [];
  for (const q of raw.questions) {
    if (!validIds.has(q.messageId)) {
      dropped += 1;
      continue;
    }
    const key = `${q.theme}:${q.messageId}`;
    if (seenQ.has(key)) continue;
    seenQ.add(key);
    questions.push(q);
  }

  const seenO = new Set<string>();
  const objections: ValidatedClassification["objections"] = [];
  for (const o of raw.objections) {
    if (!validIds.has(o.messageId)) {
      dropped += 1;
      continue;
    }
    const key = `${o.type}:${o.messageId}`;
    if (seenO.has(key)) continue;
    seenO.add(key);
    objections.push(o);
  }

  const seenR = new Set<string>();
  const requests: ValidatedClassification["requests"] = [];
  for (const r of raw.requests) {
    if (!validIds.has(r.messageId)) {
      dropped += 1;
      continue;
    }
    const normalized = r.normalized.toLowerCase().trim();
    if (normalized.length === 0) continue;
    const key = `${r.kind}:${normalized}:${r.messageId}`;
    if (seenR.has(key)) continue;
    seenR.add(key);
    requests.push({ ...r, normalized });
  }

  if (dropped > 0) {
    aiLog("classifier_labels_dropped", { conversationId: input.conversationId, dropped });
  }

  return {
    questions,
    objections,
    requests,
    droppedLabels: dropped,
    userMessageCount: included.length,
    sourceUpdatedAt: latest,
    model: null,
  };
}
