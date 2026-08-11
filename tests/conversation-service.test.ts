import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { messages } from "@/db/schema";
import {
  appendMessage,
  deleteConversation,
  endConversation,
  getConversation,
  listMessages,
  startConversation,
} from "@/lib/data/conversation-service";
import { makeSession, resetDb } from "./db-helpers";

describe("conversation persistence", () => {
  beforeEach(resetDb);

  it("creates a conversation and reads the raw transcript back in order", async () => {
    const session = await makeSession();
    const conversation = await startConversation({ sessionId: session.id, productId: "p-1" });
    expect(conversation.id).toMatch(/^conv_/);
    expect(conversation.agentType).toBe("sales");
    expect(conversation.status).toBe("active");

    await appendMessage({ conversationId: conversation.id, role: "user", content: "I run a Thai restaurant." });
    await appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Great — how many takeout orders per day?",
      model: "test-model",
    });
    await appendMessage({
      conversationId: conversation.id,
      role: "tool",
      content: "{}",
      toolName: "calculatePrice",
      toolCallId: "call_1",
      toolResult: { unitPriceCents: 42 },
    });

    const transcript = await listMessages(conversation.id);
    expect(transcript.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(transcript[0].content).toBe("I run a Thai restaurant.");
    expect(transcript[2].toolName).toBe("calculatePrice");
    expect(transcript[2].toolResultJson).toEqual({ unitPriceCents: 42 });
  });

  it("records an outcome + structured summary without touching raw messages", async () => {
    const session = await makeSession();
    const conversation = await startConversation({ sessionId: session.id });
    await appendMessage({ conversationId: conversation.id, role: "user", content: "hello" });
    await endConversation({
      conversationId: conversation.id,
      outcome: "quote_started",
      summary: { businessType: "restaurant", quantity: 5000 },
    });

    const row = await getConversation(conversation.id);
    expect(row?.status).toBe("ended");
    expect(row?.outcome).toBe("quote_started");
    expect(row?.summaryJson).toEqual({ businessType: "restaurant", quantity: 5000 });
    expect(row?.endedAt).toBeInstanceOf(Date);
    expect(await listMessages(conversation.id)).toHaveLength(1); // extraction never destroys transcript
  });

  it("validates roles, outcomes, content bounds, and conversation existence", async () => {
    const session = await makeSession();
    const conversation = await startConversation({ sessionId: session.id });
    await expect(
      appendMessage({ conversationId: conversation.id, role: "hacker" as never, content: "x" }),
    ).rejects.toThrow();
    await expect(
      appendMessage({ conversationId: conversation.id, role: "user", content: "x".repeat(20_001) }),
    ).rejects.toThrow();
    await expect(appendMessage({ conversationId: "conv_missing", role: "user", content: "x" })).rejects.toThrow(
      /unknown conversation/i,
    );
    await expect(
      endConversation({ conversationId: conversation.id, outcome: "won_lottery" as never }),
    ).rejects.toThrow();
    await expect(startConversation({ sessionId: `sess_${"0".repeat(32)}` })).rejects.toThrow(); // FK: real session required
  });

  it("privacy deletion cascades raw messages", async () => {
    const session = await makeSession();
    const conversation = await startConversation({ sessionId: session.id });
    await appendMessage({ conversationId: conversation.id, role: "user", content: "delete me" });
    await deleteConversation(conversation.id);

    expect(await getConversation(conversation.id)).toBeNull();
    const db = await getDb();
    expect(await db.select().from(messages).where(eq(messages.conversationId, conversation.id))).toHaveLength(0);
  });
});

describe("conversation outcome stamping (Session 06)", () => {
  beforeEach(resetDb);

  it("stamps checkout_started/purchased on the active sales conversation without ending it", async () => {
    const { markConversationOutcomeForSession } = await import("@/lib/data/conversation-service");
    const session = await makeSession();
    const conversation = await startConversation({ sessionId: session.id });

    await markConversationOutcomeForSession(session.id, "checkout_started");
    let row = await getConversation(conversation.id);
    expect(row?.outcome).toBe("checkout_started");
    expect(row?.status).toBe("active"); // customer can keep chatting

    await markConversationOutcomeForSession(session.id, "purchased");
    row = await getConversation(conversation.id);
    expect(row?.outcome).toBe("purchased");

    // purchased is terminal-strength: a later checkout_started never downgrades it.
    await markConversationOutcomeForSession(session.id, "checkout_started");
    row = await getConversation(conversation.id);
    expect(row?.outcome).toBe("purchased");
  });

  it("is a no-op without an active conversation and preserves escalated outcomes", async () => {
    const { markConversationOutcomeForSession, markConversationEscalated } = await import(
      "@/lib/data/conversation-service"
    );
    const session = await makeSession();
    await expect(markConversationOutcomeForSession(session.id, "quote_started")).resolves.toBeUndefined();

    const conversation = await startConversation({ sessionId: session.id });
    await markConversationEscalated(conversation.id);
    await markConversationOutcomeForSession(session.id, "checkout_started");
    const row = await getConversation(conversation.id);
    expect(row?.outcome).toBe("escalated"); // a handoff in motion outranks funnel stamps
  });
});
