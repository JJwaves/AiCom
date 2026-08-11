import type { AiProviderName } from "../config";

/**
 * Provider abstraction — the internal normalized surface every vendor
 * adapter implements. Nothing outside lib/ai/providers touches a vendor SDK,
 * and no raw vendor response object crosses this boundary (vendor content
 * blocks that must round-trip ride inside the `opaque` field, typed unknown,
 * interpreted only by the adapter that produced them).
 *
 * Deliberately minimal (three single-shot capabilities). The agentic LOOP —
 * runToolConversation with limits, budgets, auditing — lives in
 * lib/ai/runtime.ts and is provider-agnostic; adapters only ever execute one
 * model step. Adapters normalize errors to AiError before throwing.
 */

/** Conversation turn shapes the runtime composes. Adapter maps them to wire format. */
export type AiChatMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      /** Vendor content blocks to echo back verbatim on the next step (thinking/tool_use blocks). */
      opaque?: unknown;
    }
  | { role: "tool_results"; results: AiToolResultMessage[] };

export type AiToolResultMessage = {
  toolCallId: string;
  /** JSON-serializable structured result (already validated by the tool registry). */
  result: unknown;
  isError: boolean;
};

export type AiUsageInfo = {
  inputTokens?: number;
  outputTokens?: number;
};

export type AiFinishReason = "stop" | "max_tokens" | "tool_use" | "refusal" | "other";

/** Wire-format tool the model may call (JSON Schema produced from the tool's zod input). */
export type ProviderToolSpec = {
  name: string;
  description: string;
  inputJsonSchema: Record<string, unknown>;
};

export type ProviderRequestBase = {
  model: string;
  system?: string;
  messages: AiChatMessage[];
  maxOutputTokens: number;
};

export type ProviderTextResult = {
  provider: AiProviderName;
  model: string;
  text: string;
  finish: AiFinishReason;
  usage: AiUsageInfo;
  latencyMs: number;
};

export type ProviderStructuredRequest = ProviderRequestBase & {
  /** Sanitized JSON Schema the provider should constrain output to. */
  outputJsonSchema: Record<string, unknown>;
};

/** Raw JSON text — parsing/zod validation happens above, in lib/ai/schemas. */
export type ProviderStructuredResult = ProviderTextResult;

export type ProviderToolStepRequest = ProviderRequestBase & {
  tools: ProviderToolSpec[];
};

export type AiToolCallRequest = {
  id: string;
  name: string;
  /** Untrusted model-produced arguments — validated by the tool registry before execution. */
  input: unknown;
};

export type ProviderToolStepResult = {
  provider: AiProviderName;
  model: string;
  /** Text emitted this step (may accompany tool calls). */
  text: string;
  toolCalls: AiToolCallRequest[];
  /** Assistant turn to append to history so the next step sees this one (carries opaque vendor blocks). */
  assistantMessage: Extract<AiChatMessage, { role: "assistant" }>;
  finish: AiFinishReason;
  usage: AiUsageInfo;
  latencyMs: number;
};

export interface AIProvider {
  readonly name: AiProviderName;
  generateText(req: ProviderRequestBase): Promise<ProviderTextResult>;
  generateStructured(req: ProviderStructuredRequest): Promise<ProviderStructuredResult>;
  /** ONE model step of a tool conversation — the loop lives in runtime.ts. */
  generateToolStep(req: ProviderToolStepRequest): Promise<ProviderToolStepResult>;
}
