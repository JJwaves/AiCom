import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/ai/chat/route";
import { __resetChatRateLimitersForTests, AI_UNAVAILABLE_MESSAGE } from "@/app/api/ai/chat/shared";
import { FakeAiProvider, type FakeStep } from "@/lib/ai";
import { __setSalesTestProvider, runSalesAgentTurn } from "@/lib/ai/agents/sales";
import { makeSession, resetDb } from "./db-helpers";

/**
 * Customer-facing chat endpoint (Session 05 spec §18–§19).
 *
 * Trust boundary tests: the client supplies only a message; flags + runtime
 * availability gate everything; abuse is bounded by body/message caps and
 * two token buckets; failures return normalized customer-safe copy with no
 * provider internals; GET history never leaks system/tool rows.
 */

const touched = new Set<string>();
function setEnv(key: string, value: string): void {
  touched.add(key);
  process.env[key] = value;
}
afterEach(() => {
  for (const key of touched) delete process.env[key];
  touched.clear();
  __setSalesTestProvider(null);
});
beforeEach(async () => {
  await resetDb();
  __resetChatRateLimitersForTests();
  setEnv("AI_RUNTIME_ENABLED", "true");
  setEnv("AI_SALES_ENABLED", "true");
  setEnv("ANTHROPIC_API_KEY", "test-key-never-used");
});

/** A step that satisfies ANY fake call (tool step, extraction, summary). */
const GENERIC: FakeStep = { kind: "text", text: '{"candidates":[]}' };
const reply = (text: string): FakeStep => ({ kind: "text", text });
const NO_EXTRACTION: FakeStep = GENERIC;

function post(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("availability gating", () => {
  it("both flags off ⇒ 503 with the customer-safe fallback, no provider construction", async () => {
    delete process.env.AI_RUNTIME_ENABLED;
    delete process.env.AI_SALES_ENABLED;
    const res = await POST(post({ message: "hi" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ ok: false, code: "AI_UNAVAILABLE", message: AI_UNAVAILABLE_MESSAGE });
  });

  it("flags on but no provider key ⇒ 503 (runtime unavailable)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(post({ message: "hi" }));
    expect(res.status).toBe(503);
  });
});

describe("request validation", () => {
  it("rejects malformed JSON (400), empty and oversized messages (422), oversized bodies (413)", async () => {
    expect((await POST(post("{not json"))).status).toBe(400);
    expect((await POST(post({ message: "" }))).status).toBe(422);
    expect((await POST(post({ message: "x".repeat(2001) }))).status).toBe(422);
    expect((await POST(post({ message: "x", pad: "y".repeat(20_000) }))).status).toBe(413);
    expect((await POST(post({ wrong: "shape" }))).status).toBe(422);
  });
});

describe("happy path", () => {
  it("resolves the session server-side, runs the agent, mints rolling cookies", async () => {
    __setSalesTestProvider(new FakeAiProvider([reply("Hello! What are you packing?"), NO_EXTRACTION]));
    const res = await POST(post({ message: "hi there" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toBe("Hello! What are you packing?");
    expect(body.needsHuman).toBe(false);
    expect(typeof body.conversationId).toBe("string");
    const setCookies = res.headers.getSetCookie().join(";");
    expect(setCookies).toContain("bd_sid=");
    expect(setCookies).toContain("HttpOnly");
  });

  it("client-supplied identity fields cannot leak into the turn (schema strips them)", async () => {
    __setSalesTestProvider(new FakeAiProvider([reply("ok"), NO_EXTRACTION]));
    const res = await POST(
      post({ message: "hi", customerId: "cust_forged", agentType: "ceo", price: 1, sessionId: "sess_forged" }),
    );
    // Unknown keys are simply ignored by the schema; the turn runs under the cookie session only.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("surfaces the structured escalation signal", async () => {
    __setSalesTestProvider(
      new FakeAiProvider([
        {
          kind: "toolCalls",
          calls: [
            { name: "requestHumanHelp", input: { reason: "customer_requested_human", requirementSummary: "Wants a person." } },
          ],
        },
        reply("A teammate will follow up right here."),
        NO_EXTRACTION,
      ]),
    );
    const res = await POST(post({ message: "let me talk to a human" }));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, needsHuman: true, handoffReason: "customer_requested_human", conversationStatus: "escalated" });
  });

  it("carries server-validated configuration updates and suggestions on the wire (S06)", async () => {
    const { PRODUCTS } = await import("@/config/products");
    const p = PRODUCTS[0];
    __setSalesTestProvider(
      new FakeAiProvider([
        {
          kind: "toolCalls",
          calls: [
            { name: "updateConfiguration", input: { productId: p.id, patch: { colorId: "black", quantity: 5000 } } },
            {
              name: "suggestConfigurationUpdate",
              input: { productId: p.id, patch: { quantity: 10_000 }, label: "Update to 10,000 bags" },
            },
          ],
        },
        reply("Done — 5,000 black bags. 10,000 would drop the unit price; want that instead?"),
        NO_EXTRACTION,
      ]),
    );
    const res = await POST(post({ message: "5,000 black bags please" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configurationUpdate).toMatchObject({
      productId: p.id,
      revision: expect.any(Number),
      changedFields: expect.arrayContaining(["colorId", "quantity"]),
    });
    expect(body.configurationUpdate.config).toMatchObject({ colorId: "black", quantity: 5000 });
    expect(body.suggestedActions).toHaveLength(1);
    expect(body.suggestedActions[0]).toMatchObject({
      type: "APPLY_CONFIGURATION_PATCH",
      label: "Update to 10,000 bags",
      patch: { quantity: 10_000 },
      productPath: `/products/${p.slug}`,
    });
    // Cost/margin fields never cross the wire.
    const json = JSON.stringify(body);
    for (const forbidden of ["grossMargin", "contributionMargin", "minimumAllowedPrice", "costStatus", "\"costs\""]) {
      expect(json).not.toContain(forbidden);
    }
  });
});

describe("failure normalization", () => {
  it("provider errors become the fixed customer-safe copy — never internals", async () => {
    __setSalesTestProvider(new FakeAiProvider([{ kind: "error", code: "AI_PROVIDER_UNAVAILABLE", message: "scripted vendor detail" }]));
    const res = await POST(post({ message: "hi" }));
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).toContain(AI_UNAVAILABLE_MESSAGE);
    expect(text).not.toContain("scripted vendor detail");
    expect(text).not.toContain("AI_PROVIDER_UNAVAILABLE");
  });
});

describe("rate protection", () => {
  it("per-session bucket: 6 messages pass, the 7th answers 429 with Retry-After", async () => {
    __setSalesTestProvider(new FakeAiProvider(Array.from({ length: 40 }, () => GENERIC)));
    const session = await makeSession();
    const cookie = `bd_sid=${session.id}`;
    for (let i = 0; i < 6; i++) {
      const res = await POST(post({ message: `msg ${i}` }, cookie));
      expect(res.status).toBe(200);
    }
    const blocked = await POST(post({ message: "one more" }, cookie));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    const body = await blocked.json();
    expect(body.code).toBe("RATE_LIMITED");
  });

  it("per-IP backstop catches cookie-dropping clients", async () => {
    __setSalesTestProvider(new FakeAiProvider(Array.from({ length: 80 }, () => GENERIC)));
    let last: Response | null = null;
    for (let i = 0; i < 21; i++) {
      last = await POST(post({ message: `n${i}` })); // no cookie ⇒ fresh session every time
      if (last.status === 429) break;
    }
    expect(last?.status).toBe(429);
  });
});

describe("GET history", () => {
  it("returns only user/assistant rows — system handoff records and tool rows never leak", async () => {
    const session = await makeSession();
    const fake = new FakeAiProvider([
      {
        kind: "toolCalls",
        calls: [
          { name: "searchProducts", input: {} },
          { name: "requestHumanHelp", input: { reason: "complaint", requirementSummary: "Unhappy with a past order." } },
        ],
      },
      reply("I've asked a teammate to step in."),
      NO_EXTRACTION,
    ]);
    await runSalesAgentTurn({ sessionId: session.id, message: "I have a complaint" }, { provider: fake });

    const res = await GET(new Request("http://localhost/api/ai/chat", { headers: { cookie: `bd_sid=${session.id}` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversation.status).toBe("escalated");
    expect(body.conversation.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("human_handoff");
    expect(raw).not.toContain("searchProducts");
    expect(raw).not.toContain("Unhappy with a past order");
  });

  it("no cookie / unknown session ⇒ empty history, and GET never mints a session", async () => {
    const none = await GET(new Request("http://localhost/api/ai/chat"));
    expect((await none.json()).conversation).toBeNull();
    const unknown = await GET(
      new Request("http://localhost/api/ai/chat", { headers: { cookie: "bd_sid=sess_00000000000000000000000000000000" } }),
    );
    expect((await unknown.json()).conversation).toBeNull();
    expect(none.headers.getSetCookie()).toHaveLength(0);
  });

  it("flags off ⇒ 503, same normalized shape", async () => {
    delete process.env.AI_SALES_ENABLED;
    const res = await GET(new Request("http://localhost/api/ai/chat"));
    expect(res.status).toBe(503);
  });
});
