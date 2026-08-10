"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isDemoPricing } from "@/config/business";
import { estimateShipping } from "@/config/shipping";
import { quoteConfiguration, requiresCustomQuote } from "@/modules/pricing";
import { track } from "@/lib/analytics/track";
import { useCart } from "@/lib/cart/cart-context";
import { formatDimensions, formatMoney, formatPct, formatQty, formatUnitPrice } from "@/lib/format";
import type { ArtworkRef, Product, ProductConfiguration } from "@/types/commerce";
import { ArtworkUploader } from "./ArtworkUploader";
import { TierPricingTable } from "./TierPricingTable";
import { BagIllustration } from "./BagIllustration";

/**
 * The product configurator — the primary conversion surface.
 * Order of controls mirrors the buying decision: size → color → printing →
 * artwork → quantity → price → shipping → add to cart.
 */
export function ProductConfigurator({ product }: { product: Product }) {
  const router = useRouter();
  const { addLine } = useCart();
  const startedRef = useRef(false);

  const [sizeId, setSizeId] = useState(product.sizes[0]?.id ?? "");
  const [materialId, setMaterialId] = useState(product.materials[0]?.id ?? "");
  const [colorId, setColorId] = useState(product.colors[0]?.id ?? "");
  const [printId, setPrintId] = useState<ProductConfiguration["printOptionId"]>(
    product.printOptions.find((p) => p.id === "one-color")?.id ?? product.printOptions[0].id,
  );
  const [quantity, setQuantity] = useState(product.quantityPresets[1] ?? product.minQuantity);
  const [customQty, setCustomQty] = useState<string>("");
  const [artwork, setArtwork] = useState<ArtworkRef | null>(null);
  const [postal, setPostal] = useState("");
  const [shippingMsg, setShippingMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [added, setAdded] = useState(false);

  const config: ProductConfiguration = useMemo(
    () => ({
      productId: product.id,
      sizeId,
      materialId,
      colorId,
      printOptionId: printId,
      quantity,
      artwork,
    }),
    [product.id, sizeId, materialId, colorId, printId, quantity, artwork],
  );

  const quote = useMemo(() => quoteConfiguration(product, config), [product, config]);
  const needsQuote = requiresCustomQuote(product, config);
  const selectedPrint = product.printOptions.find((p) => p.id === printId);
  const selectedSize = product.sizes.find((s) => s.id === sizeId);
  const selectedColor = product.colors.find((c) => c.id === colorId);
  const missingArtwork = Boolean(selectedPrint?.requiresArtwork) && !artwork;

  const markStarted = () => {
    if (!startedRef.current) {
      startedRef.current = true;
      track({ name: "product_config_started", params: { product_id: product.id } });
    }
  };

  useEffect(() => {
    if (quote) {
      track({
        name: "view_price",
        params: {
          product_id: product.id,
          unit_price: quote.unitPriceCents / 100,
          value: quote.totalCents / 100,
          currency: quote.currency,
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.unitPriceCents, quote?.totalCents]);

  const setQty = (q: number) => {
    markStarted();
    setQuantity(q);
    setCustomQty("");
    track({ name: "select_quantity", params: { product_id: product.id, quantity: q } });
  };

  const handleAdd = () => {
    if (!quote || missingArtwork || needsQuote) return;
    const optionSummary = [
      selectedSize ? `${selectedSize.label} (${formatDimensions(selectedSize.dimensions)})` : "",
      selectedColor?.label,
      selectedPrint?.label,
    ]
      .filter(Boolean)
      .join(" · ");
    addLine({
      config,
      unitPriceCents: quote.unitPriceCents,
      totalCents: quote.totalCents,
      title: product.title,
      optionSummary,
    });
    track({
      name: "add_to_cart",
      params: {
        items: [
          {
            product_id: product.id,
            product_name: product.title,
            variant: optionSummary,
            quantity,
            unit_price: quote.unitPriceCents / 100,
          },
        ],
        value: quote.totalCents / 100,
        currency: quote.currency,
      },
    });
    setAdded(true);
    setTimeout(() => router.push("/cart"), 450);
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
      {/* LEFT — gallery */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <div className="surface flex items-center justify-center p-8">
          <BagIllustration
            bodyColor={selectedColor?.swatch ?? "oklch(97% 0 0)"}
            showLogo={printId !== "none"}
            logoColors={printId === "two-color" ? 2 : 1}
            className="w-full max-w-sm"
            title={`${product.title} in ${selectedColor?.label ?? "white"}${printId !== "none" ? " with logo print area" : ""}`}
          />
        </div>
        {selectedSize && (
          <p className="label-mono mt-3 text-center">
            {selectedSize.label} · {formatDimensions(selectedSize.dimensions)}
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          {product.images.slice(0, 4).map((img) =>
            img.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={img.slot} src={img.src} alt={img.alt} className="surface w-full" />
            ) : (
              <div key={img.slot} className="photo-slot !min-h-28">
                <span className="label-mono">Photo slot</span>
                <span className="text-xs">{img.alt}</span>
              </div>
            ),
          )}
        </div>
      </div>

      {/* RIGHT — configurator */}
      <div onPointerDown={markStarted} onKeyDown={markStarted}>
        <h1 className="text-3xl sm:text-4xl" style={{ fontWeight: 600 }}>
          {product.title}
        </h1>
        <p className="mt-2 text-ink-2">{product.positioning}</p>
        <p className="mt-3 font-mono text-sm text-ink">
          Starting at{" "}
          <span className="text-lg font-semibold">
            {formatUnitPrice(product.pricingTiers[product.pricingTiers.length - 1].unitPriceCents, product.currency)}
            /bag
          </span>{" "}
          <span className="text-ink-3">at {formatQty(product.pricingTiers[product.pricingTiers.length - 1].minQty)}+ units</span>
        </p>
        {isDemoPricing() && product.pricingStatus === "DEMO" && (
          <p className="mt-2 inline-block rounded-[6px] bg-error-soft px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-error">
            Demo pricing — replace before launch
          </p>
        )}

        {/* 1 · Size */}
        <fieldset className="mt-8">
          <legend className="label-mono mb-2">1 · Size</legend>
          <div className="flex flex-wrap gap-2">
            {product.sizes.map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                aria-pressed={s.id === sizeId}
                onClick={() => {
                  setSizeId(s.id);
                  track({ name: "select_size", params: { product_id: product.id, size: s.label } });
                }}
              >
                <span>{s.label}</span>
                <span className="font-mono text-xs text-ink-3">{formatDimensions(s.dimensions)}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-3">
            Need exact dimensions?{" "}
            <Link href={`/request-quote?product=${product.slug}`} className="text-accent underline">
              Request custom sizing
            </Link>
          </p>
        </fieldset>

        {/* 2 · Material */}
        {product.materials.length > 1 && (
          <fieldset className="mt-6">
            <legend className="label-mono mb-2">2 · Material weight</legend>
            <div className="flex flex-wrap gap-2">
              {product.materials.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="chip"
                  aria-pressed={m.id === materialId}
                  onClick={() => setMaterialId(m.id)}
                >
                  {m.label}
                  {m.priceDeltaCents > 0 && (
                    <span className="font-mono text-xs text-accent">+{formatUnitPrice(m.priceDeltaCents)}/bag</span>
                  )}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {/* 3 · Color */}
        <fieldset className="mt-6">
          <legend className="label-mono mb-2">{product.materials.length > 1 ? "3" : "2"} · Bag color</legend>
          <div className="flex flex-wrap gap-2">
            {product.colors.map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip"
                aria-pressed={c.id === colorId}
                onClick={() => {
                  setColorId(c.id);
                  track({ name: "select_color", params: { product_id: product.id, color: c.label } });
                }}
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-4 w-4 rounded-full border border-rule-2"
                  style={{ background: c.swatch }}
                />
                {c.label}
              </button>
            ))}
          </div>
          {selectedColor?.custom && (
            <p className="mt-2 rounded-[6px] bg-accent-soft px-3 py-2 text-xs text-ink-2">
              Custom colors are quoted individually — finish your specs below and we&apos;ll route you to the quote
              form.
            </p>
          )}
        </fieldset>

        {/* 4 · Printing */}
        <fieldset className="mt-6">
          <legend className="label-mono mb-2">Printing</legend>
          <div className="grid gap-2">
            {product.printOptions.map((p) => (
              <button
                key={p.id}
                type="button"
                className="chip w-full !justify-between text-left"
                aria-pressed={p.id === printId}
                onClick={() => {
                  setPrintId(p.id);
                  track({ name: "select_print_option", params: { product_id: product.id, print_option: p.id } });
                }}
              >
                <span>
                  <span className="block font-medium">{p.label}</span>
                  <span className="block text-xs font-normal text-ink-3">{p.description}</span>
                </span>
                <span className="font-mono text-xs text-ink-3">
                  {p.priceDeltaCents > 0 ? `+${formatUnitPrice(p.priceDeltaCents)}/bag` : "included"}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {/* 5 · Artwork */}
        {selectedPrint?.requiresArtwork && (
          <div className="mt-6">
            <ArtworkUploader
              value={artwork}
              onChange={(ref) => {
                setArtwork(ref);
                if (ref) {
                  track({ name: "upload_artwork", params: { product_id: product.id, file_type: ref.fileType } });
                }
              }}
            />
          </div>
        )}

        {/* 6 · Quantity */}
        <fieldset className="mt-6">
          <legend className="label-mono mb-2">Quantity</legend>
          <div className="flex flex-wrap gap-2">
            {product.quantityPresets.map((q) => (
              <button key={q} type="button" className="chip font-mono" aria-pressed={q === quantity && !customQty} onClick={() => setQty(q)}>
                {formatQty(q)}
              </button>
            ))}
            <label className="chip cursor-text" data-selected={Boolean(customQty)}>
              <span className="text-xs text-ink-3">Custom:</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={100}
                value={customQty}
                onChange={(e) => {
                  const v = e.target.value;
                  setCustomQty(v);
                  const n = Number(v);
                  if (Number.isFinite(n) && n > 0) {
                    markStarted();
                    setQuantity(n);
                    track({ name: "select_quantity", params: { product_id: product.id, quantity: n } });
                  }
                }}
                className="w-24 bg-transparent font-mono text-sm text-ink outline-none"
                aria-label="Custom quantity"
                placeholder={`${formatQty(product.minQuantity)}+`}
              />
            </label>
          </div>
          {quantity < product.minQuantity && (
            <p className="mt-2 text-xs text-error" role="alert">
              Minimum order is {formatQty(product.minQuantity)} bags. Smaller runs may be possible —{" "}
              <Link href={`/request-quote?product=${product.slug}&qty=${quantity}`} className="underline">
                request custom pricing
              </Link>
              .
            </p>
          )}
        </fieldset>

        {/* Tier table */}
        <details className="mt-4 rounded-[10px] border border-rule p-3" open>
          <summary className="label-mono cursor-pointer select-none">Volume pricing</summary>
          <div className="mt-3">
            <TierPricingTable
              tiers={product.pricingTiers}
              currency={product.currency}
              activeMinQty={quote?.tier.minQty}
              onPick={setQty}
            />
          </div>
        </details>

        {/* 7 · Price readout — graphite panel */}
        <div className="graphite-panel mt-6 p-5" aria-live="polite">
          {quote && !needsQuote ? (
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="label-mono !text-graphite-muted">Price per bag</p>
                <p className="font-mono text-3xl font-semibold text-graphite-ink">
                  {formatUnitPrice(quote.unitPriceCents, quote.currency)}
                </p>
                <p className="mt-1 font-mono text-xs text-graphite-muted">
                  {formatQty(quantity)} bags
                  {quote.savingsPct > 0 && (
                    <span className="ml-2 rounded bg-ok-soft px-1.5 py-0.5 text-ok">
                      you save {formatPct(quote.savingsPct)} at this quantity
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className="label-mono !text-graphite-muted">Total</p>
                <p className="font-mono text-3xl font-semibold" style={{ color: "oklch(70% 0.14 256)" }}>
                  {formatMoney(quote.totalCents, quote.currency)}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-graphite-ink">
              This configuration is quoted individually — use{" "}
              <Link href={`/request-quote?product=${product.slug}`} className="underline" style={{ color: "oklch(70% 0.14 256)" }}>
                Request custom pricing
              </Link>{" "}
              and we&apos;ll price it within one business day.
            </p>
          )}
        </div>

        {/* 8 · Production + shipping */}
        <div className="mt-4 grid gap-3 text-sm">
          <p className="text-ink-3">
            <span className="label-mono mr-2">Production</span>
            Estimated production time is confirmed with your artwork proof.
          </p>
          <div>
            <label htmlFor="postal" className="label-mono mb-1 block">
              Shipping estimate
            </label>
            <div className="flex gap-2">
              <input
                id="postal"
                className="input max-w-44"
                placeholder="ZIP / postal code"
                value={postal}
                autoComplete="postal-code"
                onChange={(e) => setPostal(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--secondary text-sm"
                onClick={() => {
                  const est = estimateShipping(postal);
                  if (est.mode === "invalid") {
                    setShippingMsg({ text: est.message, tone: "error" });
                  } else {
                    setShippingMsg({ text: est.message, tone: "ok" });
                    track({ name: "shipping_estimate_requested", params: { market: postal.trim().slice(0, 2) } });
                  }
                }}
              >
                Check
              </button>
            </div>
            {shippingMsg && (
              <p className={`mt-1 text-xs ${shippingMsg.tone === "error" ? "text-error" : "text-ok"}`} role="status">
                {shippingMsg.text}
              </p>
            )}
          </div>
        </div>

        {/* 9 · Add to cart */}
        <div className="mt-6">
          <button
            type="button"
            className="btn btn--primary w-full !py-4 text-base"
            disabled={!quote || missingArtwork || needsQuote || added}
            onClick={handleAdd}
            data-state={added ? "success" : undefined}
          >
            {added ? "✓ Added — opening cart" : "Add to cart"}
          </button>
          {missingArtwork && (
            <p className="mt-2 text-xs text-error" role="alert">
              Upload your logo above (or switch printing to “No logo”) to continue.
            </p>
          )}
          <p className="mt-3 text-center text-sm text-ink-3">
            Need a custom size or quantity?{" "}
            <Link
              href={`/request-quote?product=${product.slug}`}
              className="text-accent underline"
              onClick={() => track({ name: "request_custom_quote", params: { product_id: product.id } })}
            >
              Request custom pricing
            </Link>
          </p>
        </div>

        {/* Sticky mobile CTA */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper/95 p-3 backdrop-blur-sm lg:hidden">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
            <div className="min-w-0">
              {quote && !needsQuote ? (
                <>
                  <p className="truncate font-mono text-sm font-semibold text-ink">
                    {formatUnitPrice(quote.unitPriceCents, quote.currency)}/bag · {formatMoney(quote.totalCents, quote.currency)}
                  </p>
                  <p className="font-mono text-[11px] text-ink-3">{formatQty(quantity)} bags</p>
                </>
              ) : (
                <p className="text-xs text-ink-3">Finish configuring to see your price</p>
              )}
            </div>
            <button
              type="button"
              className="btn btn--primary shrink-0 text-sm"
              disabled={!quote || missingArtwork || needsQuote || added}
              onClick={handleAdd}
            >
              {added ? "✓ Added" : "Add to cart"}
            </button>
          </div>
        </div>
        {/* Spacer so sticky bar never covers content on mobile */}
        <div className="h-20 lg:hidden" aria-hidden="true" />
      </div>
    </div>
  );
}
