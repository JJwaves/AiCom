import { AiError, type AiErrorCode } from "../errors";
import type {
  AIProvider,
  AiUsageInfo,
  ProviderRequestBase,
  ProviderStructuredRequest,
  ProviderStructuredResult,
  ProviderTextResult,
  ProviderToolStepRequest,
  ProviderToolStepResult,
} from "./types";

/**
 * FakeAiProvider — deterministic scriptable provider for tests and local
 * development. No network, no credentials, ever.
 *
 * Script it with a queue of steps; each provider call consumes one step:
 *   text          → resolves generateText/generateStructured with the string
 *   toolCalls     → resolves generateToolStep with the given tool requests
 *   error         → throws the given AiError code
 * Every received request is captured in `.requests` for assertions.
 */

export type FakeStep =
  | { kind: "text"; text: string; usage?: AiUsageInfo; finish?: "stop" | "max_tokens" | "refusal" }
  | { kind: "toolCalls"; calls: { id?: string; name: string; input: unknown }[]; text?: string; usage?: AiUsageInfo }
  | { kind: "error"; code: AiErrorCode; message?: string };

export type FakeReceivedRequest = {
  method: "generateText" | "generateStructured" | "generateToolStep";
  request: ProviderRequestBase | ProviderStructuredRequest | ProviderToolStepRequest;
};

const DEFAULT_USAGE: AiUsageInfo = { inputTokens: 100, outputTokens: 50 };

export class FakeAiProvider implements AIProvider {
  // Impersonates the configured vendor so routing/usage records stay coherent.
  readonly name = "anthropic" as const;
  readonly requests: FakeReceivedRequest[] = [];
  private readonly queue: FakeStep[];

  constructor(steps: FakeStep[]) {
    this.queue = [...steps];
  }

  private next(
    method: FakeReceivedRequest["method"],
    request: FakeReceivedRequest["request"],
  ): Exclude<FakeStep, { kind: "error" }> {
    this.requests.push({ method, request });
    const step = this.queue.shift();
    if (!step) {
      throw new AiError("AI_PROVIDER_UNAVAILABLE", `FakeAiProvider script exhausted (call #${this.requests.length}: ${method})`);
    }
    if (step.kind === "error") {
      throw new AiError(step.code, step.message ?? `scripted ${step.code}`);
    }
    return step;
  }

  async generateText(req: ProviderRequestBase): Promise<ProviderTextResult> {
    const step = this.next("generateText", req);
    if (step.kind !== "text") throw new AiError("AI_INVALID_RESPONSE", "fake script mismatch: expected a text step");
    return {
      provider: this.name,
      model: req.model,
      text: step.text,
      finish: step.finish ?? "stop",
      usage: step.usage ?? DEFAULT_USAGE,
      latencyMs: 1,
    };
  }

  async generateStructured(req: ProviderStructuredRequest): Promise<ProviderStructuredResult> {
    const step = this.next("generateStructured", req);
    if (step.kind !== "text") throw new AiError("AI_INVALID_RESPONSE", "fake script mismatch: expected a text step");
    return {
      provider: this.name,
      model: req.model,
      text: step.text,
      finish: step.finish ?? "stop",
      usage: step.usage ?? DEFAULT_USAGE,
      latencyMs: 1,
    };
  }

  async generateToolStep(req: ProviderToolStepRequest): Promise<ProviderToolStepResult> {
    const step = this.next("generateToolStep", req);
    if (step.kind === "text") {
      return {
        provider: this.name,
        model: req.model,
        text: step.text,
        toolCalls: [],
        assistantMessage: { role: "assistant", content: step.text },
        finish: step.finish ?? "stop",
        usage: step.usage ?? DEFAULT_USAGE,
        latencyMs: 1,
      };
    }
    const calls = step.calls.map((c, i) => ({ id: c.id ?? `fake_call_${this.requests.length}_${i}`, name: c.name, input: c.input }));
    return {
      provider: this.name,
      model: req.model,
      text: step.text ?? "",
      toolCalls: calls,
      assistantMessage: { role: "assistant", content: step.text ?? "", opaque: { fakeToolUse: calls } },
      finish: "tool_use",
      usage: step.usage ?? DEFAULT_USAGE,
      latencyMs: 1,
    };
  }
}
