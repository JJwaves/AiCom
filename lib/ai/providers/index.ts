import type { AiConfig } from "../config";
import { AiError } from "../errors";
import { AnthropicProvider } from "./anthropic";
import type { AIProvider } from "./types";

/**
 * Provider factory — vendor choice is configuration (AI_PROVIDER), never
 * business logic.
 *
 * Status: anthropic IMPLEMENTED · openai/gemini SUPPORTED BY INTERFACE,
 * DEFERRED (selecting one fails loudly with the exact gap, not silently).
 */
export function createProvider(config: AiConfig): AIProvider {
  switch (config.provider) {
    case "anthropic":
      if (!config.apiKey) {
        throw new AiError("AI_CONFIGURATION_ERROR", "AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
      }
      return new AnthropicProvider({
        apiKey: config.apiKey,
        timeoutMs: config.requestTimeoutMs,
        maxRetries: config.providerMaxRetries,
      });
    case "openai":
    case "gemini":
      throw new AiError(
        "AI_CONFIGURATION_ERROR",
        `AI_PROVIDER=${config.provider} is interface-supported but not implemented yet — implement lib/ai/providers/${config.provider}.ts or set AI_PROVIDER=anthropic`,
      );
  }
}

export type { AIProvider } from "./types";
