import { z } from "zod";
import { AiError } from "./errors";

/**
 * AI runtime configuration — parsed fresh from server env on every call
 * (cheap, and lets tests mutate process.env deterministically).
 *
 * Server-only: API keys must never reach a client bundle, so importing this
 * module in the browser throws immediately (same guard as db/client.ts).
 * No NEXT_PUBLIC_* variable is ever read here.
 *
 * Provider selection and model routing are configuration, not code
 * (AI_AGENT_ARCHITECTURE.md): AI_PROVIDER picks the vendor, the three
 * AI_MODEL_* vars pin a model per workload class.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/ai/config is server-only — never import it from client components");
}

export const AI_PROVIDER_NAMES = ["anthropic", "openai", "gemini"] as const;
export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number];

export const AI_WORKLOADS = ["LOW_COST", "STANDARD", "REASONING"] as const;
/** LOW_COST: classification/extraction/summaries · STANDARD: customer-facing conversation · REASONING: business analysis. */
export type AiWorkload = (typeof AI_WORKLOADS)[number];

/** Session-04 defaults; every one overridable by env. */
const DEFAULT_MODELS: Record<AiWorkload, string> = {
  LOW_COST: "claude-haiku-4-5",
  STANDARD: "claude-sonnet-5",
  REASONING: "claude-opus-5",
};

const positiveIntFromEnv = (fallback: number, max: number) =>
  z.coerce.number().int().positive().max(max).catch(fallback).default(fallback);

const optionalBudgetUsd = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (raw === undefined || raw.trim() === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      ctx.addIssue({ code: "custom", message: "budget must be a positive number of USD" });
      return z.NEVER;
    }
    return n;
  });

const envSchema = z.object({
  AI_PROVIDER: z.enum(AI_PROVIDER_NAMES).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  AI_MODEL_LOW_COST: z.string().min(1).default(DEFAULT_MODELS.LOW_COST),
  AI_MODEL_STANDARD: z.string().min(1).default(DEFAULT_MODELS.STANDARD),
  AI_MODEL_REASONING: z.string().min(1).default(DEFAULT_MODELS.REASONING),
  /** Budgets are optional — unset means "no cap configured" (documented default: requests proceed, spend still recorded). */
  AI_DAILY_BUDGET_USD: optionalBudgetUsd,
  AI_MONTHLY_BUDGET_USD: optionalBudgetUsd,
  AI_REQUEST_TIMEOUT_MS: positiveIntFromEnv(30_000, 300_000),
  /** Provider-level transport retries (SDK handles 429/5xx backoff). Conservative. */
  AI_PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(3).catch(1).default(1),
  /** Cap on thinking + response tokens per model call. */
  AI_MAX_OUTPUT_TOKENS: positiveIntFromEnv(16_000, 64_000),
  /** Tool-loop safety limits (per AI turn). */
  AI_MAX_TOOL_CALLS_PER_TURN: positiveIntFromEnv(8, 50),
  AI_MAX_MODEL_CALLS_PER_TURN: positiveIntFromEnv(5, 20),
  AI_MAX_TURN_DURATION_MS: positiveIntFromEnv(120_000, 600_000),
  /** Extra model attempts after an invalid structured response (0–2). */
  AI_STRUCTURED_RETRY_LIMIT: z.coerce.number().int().min(0).max(2).catch(1).default(1),
});

export type AiConfig = {
  provider: AiProviderName;
  /** Key for the SELECTED provider only; null = not configured. */
  apiKey: string | null;
  models: Record<AiWorkload, string>;
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  requestTimeoutMs: number;
  providerMaxRetries: number;
  maxOutputTokens: number;
  limits: {
    maxToolCallsPerTurn: number;
    maxModelCallsPerTurn: number;
    maxTurnDurationMs: number;
    structuredRetryLimit: number;
  };
};

const KEY_VARS: Record<AiProviderName, "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "GOOGLE_GENERATIVE_AI_API_KEY"> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_GENERATIVE_AI_API_KEY",
};

/** Loose env source — process.env or a plain test object. */
export type AiEnvSource = Record<string, string | undefined>;

export function getAiConfig(env: AiEnvSource = process.env): AiConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new AiError("AI_CONFIGURATION_ERROR", `invalid AI environment configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const e = parsed.data;
  const key = env[KEY_VARS[e.AI_PROVIDER]];
  return {
    provider: e.AI_PROVIDER,
    apiKey: key && key.trim() !== "" ? key : null,
    models: {
      LOW_COST: e.AI_MODEL_LOW_COST,
      STANDARD: e.AI_MODEL_STANDARD,
      REASONING: e.AI_MODEL_REASONING,
    },
    dailyBudgetUsd: e.AI_DAILY_BUDGET_USD,
    monthlyBudgetUsd: e.AI_MONTHLY_BUDGET_USD,
    requestTimeoutMs: e.AI_REQUEST_TIMEOUT_MS,
    providerMaxRetries: e.AI_PROVIDER_MAX_RETRIES,
    maxOutputTokens: e.AI_MAX_OUTPUT_TOKENS,
    limits: {
      maxToolCallsPerTurn: e.AI_MAX_TOOL_CALLS_PER_TURN,
      maxModelCallsPerTurn: e.AI_MAX_MODEL_CALLS_PER_TURN,
      maxTurnDurationMs: e.AI_MAX_TURN_DURATION_MS,
      structuredRetryLimit: e.AI_STRUCTURED_RETRY_LIMIT,
    },
  };
}
