import { describeError, logError, redactText, type LogSubsystem } from "./logger";

/**
 * External error tracking (Production Launch Session 03 §36, §37).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY NOT `@sentry/nextjs`
 * ─────────────────────────────────────────────────────────────────────────
 * The repository has one dependency doctrine, applied in Session 02 to
 * object storage: an SDK earns its place by providing capability, not
 * convenience. Sentry's ingest API is a documented HTTP endpoint, and the
 * capability needed here — "an unexpected server exception reaches somebody"
 * — is roughly sixty lines of `fetch`. The SDK's real value is browser
 * capture, source maps, performance tracing and release health, none of
 * which this session needs and all of which change the build.
 *
 * So: a small transport, two supported destinations, and an honest
 * statement of what is NOT included.
 *
 *   SENTRY_DSN            → Sentry-compatible envelope ingest (also GlitchTip)
 *   ERROR_WEBHOOK_URL     → a plain JSON POST (Slack workflow, Zapier, a
 *                           log drain, an internal endpoint)
 *   neither configured    → reports go to the structured log only
 *
 * WHAT THIS DOES NOT DO, deliberately, and documented in docs/OBSERVABILITY.md:
 * browser/client-side error capture, source-map symbolication, release
 * tracking, performance tracing, breadcrumbs, or user-session replay. If the
 * owner later wants those, installing the real SDK is a clean upgrade — this
 * module's call sites do not change.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS AND IS NOT AN ERROR
 * ─────────────────────────────────────────────────────────────────────────
 * Reported: unexpected server exceptions — a Shopify call that threw, a
 * failed database write, an artwork verification that crashed, an AI runtime
 * fault, a reconciliation failure.
 *
 * NOT reported (§37): expected business outcomes. Below MOQ, missing
 * artwork, 409 REPRICED, an unmapped configuration, an invalid customer
 * input, a rate-limited caller. Those are the system working. Reporting them
 * trains the owner to ignore the alert channel, which is the same as having
 * no alerting.
 */

export type ErrorContext = {
  subsystem: LogSubsystem;
  /** What was being attempted, e.g. "shopify_draft_order_create". */
  event: string;
  correlationId?: string | null;
  /** Stable failure code where one exists. */
  code?: string | null;
  /** Additional SAFE scalars. Never a payload, never a credential, never PII. */
  fields?: Record<string, string | number | boolean | null | undefined>;
};

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

type SentryDsn = { origin: string; projectId: string; publicKey: string };

/** `https://<publicKey>@<host>/<projectId>` — anything else is not a DSN. */
export function parseSentryDsn(raw: string): SentryDsn | null {
  try {
    const url = new URL(raw.trim());
    const projectId = url.pathname.replace(/^\/+/, "").split("/").pop() ?? "";
    if (!url.username || !projectId || !/^https?:$/.test(url.protocol)) return null;
    return { origin: `${url.protocol}//${url.host}`, projectId, publicKey: url.username };
  } catch {
    return null;
  }
}

function readEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type ErrorTrackingReadiness = {
  configured: boolean;
  /** Which destinations are live. Never the DSN, never the URL. */
  destinations: ("sentry" | "webhook")[];
  /** Set when a destination is configured but unusable (e.g. malformed DSN). */
  error: string | null;
};

/** Non-throwing readiness view for /admin and health. Exposes NO secret. */
export function describeErrorTrackingReadiness(): ErrorTrackingReadiness {
  const destinations: ("sentry" | "webhook")[] = [];
  let error: string | null = null;
  const dsn = readEnv("SENTRY_DSN");
  if (dsn) {
    if (parseSentryDsn(dsn)) destinations.push("sentry");
    else error = "SENTRY_DSN is set but is not a valid DSN (expected https://<key>@<host>/<project-id>)";
  }
  if (readEnv("ERROR_WEBHOOK_URL")) destinations.push("webhook");
  return { configured: destinations.length > 0, destinations, error };
}

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

/**
 * A burst cap. An error loop (a failing database on every request) must not
 * turn into an outbound request loop that costs money and buries the signal.
 * Dropped reports still reach the structured log, and the drop is counted.
 */
const MAX_REPORTS_PER_WINDOW = 60;
const WINDOW_MS = 60_000;
let windowStart = 0;
let windowCount = 0;
let droppedSinceLastReport = 0;

function withinBurstCap(now: number): boolean {
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  if (windowCount >= MAX_REPORTS_PER_WINDOW) {
    droppedSinceLastReport += 1;
    return false;
  }
  windowCount += 1;
  return true;
}

/** Test seam: reporting is fire-and-forget, so tests need the promise. */
let lastDelivery: Promise<void> = Promise.resolve();
export function __errorTrackingDeliveryForTests(): Promise<void> {
  return lastDelivery;
}
export function __resetErrorTrackingForTests(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__resetErrorTrackingForTests is a test hook and cannot be used in production");
  }
  windowStart = 0;
  windowCount = 0;
  droppedSinceLastReport = 0;
  lastDelivery = Promise.resolve();
}

const DELIVERY_TIMEOUT_MS = 4_000;

async function postJson(url: string, body: string, headers: Record<string, string>): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

function sentryEnvelope(dsn: SentryDsn, payload: Record<string, unknown>): { url: string; body: string; headers: Record<string, string> } {
  const eventId = (payload.event_id as string) ?? "";
  const header = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() });
  const itemHeader = JSON.stringify({ type: "event" });
  return {
    url: `${dsn.origin}/api/${dsn.projectId}/envelope/?sentry_key=${encodeURIComponent(dsn.publicKey)}&sentry_version=7`,
    body: `${header}\n${itemHeader}\n${JSON.stringify(payload)}\n`,
    headers: { "Content-Type": "application/x-sentry-envelope" },
  };
}

/**
 * Report an unexpected exception.
 *
 * Fire-and-forget by contract: it returns void, never throws, and a
 * monitoring outage can never fail the customer's request. The structured
 * log line is written FIRST and unconditionally, so an unconfigured or
 * broken tracker still leaves a record on the platform's own log drain.
 */
export function captureException(err: unknown, context: ErrorContext): void {
  const description = describeError(err);
  logError({
    subsystem: context.subsystem,
    event: context.event,
    correlationId: context.correlationId ?? null,
    code: context.code ?? null,
    error: description,
    ...(context.fields ?? {}),
  });

  try {
    const readiness = describeErrorTrackingReadiness();
    if (!readiness.configured) return;
    if (!withinBurstCap(Date.now())) return;

    const dropped = droppedSinceLastReport;
    droppedSinceLastReport = 0;

    const eventId = crypto.randomUUID().replace(/-/g, "");
    const tags: Record<string, string> = {
      subsystem: context.subsystem,
      event: context.event,
      environment: process.env.NODE_ENV ?? "development",
    };
    if (context.code) tags.code = context.code;

    const extra: Record<string, unknown> = { ...(context.fields ?? {}) };
    if (context.correlationId) extra.correlationId = context.correlationId;
    if (dropped > 0) extra.droppedReportsSinceLast = dropped;
    // A stack helps triage and is not customer data; it is redacted like
    // everything else in case a signed URL made it into a frame.
    if (err instanceof Error && err.stack) extra.stack = redactText(err.stack).slice(0, 4_000);

    const payload = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: "node",
      level: "error",
      logger: `bagdirect.${context.subsystem}`,
      environment: process.env.NODE_ENV ?? "development",
      server_name: undefined,
      message: `${context.event}: ${description}`,
      tags,
      extra,
    };

    const deliveries: Promise<void>[] = [];
    const dsnRaw = readEnv("SENTRY_DSN");
    const dsn = dsnRaw ? parseSentryDsn(dsnRaw) : null;
    if (dsn) {
      const envelope = sentryEnvelope(dsn, payload);
      deliveries.push(postJson(envelope.url, envelope.body, envelope.headers));
    }
    const webhook = readEnv("ERROR_WEBHOOK_URL");
    if (webhook) deliveries.push(postJson(webhook, JSON.stringify(payload), {}));

    lastDelivery = Promise.allSettled(deliveries).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          // Reported through console directly: routing a tracker failure back
          // through captureException would be a loop.
          console.error(
            JSON.stringify({
              subsystem: "health",
              event: "error_tracking_delivery_failed",
              severity: "warn",
              at: new Date().toISOString(),
              error: describeError(result.reason),
            }),
          );
        }
      }
    });
  } catch {
    /* monitoring must never break the request it is monitoring */
  }
}
