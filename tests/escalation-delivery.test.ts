import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as handledRoute } from "@/app/api/admin/handoffs/[id]/handled/route";
import { POST as retryRoute } from "@/app/api/admin/handoffs/[id]/retry/route";
import { requestHumanHelpTool } from "@/lib/ai/tools/escalation-tools";
import { listMessages, startConversation } from "@/lib/data/conversation-service";
import { handoffCounts, getHandoff, listHandoffs } from "@/lib/data/handoff-service";
import { buildHandoffPayload, deliverHandoff, handoffDeliveryConfigured } from "@/lib/escalation/delivery";
import { applyNeedProfileUpdate } from "@/lib/data/customer-need-service";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";
import { makeSession, resetDb } from "./db-helpers";

/**
 * Production Launch Session 03 §20–§23, §62 — escalations reach a human.
 *
 * The governing property: PERSISTENCE IS PRIMARY. A delivery failure is a
 * recorded state, never a lost customer request, and the customer is only
 * ever told their request was RECORDED.
 */

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(async () => {
  await resetDb();
  __resetRateLimitsForTests();
  delete process.env.HUMAN_HANDOFF_WEBHOOK_URL;
  delete process.env.QUOTE_WEBHOOK_URL;
  process.env.ADMIN_USER = "owner";
  process.env.ADMIN_PASSWORD = "correct-horse";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.unstubAllGlobals();
  delete process.env.HUMAN_HANDOFF_WEBHOOK_URL;
  delete process.env.ADMIN_USER;
  delete process.env.ADMIN_PASSWORD;
});

async function escalate(overrides: Record<string, unknown> = {}) {
  const session = await makeSession();
  const conversation = await startConversation({ sessionId: session.id, agentType: "sales" });
  await applyNeedProfileUpdate(session.id, { businessName: "Pho Hanoi", quantity: 25_000 }, "USER_STATED", {});
  const result = await requestHumanHelpTool.execute(
    {
      reason: "large_order",
      requirementSummary: "Needs 25,000 bags with a two-colour logo for a 12-store rollout.",
      customerQuestion: "Can you hit a 3-week deadline?",
      contactEmail: "buyer@phohanoi.example",
      ...overrides,
    } as Parameters<typeof requestHumanHelpTool.execute>[0],
    {
      agentType: "sales",
      permissions: ["CUSTOMER_WRITE"],
      sessionId: session.id,
      conversationId: conversation.id,
      requestId: "req_test",
    },
  );
  return { session, conversation, result };
}

function adminRequest(url: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from("owner:correct-horse").toString("base64")}`,
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: "{}",
  });
}

/* ------------------------------------------------------------------ */

describe("the handoff is persisted first (§22, §62)", () => {
  it("stores a row even with NO delivery destination configured", async () => {
    const { conversation } = await escalate();

    const rows = await listHandoffs();
    expect(rows).toHaveLength(1);
    expect(rows[0].conversationId).toBe(conversation.id);
    expect(rows[0].reason).toBe("large_order");
    expect(rows[0].deliveryStatus).toBe("not_configured");
    expect(rows[0].requirementSummary).toContain("25,000");
  });

  it("survives a delivery destination that fails outright", async () => {
    process.env.HUMAN_HANDOFF_WEBHOOK_URL = "https://hooks.example/handoff";
    globalThis.fetch = vi.fn(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const { result } = await escalate();
    // The TOOL still succeeded: the customer was told their request was recorded.
    expect((result as { escalated: boolean }).escalated).toBe(true);

    const rows = await listHandoffs();
    expect(rows[0].deliveryStatus).toBe("failed");
    expect(rows[0].deliveryAttempts).toBe(1);
    expect(rows[0].lastError).toContain("connection refused");
    expect(rows[0].deliveredAt).toBeNull();
  });

  it("records a delivered handoff when the destination accepts it", async () => {
    process.env.HUMAN_HANDOFF_WEBHOOK_URL = "https://hooks.example/handoff";
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;

    await escalate();
    const rows = await listHandoffs();
    expect(rows[0].deliveryStatus).toBe("delivered");
    expect(rows[0].deliveredAt).not.toBeNull();
    expect(rows[0].lastError).toBeNull();
  });

  it("still writes the conversation system message, so the full context survives", async () => {
    const { conversation } = await escalate();
    const messages = await listMessages(conversation.id);
    expect(messages.some((m) => m.role === "system" && m.structuredJson?.kind === "human_handoff")).toBe(true);
  });
});

describe("the payload carries what an owner needs and nothing more (§21, §62)", () => {
  it("includes the reference, reason, summary, volunteered contact and a deep link", async () => {
    process.env.NEXT_PUBLIC_SITE_DOMAIN = "bagdirect.example";
    await escalate();
    const [row] = await listHandoffs();
    const payload = buildHandoffPayload(row);

    expect(payload.handoffId).toBe(row.id);
    expect(payload.reason).toBe("large_order");
    expect(payload.requirementSummary).toContain("25,000");
    expect(payload.contact.email).toBe("buyer@phohanoi.example");
    expect(payload.adminUrl).toBe(`https://bagdirect.example/admin/handoffs#${row.id}`);
    delete process.env.NEXT_PUBLIC_SITE_DOMAIN;
  });

  it("carries NO transcript, need profile, secret or session identity", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-never-appear";
    await escalate();
    const [row] = await listHandoffs();
    const raw = JSON.stringify(buildHandoffPayload(row));

    for (const forbidden of ["sk-ant", "sessionId", "needProfile", "messages", "transcript", "margin", "cost"]) {
      expect(raw).not.toContain(forbidden);
    }
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("omits the deep link honestly when no domain is configured", async () => {
    delete process.env.NEXT_PUBLIC_SITE_DOMAIN;
    await escalate();
    const [row] = await listHandoffs();
    expect(buildHandoffPayload(row).adminUrl).toBeNull();
  });
});

describe("retry and owner workflow (§22, §23)", () => {
  it("a retry after a failure can succeed, and increments the attempt count", async () => {
    process.env.HUMAN_HANDOFF_WEBHOOK_URL = "https://hooks.example/handoff";
    globalThis.fetch = vi.fn(async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    await escalate();
    const [failed] = await listHandoffs();
    expect(failed.deliveryStatus).toBe("failed");

    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const res = await retryRoute(adminRequest(`http://localhost/api/admin/handoffs/${failed.id}/retry`), {
      params: Promise.resolve({ id: failed.id }),
    });
    expect(res.status).toBe(200);

    const after = await getHandoff(failed.id);
    expect(after?.deliveryStatus).toBe("delivered");
    expect(after?.deliveryAttempts).toBe(2);
  });

  it("marking handled records the SERVER-derived admin identity", async () => {
    await escalate();
    const [row] = await listHandoffs();
    const res = await handledRoute(adminRequest(`http://localhost/api/admin/handoffs/${row.id}/handled`), {
      params: Promise.resolve({ id: row.id }),
    });
    expect(res.status).toBe(200);

    const after = await getHandoff(row.id);
    expect(after?.handledAt).not.toBeNull();
    expect(after?.handledBy).toBe("admin:owner");
  });

  it("refuses an unauthenticated retry", async () => {
    await escalate();
    const [row] = await listHandoffs();
    const res = await retryRoute(
      new Request(`http://localhost/api/admin/handoffs/${row.id}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: row.id }) },
    );
    expect(res.status).toBe(401);
  });

  it("counts are visible for the admin surface", async () => {
    await escalate();
    const counts = await handoffCounts();
    expect(counts.total).toBe(1);
    expect(counts.unhandled).toBe(1);
    expect(counts.notConfigured).toBe(1);
  });
});

describe("delivery configuration (§20)", () => {
  it("falls back to the quote webhook the owner already has", () => {
    delete process.env.HUMAN_HANDOFF_WEBHOOK_URL;
    expect(handoffDeliveryConfigured()).toBe(false);
    process.env.QUOTE_WEBHOOK_URL = "https://hooks.example/quote";
    expect(handoffDeliveryConfigured()).toBe(true);
    delete process.env.QUOTE_WEBHOOK_URL;
  });

  it("an unconfigured destination is its OWN state, not a failure", async () => {
    await escalate();
    const [row] = await listHandoffs();
    const outcome = await deliverHandoff(row);
    expect(outcome.status).toBe("not_configured");
  });
});
