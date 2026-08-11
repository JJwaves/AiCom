import Anthropic from "@anthropic-ai/sdk";
import { AiError } from "../errors";
import type {
  AiChatMessage,
  AiFinishReason,
  AIProvider,
  AiToolCallRequest,
  ProviderRequestBase,
  ProviderStructuredRequest,
  ProviderStructuredResult,
  ProviderTextResult,
  ProviderToolStepRequest,
  ProviderToolStepResult,
} from "./types";

/**
 * Anthropic adapter — the one production provider implemented in Session 04
 * (OpenAI/Gemini are interface-supported, deferred). Wraps the official
 * @anthropic-ai/sdk; everything vendor-specific (wire shapes, content
 * blocks, error classes) stays inside this file.
 *
 * - Timeout + conservative transport retries are SDK client options (SDK
 *   retries only 429/5xx/network with backoff).
 * - Current models think adaptively by default; thinking output is omitted
 *   by default and thinking tokens count toward max_tokens — maxOutputTokens
 *   must leave headroom (config default 16k).
 * - `fetch` is injectable so tests exercise the full adapter without
 *   network or credentials.
 * - stop_reason "refusal" is a valid outcome (safety classifiers), not an
 *   exception — normalized to finish: "refusal" for callers to handle.
 */

type AnthropicAdapterOptions = {
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  /** Test seam — never set in production. */
  fetch?: typeof globalThis.fetch;
};

function toWireMessages(messages: AiChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    switch (m.role) {
      case "user":
        return { role: "user", content: m.content };
      case "assistant":
        // Echo the vendor blocks verbatim when we have them (required for
        // thinking/tool_use round-trips); plain text otherwise.
        return {
          role: "assistant",
          content: (m.opaque as Anthropic.ContentBlockParam[] | undefined) ?? m.content,
        };
      case "tool_results":
        return {
          role: "user",
          content: m.results.map(
            (r): Anthropic.ToolResultBlockParam => ({
              type: "tool_result",
              tool_use_id: r.toolCallId,
              content: JSON.stringify(r.result),
              is_error: r.isError,
            }),
          ),
        };
    }
  });
}

function toFinish(stopReason: string | null): AiFinishReason {
  switch (stopReason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "max_tokens";
    case "tool_use":
      return "tool_use";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Vendor error → typed AiError. Most-specific first; never leaks the API key. */
function normalizeError(err: unknown): AiError {
  if (err instanceof Anthropic.APIUserAbortError) {
    return new AiError("AI_TIMEOUT", "anthropic request aborted", { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError("AI_TIMEOUT", "anthropic request timed out", { cause: err });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError("AI_RATE_LIMITED", "anthropic rate limit (429)", { cause: err });
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new AiError("AI_PROVIDER_UNAVAILABLE", `anthropic server error (${err.status})`, { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError("AI_PROVIDER_UNAVAILABLE", "anthropic unreachable (network)", { cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    // Remaining 4xx: bad key/model/request — our configuration, not their outage.
    return new AiError("AI_CONFIGURATION_ERROR", `anthropic rejected the request (${err.status ?? "?"}: ${err.message})`, {
      cause: err,
    });
  }
  return new AiError("AI_PROVIDER_UNAVAILABLE", "anthropic call failed", { cause: err });
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(opts: AnthropicAdapterOptions) {
    if (!opts.apiKey) {
      throw new AiError("AI_CONFIGURATION_ERROR", "ANTHROPIC_API_KEY is not configured");
    }
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      timeout: opts.timeoutMs,
      maxRetries: opts.maxRetries,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  async generateText(req: ProviderRequestBase): Promise<ProviderTextResult> {
    const started = Date.now();
    try {
      const response = await this.client.messages.create({
        model: req.model,
        max_tokens: req.maxOutputTokens,
        ...(req.system ? { system: req.system } : {}),
        messages: toWireMessages(req.messages),
      });
      return {
        provider: this.name,
        model: response.model,
        text: textOf(response.content),
        finish: toFinish(response.stop_reason),
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async generateStructured(req: ProviderStructuredRequest): Promise<ProviderStructuredResult> {
    const started = Date.now();
    try {
      const response = await this.client.messages.create({
        model: req.model,
        max_tokens: req.maxOutputTokens,
        ...(req.system ? { system: req.system } : {}),
        messages: toWireMessages(req.messages),
        output_config: { format: { type: "json_schema", schema: req.outputJsonSchema } },
      });
      return {
        provider: this.name,
        model: response.model,
        text: textOf(response.content),
        finish: toFinish(response.stop_reason),
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async generateToolStep(req: ProviderToolStepRequest): Promise<ProviderToolStepResult> {
    const started = Date.now();
    try {
      const response = await this.client.messages.create({
        model: req.model,
        max_tokens: req.maxOutputTokens,
        ...(req.system ? { system: req.system } : {}),
        messages: toWireMessages(req.messages),
        tools: req.tools.map(
          (t): Anthropic.Tool => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputJsonSchema as Anthropic.Tool.InputSchema,
          }),
        ),
      });
      const toolCalls: AiToolCallRequest[] = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));
      const text = textOf(response.content);
      return {
        provider: this.name,
        model: response.model,
        text,
        toolCalls,
        // Full vendor content (incl. thinking blocks) rides back opaquely so
        // the next step's history is exactly what the API requires.
        assistantMessage: { role: "assistant", content: text, opaque: response.content },
        finish: toFinish(response.stop_reason),
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      throw normalizeError(err);
    }
  }
}
