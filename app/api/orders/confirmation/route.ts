import { NextResponse } from "next/server";
import { getOrderConfirmationForSession } from "@/lib/commerce/order-confirmation";
import { parseCookies } from "@/lib/data/request-session";
import { getSession, SESSION_COOKIE } from "@/lib/data/session-service";
import { logWarn } from "@/lib/observability/logger";

/**
 * Order confirmation lookup (Production Launch Session 03 §4).
 *
 * The ONLY way the browser learns that an order was paid. It answers one
 * question — "is THIS order, which belongs to MY session, paid?" — and the
 * answer comes from the order row that a signed Shopify webhook wrote.
 *
 * NO SESSION IS MINTED HERE. A GET that creates a session row would make
 * this endpoint a write amplifier for anyone with a URL; an unknown browser
 * simply has no orders. That is also why the response is identical (404) for
 * a non-existent order and for someone else's order.
 *
 * Polling is expected and cheap: the webhook that marks an order paid can
 * arrive seconds after the customer returns, so the confirmation surface
 * asks again a few times. One indexed primary-key read per ask.
 */

export const runtime = "nodejs";

const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orderId = url.searchParams.get("order");
  if (!orderId || !ORDER_ID.test(orderId)) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  const sessionId = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (!sessionId) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });

  try {
    const session = await getSession(sessionId);
    if (!session) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });

    const confirmation = await getOrderConfirmationForSession(orderId, session.id);
    if (!confirmation) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });

    return NextResponse.json({ ok: true, order: confirmation }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // A read failure is not an exception worth paging anyone about; the
    // customer's order is unaffected and the page retries.
    logWarn({
      subsystem: "commerce",
      event: "order_confirmation_read_failed",
      code: "CONFIRMATION_UNAVAILABLE",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, code: "UNAVAILABLE" }, { status: 503 });
  }
}
