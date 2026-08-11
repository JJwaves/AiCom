/**
 * Normalized AI errors — application code never handles raw vendor error
 * shapes. Every failure crossing the lib/ai boundary is an AiError with one
 * of these codes; the original vendor error rides along as `cause` for logs.
 *
 * None of these messages are customer-facing copy. Callers (S05+) map codes
 * to graceful degradation (hide the AI surface, fall back to manual flows) —
 * commerce never fails because AI failed.
 */

export const AI_ERROR_CODES = [
  /** Flag off — the runtime is disabled by configuration. */
  "AI_DISABLED",
  /** Missing/invalid config: no API key, unknown provider/model, unpriced model under a budget, bad request we built. */
  "AI_CONFIGURATION_ERROR",
  /** Provider down/overloaded/unreachable (5xx, 529, network). Retryable later. */
  "AI_PROVIDER_UNAVAILABLE",
  /** Provider rate limit (429). Retryable with backoff. */
  "AI_RATE_LIMITED",
  /** Provider call exceeded the configured timeout. */
  "AI_TIMEOUT",
  /** Model output failed schema validation / was unparsable / was refused. */
  "AI_INVALID_RESPONSE",
  /** Configured AI budget cap reached — or the cap check itself failed (fail closed). */
  "AI_BUDGET_EXCEEDED",
  /** Tool loop failure that aborts the turn (limits exceeded). Per-call tool errors are structured results, not throws. */
  "AI_TOOL_ERROR",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export class AiError extends Error {
  readonly code: AiErrorCode;
  /** Machine-readable discriminator inside a code, e.g. "daily_exceeded" | "check_failed". */
  readonly detail?: string;

  constructor(code: AiErrorCode, message: string, opts: { detail?: string; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "AiError";
    this.code = code;
    this.detail = opts.detail;
  }
}

export function isAiError(err: unknown): err is AiError {
  return err instanceof AiError;
}

/** Wrap anything non-AiError so callers can rely on the typed surface. */
export function toAiError(err: unknown, fallbackCode: AiErrorCode, context: string): AiError {
  if (isAiError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new AiError(fallbackCode, `${context}: ${message}`, { cause: err });
}
