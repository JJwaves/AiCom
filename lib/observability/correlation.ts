import { randomUUID } from "node:crypto";

/**
 * Correlation ids (Production Launch Session 03 §35).
 *
 * ONE id follows a single customer action across the subsystems that can
 * each fail independently: checkout creation → Shopify draft order → order
 * persistence → webhook reconciliation → artwork finalization. Without it,
 * "a checkout failed at 14:03" is a log search across four subsystems with
 * no join key.
 *
 * Deliberately NOT distributed tracing: no OpenTelemetry, no collector, no
 * new infrastructure. A correlation id is a short opaque string that is
 * logged, propagated in a header, and stored on the rows that outlive the
 * request. That is enough to answer "what happened to THIS order".
 *
 * PRIVACY: a correlation id is random. It is never derived from a session
 * id, a customer id, an email address or an IP — so it cannot be reversed
 * into an identity, and it is safe to return to the browser and safe to put
 * in a third-party error report.
 */

/** The inbound/outbound header. Vercel and most proxies pass this through. */
export const CORRELATION_HEADER = "x-request-id";

/** Bounded, printable, and safe to echo — a hostile header never reaches a log line verbatim. */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function newCorrelationId(): string {
  return `req_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/**
 * The correlation id for a request: the caller's, if it is a plausible id,
 * otherwise a fresh one. A client-supplied value is only ever used as a log
 * label — it grants nothing and identifies nobody.
 */
export function correlationIdFrom(req: { headers: { get(name: string): string | null } }): string {
  const supplied = req.headers.get(CORRELATION_HEADER);
  if (supplied && SAFE_ID.test(supplied)) return supplied;
  return newCorrelationId();
}

/** Attach the id to a response so the customer can quote it to support. */
export function withCorrelationHeader<T extends { headers: Headers }>(res: T, correlationId: string): T {
  res.headers.set(CORRELATION_HEADER, correlationId);
  return res;
}
