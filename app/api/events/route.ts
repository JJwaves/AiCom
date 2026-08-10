import { NextResponse } from "next/server";
import { z } from "zod";
import { eventInputSchema, recordEvents } from "@/lib/data/event-service";
import { sessionFromRequest, setSessionCookies } from "@/lib/data/request-session";
import { attributionSnapshotSchema, recordAttribution } from "@/lib/data/session-service";

/**
 * First-party event intake (the dual-write target of lib/analytics).
 *
 * Public and unauthenticated by nature, so strictly bounded: capped body
 * size, capped batch, taxonomy-validated names, scalar-only props. Minted
 * session ids return as rolling httpOnly cookies. Attribution snapshots
 * merge server-side with the same immutable-first-touch semantics the
 * client library has always had.
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
    console.error("[events] persistence failed", err);
    return NextResponse.json({ ok: false, code: "UNAVAILABLE" }, { status: 503 });
  }
}
