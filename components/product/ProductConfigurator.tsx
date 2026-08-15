"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isDemoPricing } from "@/config/business";
import { estimateShipping } from "@/config/shipping";
import { quoteConfiguration, requiresCustomQuote } from "@/modules/pricing";
import { track } from "@/lib/analytics/track";
import { useCart } from "@/lib/cart/cart-context";
import { ConfigurationProvider, useConfiguration } from "@/lib/configuration/context";
import type { TrackedField } from "@/lib/configuration/store";
import { formatDimensions, formatMoney, formatPct, formatQty, formatUnitPrice } from "@/lib/format";
import type { CtaCopyVariant, ShippingMessageVariant } from "@/modules/experiments/variants";
import type { Product } from "@/types/commerce";
import { ArtworkUploader } from "./ArtworkUploader";
import { TierPricingTable } from "./TierPricingTable";
import { BagIllustration } from "./BagIllustration";

/**
 * The product configurator — the primary conversion surface.
 * Order of controls mirrors the buying decision: size → color → printing →
 * artwork → quantity → price → shipping → add to cart.
 *
 * Session 06: selection state lives in the SHARED configuration store
 * (lib/configuration) — the same validated state the AI Packaging Expert
 * reads and updates. AI changes arrive server-validated over the sync bus,
 * update these controls visibly (highlight + aria-live announcement), and
 * re-price through the same engine call as manual changes.
 *
 * Session 11: `experiments` carries SERVER-RESOLVED, SERVER-VALIDATED
 * presentation overrides for two registered targets. They are plain text
 * values rendered as React children — never markup — and both default to
 * null, which renders exactly the pre-Session-11 UI. Nothing about pricing,
 * validation, cart payloads or button behaviour is experimentable.
 */
export type ConfiguratorExperiments = {
  shippingMessage?: ShippingMessageVariant | null;
  primaryCta?: CtaCopyVariant | null;
};

export function ProductConfigurator({
  product,
  experiments,
}: {
  product: Product;
  experiments?: ConfiguratorExperiments;
}) {
  return (
    <ConfigurationProvider product={product}>
      <ConfiguratorView product={product} experiments={experiments} />
    </ConfigurationProvider>
  );
}

const FIELD_ANNOUNCE_LABELS: Record<string, string> = {
  sizeId: "size",
  materialId: "material",
  colorId: "color",
  printOptionId: "printing",
  quantity: "quantity",
};

function ConfiguratorView({ product, experiments }: { product: Product; experiments?: ConfiguratorExperiments }) {
  const router = useRouter();
  const { addLine } = useCart();
  const { state, config, setSize, setMaterial, setColor, setPrintOption, setQuantity, setArtwork, flushSync } =
    useConfiguration();
  const startedRef = useRef(false);

  const [customQty, setCustomQty] = useState<string>("");
  const [postal, setPostal] = useState("");
  const [shippingMsg, setShippingMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [added, setAdded] = useState(false);
  /** Fields the Packaging Expert just changed — drives the brief highlight. */
  const [aiFields, setAiFields] = useState<ReadonlySet<TrackedField>>(new Set());
  const [announcement, setAnnouncement] = useState("");

  const { sizeId, materialId, colorId, printOptionId: printId, quantity, artwork } = config;

  /* Session 11 experiment overrides — presentation only, already validated
   * server-side. `null` everywhere means "render the normal UI". */
  const shippingMessage = experiments?.shippingMessage ?? null;
  const ctaLabel = experiments?.primaryCta?.ctaLabel ?? "Add to cart";
  const ctaHelperText = experiments?.primaryCta?.helperText ?? null;

  const quote = useMemo(() => quoteConfiguration(product, config), [product, config]);
  const needsQuote = requiresCustomQuote(product, config);
  const selectedPrint = product.printOptions.find((p) => p.id === printId);
  const selectedSize = product.sizes.find((s) => s.id === sizeId);
  const selectedColor = product.colors.find((c) => c.id === colorId);
  const missingArtwork = Boolean(selectedPrint?.requiresArtwork) && !artwork;

  // External (AI/restore) changes: reconcile the custom-quantity echo field,
  // and for AI changes highlight the touched controls + announce politely.
  // "Adjust state during render" pattern — reacts to store changes without
  // an effect-render cascade.
  const lastChange = state.lastChange;
  const [prevChange, setPrevChange] = useState(lastChange);
  if (lastChange !== prevChange) {
    setPrevChange(lastChange);
    if (lastChange && lastChange.source !== "user") {
      if (lastChange.fields.includes("quantity")) {
        setCustomQty(product.quantityPresets.includes(quantity) ? "" : String(quantity));
      }
      if (lastChange.source === "ai") {
        setAiFields(new Set(lastChange.fields));
        const parts = lastChange.fields
          .filter((f) => f in FIELD_ANNOUNCE_LABELS)
          .map((f) => {
            if (f === "quantity") return `quantity to ${formatQty(quantity)}`;
            if (f === "sizeId") return `size to ${product.sizes.find((s) => s.id === sizeId)?.label ?? sizeId}`;
            if (f === "materialId") return `material to ${product.materials.find((m) => m.id === materialId)?.label ?? materialId}`;
            if (f === "colorId") return `color to ${product.colors.find((c) => c.id === colorId)?.label ?? colorId}`;
            return `printing to ${product.printOptions.find((p) => p.id === printId)?.label ?? printId}`;
          });
        if (parts.length > 0) {
          setAnnouncement(`Packaging Expert updated ${parts.join(", ")}.`);
        }
      }
    }
  }

  // Let the AI highlight fade after a few seconds (setState via timer is async — no cascade).
  useEffect(() => {
    if (aiFields.size === 0) return;
    const timer = setTimeout(() => setAiFields(new Set()), 6000);
    return () => clearTimeout(timer);
  }, [aiFields]);

  const aiTouched = (...fields: TrackedField[]) => fields.some((f) => aiFields.has(f));
  const aiMark = (...fields: TrackedField[]) =>
    aiTouched(...fields) ? (
      <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal text-accent">
        Updated by Packaging Expert
      </span>
    ) : null;
  const aiRing = (...fields: TrackedField[]) =>
    aiTouched(...fields) ? "rounded-[10px] bg-accent-soft/60 outline outline-1 outline-accent/40 p-2 -m-2 transition-colors" : "transition-colors";

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
    // Persist the exact state the cart line is about to snapshot (non-blocking).
    void flushSync();
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
      {/* Assistive announcements for AI-driven configuration changes. */}
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

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
        <fieldset className={`mt-8 ${aiRing("sizeId")}`}>
          <legend className="label-mono mb-2">1 · Size{aiMark("sizeId")}</legend>
          <div className="flex flex-wrap gap-2">
            {product.sizes.map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                aria-pressed={s.id === sizeId}
                onClick={() => {
                  setSize(s.id);
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
          <fieldset className={`mt-6 ${aiRing("materialId")}`}>
            <legend className="label-mono mb-2">2 · Material weight{aiMark("materialId")}</legend>
            <div className="flex flex-wrap gap-2">
              {product.materials.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="chip"
                  aria-pressed={m.id === materialId}
                  onClick={() => setMaterial(m.id)}
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
        <fieldset className={`mt-6 ${aiRing("colorId")}`}>
          <legend className="label-mono mb-2">
            {product.materials.length > 1 ? "3" : "2"} · Bag color{aiMark("colorId")}
          </legend>
          <div className="flex flex-wrap gap-2">
            {product.colors.map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip"
                aria-pressed={c.id === colorId}
                onClick={() => {
                  setColor(c.id);
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
        <fieldset className={`mt-6 ${aiRing("printOptionId")}`}>
          <legend className="label-mono mb-2">Printing{aiMark("printOptionId")}</legend>
          <div className="grid gap-2">
            {product.printOptions.map((p) => (
              <button
                key={p.id}
                type="button"
                className="chip w-full !justify-between text-left"
                aria-pressed={p.id === printId}
                onClick={() => {
                  setPrintOption(p.id);
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
              value={artwork ?? null}
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
        <fieldset className={`mt-6 ${aiRing("quantity")}`}>
          <legend className="label-mono mb-2">Quantity{aiMark("quantity")}</legend>
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
          {shippingMessage && shippingMessage.placement === "above_cta" && (
            <p data-experiment="product.shipping_message" className="mb-3 rounded-[6px] bg-accent-soft px-3 py-2 text-sm text-ink-2">
              {shippingMessage.message}
            </p>
          )}
          <button
            type="button"
            className="btn btn--primary w-full !py-4 text-base"
            disabled={!quote || missingArtwork || needsQuote || added}
            onClick={handleAdd}
            data-state={added ? "success" : undefined}
          >
            {added ? "✓ Added — opening cart" : ctaLabel}
          </button>
          {ctaHelperText && (
            <p data-experiment="product.primary_cta" className="mt-2 text-center text-xs text-ink-3">
              {ctaHelperText}
            </p>
          )}
          {shippingMessage && shippingMessage.placement === "below_cta" && (
            <p data-experiment="product.shipping_message" className="mt-3 rounded-[6px] bg-accent-soft px-3 py-2 text-sm text-ink-2">
              {shippingMessage.message}
            </p>
          )}
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
              {added ? "✓ Added" : ctaLabel}
            </button>
          </div>
        </div>
        {/* Spacer so sticky bar never covers content on mobile */}
        <div className="h-20 lg:hidden" aria-hidden="true" />
      </div>
    </div>
  );
}
