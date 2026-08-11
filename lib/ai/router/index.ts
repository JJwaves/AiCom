import type { AiConfig, AiWorkload } from "../config";
import { AiError } from "../errors";

/**
 * Model router — deterministic workload→model mapping from configuration
 * (MASTER_PROMPT §23: never send every request to the strongest model;
 * routing is configuration, not ML).
 *
 *   LOW_COST  → intent classification, field extraction, summaries, tagging
 *   STANDARD  → customer-facing sales conversation, product explanation
 *   REASONING → business analysis, multi-source decision support
 *
 * Defaults live in lib/ai/config.ts and are overridden per tier by
 * AI_MODEL_LOW_COST / AI_MODEL_STANDARD / AI_MODEL_REASONING.
 */
export function selectModel(config: AiConfig, workload: AiWorkload): string {
  const model = config.models[workload];
  if (!model) {
    // Unreachable with a zod-validated config; kept as a typed guard.
    throw new AiError("AI_CONFIGURATION_ERROR", `no model configured for workload ${workload}`);
  }
  return model;
}
