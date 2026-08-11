/**
 * AI model pricing — the ONLY place cost-per-token numbers live.
 *
 * NO INVENTED PRICES (same doctrine as config/costs.ts): every value ships
 * as a `null` [TO BE PROVIDED] placeholder until the owner copies current
 * rates from the provider's published pricing page. Unpriced model ⇒
 * `estimateCostMicros()` returns null and AiUsage rows record no cost.
 *
 * MAINTENANCE — when providers change prices or a model is added:
 *   1. Look up current $/1M-token rates (Anthropic: platform.claude.com →
 *      docs → pricing; OpenAI/Gemini: their pricing pages).
 *   2. Fill/adjust the entry below (usdPerMTokIn/usdPerMTokOut are USD per
 *      one million tokens — conveniently, that number IS the cost in
 *      micro-dollars per single token).
 *   3. Commit with the date checked, e.g. "verified 2026-08-10".
 *
 * BUDGET INTERACTION (lib/ai/usage/budget-guard.ts): if AI budget caps are
 * configured but the active model has no pricing here, AI calls FAIL CLOSED
 * with AI_CONFIGURATION_ERROR — a budget cannot be enforced over spend we
 * can't measure, and silently untracked spend is a financially dangerous
 * assumption. No budgets configured ⇒ null pricing is fine (cost simply
 * isn't estimated).
 *
 * Reference (NOT active config — verify before copying): Anthropic's
 * published first-party rates as of the 2026-06 docs snapshot were
 * haiku-4-5 $1/$5, sonnet-5 $3/$15 (intro $2/$10 through 2026-08-31),
 * opus-5 $5/$25 per MTok.
 */

export type ModelPricing = {
  /** USD per 1M input tokens (= micro-dollars per token). null = [TO BE PROVIDED]. */
  usdPerMTokIn: number | null;
  /** USD per 1M output tokens (= micro-dollars per token). null = [TO BE PROVIDED]. */
  usdPerMTokOut: number | null;
};

/** Keyed by exact model id as sent to the provider. */
export const AI_MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5": { usdPerMTokIn: null, usdPerMTokOut: null },
  "claude-sonnet-5": { usdPerMTokIn: null, usdPerMTokOut: null },
  "claude-opus-5": { usdPerMTokIn: null, usdPerMTokOut: null },
};

export function getModelPricing(model: string): ModelPricing | null {
  return AI_MODEL_PRICING[model] ?? null;
}
