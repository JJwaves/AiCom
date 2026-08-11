import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import { AiError } from "@/lib/ai/errors";

/**
 * Adapter tests against a mocked fetch — full request/response mapping and
 * error normalization with zero network and zero credentials.
 */

type Captured = { url: string; body: Record<string, unknown> };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function messageResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "text", text: "hello there" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 42, output_tokens: 7 },
    ...overrides,
  };
}

function makeProvider(handler: (captured: Captured) => Response | Promise<Response>, timeoutMs = 5_000) {
  const captured: Captured[] = [];
  const provider = new AnthropicProvider({
    apiKey: "sk-test",
    timeoutMs,
    maxRetries: 0,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const entry: Captured = {
        url: String(input),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      };
      captured.push(entry);
      return handler(entry);
    }) as typeof globalThis.fetch,
  });
  return { provider, captured };
}

const baseRequest = {
  model: "claude-sonnet-5",
  system: "You are a test.",
  messages: [{ role: "user" as const, content: "hi" }],
  maxOutputTokens: 500,
};

describe("AnthropicProvider — request/response mapping", () => {
  it("maps generateText: wire body, text, usage, finish", async () => {
    const { provider, captured } = makeProvider(() => jsonResponse(200, messageResponse()));
    const result = await provider.generateText(baseRequest);
    expect(result).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5",
      text: "hello there",
      finish: "stop",
      usage: { inputTokens: 42, outputTokens: 7 },
    });
    expect(captured[0].url).toContain("/v1/messages");
    expect(captured[0].body).toMatchObject({
      model: "claude-sonnet-5",
      max_tokens: 500,
      system: "You are a test.",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("maps tool_results turns to tool_result blocks and echoes opaque assistant content", async () => {
    const { provider, captured } = makeProvider(() => jsonResponse(200, messageResponse()));
    await provider.generateText({
      ...baseRequest,
      messages: [
        { role: "user", content: "price this" },
        { role: "assistant", content: "calling tool", opaque: [{ type: "text", text: "calling tool" }] },
        { role: "tool_results", results: [{ toolCallId: "toolu_1", result: { ok: true }, isError: false }] },
      ],
    });
    const messages = captured[0].body.messages as Array<Record<string, unknown>>;
    expect(messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "calling tool" }] });
    expect(messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"ok":true}', is_error: false }],
    });
  });

  it("maps generateStructured to output_config json_schema", async () => {
    const { provider, captured } = makeProvider(() =>
      jsonResponse(200, messageResponse({ content: [{ type: "text", text: '{"a":1}' }] })),
    );
    const result = await provider.generateStructured({
      ...baseRequest,
      outputJsonSchema: { type: "object", properties: { a: { type: "number" } }, additionalProperties: false },
    });
    expect(result.text).toBe('{"a":1}');
    expect(captured[0].body.output_config).toEqual({
      format: {
        type: "json_schema",
        schema: { type: "object", properties: { a: { type: "number" } }, additionalProperties: false },
      },
    });
  });

  it("maps generateToolStep: tools on the wire, tool_use blocks parsed, content kept opaque", async () => {
    const { provider, captured } = makeProvider(() =>
      jsonResponse(
        200,
        messageResponse({
          content: [
            { type: "text", text: "let me check" },
            { type: "tool_use", id: "toolu_9", name: "searchProducts", input: { query: "bags" } },
          ],
          stop_reason: "tool_use",
        }),
      ),
    );
    const result = await provider.generateToolStep({
      ...baseRequest,
      tools: [{ name: "searchProducts", description: "search", inputJsonSchema: { type: "object" } }],
    });
    expect(captured[0].body.tools).toEqual([{ name: "searchProducts", description: "search", input_schema: { type: "object" } }]);
    expect(result.finish).toBe("tool_use");
    expect(result.toolCalls).toEqual([{ id: "toolu_9", name: "searchProducts", input: { query: "bags" } }]);
    expect(result.text).toBe("let me check");
    expect(result.assistantMessage.opaque).toHaveLength(2);
  });

  it("normalizes stop_reason refusal", async () => {
    const { provider } = makeProvider(() => jsonResponse(200, messageResponse({ stop_reason: "refusal", content: [] })));
    const result = await provider.generateText(baseRequest);
    expect(result.finish).toBe("refusal");
    expect(result.text).toBe("");
  });
});

describe("AnthropicProvider — error normalization", () => {
  const apiError = (type: string, message: string) => ({ type: "error", error: { type, message } });

  async function expectCode(status: number, errType: string, expectedCode: string) {
    const { provider } = makeProvider(() => jsonResponse(status, apiError(errType, "boom")));
    try {
      await provider.generateText(baseRequest);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).code).toBe(expectedCode);
    }
  }

  it("429 → AI_RATE_LIMITED", async () => {
    await expectCode(429, "rate_limit_error", "AI_RATE_LIMITED");
  });
  it("500 → AI_PROVIDER_UNAVAILABLE", async () => {
    await expectCode(500, "api_error", "AI_PROVIDER_UNAVAILABLE");
  });
  it("529 overloaded → AI_PROVIDER_UNAVAILABLE", async () => {
    await expectCode(529, "overloaded_error", "AI_PROVIDER_UNAVAILABLE");
  });
  it("401 → AI_CONFIGURATION_ERROR", async () => {
    await expectCode(401, "authentication_error", "AI_CONFIGURATION_ERROR");
  });
  it("404 bad model → AI_CONFIGURATION_ERROR", async () => {
    await expectCode(404, "not_found_error", "AI_CONFIGURATION_ERROR");
  });
  it("400 bad request → AI_CONFIGURATION_ERROR", async () => {
    await expectCode(400, "invalid_request_error", "AI_CONFIGURATION_ERROR");
  });

  it("network failure → AI_PROVIDER_UNAVAILABLE", async () => {
    const { provider } = makeProvider(() => {
      throw new TypeError("fetch failed");
    });
    try {
      await provider.generateText(baseRequest);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as AiError).code).toBe("AI_PROVIDER_UNAVAILABLE");
    }
  });

  it("timeout → AI_TIMEOUT", async () => {
    const provider = new AnthropicProvider({
      apiKey: "sk-test",
      timeoutMs: 60,
      maxRetries: 0,
      fetch: ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        })) as typeof globalThis.fetch,
    });
    try {
      await provider.generateText(baseRequest);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).code).toBe("AI_TIMEOUT");
    }
  });

  it("constructor refuses an empty key", () => {
    expect(() => new AnthropicProvider({ apiKey: "", timeoutMs: 1000, maxRetries: 0 })).toThrowError(AiError);
  });
});
