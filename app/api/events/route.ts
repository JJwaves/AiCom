import { NextResponse } from "next/server";
import { z } from "zod";
import { eventInputSchema, recordEvents } from "@/lib/data/event-service";
import { sessionFromRequest, setSessionCookies } from "@/lib/data/request-session";
import { attributionSnapshotSchema, recordAttribution } from "@/lib/data/session-service";
import { captureException } from "@/lib/observability/error-tracking";
import { correlationIdFrom } from "@/lib/observability/correlation";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitedResponse } from "@/lib/rate-limit/http";

/**
 * First-party event intake (the dual-write target of lib/analytics).
 *
 * Public and unauthenticated by nature, so strictly bounded: capped body
 * size, capped batch, taxonomy-validated names, scalar-only props. Minted
 * session ids return as rolling httpOnly cookies. Attribution snapshots
 * merge server-side with the same immutable-first-touch semantics the
 * client library has always had.
 *
 * REQUEST-FREQUENCY PROTECTION (Production Launch Session 03 §12). The
 * production audit named this route as unauthenticated and unbounded by
 * frequency: body and batch caps bound one request's SIZE, but nothing
 * bounded how many requests arrived, and every accepted request writes rows
 * that first-party analytics then reports as real behaviour.
 *
 * The NETWORK scope is checked BEFORE `sessionFromRequest`, deliberately: a
 * caller with no cookie mints a new session row on every request, so
 * limiting after identity resolution would still let an abusive client force
 * unbounded writes. The session scope is checked once identity exists.
 *
 * Body is parsed from text because sendBeacon posts without a JSON
 * content type.
 */

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64_000;

const bodySchema = z.object({
  events: z.array(eventInputSchema).min(1).max(20),
  attribution: attributionSnapshotSchema.optional(),
});

export async function POST(req: Request) {
  const correlationId = correlationIdFrom(req);

  // Frequency, before identity: an unauthenticated caller must not be able
  // to make us write a session row just by arriving.
  const networkLimit = await enforceRateLimit({ route: "events", req, scopes: ["network"] });
  if (!networkLimit.allowed) return rateLimitedResponse(networkLimit);

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_REQUEST" }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, code: "TOO_LARGE" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_REQUEST" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });
  }

  const ctx = await sessionFromRequest(req);
  if (!ctx) {
    // Event persistence is best-effort — never surface databases problems as
    // storefront errors; the dataLayer copy of the event is unaffected.
    return NextResponse.json({ ok: false, code: "UNAVAILABLE" }, { status: 503 });
  }

  const sessionLimit = await enforceRateLimit({
    route: "events",
    req,
    sessionId: ctx.session.id,
    scopes: ["session"],
  });
  if (!sessionLimit.allowed) return rateLimitedResponse(sessionLimit);

  try {
    if (parsed.data.attribution) {
      await recordAttribution(ctx.session.id, parsed.data.attribution);
    }
    const stored = await recordEvents(ctx.session.id, parsed.data.events, {
      customerId: ctx.session.customerId,
    });
    const res = NextResponse.json({ ok: true, stored });
    setSessionCookies(res, ctx.session);
    return res;
  } catch (err) {
    captureException(err, {
      subsystem: "events",
      event: "event_persistence_failed",
      correlationId,
      code: "EVENTS_PERSISTENCE_FAILED",
      fields: { batchSize: parsed.data.events.length },
    });
    return NextResponse.json({ ok: false, code: "UNAVAILABLE" }, { status: 503 });
  }
}
