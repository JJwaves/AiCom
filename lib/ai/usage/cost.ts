import { getModelPricing } from "@/config/ai-pricing";

/**
 * Cost estimation — the only code that turns tokens into money, fed solely
 * by config/ai-pricing.ts. Unpriced model or unknown token counts ⇒ null
 * (recorded as "cost unknown", never guessed).
 *
 * Unit identity that keeps this exact integer math: USD-per-1M-tokens IS
 * micro-dollars-per-token, so micros = tokens × usdPerMTok.
 */
export function estimateCostMicros(
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number | null {
  const pricing = getModelPricing(model);
  if (!pricing || pricing.usdPerMTokIn === null || pricing.usdPerMTokOut === null) return null;
  if (inputTokens === undefined || outputTokens === undefined) return null;
  return Math.round(inputTokens * pricing.usdPerMTokIn + outputTokens * pricing.usdPerMTokOut);
}

/** Budget enforcement needs measurable spend — true iff the model has full pricing. */
export function isModelPriced(model: string): boolean {
  const pricing = getModelPricing(model);
  return !!pricing && pricing.usdPerMTokIn !== null && pricing.usdPerMTokOut !== null;
}
