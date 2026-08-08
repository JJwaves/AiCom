"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart/cart-context";
import { getCommerce } from "@/lib/commerce";
import { PRODUCTS } from "@/config/products";
import { quoteConfiguration } from "@/lib/pricing/engine";
import { attributionToMetadata, readAttribution } from "@/lib/attribution/attribution";
import { track } from "@/lib/analytics/track";
import { formatMoney, formatQty, formatUnitPrice } from "@/lib/format";

export default function CartPage() {
  const router = useRouter();
  const { cart, removeLine, updateQuantity, subtotalCents, count } = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(
    () =>
      cart.lines.map((l) => ({
        product_id: l.config.productId,
        product_name: l.title,
        variant: l.optionSummary,
        quantity: l.config.quantity,
        unit_price: l.unitPriceCents / 100,
      })),
    [cart.lines],
  );

  useEffect(() => {
    if (count > 0) {
      track({ name: "view_cart", params: { items, value: subtotalCents / 100, currency: cart.currency } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const changeQty = (lineId: string, productId: string, qty: number) => {
    const product = PRODUCTS.find((p) => p.id === productId);
    if (!product || qty < product.minQuantity) return;
    const line = cart.lines.find((l) => l.lineId === lineId);
    if (!line) return;
    const quote = quoteConfiguration(product, { ...line.config, quantity: qty });
    if (quote) updateQuantity(lineId, qty, quote.unitPriceCents);
  };

  const checkout = async () => {
    setBusy(true);
    setError(null);
    try {
      track({ name: "begin_checkout", params: { items, value: subtotalCents / 100, currency: cart.currency } });
      const attribution = attributionToMetadata(readAttribution());
      const result = await getCommerce().createCheckout(cart, attribution);
      if (result.kind === "redirect") {
        window.location.href = result.url;
      } else {
        router.push(`/order-status?order=${result.orderId}&placed=1`);
      }
    } catch {
      setError("Checkout is temporarily unavailable. Nothing was charged — try again in a moment.");
      setBusy(false);
    }
  };

  if (count === 0) {
    return (
      <section className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
        <h1 className="text-2xl" style={{ fontWeight: 600 }}>
          Your cart is empty
        </h1>
        <p className="mt-2 text-ink-3">Configure a bag and it lands here.</p>
        <Link href="/products/custom-non-woven-takeout-bags" className="btn btn--primary mt-6">
          Shop takeout bags
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl" style={{ fontWeight: 600 }}>
        Cart
      </h1>

      <ul className="mt-8 space-y-4">
        {cart.lines.map((line) => {
          const product = PRODUCTS.find((p) => p.id === line.config.productId);
          return (
            <li key={line.lineId} className="surface p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base" style={{ fontWeight: 600 }}>
                    {line.title}
                  </h2>
                  <p className="mt-1 text-sm text-ink-3">{line.optionSummary}</p>
                  {line.config.artwork && (
                    <p className="mt-1 font-mono text-xs text-ink-3">
                      Artwork: {line.config.artwork.fileName}
                      {line.config.artwork.notes ? ` · “${line.config.artwork.notes.slice(0, 60)}”` : ""}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(line.lineId)}
                  className="text-xs text-ink-3 underline hover:text-error"
                >
                  Remove
                </button>
              </div>
              <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-rule pt-3">
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Change quantity">
                  {(product?.quantityPresets ?? []).map((q) => (
                    <button
                      key={q}
                      type="button"
                      className="chip !px-2.5 !py-1.5 font-mono text-xs"
                      aria-pressed={q === line.config.quantity}
                      onClick={() => changeQty(line.lineId, line.config.productId, q)}
                    >
                      {formatQty(q)}
                    </button>
                  ))}
                </div>
                <p className="font-mono text-sm text-ink">
                  {formatQty(line.config.quantity)} × {formatUnitPrice(line.unitPriceCents, cart.currency)} ={" "}
                  <span className="text-base font-semibold">{formatMoney(line.totalCents, cart.currency)}</span>
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="graphite-panel mt-8 p-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="label-mono !text-graphite-muted">Subtotal</p>
            <p className="mt-1 text-xs text-graphite-muted">Shipping and any tax calculated at checkout.</p>
          </div>
          <p className="font-mono text-3xl font-semibold text-graphite-ink">{formatMoney(subtotalCents, cart.currency)}</p>
        </div>
        <button type="button" className="btn btn--primary mt-5 w-full !py-4" onClick={checkout} disabled={busy}>
          {busy ? "Opening checkout…" : "Checkout"}
        </button>
        {error && (
          <p role="alert" className="mt-3 rounded-[6px] bg-error-soft px-3 py-2 text-sm text-error">
            {error}
          </p>
        )}
        <p className="mt-3 text-center text-xs text-graphite-muted">
          Guest checkout — no account needed. Printed orders get an artwork proof before production.
        </p>
      </div>
    </section>
  );
}
