"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCart } from "@/lib/cart/cart-context";
import {
  clearPendingOrder,
  fetchOrderConfirmation,
  firePurchase,
  type ConfirmedPurchase,
} from "@/lib/analytics/purchase";
import { formatMoney, formatQty } from "@/lib/format";

/**
 * Order confirmation / status (Production Launch Session 03 §4).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT CHANGED, AND WHY IT MATTERED
 * ═══════════════════════════════════════════════════════════════════════════
 * This page used to read an order out of `sessionStorage` and fire the
 * `purchase` analytics event whenever the URL carried `?placed=1`. Both
 * inputs were browser state: the parameter could be typed, the stored object
 * was written before any payment existed, and a customer who ABANDONED the
 * Shopify checkout could still reach a page that reported a sale.
 *
 * Now the page asks the server one question — "is this order, which belongs
 * to my session, paid?" — and the server answers from the order row that an
 * HMAC-verified Shopify webhook wrote. Payment truth never leaves the
 * server.
 *
 * POLLING: the webhook usually lands within seconds of the customer
 * returning, but it is a separate network path with its own retries. So the
 * page shows an honest "payment is being confirmed" state and asks again a
 * few times, rather than either lying ("thanks for your order!") or giving
 * up ("we can't find it").
 */

const POLL_INTERVAL_MS = 2_000;
const MAX_POLLS = 8;

function OrderStatusInner() {
  const params = useSearchParams();
  const orderId = params.get("order");
  const { clear } = useCart();
  const [order, setOrder] = useState<ConfirmedPurchase | null>(null);
  const [state, setState] = useState<"loading" | "paid" | "awaiting_payment" | "not_found">("loading");
  const pollCount = useRef(0);
  const cartCleared = useRef(false);

  const check = useCallback(async () => {
    if (!orderId) return;
    const confirmation = await fetchOrderConfirmation(orderId);
    if (!confirmation) {
      setState("not_found");
      return;
    }
    setOrder(confirmation);
    if (!confirmation.paid) {
      setState("awaiting_payment");
      return;
    }
    setState("paid");
    // Analytics fires here and ONLY here — from a server-confirmed paid
    // order, deduplicated by transaction id so a refresh cannot repeat it.
    firePurchase(confirmation);
    clearPendingOrder();
    if (!cartCleared.current) {
      cartCleared.current = true;
      clear();
    }
  }, [orderId, clear]);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      await check();
      if (cancelled) return;
      pollCount.current += 1;
      // Re-read the state through the setter to avoid stale closure state.
      setState((current) => {
        if (current === "awaiting_payment" && pollCount.current < MAX_POLLS) {
          timer = setTimeout(run, POLL_INTERVAL_MS);
        }
        return current;
      });
    };
    void run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderId, check]);

  if (!orderId) return <LookupHelp />;

  if (state === "loading") {
    return (
      <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <p className="text-ink-2" role="status">
          Checking your order…
        </p>
      </section>
    );
  }

  if (state === "not_found") return <LookupHelp unknownOrder />;

  if (!order) return <LookupHelp unknownOrder />;

  const total = order.valueCents;

  return (
    <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      {state === "paid" ? (
        <p className="rounded-[6px] bg-ok-soft px-4 py-3 text-sm font-medium text-ok" role="status">
          {order.demo
            ? "✓ Order received (demo checkout — no payment was processed)"
            : "✓ Payment confirmed — your order is being prepared"}
        </p>
      ) : (
        <p className="rounded-[6px] bg-paper-2 px-4 py-3 text-sm font-medium text-ink-2" role="status">
          We&apos;re confirming your payment with our payment provider. This usually takes a few seconds — you can
          leave this page, your order is safe either way.
        </p>
      )}

      <h1 className="mt-4 text-3xl" style={{ fontWeight: 600 }}>
        Order {order.transactionId}
      </h1>
      <p className="mt-2 text-sm text-ink-3">
        Placed {new Date(order.placedAt).toLocaleString()}. Printed orders receive an artwork proof by email before
        production starts.
      </p>

      <ul className="mt-6 space-y-3">
        {order.lines.map((line, index) => (
          <li key={`${line.productId}-${index}`} className="surface p-4">
            <p className="font-medium text-ink">{line.title}</p>
            {line.optionSummary ? <p className="text-sm text-ink-3">{line.optionSummary}</p> : null}
            <p className="mt-1 font-mono text-sm text-ink">
              {formatQty(line.quantity)} bags · {formatMoney(line.totalCents, order.currency as "USD" | "CAD")}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-right font-mono text-lg font-semibold text-ink">
        Total {formatMoney(total, order.currency as "USD" | "CAD")}
      </p>
      <p className="mt-1 text-right text-xs text-ink-3">
        Shipping and tax are calculated and charged at checkout.
      </p>

      <Link href="/products" className="btn btn--secondary mt-8">
        Continue shopping
      </Link>
    </section>
  );
}

function LookupHelp({ unknownOrder = false }: { unknownOrder?: boolean }) {
  return (
    <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl" style={{ fontWeight: 600 }}>
        Order status
      </h1>
      <p className="mt-3 max-w-md text-ink-2">
        {unknownOrder
          ? "We couldn't find that order for this browser. If you ordered from a different device or cleared your cookies, we can look it up for you."
          : "Your order confirmation email contains a status link. Can't find it? Contact us with your order number and the email you ordered with, and we'll resend it."}
      </p>
      <Link href="/contact" className="btn btn--primary mt-6">
        Contact us
      </Link>
    </section>
  );
}

export default function OrderStatusPage() {
  return (
    <Suspense>
      <OrderStatusInner />
    </Suspense>
  );
}
