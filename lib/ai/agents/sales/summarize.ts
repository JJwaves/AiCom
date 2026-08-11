import {
  listMessages,
  updateConversationSummary,
  type ConversationRow,
} from "@/lib/data/conversation-service";
import type { AiRuntime } from "../../runtime";
import { aiLog } from "../../log";

/**
 * Threshold-based conversation summarization (Session 05 spec §11).
 *
 * Purpose: context compression for later turns, human handoff, future
 * Customer Intelligence, and session continuation. NOT run after every
 * message — only when SUMMARY_EVERY_MESSAGES new customer/assistant turns
 * accumulated since the last summary. LOW_COST workload. The summary is a
 * derived view stored on conversations.summaryJson; raw message rows are
 * never touched.
 */

export const SUMMARY_EVERY_MESSAGES = 6;
const MAX_TRANSCRIPT_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 500;
const MAX_SUMMARY_CHARS = 2000;

export type ConversationSummary = {
  text: string;
  /** How many user+assistant messages the summary covers (threshold cursor). */
  coveredMessages: number;
  promptVersion: string;
  updatedAt: string;
};

export async function maybeSummarizeConversation(opts: {
  runtime: AiRuntime;
  conversation: ConversationRow;
  sessionId: string;
}): Promise<ConversationSummary | null> {
  const all = await listMessages(opts.conversation.id);
  const transcript = all.filter((m) => m.role === "user" || m.role === "assistant");
  const covered =
    typeof opts.conversation.summaryJson?.coveredMessages === "number"
      ? (opts.conversation.summaryJson.coveredMessages as number)
      : 0;
  if (transcript.length - covered < SUMMARY_EVERY_MESSAGES) return null;

  const rendered = transcript
    .slice(-MAX_TRANSCRIPT_MESSAGES)
    .map((m) => `${m.role === "user" ? "Customer" : "Expert"}: ${m.content.slice(0, MAX_MESSAGE_CHARS)}`)
    .join("\n");

  const result = await opts.runtime.generateText({
    workload: "LOW_COST",
    prompt: { id: "ai_sales_summary" },
    messages: [{ role: "user", content: rendered }],
    agentType: "sales",
    sessionId: opts.sessionId,
    conversationId: opts.conversation.id,
  });

  const summary: ConversationSummary = {
    text: result.text.slice(0, MAX_SUMMARY_CHARS),
    coveredMessages: transcript.length,
    promptVersion: "1.0.0",
    updatedAt: new Date().toISOString(),
  };
  await updateConversationSummary(opts.conversation.id, summary);
  aiLog("conversation_summarized", {
    conversationId: opts.conversation.id,
    coveredMessages: transcript.length,
  });
  return summary;
}
