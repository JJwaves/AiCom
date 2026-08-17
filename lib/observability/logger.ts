/**
 * Structured operational logging (Production Launch Session 03 §34).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 * Before this session every subsystem logged in its own shape:
 * `[checkout] provider createCheckout failed`, `[artwork] verification
 * failed for art_…`, `[shopify-webhook] processing failed for orders/paid`.
 * All readable by a human reading one line; none of them joinable, filterable
 * by severity, or alertable on. A production alert rule needs a field, not a
 * prefix.
 *
 * The shape is one JSON line per event with a stable field set:
 *
 *   { subsystem, event, severity, correlationId, at, code?, …safe fields }
 *
 * `lib/ai/log.ts` (the `[ai]` channel) predates this and stays as it is —
 * it has its own established event vocabulary and its own redaction rules,
 * and rewriting it would churn Session 04–13 tests for no operational gain.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT MUST NEVER APPEAR IN A LOG LINE
 * ─────────────────────────────────────────────────────────────────────────
 * API keys, the Shopify Admin token, the webhook signing secret, OAuth
 * refresh tokens, storage credentials, card/payment data, raw artwork, and
 * full conversation transcripts. Two mechanisms enforce it:
 *
 *  1. FIELDS ARE SCALARS. `logEvent` accepts only string/number/boolean/null
 *     — you cannot pass a credentials object, an Error with a `config`
 *     property, or a raw provider response, because there is no field type
 *     that would carry it.
 *  2. KEY AND VALUE REDACTION. A field whose NAME looks secret is replaced
 *     with "[redacted]", and a value that looks like a known credential
 *     shape (shpat_…, sk-…, an AWS key id, a bearer token) is replaced too —
 *     because the value can arrive inside a provider error message that
 *     nobody wrote by hand.
 *
 * Redaction is a backstop, not a licence: the rule is still "do not log the
 * secret".
 */

export type LogSeverity = "debug" | "info" | "warn" | "error";

/**
 * The subsystems that can fail independently in production. A closed list
 * on purpose: an alert rule filters on this field, and a free-form string
 * would silently create a subsystem nobody is alerting on.
 */
export const LOG_SUBSYSTEMS = [
  "checkout",
  "commerce",
  "webhook",
  "reconciliation",
  "artwork",
  "events",
  "quote",
  "escalation",
  "rate-limit",
  "health",
  "admin",
  "ai",
  "db",
  "analytics",
] as const;

export type LogSubsystem = (typeof LOG_SUBSYSTEMS)[number];

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export type LogEntry = {
  subsystem: LogSubsystem;
  event: string;
  severity?: LogSeverity;
  /** Joins this line to every other line from the same customer action. */
  correlationId?: string | null;
  /** Stable, machine-comparable failure code — never a raw provider message. */
  code?: string | null;
} & LogFields;

/* ------------------------------------------------------------------ */
/* Redaction                                                           */
/* ------------------------------------------------------------------ */

/** Field NAMES that must never carry a value into a log line. */
const SECRET_KEY = /(token|secret|password|passwd|apikey|api_key|credential|authorization|cookie|dsn|signature)/i;

/**
 * Value SHAPES that are credentials wherever they appear — including inside
 * a provider's own error text, which no reviewer here wrote.
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /shp(at|ca|pa|ss)_[A-Za-z0-9]{8,}/g, // Shopify access tokens
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI-style keys
  /sk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic keys
  /AKIA[0-9A-Z]{16}/g, // AWS access key ids
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\b1\/\/[A-Za-z0-9._~+/-]{20,}/g, // Google OAuth refresh tokens
];

export const REDACTED = "[redacted]";

/** Scrub a string that may embed a credential (provider error text, URLs). */
export function redactText(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

function redactValue(key: string, value: string | number | boolean | null): string | number | boolean | null {
  if (SECRET_KEY.test(key)) return REDACTED;
  return typeof value === "string" ? redactText(value) : value;
}

/** Longest a single field may be. A truncated log line still alerts; an unbounded one costs money. */
const MAX_FIELD_CHARS = 500;

/* ------------------------------------------------------------------ */
/* Emit                                                                */
/* ------------------------------------------------------------------ */

const SEVERITY_STREAM: Record<LogSeverity, "log" | "warn" | "error"> = {
  debug: "log",
  info: "log",
  warn: "warn",
  error: "error",
};

/**
 * Emit one structured line. Never throws: a logger that can break a checkout
 * is worse than no logger.
 */
export function logEvent(entry: LogEntry): void {
  try {
    const { subsystem, event, severity = "info", correlationId, code, ...rest } = entry;
    const payload: Record<string, string | number | boolean | null> = {
      subsystem,
      event,
      severity,
      at: new Date().toISOString(),
    };
    if (correlationId) payload.correlationId = correlationId;
    if (code) payload.code = code;
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      const redacted = redactValue(key, value as string | number | boolean | null);
      payload[key] = typeof redacted === "string" ? redacted.slice(0, MAX_FIELD_CHARS) : redacted;
    }
    const stream = SEVERITY_STREAM[severity] ?? "log";
    console[stream](JSON.stringify(payload));
  } catch {
    /* logging must never break a request */
  }
}

/** Convenience wrappers — a severity passed here is overridden by the wrapper's own. */
export const logInfo = (entry: LogEntry): void => logEvent({ ...entry, severity: "info" });
export const logWarn = (entry: LogEntry): void => logEvent({ ...entry, severity: "warn" });
export const logError = (entry: LogEntry): void => logEvent({ ...entry, severity: "error" });

/**
 * A safe one-line description of an unknown throwable.
 *
 * Errors reach logs from provider SDKs, `fetch`, and the database, and their
 * messages routinely embed the URL — which may embed a signed credential.
 * Stack traces stay out of the log payload entirely: they are large, they
 * leak file layout, and the error tracker already keeps them.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return redactText(`${err.name}: ${err.message}`).slice(0, MAX_FIELD_CHARS);
  return redactText(String(err)).slice(0, MAX_FIELD_CHARS);
}
