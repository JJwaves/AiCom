/**
 * lib/ai — AI provider infrastructure + tool architecture (Session 04).
 *
 * Public surface for future agents (S05+). The LLM provides intelligence;
 * the application provides authority — nothing in here can set a price,
 * touch payments/refunds/ads, or reach the database outside the typed tool
 * registry and lib/data services.
 *
 * Server-only (config.ts throws in the browser). Everything is OFF until
 * AI_RUNTIME_ENABLED=true and a provider key is configured; commerce works
 * with all of it off.
 */

export { AiRuntime, isAiRuntimeAvailable } from "./runtime";
export type {
  GenerateObjectRequest,
  GenerateTextRequest,
  GenerateTextResult,
  ToolConversationRequest,
  ToolConversationResult,
  ToolConversationStatus,
} from "./runtime";
export { AiError, isAiError, AI_ERROR_CODES, type AiErrorCode } from "./errors";
export { getAiConfig, AI_WORKLOADS, type AiConfig, type AiWorkload, type AiProviderName } from "./config";
export { selectModel } from "./router";
export { createProvider } from "./providers";
export type { AIProvider, AiChatMessage } from "./providers/types";
export { FakeAiProvider, type FakeStep } from "./providers/fake";
export { getPrompt, listPrompts, renderPrompt, type PromptDefinition, type PromptId } from "./prompts/registry";
export { createSalesToolRegistry, createToolContext, ToolRegistry } from "./tools";
export {
  AGENT_TOOL_PERMISSIONS,
  TOOL_PERMISSIONS,
  type AnyToolDefinition,
  type ToolCallResult,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolPermission,
} from "./tools/types";
export { assertWithinAiBudget } from "./usage/budget-guard";
export { estimateCostMicros, isModelPriced } from "./usage/cost";
