import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { conversations } from "@/db/schema";
import { recordServerEvent } from "@/lib/data/event-service";
import { createInsight, listInsights } from "@/lib/data/insight-service";
import { getClassificationForConversation, resolveEvidenceRefs } from "@/lib/data/intelligence-service";
import { deleteCustomerData, deleteSessionData } from "@/lib/data/privacy";
import { upsertCustomerByEmail } from "@/lib/data/customer-service";
import {
  aggregateQuestions,
  loadConversationCorpus,
  periodFromDays,
} from "@/modules/customer-intelligence";
import { makeSession, resetDb } from "./db-helpers";
import { seedClassification, seedConversation } from "./ci-helpers";

/**
 * Session 08 — privacy (§32): deleted customer/session data must stop
 * being available as active evidence. Classifications cascade with their
 * conversations; dangling insight refs resolve to an honest "missing"
 * count; deleted conversations vanish from aggregation.
 */

beforeEach(async () => {
  await resetDb();
});

describe("classification rows die with their conversation", () => {
  it("session deletion cascades conversations → classifications and removes them from aggregation", async () => {
    const session = await makeSession();
    const { conversation, messages } = await seedConversation(session.id, ["What is your MOQ?"]);
    await recordServerEvent({ sessionId: session.id, name: "price_viewed" });
    await seedClassification(conversation.id, { questions: [{ theme: "MOQ", messageId: messages[0].id }] });

    const before = await loadConversationCorpus(periodFromDays(30));
    expect(aggregateQuestions(before)).toHaveLength(1);

    await deleteSessionData(session.id);

    expect(await getClassificationForConversation(conversation.id)).toBeNull();
    const after = await loadConversationCorpus(periodFromDays(30));
    expect(after.totals.conversations).toBe(0);
    expect(aggregateQuestions(after)).toHaveLength(0);
  });

  it("customer deletion removes cross-session conversations and their classifications", async () => {
    const session = await makeSession();
    const customer = await upsertCustomerByEmail({ email: "delete-me@example.com" });
    const { conversation } = await seedConversation(session.id, ["hello"]);
    const db = await getDb();
    await db.update(conversations).set({ customerId: customer.id }).where(eq(conversations.id, conversation.id));
    await seedClassification(conversation.id, {});

    await deleteCustomerData(customer.id);
    expect(await getClassificationForConversation(conversation.id)).toBeNull();
  });
});

describe("insight evidence honors deletion (§19, §30)", () => {
  it("resolves deleted refs as missing — never reconstructed, never fabricated", async () => {
    const session = await makeSession();
    const { conversation, messages } = await seedConversation(session.id, [
      "We are a bakery and need 300 bags — 500 is too many for us.",
    ]);
    await createInsight({
      insightType: "MOQ_SIGNAL",
      title: "Below-MOQ interest",
      sourceRefs: [
        { table: "conversations", id: conversation.id },
        { table: "messages", id: messages[0].id },
      ],
      evidenceCount: 2,
    });

    const before = await resolveEvidenceRefs((await listInsights())[0].sourceRefsJson);
    expect(before.items).toHaveLength(2);
    expect(before.missing).toBe(0);
    const message = before.items.find((i) => i.table === "messages");
    expect(message && "excerpt" in message ? message.excerpt : "").toContain("bakery");

    await deleteSessionData(session.id);

    // The insight row survives (aggregated business record) but its
    // behavioral evidence is gone and is REPORTED gone.
    const after = await resolveEvidenceRefs((await listInsights())[0].sourceRefsJson);
    expect(after.items).toHaveLength(0);
    expect(after.missing).toBe(2);
  });

  it("bounds message excerpts for the admin drill-down", async () => {
    const session = await makeSession();
    const long = `We need bags. ${"Very long requirements. ".repeat(40)}`;
    const { messages } = await seedConversation(session.id, [long]);
    const resolved = await resolveEvidenceRefs([{ table: "messages", id: messages[0].id }]);
    const item = resolved.items[0];
    expect(item.table).toBe("messages");
    if (item.table === "messages") {
      expect(item.excerpt.length).toBeLessThanOrEqual(241); // 240 + ellipsis
    }
  });
});
