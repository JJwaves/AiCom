import { attributionToMetadata, readAttribution } from "@/lib/attribution/attribution";
import type { Cart, CartLine } from "@/types/commerce";

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
 */

export type CheckoutSubmitResult =
  | { kind: "mock-order"; orderId: string; order: { cart: Cart; createdAt: string } }
  | { kind: "redirect"; url: string }
  | { kind: "repriced"; lines: { lineId: string; quantity: number; unitPriceCents: number; totalCents: number }[] }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

type CheckoutResponse =
  | { ok: true; result: { kind: "mock"; orderId: string }; order: { cart: Cart; createdAt: string } }
  | { ok: true; result: { kind: "redirect"; url: string } }
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
      if ("order" in data) return { kind: "mock-order", orderId: data.result.orderId, order: data.order };
      return { kind: "redirect", url: data.result.url };
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

/** Persist the SERVER-priced order payload for the demo confirmation page (mock provider only). */
export function persistMockOrderPayload(orderId: string, order: { cart: Cart; createdAt: string }): void {
  try {
    sessionStorage.setItem(`order:${orderId}`, JSON.stringify(order));
  } catch {
    /* confirmation page falls back to its "order recorded" copy */
  }
}
