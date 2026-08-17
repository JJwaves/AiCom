import { attributionToMetadata, readAttribution } from "@/lib/attribution/attribution";
import { rememberPendingOrder } from "@/lib/analytics/purchase";
import type { CartLine } from "@/types/commerce";

/**
 * Shared client-side checkout submission (Session 07) — the ONE path every
 * surface uses to hand a cart to /api/checkout. The cart page's Checkout
 * button and the chat's "Continue to checkout" action both call this; the
 * server re-quotes every line and remains the only price authority. A
 * REPRICED answer comes back as data so each surface can show the corrected
 * prices and ask the customer to confirm again — never auto-accepted here.
 *
 * The checkout destination is exclusively what /api/checkout returns
 * (provider-generated). Nothing in this module accepts a URL from anywhere
 * else.
 *
 * Production Launch Session 03 §3: this module no longer stores a copy of
 * the ORDER in the browser. It stores the order ID as a pending intention,
 * and the confirmation surface asks the server whether that order was paid.
 * A client-held order payload could never be evidence of payment, and while
 * it existed it was what the purchase event was fired from.
 */

export type CheckoutSubmitResult =
  /** `orderId` is BAGDIRECT's order id — what the confirmation surface asks the server about. */
  | { kind: "mock-order"; orderId: string | null }
  | { kind: "redirect"; url: string; orderId: string | null }
  | { kind: "repriced"; lines: { lineId: string; quantity: number; unitPriceCents: number; totalCents: number }[] }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

type CheckoutResponse =
  | { ok: true; result: { kind: "mock"; orderId: string }; orderId: string | null }
  | { ok: true; result: { kind: "redirect"; url: string }; orderId: string | null }
  | { ok: false; code: "REPRICED"; lines: { lineId: string; quantity: number; unitPriceCents: number; totalCents: number }[] }
  | { ok: false; code: string; error?: string; errors?: { lineId: string; reason: string }[] };

const CHECKOUT_UNAVAILABLE = "Checkout is temporarily unavailable. Nothing was charged — try again in a moment.";

export async function submitCartCheckout(lines: CartLine[]): Promise<CheckoutSubmitResult> {
  try {
    const attribution = attributionToMetadata(readAttribution());
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lines: lines.map((l) => ({
          lineId: l.lineId,
          config: l.config,
          proposedUnitPriceCents: l.unitPriceCents,
          proposedTotalCents: l.totalCents,
        })),
        attribution,
      }),
    });
    const data = (await res.json()) as CheckoutResponse;

    if (data.ok) {
      // The BagDirect order id is remembered as a PENDING order — an
      // intention to pay, never a purchase. Only the server, reading the
      // webhook-written paid flag, can turn it into one.
      if (data.orderId) rememberPendingOrder(data.orderId);
      if (data.result.kind === "mock") return { kind: "mock-order", orderId: data.orderId };
      return { kind: "redirect", url: data.result.url, orderId: data.orderId };
    }
    if (data.code === "REPRICED" && "lines" in data && data.lines) {
      return { kind: "repriced", lines: data.lines };
    }
    if (data.code === "INVALID" && "errors" in data && data.errors?.length) {
      return { kind: "invalid", message: `${data.errors[0].reason}. Remove or adjust that line to continue.` };
    }
    return { kind: "error", message: CHECKOUT_UNAVAILABLE };
  } catch {
    return { kind: "error", message: CHECKOUT_UNAVAILABLE };
  }
}

