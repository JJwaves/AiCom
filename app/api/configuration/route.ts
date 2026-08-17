import { NextResponse } from "next/server";
import { z } from "zod";
import {
  applyConfigurationPatchForSession,
  resolveCurrentConfiguration,
  syncConfigurationForSession,
  type ApplyConfigurationResult,
} from "@/lib/configuration/server";
import { MAX_QUANTITY } from "@/lib/configuration/validation";
import { parseCookies, sessionFromRequest, setSessionCookies } from "@/lib/data/request-session";
import { getSession, SESSION_COOKIE } from "@/lib/data/session-service";
import { configurationSchema } from "@/lib/validation/checkout";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitedResponse } from "@/lib/rate-limit/http";

/**
 * Shared-configuration persistence API (Session 06).
 *
 * POST — two shapes, one server-side application path:
 *   { productId, config }                     full snapshot from the visual
 *                                             configurator (debounced sync;
 *                                             last-write-wins by design)
 *   { productId, patch, expectedRevision? }   partial patch (an AI
 *                                             suggestion the customer tapped;
 *                                             re-validated server-side —
 *                                             a stale client chip can never
 *                                             blindly overwrite newer state)
 *
 * Both validate against the live catalog via lib/configuration and persist
 * source "configurator" with CONFIGURATOR need-profile evidence — a tapped
 * suggestion is a USER action. AI-initiated writes never pass through here;
 * they use the updateConfiguration tool (source "ai").
 *
 * GET ?productId=… returns the session's live configuration row for restore
 * (no session is minted; unknown browsers just have no configuration).
 *
 * Rate limiting (Production Launch Session 03 §15): classified
 * PUBLIC_DB_WRITE and enforced through the centralized limiter — network
 * scope before a session is minted, session scope after. The limits are set
 * for a human fiddling with a configurator at full speed, so a real customer
 * never meets them. The platform/WAF layer remains the hard outer bound
 * (docs/OBSERVABILITY.md).
 */

export const runtime = "nodejs";

const MAX_BODY_BYTES = 32_000; // artwork metadata included — still tiny

// STRICT: unknown patch keys (prices, artwork, admin fields…) are a
// validation error — a stale or tampered suggestion chip fails loudly.
const patchSchema = z
  .strictObject({
    sizeId: z.string().trim().min(1).max(100),
    materialId: z.string().trim().min(1).max(100),
    colorId: z.string().trim().min(1).max(100),
    printOptionId: z.enum(["none", "one-color", "two-color", "full-custom"]),
    quantity: z.number().int().positive().max(MAX_QUANTITY),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "empty patch");

const bodySchema = z.union([
  z.object({ productId: z.string().trim().min(1).max(100), config: configurationSchema }),
  z.object({
    productId: z.string().trim().min(1).max(100),
    patch: patchSchema,
    expectedRevision: z.number().int().nonnegative().optional(),
  }),
]);

function toWireConfiguration(result: Extract<ApplyConfigurationResult, { status: "applied" | "stale_revision" }>) {
  const current = result.current;
  return {
    config: current.config,
    revision: current.revision,
    requiresCustomQuote: current.requiresCustomQuote,
    price: current.price,
  };
}

export async function POST(req: Request) {
  const networkLimit = await enforceRateLimit({ route: "configuration", req, scopes: ["network"] });
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
    // Persistence is additive to commerce — the configurator keeps working
    // locally; the client silently retries on a later change.
    return NextResponse.json({ ok: false, code: "SESSION_UNAVAILABLE" }, { status: 503 });
  }

  const sessionLimit = await enforceRateLimit({
    route: "configuration",
    req,
    sessionId: ctx.session.id,
    scopes: ["session"],
  });
  if (!sessionLimit.allowed) return rateLimitedResponse(sessionLimit);

  try {
    const result =
      "config" in parsed.data
        ? await syncConfigurationForSession({
            sessionId: ctx.session.id,
            productId: parsed.data.productId,
            config: parsed.data.config,
            customerId: ctx.session.customerId,
          })
        : await applyConfigurationPatchForSession({
            sessionId: ctx.session.id,
            productId: parsed.data.productId,
            patch: parsed.data.patch,
            expectedRevision: parsed.data.expectedRevision,
            source: "configurator",
            customerId: ctx.session.customerId,
          });

    let res: NextResponse;
    switch (result.status) {
      case "applied":
        res = NextResponse.json({ ok: true, configuration: toWireConfiguration(result) });
        break;
      case "invalid":
        res = NextResponse.json(
          {
            ok: false,
            code: "UNSUPPORTED_OPTION",
            issues: result.issues.map(({ field, requested, reason, available, message }) => ({
              field,
              requested,
              reason,
              available,
              message,
            })),
          },
          { status: 422 },
        );
        break;
      case "stale_revision":
        res = NextResponse.json(
          { ok: false, code: "STALE_REVISION", configuration: toWireConfiguration(result) },
          { status: 409 },
        );
        break;
      case "unknown_product":
        res = NextResponse.json({ ok: false, code: "UNKNOWN_PRODUCT" }, { status: 404 });
        break;
    }
    setSessionCookies(res, ctx.session);
    return res;
  } catch (err) {
    console.error("[configuration] persistence failed (configurator remains local-only)", err);
    return NextResponse.json({ ok: false, code: "PERSISTENCE_FAILED" }, { status: 503 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const productId = url.searchParams.get("productId")?.trim();
  if (!productId || productId.length > 100) {
    return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });
  }

  const sessionId = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (!sessionId) return NextResponse.json({ ok: true, configuration: null });

  try {
    const session = await getSession(sessionId);
    if (!session) return NextResponse.json({ ok: true, configuration: null });
    const current = await resolveCurrentConfiguration(session.id, productId);
    if (!current || "status" in current) {
      return NextResponse.json({ ok: true, configuration: null });
    }
    // Revision 0 = defaults (no row) — nothing to restore.
    if (current.revision === 0) return NextResponse.json({ ok: true, configuration: null });
    return NextResponse.json({
      ok: true,
      configuration: {
        config: current.config,
        revision: current.revision,
        requiresCustomQuote: current.requiresCustomQuote,
        price: current.price,
      },
    });
  } catch (err) {
    console.error("[configuration] read failed", err);
    return NextResponse.json({ ok: false, code: "READ_FAILED" }, { status: 503 });
  }
}
