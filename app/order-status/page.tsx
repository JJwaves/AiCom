"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { track } from "@/lib/analytics/track";
import { formatMoney, formatQty } from "@/lib/format";
import type { Cart } from "@/types/commerce";

/**
 * Order status / confirmation.
 * - Mock provider: renders the locally stored order and fires the purchase
 *   event (deduped by transaction_id in lib/analytics).
 * - Shopify: order status lives on Shopify's order status page; this page
 *   becomes a lookup helper (order number + email → status link).
 */

function OrderStatusInner() {
  const params = useSearchParams();
  const orderId = params.get("order");
  const justPlaced = params.get("placed") === "1";
  const [order, setOrder] = useState<{ cart: Cart; createdAt: string } | null>(null);

  useEffect(() => {
    if (!orderId) return;
    try {
      const raw = sessionStorage.getItem(`order:${orderId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { cart: Cart; createdAt: string };
        // SSR-safe hydration — sessionStorage is client-only.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOrder(parsed);
        if (justPlaced) {
          const value = parsed.cart.lines.reduce((s, l) => s + l.totalCents, 0) / 100;
          track({
            name: "purchase",
            params: {
              transaction_id: orderId,
              value,
              currency: parsed.cart.currency,
              items: parsed.cart.lines.map((l) => ({
                product_id: l.config.productId,
                product_name: l.title,
                variant: l.optionSummary,
                quantity: l.config.quantity,
                unit_price: l.unitPriceCents / 100,
              })),
            },
          });
          // Clear the cart after a confirmed (mock) purchase
          localStorage.removeItem("bd_cart_v1");
        }
      }
    } catch {
      /* no stored order */
    }
  }, [orderId, justPlaced]);

  if (orderId && order) {
    const total = order.cart.lines.reduce((s, l) => s + l.totalCents, 0);
    return (
      <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        {justPlaced && (
          <p className="rounded-[6px] bg-ok-soft px-4 py-3 text-sm font-medium text-ok" role="status">
            ✓ Order received (demo checkout — no payment was processed)
          </p>
        )}
        <h1 className="mt-4 text-3xl" style={{ fontWeight: 600 }}>
          Order {orderId}
        </h1>
        <p className="mt-2 text-sm text-ink-3">
          Placed {new Date(order.createdAt).toLocaleString()}. Printed orders receive an artwork proof by email
          before production starts.
        </p>
        <ul className="mt-6 space-y-3">
          {order.cart.lines.map((l) => (
            <li key={l.lineId} className="surface p-4">
              <p className="font-medium text-ink">{l.title}</p>
              <p className="text-sm text-ink-3">{l.optionSummary}</p>
              <p className="mt-1 font-mono text-sm text-ink">
                {formatQty(l.config.quantity)} bags · {formatMoney(l.totalCents, order.cart.currency)}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-right font-mono text-lg font-semibold text-ink">
          Total {formatMoney(total, order.cart.currency)}
        </p>
        <Link href="/products" className="btn btn--secondary mt-8">
          Continue shopping
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl" style={{ fontWeight: 600 }}>
        Order status
      </h1>
      <p className="mt-3 max-w-md text-ink-2">
        Your order confirmation email contains a status link. Can&apos;t find it? Contact us with your order
        number and the email you ordered with, and we&apos;ll resend it.
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
