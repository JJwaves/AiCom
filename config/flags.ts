/**
 * Feature flags — every AI capability defaults OFF (GUARDRAILS.md).
 *
 * A flag is enabled only when its env var is explicitly "true" or "1"
 * (server env; none are NEXT_PUBLIC, so client bundles always read false —
 * AI surfaces are server-gated and simply don't render when off).
 * Commerce must be fully functional with every flag off.
 *
 * AI_RUNTIME is the master switch for the whole lib/ai runtime (Session 04);
 * per-agent flags additionally gate their own agents in later sessions —
 * e.g. the Session 05 sales agent requires AI_RUNTIME && AI_SALES.
 */

export const FEATURE_FLAGS = [
  /** Master switch for lib/ai (providers, router, tools). */
  "AI_RUNTIME",
  /** Customer-facing AI Sales Agent (Session 05). */
  "AI_SALES",
  "AI_CUSTOMER_INTELLIGENCE",
  /** Business Intelligence admin surface + CEO recommendation agent (Session 09). */
  "AI_BUSINESS_INTELLIGENCE",
  /**
   * AI Action Center admin surface (Session 10). The Guardrail Engine
   * itself is ALWAYS active — a proposed action is evaluated whether or not
   * this flag is on; the flag gates the /admin/ai-actions surface and its
   * mutation routes, which 404 while it is off.
   */
  "AI_ACTION_CENTER",
  "AI_PRICING_AGENT",
  "AI_CRO_AGENT",
  "AI_GOOGLE_ADS_AGENT",
  "AI_META_ADS_AGENT",
  /** Guarded auto-execution tiers — far-future, require operating history. */
  "AI_AUTO_PRICING",
  "AI_AUTO_ADS",
  "EXPERIMENT_ENGINE",
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

/** Env var for a flag: AI_RUNTIME → AI_RUNTIME_ENABLED. */
export function flagEnvVar(flag: FeatureFlag): string {
  return `${flag}_ENABLED`;
}

/**
 * Read at call time (not module load) so tests and runtime env changes are
 * honored. Anything other than exactly "true" or "1" — including unset,
 * "false", or garbage — reads as OFF: flags fail safe.
 */
export function isFlagEnabled(flag: FeatureFlag): boolean {
  const raw = process.env[flagEnvVar(flag)];
  return raw === "true" || raw === "1";
}
