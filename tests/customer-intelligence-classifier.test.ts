import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiRuntime, FakeAiProvider } from "@/lib/ai";
import { classifyConversation } from "@/lib/ai/agents/customer-intelligence/classifier";
import { processCustomerIntelligence } from "@/lib/ai/agents/customer-intelligence/process";
import {
  getClassificationForConversation,
  listConversationsNeedingClassification,
} from "@/lib/data/intelligence-service";
import { listRecentAiUsage } from "@/lib/data/ai-usage-service";
import { appendMessage } from "@/lib/data/conversation-service";
import { CLASSIFIER_VERSION } from "@/modules/customer-intelligence";
import { makeSession, resetDb } from "./db-helpers";
import { seedClassification, seedConversation } from "./ci-helpers";

/**
 * Session 08 — AI classification: controlled enums, server-verified
 * evidence, idempotent processing, and fail-safe behavior for every
 * provider failure class. FakeAiProvider only — no credentials, no
 * network (§41).
 */

const touched = new Set<string>();
function setEnv(key: string, value: string): void {
  touched.add(key);
  process.env[key] = value;
}
afterEach(() => {
  for (const key of touched) delete process.env[key];
  touched.clear();
});
beforeEach(async () => {
  await resetDb();
  setEnv("AI_RUNTIME_ENABLED", "true");
  setEnv("AI_CUSTOMER_INTELLIGENCE_ENABLED", "true");
});

const output = (value: unknown) => ({ kind: "text" as const, text: JSON.stringify(value) });
const empty = { questions: [], objections: [], requests: [] };

describe("classifyConversation — labels are validated server-side", () => {
  it("keeps only labels whose messageId is a real customer message", async () => {
    const session = await makeSession();
    const { conversation, messages } = await seedConversation(session.id, ["What is your MOQ?"]);
    const fake = new FakeAiProvider([
      output({
        questions: [
          { theme: "MOQ", messageId: messages[0].id },
          { theme: "SHIPPING", messageId: "msg_fabricated_00000000000000000000" },
        ],
        objections: [],
        requests: [{ kind: "product", normalized: "Insulated Bag", messageId: messages[0].id }],
      }),
    ]);
    const runtime = new AiRuntime({ provider: fake });
    const result = await classifyConversation(runtime, {
      conversationId: conversation.id,
      sessionId: session.id,
      userMessages: messages,
    });
    expect(result.questions).toEqual([{ theme: "MOQ", messageId: messages[0].id }]);
    expect(result.droppedLabels).toBe(1);
    // Request phrases normalize to lowercase for stable aggregation keys.
    expect(result.requests[0].normalized).toBe("insulated bag");
  });

  it("rejects categories outside the controlled taxonomy (schema retry, then failure)", async () => {
    const session = await makeSession();
    const { conversation, messages } = await seedConversation(session.id, ["Do you have glitter bags?"]);
    const bad = output({ questions: [{ theme: "GLITTER", messageId: messages[0].id }], objections: [], requests: [] });
    const fake = new FakeAiProvider([bad, bad]);
    const runtime = new AiRuntime({ provider: fake });
    await expect(
      classifyConversation(runtime, { conversationId: conversation.id, sessionId: session.id, userMessages: messages }),
    ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
    // Bounded: initial + one retry, no runaway.
    expect(fake.requests).toHaveLength(2);
  });

  it("records usage rows tagged customer_intelligence with the versioned prompt", async () => {
    const session = await makeSession();
    const { conversation, messages } = await seedConversation(session.id, ["How long does shipping take?"]);
    const fake = new FakeAiProvider([output(empty)]);
    const runtime = new AiRuntime({ provider: fake });
    await classifyConversation(runtime, { conversationId: conversation.id, sessionId: session.id, userMessages: messages });
    const [usage] = await listRecentAiUsage(1);
    expect(usage.agentType).toBe("customer_intelligence");
    expect(usage.promptId).toBe("ai_customer_intelligence_classifier");
    expect(usage.promptVersion).toBe("1.0.0");
    expect(usage.conversationId).toBe(conversation.id);
  });
});

describe("processCustomerIntelligence — idempotent explicit batches", () => {
  it("classifies pending conversations and persists prompt/model metadata + deterministic support", async () => {
    const session = await makeSession();
    const { conversation, messages } = await seedConversation(session.id, ["Do you sell insulated bags?"]);
    const fake = new FakeAiProvider([
      output({
        questions: [{ theme: "PRODUCT_AVAILABILITY", messageId: messages[0].id }],
        objections: [],
        requests: [{ kind: "product", normalized: "insulated bag", messageId: messages[0].id }],
      }),
    ]);
    const result = await processCustomerIntelligence({ runtime: new AiRuntime({ provider: fake }) });
    expect(result).toMatchObject({ status: "completed", processed: 1, failed: 0, remaining: 0 });

    const row = await getClassificationForConversation(conversation.id);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("classified");
    expect(row!.classifierVersion).toBe(CLASSIFIER_VERSION);
    expect(row!.promptId).toBe("ai_customer_intelligence_classifier");
    expect(row!.promptVersion).toBe("1.0.0");
    // Catalog support decided deterministically — the model never said "unsupported".
    expect(row!.unsupportedRequestsJson).toEqual([
      { kind: "product", normalized: "insulated bag", messageId: messages[0].id, support: "unsupported" },
    ]);
  });

  it("does not re-send already-classified conversations (zero provider calls)", async () => {
    const session = await makeSession();
    const { messages } = await seedConversation(session.id, ["What is your MOQ?"]);
    const first = new FakeAiProvider([
      output({ questions: [{ theme: "MOQ", messageId: messages[0].id }], objections: [], requests: [] }),
    ]);
    await processCustomerIntelligence({ runtime: new AiRuntime({ provider: first }) });

    const second = new FakeAiProvider([]); // any call would throw
    const rerun = await processCustomerIntelligence({ runtime: new AiRuntime({ provider: second }) });
    expect(rerun).toMatchObject({ status: "completed", processed: 0, failed: 0, remaining: 0 });
    expect(second.requests).toHaveLength(0);
  });

  it("reprocesses when new customer messages arrive or the classifier version changes", async () => {
    const session = await makeSession();
    const { conversation, messages } = await seedConversation(session.id, ["First question about price"]);
    await seedClassification(conversation.id, { sourceUpdatedAt: messages[0].createdAt });
    expect(await listConversationsNeedingClassification(CLASSIFIER_VERSION, 10)).toHaveLength(0);

    // A new customer message makes the stored classification stale.
    await appendMessage({ conversationId: conversation.id, role: "user", content: "And what about delivery time?" });
    const stale = await listConversationsNeedingClassification(CLASSIFIER_VERSION, 10);
    expect(stale.some((c) => c.conversation.id === conversation.id)).toBe(true);

    // An older pipeline version is also stale — explicit reprocessing path.
    await seedClassification(conversation.id, { classifierVersion: "0.9.0" });
    const outdated = await listConversationsNeedingClassification(CLASSIFIER_VERSION, 10);
    expect(outdated.some((c) => c.conversation.id === conversation.id)).toBe(true);
  });

  it("marks a conversation failed on invalid output and continues the batch", async () => {
    const session = await makeSession();
    const first = await seedConversation(session.id, ["gibberish that breaks the model"]);
    const session2 = await makeSession();
    const second = await seedConversation(session2.id, ["What sizes do you have?"]);

    const fake = new FakeAiProvider([
      { kind: "text", text: "not json at all" },
      { kind: "text", text: "still not json" }, // retry also fails → AI_INVALID_RESPONSE
      output({ questions: [{ theme: "SIZE", messageId: second.messages[0].id }], objections: [], requests: [] }),
    ]);
    const result = await processCustomerIntelligence({ runtime: new AiRuntime({ provider: fake }) });
    expect(result).toMatchObject({ status: "completed", processed: 1, failed: 1 });

    const failedRow = await getClassificationForConversation(first.conversation.id);
    expect(failedRow!.status).toBe("failed");
    expect(failedRow!.errorCode).toBe("AI_INVALID_RESPONSE");
    expect(failedRow!.questionsJson).toEqual([]);
    const okRow = await getClassificationForConversation(second.conversation.id);
    expect(okRow!.status).toBe("classified");

    // Failed rows are retried by the next explicit run.
    const pending = await listConversationsNeedingClassification(CLASSIFIER_VERSION, 10);
    expect(pending.map((p) => p.conversation.id)).toEqual([first.conversation.id]);
  });

  it("aborts the batch on budget exhaustion and leaves conversations pending (not failed)", async () => {
    const session = await makeSession();
    const a = await seedConversation(session.id, ["Question A"]);
    const session2 = await makeSession();
    await seedConversation(session2.id, ["Question B"]);

    const fake = new FakeAiProvider([{ kind: "error", code: "AI_BUDGET_EXCEEDED" }]);
    const result = await processCustomerIntelligence({ runtime: new AiRuntime({ provider: fake }) });
    expect(result.status).toBe("aborted");
    expect(result.abortReason).toBe("AI_BUDGET_EXCEEDED");
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(2);
    expect(await getClassificationForConversation(a.conversation.id)).toBeNull();
  });

  it("aborts on provider unavailability the same way", async () => {
    const session = await makeSession();
    await seedConversation(session.id, ["Question"]);
    const fake = new FakeAiProvider([{ kind: "error", code: "AI_PROVIDER_UNAVAILABLE" }]);
    const result = await processCustomerIntelligence({ runtime: new AiRuntime({ provider: fake }) });
    expect(result.status).toBe("aborted");
    expect(result.abortReason).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(result.remaining).toBe(1);
  });

  it("returns unavailable without touching rows when the feature flag is off", async () => {
    delete process.env.AI_CUSTOMER_INTELLIGENCE_ENABLED;
    const session = await makeSession();
    await seedConversation(session.id, ["Question"]);
    const result = await processCustomerIntelligence();
    expect(result.status).toBe("unavailable");
    expect(await listConversationsNeedingClassification(CLASSIFIER_VERSION, 10)).toHaveLength(1);
  });
});
