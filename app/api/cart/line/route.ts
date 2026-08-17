import { NextResponse } from "next/server";
import { z } from "zod";
import { prepareCartLineFromConfiguration } from "@/lib/commerce/cart-line";
import { markConversationOutcomeForSession } from "@/lib/data/conversation-service";
import { recordServerEvent } from "@/lib/data/event-service";
import { sessionFromRequest, setSessionCookies } from "@/lib/data/request-session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitedResponse } from "@/lib/rate-limit/http";

/**
 * AI-assisted cart-line preparation API (Session 07) — the endpoint behind
 * the chat's "Add to cart" chips. A tapped chip is a USER action, but its
 * payload is client state: everything is re-validated here against the
 * session's CURRENT authoritative configuration before a line is returned,
 * and the browser adds the SERVER's line to the cart — never the chip's.
 *
 * The chip states the price the customer saw (`expectedTotalCents`) and the
 * revision it was based on; a price drift answers 409 REPRICED with the
 * current engine price (the customer confirms again — /api/checkout
 * semantics), a revision drift answers 409 STALE_CONFIGURATION with the
 * current state. STRICT body schema: a price/artwork/admin key is a loud
 * 422, never silently stripped.
 *
 * Rate limiting (Production Launch Session 03 §15): PUBLIC_DB_WRITE through
 * the centralized limiter, network scope first, session scope once identity
 * is known. A chip tap is human-paced by construction, so the limits are far
 * above any real interaction.
 */

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4_000;

const bodySchema = z.strictObject({
  productId: z.string().trim().min(1).max(100),
  expectedRevision: z.number().int().nonnegative(),
  expectedTotalCents: z.number().int().positive(),
});

export async function POST(req: Request) {
  const networkLimit = await enforceRateLimit({ route: "cart_line", req, scopes: ["network"] });
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
    return NextResponse.json({ ok: false, code: "SESSION_UNAVAILABLE" }, { status: 503 });
  }

  const sessionLimit = await enforceRateLimit({
    route: "cart_line",
    req,
    sessionId: ctx.session.id,
    scopes: ["session"],
  });
  if (!sessionLimit.allowed) return rateLimitedResponse(sessionLimit);

  try {
    const result = await prepareCartLineFromConfiguration({
      sessionId: ctx.session.id,
      productId: parsed.data.productId,
      expectedRevision: parsed.data.expectedRevision,
      expectedTotalCents: parsed.data.expectedTotalCents,
    });

    // Funnel telemetry — non-fatal, never blocks the customer.
    try {
      await recordServerEvent({
        sessionId: ctx.session.id,
        name: "ai_add_to_cart_requested",
        productId: parsed.data.productId,
        props: { via: "chip", outcome: result.status },
      });
      if (result.status === "prepared") {
        await markConversationOutcomeForSession(ctx.session.id, "cart_added");
      }
    } catch (err) {
      console.error("[cart] add-to-cart telemetry failed (line preparation unaffected)", err);
    }

    let res: NextResponse;
    switch (result.status) {
      case "prepared":
        res = NextResponse.json({
          ok: true,
          status: "prepared",
          productId: result.productId,
          line: result.line,
          revision: result.revision,
          currency: result.currency,
          pricingStatus: result.pricingStatus,
        });
        break;
      case "repriced":
        res = NextResponse.json(
          {
            ok: false,
            code: "REPRICED",
            productId: result.productId,
            expectedTotalCents: result.expectedTotalCents,
            currentPrice: result.currentPrice,
            revision: result.revision,
          },
          { status: 409 },
        );
        break;
      case "stale_configuration":
        res = NextResponse.json(
          {
            ok: false,
            code: "STALE_CONFIGURATION",
            configuration: {
              config: result.current.config,
              revision: result.current.revision,
              requiresCustomQuote: result.current.requiresCustomQuote,
              price: result.current.price,
            },
          },
          { status: 409 },
        );
        break;
      case "custom_quote_required":
        res = NextResponse.json({ ok: false, code: "CUSTOM_QUOTE_REQUIRED" }, { status: 422 });
        break;
      case "artwork_required":
        res = NextResponse.json({ ok: false, code: "ARTWORK_REQUIRED", printLabel: result.printLabel }, { status: 422 });
        break;
      case "not_configured":
        res = NextResponse.json({ ok: false, code: "NOT_CONFIGURED" }, { status: 409 });
        break;
      case "unknown_product":
        res = NextResponse.json({ ok: false, code: "UNKNOWN_PRODUCT" }, { status: 404 });
        break;
    }
    setSessionCookies(res, ctx.session);
    return res;
  } catch (err) {
    console.error("[cart] line preparation failed", err);
    return NextResponse.json({ ok: false, code: "PREPARATION_FAILED" }, { status: 503 });
  }
}
