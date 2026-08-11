import type { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { getAiConfig, type AiConfig, type AiEnvSource, type AiWorkload } from "./config";
import { AiError, toAiError } from "./errors";
import { aiLog } from "./log";
import { createProvider } from "./providers";
import type { AIProvider, AiChatMessage, AiUsageInfo } from "./providers/types";
import { getPrompt, renderPrompt, type PromptId } from "./prompts/registry";
import { selectModel } from "./router";
import { toProviderJsonSchema, parseStructured, invalidResponseError } from "./schemas/structured";
import type { ToolRegistry } from "./tools/registry";
import type { ToolCallResult, ToolExecutionContext } from "./tools/types";
import { assertWithinAiBudget } from "./usage/budget-guard";
import { recordUsageNonFatal } from "./usage/record";

/**
 * AI runtime — the composition layer every future agent calls. One pipeline
 * wraps every provider request:
 *
 *   AI_RUNTIME flag → env config → model router → budget guard
 *     → provider call (timeout + normalized errors) → AiUsage row
 *
 * Failures are typed AiErrors; callers degrade gracefully (commerce never
 * depends on an AI response). The runtime is stateless — construct it per
 * request or reuse; providers are created from config unless injected
 * (tests inject FakeAiProvider).
 */

export type RuntimeCommonOptions = {
  workload: AiWorkload;
  /** Renders the versioned prompt as the system prompt and stamps id+version on the AiUsage row. */
  prompt?: { id: PromptId; vars?: Record<string, string> };
  /** Overrides `prompt` as system text when both are given. */
  system?: string;
  agentType?: string;
  sessionId?: string;
  conversationId?: string;
  maxOutputTokens?: number;
};

export type GenerateTextRequest = RuntimeCommonOptions & { messages: AiChatMessage[] };

export type GenerateTextResult = {
  text: string;
  model: string;
  provider: string;
  finish: "stop" | "max_tokens" | "refusal" | "other" | "tool_use";
  usage: AiUsageInfo;
  latencyMs: number;
};

export type GenerateObjectRequest<T> = GenerateTextRequest & { schema: z.ZodType<T> };

export type ToolConversationRequest = RuntimeCommonOptions & {
  messages: AiChatMessage[];
  registry: ToolRegistry;
  context: ToolExecutionContext;
};

export type ToolConversationStatus = "complete" | "refusal" | "tool_call_limit" | "model_call_limit" | "duration_limit";

export type ToolConversationResult = {
  status: ToolConversationStatus;
  /** Final assistant text (empty when a limit cut the turn short). */
  text: string;
  modelCalls: number;
  executedToolCalls: ToolCallResult[];
  /** Full turn history (assistant turns carry provider-opaque blocks) for S05 persistence. */
  messages: AiChatMessage[];
  usage: Required<AiUsageInfo>;
};

export class AiRuntime {
  private readonly config: AiConfig;
  private readonly provider: AIProvider;

  constructor(opts: { provider?: AIProvider; env?: AiEnvSource } = {}) {
    if (!isFlagEnabled("AI_RUNTIME")) {
      throw new AiError("AI_DISABLED", "AI runtime is disabled (set AI_RUNTIME_ENABLED=true to enable)");
    }
    this.config = getAiConfig(opts.env);
    this.provider = opts.provider ?? createProvider(this.config);
  }

  get limits(): AiConfig["limits"] {
    return this.config.limits;
  }

  private systemFor(opts: RuntimeCommonOptions): { system?: string; promptId?: string; promptVersion?: string } {
    if (opts.system !== undefined) return { system: opts.system };
    if (opts.prompt) {
      const def = getPrompt(opts.prompt.id);
      return { system: renderPrompt(def, opts.prompt.vars ?? {}), promptId: def.id, promptVersion: def.version };
    }
    return {};
  }

  async generateText(req: GenerateTextRequest): Promise<GenerateTextResult> {
    const model = selectModel(this.config, req.workload);
    const { system, promptId, promptVersion } = this.systemFor(req);
    await assertWithinAiBudget(this.config, model);
    const started = Date.now();
    try {
      const result = await this.provider.generateText({
        model,
        system,
        messages: req.messages,
        maxOutputTokens: req.maxOutputTokens ?? this.config.maxOutputTokens,
      });
      await recordUsageNonFatal({
        provider: this.provider.name,
        model,
        requestType: "text",
        agentType: req.agentType,
        sessionId: req.sessionId,
        conversationId: req.conversationId,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs: result.latencyMs,
        success: true,
        promptId,
        promptVersion,
      });
      return { ...result, provider: this.provider.name };
    } catch (err) {
      const aiErr = toAiError(err, "AI_PROVIDER_UNAVAILABLE", "generateText failed");
      aiLog("provider_error", { method: "generateText", model, code: aiErr.code, message: aiErr.message });
      await recordUsageNonFatal({
        provider: this.provider.name,
        model,
        requestType: "text",
        agentType: req.agentType,
        sessionId: req.sessionId,
        conversationId: req.conversationId,
        latencyMs: Date.now() - started,
        success: false,
        errorCode: aiErr.code,
        promptId,
        promptVersion,
      });
      throw aiErr;
    }
  }

  /**
   * Structured generation: provider-constrained JSON + OUR zod validation
   * (the authority). Conservative bounded retry: on invalid output, one
   * corrective re-ask per AI_STRUCTURED_RETRY_LIMIT (default 1), then a
   * typed AI_INVALID_RESPONSE. Refusals never retry.
   */
  async generateStructuredObject<T>(req: GenerateObjectRequest<T>): Promise<T> {
    const model = selectModel(this.config, req.workload);
    const { system, promptId, promptVersion } = this.systemFor(req);
    const outputJsonSchema = toProviderJsonSchema(req.schema);
    const messages: AiChatMessage[] = [...req.messages];
    const attempts = 1 + this.config.limits.structuredRetryLimit;
    let lastIssues = "";

    for (let attempt = 1; attempt <= attempts; attempt++) {
      await assertWithinAiBudget(this.config, model);
      const started = Date.now();
      let raw: { text: string; finish: string; usage: AiUsageInfo; latencyMs: number };
      try {
        raw = await this.provider.generateStructured({
          model,
          system,
          messages: [...messages],
          maxOutputTokens: req.maxOutputTokens ?? this.config.maxOutputTokens,
          outputJsonSchema,
        });
      } catch (err) {
        const aiErr = toAiError(err, "AI_PROVIDER_UNAVAILABLE", "generateStructuredObject failed");
        aiLog("provider_error", { method: "generateStructuredObject", model, code: aiErr.code, message: aiErr.message });
        await recordUsageNonFatal({
          provider: this.provider.name,
          model,
          requestType: "structured",
          agentType: req.agentType,
          sessionId: req.sessionId,
          conversationId: req.conversationId,
          latencyMs: Date.now() - started,
          success: false,
          errorCode: aiErr.code,
          promptId,
          promptVersion,
        });
        throw aiErr;
      }

      const parsed = parseStructured(raw.text, req.schema);
      await recordUsageNonFatal({
        provider: this.provider.name,
        model,
        requestType: "structured",
        agentType: req.agentType,
        sessionId: req.sessionId,
        conversationId: req.conversationId,
        inputTokens: raw.usage.inputTokens,
        outputTokens: raw.usage.outputTokens,
        latencyMs: raw.latencyMs,
        success: parsed.ok,
        errorCode: parsed.ok ? undefined : "AI_INVALID_RESPONSE",
        promptId,
        promptVersion,
      });
      if (parsed.ok) return parsed.value;
      if (raw.finish === "refusal") {
        throw invalidResponseError("refusal", "the model declined to produce this output");
      }
      lastIssues = parsed.issues;
      aiLog("invalid_structured_output", { model, attempt, reason: parsed.reason });
      if (attempt < attempts) {
        const retryNudge = renderPrompt(getPrompt("structured_output_retry"), { errors: parsed.issues.slice(0, 500) });
        messages.push({ role: "assistant", content: raw.text.slice(0, 4000) }, { role: "user", content: retryNudge });
      }
    }
    throw invalidResponseError("schema_mismatch", lastIssues);
  }

  /**
   * Tool conversation loop (provider executes single steps; the loop, its
   * limits, permission gating and auditing all live here). Limit hits end
   * the turn with a status — they never throw and never leave a tool
   * half-executed.
   */
  async runToolConversation(req: ToolConversationRequest): Promise<ToolConversationResult> {
    const model = selectModel(this.config, req.workload);
    const { system, promptId, promptVersion } = this.systemFor(req);
    const { maxModelCallsPerTurn, maxToolCallsPerTurn, maxTurnDurationMs } = this.config.limits;
    const specs = req.registry.providerSpecs(req.context);
    const messages: AiChatMessage[] = [...req.messages];
    const executed: ToolCallResult[] = [];
    const usage = { inputTokens: 0, outputTokens: 0 };
    const turnStarted = Date.now();
    let modelCalls = 0;
    let lastText = "";

    const finish = (status: ToolConversationStatus): ToolConversationResult => {
      if (status !== "complete" && status !== "refusal") {
        aiLog("tool_loop_limit", { status, modelCalls, toolCalls: executed.length, requestId: req.context.requestId });
      }
      return { status, text: lastText, modelCalls, executedToolCalls: executed, messages, usage };
    };

    while (true) {
      if (modelCalls >= maxModelCallsPerTurn) return finish("model_call_limit");
      if (Date.now() - turnStarted >= maxTurnDurationMs) return finish("duration_limit");

      await assertWithinAiBudget(this.config, model);
      const started = Date.now();
      let step;
      try {
        step = await this.provider.generateToolStep({
          model,
          system,
          // Snapshot — the provider must never observe later loop mutations.
          messages: [...messages],
          maxOutputTokens: req.maxOutputTokens ?? this.config.maxOutputTokens,
          tools: specs,
        });
      } catch (err) {
        const aiErr = toAiError(err, "AI_PROVIDER_UNAVAILABLE", "runToolConversation failed");
        aiLog("provider_error", { method: "runToolConversation", model, code: aiErr.code, message: aiErr.message });
        await recordUsageNonFatal({
          provider: this.provider.name,
          model,
          requestType: "tool_conversation",
          agentType: req.agentType ?? req.context.agentType,
          sessionId: req.sessionId ?? req.context.sessionId,
          conversationId: req.conversationId ?? req.context.conversationId,
          latencyMs: Date.now() - started,
          success: false,
          errorCode: aiErr.code,
          promptId,
          promptVersion,
        });
        throw aiErr;
      }
      modelCalls += 1;
      usage.inputTokens += step.usage.inputTokens ?? 0;
      usage.outputTokens += step.usage.outputTokens ?? 0;
      lastText = step.text || lastText;
      messages.push(step.assistantMessage);
      await recordUsageNonFatal({
        provider: this.provider.name,
        model,
        requestType: "tool_conversation",
        agentType: req.agentType ?? req.context.agentType,
        sessionId: req.sessionId ?? req.context.sessionId,
        conversationId: req.conversationId ?? req.context.conversationId,
        inputTokens: step.usage.inputTokens,
        outputTokens: step.usage.outputTokens,
        latencyMs: step.latencyMs,
        success: true,
        promptId,
        promptVersion,
      });

      if (step.finish === "refusal") return finish("refusal");
      if (step.toolCalls.length === 0) return finish("complete");

      if (executed.length + step.toolCalls.length > maxToolCallsPerTurn) {
        return finish("tool_call_limit");
      }
      const results = [];
      for (const call of step.toolCalls) {
        const result = await req.registry.execute(call.name, call.input, req.context);
        executed.push(result);
        results.push({
          toolCallId: call.id,
          result: result.ok ? result.data : { error: result.error },
          isError: !result.ok,
        });
      }
      messages.push({ role: "tool_results", results });
    }
  }
}

/**
 * Graceful-degradation probe for future surfaces: true only when the flag is
 * on AND configuration is usable. Never throws — storefront code branches on
 * this instead of try/catching the constructor.
 */
export function isAiRuntimeAvailable(env: AiEnvSource = process.env): boolean {
  try {
    if (!isFlagEnabled("AI_RUNTIME")) return false;
    const config = getAiConfig(env);
    return config.apiKey !== null;
  } catch {
    return false;
  }
}
