"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BUSINESS, PROOF_POLICY, QUOTE_CTA, isCheckoutEnabled, showsDemoPricing } from "@/config/business";
import { estimateShipping, FLAT_US_SHIPPING_CENTS, FLAT_US_SHIPPING_COPY } from "@/config/shipping";
import { quoteConfiguration, requiresCustomQuote } from "@/modules/pricing";
import { track } from "@/lib/analytics/track";
import { useCart } from "@/lib/cart/cart-context";
import { ConfigurationProvider, useConfiguration } from "@/lib/configuration/context";
import type { TrackedField } from "@/lib/configuration/store";
import { describeDimensions, formatDimensions, formatMoney, formatPct, formatQty, formatUnitPrice } from "@/lib/format";
import type { CtaCopyVariant, ShippingMessageVariant } from "@/modules/experiments/variants";
import type { Product } from "@/types/commerce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArtworkUploader } from "./ArtworkUploader";
import { TierPricingTable } from "./TierPricingTable";
import { PhotoStage } from "./PhotoStage";

/**
 * The product configurator — the primary conversion surface.
 * Order of controls mirrors the buying decision: size → color → printing →
 * artwork → quantity → price → shipping → CTA.
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
 *
 * Storefront redesign (2026-10-15): Premium Industrial Minimalism UI on the
 * shadcn/ui primitives. Phase 1 is QUOTE-LED (config/business.ts
 * `isCheckoutEnabled()`): the primary CTA carries the configuration to
 * /request-quote and artwork travels with the quote; with checkout enabled the
 * original add-to-cart path (artwork uploader, cart, Shopify) renders instead.
 * The store, the engine calls and every analytics event are unchanged.
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

/** Option button — radio semantics via aria-pressed, selected = accent border + soft fill + check. */
function OptionButton({
  selected,
  onClick,
  children,
  meta,
  className = "",
  ariaLabel,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-sm border px-4 py-3 text-left text-sm transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-focus ${
        selected
          ? "border-brand-accent bg-brand-accent-soft text-brand-ink ring-1 ring-brand-accent ring-inset"
          : "border-brand-border-control bg-brand-surface text-brand-ink-2 hover:border-brand-ink"
      } ${className}`}
    >
      <span className="flex min-w-0 items-center gap-3">{children}</span>
      <span className="flex shrink-0 items-center gap-3 text-xs text-brand-ink-muted tabular">
        {meta}
        <span
          aria-hidden="true"
          className={`flex size-5 items-center justify-center rounded-full border ${
            selected ? "border-brand-accent-ink bg-brand-accent-ink text-white" : "border-brand-border-control"
          }`}
        >
          {selected && (
            <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </span>
    </button>
  );
}

function ConfiguratorView({ product, experiments }: { product: Product; experiments?: ConfiguratorExperiments }) {
  const router = useRouter();
  const { addLine } = useCart();
  const { state, config, setSize, setMaterial, setColor, setPrintOption, setQuantity, setArtwork, flushSync } =
    useConfiguration();
  const startedRef = useRef(false);
  const checkout = isCheckoutEnabled();

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
  const ctaLabel = experiments?.primaryCta?.ctaLabel ?? (checkout ? "Add to cart" : QUOTE_CTA.label);
  const ctaHelperText = experiments?.primaryCta?.helperText ?? null;

  const quote = useMemo(() => quoteConfiguration(product, config), [product, config]);
  const needsQuote = requiresCustomQuote(product, config);
  /* MVP launch products publish a closed set of orderable quantities; the
   * arbitrary-quantity input is not rendered for them at all, so a customer
   * cannot type a number nobody priced. The engine enforces the same rule
   * server-side (requiresCustomQuote). */
  const fixedQuantities = !product.allowCustomQuantity;
  const largestOrderableQty = product.quantityPresets[product.quantityPresets.length - 1];
  /* One printing option means nothing to choose — it is stated, not selected.
   * Same for a single fixed material/construction. */
  const singlePrintOption = product.printOptions.length === 1;
  const selectedPrint = product.printOptions.find((p) => p.id === printId);
  const selectedSize = product.sizes.find((s) => s.id === sizeId);
  const selectedColor = product.colors.find((c) => c.id === colorId);
  /* Artwork gates ADD TO CART only. With the quote flow the file travels with the quote request. */
  const missingArtwork = checkout && Boolean(selectedPrint?.requiresArtwork) && !artwork;

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
      <Badge variant="secondary" className="ml-3">
        Updated by Packaging Expert
      </Badge>
    ) : null;
  const aiRing = (...fields: TrackedField[]) =>
    aiTouched(...fields) ? "-mx-3 rounded-md bg-brand-accent-soft/60 px-3 py-2 outline outline-1 outline-brand-accent/40 transition-colors" : "transition-colors";

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
      selectedSize ? `${selectedSize.label} (${formatDimensions({ ...selectedSize.dimensions, unit: selectedSize.unit })})` : "",
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

  /* Quote-led CTA: carry the exact configuration into the inquiry form. */
  const quoteParams = new URLSearchParams({
    product: product.slug,
    qty: String(quantity),
    ...(selectedSize ? { size: selectedSize.id } : {}),
    ...(selectedColor ? { color: selectedColor.id } : {}),
  });
  const quoteHref = `${QUOTE_CTA.href}?${quoteParams.toString()}`;
  const onQuoteClick = () => {
    void flushSync();
    track({ name: "request_custom_quote", params: { product_id: product.id } });
  };

  const fromTier = product.pricingTiers[product.pricingTiers.length - 1];
  const priceReady = Boolean(quote) && !needsQuote;
  let step = 0;
  const nextStep = () => String(++step).padStart(2, "0");

  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
      {/* Assistive announcements for AI-driven configuration changes. */}
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      {/* LEFT — gallery: one large stage + the shot list as thumbnails. */}
      <div className="lg:col-span-7 lg:sticky lg:top-24 lg:self-start">
        <PhotoStage
          image={product.images[0] ?? null}
          ratio="4/5"
          bagColor={selectedColor?.swatch}
          showLogo={printId !== "none"}
          priority
          label={`${product.title} — ${selectedColor?.label ?? ""}${selectedSize ? `, ${selectedSize.label}` : ""}`}
          className="lg:aspect-square"
          illustrationClassName="w-1/2"
        />
        {selectedSize && (
          <p className="mt-3 text-sm text-brand-ink-muted tabular">
            {selectedSize.label} · {formatDimensions({ ...selectedSize.dimensions, unit: selectedSize.unit })} ·{" "}
            {describeDimensions({ ...selectedSize.dimensions, unit: selectedSize.unit })}
          </p>
        )}
        <ul className="mt-4 grid grid-cols-4 gap-3">
          {product.images.slice(1, 5).map((img) => (
            <li key={img.slot}>
              <PhotoStage
                image={img}
                ratio="1/1"
                tone={img.slot.includes("white") ? "kraft" : "canvas"}
                bagColor={img.slot.includes("white") ? product.colors.find((c) => c.id === "white")?.swatch : selectedColor?.swatch}
                showLogo
                sizes="(min-width: 1024px) 12vw, 25vw"
                illustrationClassName="w-3/5"
                caption={false}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* RIGHT — facts, then the configurator. */}
      <div className="lg:col-span-5" onPointerDown={markStarted} onKeyDown={markStarted}>
        <p className="eyebrow">Custom insulated takeout bag · made to order</p>
        <h1 className="type-h1 mt-3">{product.title}</h1>
        <p className="mt-3 text-base leading-body text-brand-ink-2">{product.positioning}</p>

        {/* The B2B facts a buyer needs before anything else (b2b-commerce-ui principle 1). */}
        <dl className="mt-6 grid grid-cols-2 gap-x-6 border-y border-brand-hairline text-sm">
          {[
            {
              k: "From",
              v: `${formatUnitPrice(fromTier.unitPriceCents, product.currency)}/bag at ${formatQty(fromTier.minQty)}`,
            },
            { k: "Minimum order", v: `${formatQty(product.minQuantity)} per design` },
            { k: "Production", v: BUSINESS.STANDARD_PRODUCTION_TIME },
            { k: "Construction", v: product.materials[0]?.label ?? "Insulated, three layers" },
          ].map((row) => (
            <div key={row.k} className="border-b border-brand-hairline py-3">
              <dt className="eyebrow">{row.k}</dt>
              <dd className="mt-1 font-medium text-brand-ink tabular">{row.v}</dd>
            </div>
          ))}
        </dl>
        {showsDemoPricing(product) && (
          <Badge variant="secondary" className="mt-4">
            Demo pricing — replace before launch
          </Badge>
        )}

        {/* 1 · Size */}
        <fieldset className={`mt-8 ${aiRing("sizeId")}`}>
          <legend className="flex items-center font-heading text-lg font-medium text-brand-ink">
            <span className="mr-3 text-brand-accent tabular">{nextStep()}</span>Size{aiMark("sizeId")}
          </legend>
          <div className="mt-3 grid gap-2">
            {product.sizes.map((s) => (
              <OptionButton
                key={s.id}
                selected={s.id === sizeId}
                onClick={() => {
                  setSize(s.id);
                  track({ name: "select_size", params: { product_id: product.id, size: s.label } });
                }}
                meta={s.priceDeltaCents > 0 ? `+${formatUnitPrice(s.priceDeltaCents, product.currency)}/bag` : undefined}
              >
                <span className="font-medium text-brand-ink">{s.label}</span>
                <span className="text-xs text-brand-ink-muted tabular">{formatDimensions({ ...s.dimensions, unit: s.unit })}</span>
              </OptionButton>
            ))}
          </div>
          <p className="mt-3 text-xs text-brand-ink-muted">
            Need a custom size? The factory can make one, quoted individually, minimum {formatQty(product.minQuantity)} pieces.{" "}
            <Link href={`${QUOTE_CTA.href}?product=${product.slug}&size=custom`} className="text-brand-accent-ink underline underline-offset-3 hover:text-brand-ink">
              Request a custom size quote
            </Link>
          </p>
        </fieldset>

        {/* 2 · Material — only when the factory offers a choice. */}
        {product.materials.length > 1 && (
          <fieldset className={`mt-8 ${aiRing("materialId")}`}>
            <legend className="flex items-center font-heading text-lg font-medium text-brand-ink">
              <span className="mr-3 text-brand-accent tabular">{nextStep()}</span>Material weight{aiMark("materialId")}
            </legend>
            <div className="mt-3 grid gap-2">
              {product.materials.map((m) => (
                <OptionButton
                  key={m.id}
                  selected={m.id === materialId}
                  onClick={() => setMaterial(m.id)}
                  meta={m.priceDeltaCents > 0 ? `+${formatUnitPrice(m.priceDeltaCents, product.currency)}/bag` : undefined}
                >
                  <span className="font-medium text-brand-ink">{m.label}</span>
                </OptionButton>
              ))}
            </div>
          </fieldset>
        )}

        {/* 3 · Colour */}
        <fieldset className={`mt-8 ${aiRing("colorId")}`}>
          <legend className="flex items-center font-heading text-lg font-medium text-brand-ink">
            <span className="mr-3 text-brand-accent tabular">{nextStep()}</span>Bag colour{aiMark("colorId")}
          </legend>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {product.colors.map((c) => (
              <OptionButton
                key={c.id}
                selected={c.id === colorId}
                onClick={() => {
                  setColor(c.id);
                  track({ name: "select_color", params: { product_id: product.id, color: c.label } });
                }}
                ariaLabel={c.label}
              >
                <span aria-hidden="true" className="inline-block size-5 shrink-0 rounded-full border border-brand-hairline-strong" style={{ background: c.swatch }} />
                <span className="font-medium text-brand-ink">{c.label}</span>
              </OptionButton>
            ))}
          </div>
          {selectedColor?.custom && (
            <p className="mt-3 rounded-sm bg-brand-accent-soft px-3 py-2 text-xs text-brand-ink-2">
              Custom colours are quoted individually — finish your specs and send them with the quote request.
            </p>
          )}
        </fieldset>

        {/* 4 · Printing. With one option there is nothing to choose: the
            customer uploads artwork and production review decides the colour
            separation, so no print-colour-count selector is shown. */}
        {singlePrintOption ? (
          <div className={`mt-8 ${aiRing("printOptionId")}`}>
            <p className="flex items-center font-heading text-lg font-medium text-brand-ink">
              <span className="mr-3 text-brand-accent tabular">{nextStep()}</span>Custom logo{aiMark("printOptionId")}
            </p>
            <div className="mt-3 border-y border-brand-hairline py-4 text-sm">
              <p className="font-medium text-brand-ink">{product.printOptions[0].label}</p>
              <p className="mt-1 text-brand-ink-2">{product.printOptions[0].description}</p>
              <p className="mt-2 text-brand-ink-muted">
                {checkout ? "Upload artwork below." : "Attach your logo or artwork to the quote request — PNG, JPG, PDF, AI or EPS, up to 25 MB."}{" "}
                {PROOF_POLICY.detail}
              </p>
            </div>
          </div>
        ) : (
          <fieldset className={`mt-8 ${aiRing("printOptionId")}`}>
            <legend className="flex items-center font-heading text-lg font-medium text-brand-ink">
              <span className="mr-3 text-brand-accent tabular">{nextStep()}</span>Printing{aiMark("printOptionId")}
            </legend>
            <div className="mt-3 grid gap-2">
              {product.printOptions.map((p) => (
                <OptionButton
                  key={p.id}
                  selected={p.id === printId}
                  onClick={() => {
                    setPrintOption(p.id);
                    track({ name: "select_print_option", params: { product_id: product.id, print_option: p.id } });
                  }}
                  meta={p.priceDeltaCents > 0 ? `+${formatUnitPrice(p.priceDeltaCents, product.currency)}/bag` : "included"}
                >
                  <span className="block">
                    <span className="block font-medium text-brand-ink">{p.label}</span>
                    <span className="block text-xs text-brand-ink-muted">{p.description}</span>
                  </span>
                </OptionButton>
              ))}
            </div>
          </fieldset>
        )}

        {/* 5 · Artwork — the durable uploader is part of the checkout path only. */}
        {checkout && selectedPrint?.requiresArtwork && (
          <div className="mt-8">
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
        <fieldset className={`mt-8 ${aiRing("quantity")}`}>
          <legend className="flex items-center font-heading text-lg font-medium text-brand-ink">
            <span className="mr-3 text-brand-accent tabular">{nextStep()}</span>Quantity{aiMark("quantity")}
          </legend>
          <div className={`mt-3 grid gap-2 ${product.quantityPresets.length <= 3 ? "grid-cols-2" : "grid-cols-3"}`}>
            {product.quantityPresets.map((q) => {
              const unit = product.pricingTiers.filter((t) => t.minQty <= q).at(-1);
              const unitPrice = unit ? unit.unitPriceCents + (selectedSize?.priceDeltaCents ?? 0) : null;
              return (
                <OptionButton
                  key={q}
                  selected={q === quantity && !customQty}
                  onClick={() => setQty(q)}
                  meta={unitPrice !== null ? `${formatUnitPrice(unitPrice, product.currency)}/bag` : undefined}
                >
                  <span className="font-medium text-brand-ink tabular">{formatQty(q)} bags</span>
                </OptionButton>
              );
            })}
            {!fixedQuantities && (
              <label
                className={`flex min-h-14 cursor-text items-center gap-2 rounded-sm border px-4 text-sm ${
                  customQty ? "border-brand-accent bg-brand-accent-soft" : "border-brand-border-control bg-brand-surface"
                }`}
                data-selected={Boolean(customQty)}
              >
                <span className="text-xs text-brand-ink-muted">Custom</span>
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
                  className="w-24 bg-transparent text-base text-brand-ink outline-none tabular"
                  aria-label="Custom quantity"
                  placeholder={`${formatQty(product.minQuantity)}+`}
                />
              </label>
            )}
          </div>
          <p className="mt-3 text-xs text-brand-ink-muted">
            Minimum order {formatQty(product.minQuantity)} pieces per design.
            {fixedQuantities && (
              <>
                {" "}
                Need more than {formatQty(largestOrderableQty)}?{" "}
                <Link href={`${QUOTE_CTA.href}?product=${product.slug}&qty=${largestOrderableQty}`} className="text-brand-accent-ink underline underline-offset-3 hover:text-brand-ink">
                  Request a volume quote
                </Link>
                .
              </>
            )}
          </p>
          {quantity < product.minQuantity && (
            <p className="mt-2 text-xs text-brand-danger" role="alert">
              Minimum order is {formatQty(product.minQuantity)} bags. Smaller runs may be possible —{" "}
              <Link href={`${QUOTE_CTA.href}?product=${product.slug}&qty=${quantity}`} className="underline">
                request custom pricing
              </Link>
              .
            </p>
          )}
        </fieldset>

        {/* Price breaks for the selected size */}
        <details className="group mt-8 border-y border-brand-hairline py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between font-heading text-lg font-medium text-brand-ink [&::-webkit-details-marker]:hidden">
            {fixedQuantities ? "Price by quantity" : "Volume pricing"}
            <span aria-hidden="true" className="text-brand-ink-muted transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="mt-4">
            <TierPricingTable
              tiers={product.pricingTiers}
              currency={product.currency}
              activeMinQty={quote?.tier.minQty}
              onPick={setQty}
              /* The table must price what the customer actually selected —
                 Extra Large costs 4¢/bag more at every tier. */
              unitDeltaCents={selectedSize?.priceDeltaCents ?? 0}
              exactQuantities={fixedQuantities}
              caption={selectedSize ? `${selectedSize.label} · ${formatDimensions({ ...selectedSize.dimensions, unit: selectedSize.unit })}` : undefined}
            />
          </div>
        </details>

        {/* 7 · Price readout — surface panel, tabular figures, subtotal / shipping / total kept visibly separate.
            The $100 is a shipping CHARGE, not tax and not duty, charged once per order. */}
        <div className="mt-8 rounded-md border border-brand-hairline-strong bg-brand-surface p-5" aria-live="polite">
          {priceReady && quote ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="eyebrow">Price per bag</p>
                  <p className="mt-1 font-heading text-4xl leading-none font-medium text-brand-ink tabular">
                    {formatUnitPrice(quote.unitPriceCents, quote.currency)}
                  </p>
                  <p className="mt-2 text-sm text-brand-ink-muted tabular">
                    {formatQty(quantity)} bags
                    {quote.savingsPct > 0 && <span className="ml-2 text-brand-success">· {formatPct(quote.savingsPct)} below the base tier</span>}
                  </p>
                </div>
                <div className="text-right">
                  <p className="eyebrow">Product subtotal</p>
                  <p className="mt-1 font-heading text-4xl leading-none font-medium text-brand-ink tabular">
                    {formatMoney(quote.totalCents, quote.currency)}
                  </p>
                </div>
              </div>
              <dl className="mt-5 space-y-2 border-t border-brand-hairline pt-4 text-sm tabular">
                <div className="flex justify-between text-brand-ink-2">
                  <dt>Product subtotal</dt>
                  <dd>{formatMoney(quote.totalCents, quote.currency)}</dd>
                </div>
                <div className="flex justify-between text-brand-ink-2">
                  <dt>Shipping (flat, per order)</dt>
                  <dd>{formatMoney(FLAT_US_SHIPPING_CENTS, quote.currency)}</dd>
                </div>
                <div className="flex justify-between font-medium text-brand-ink">
                  <dt>Total before tax</dt>
                  <dd>{formatMoney(quote.totalCents + FLAT_US_SHIPPING_CENTS, quote.currency)}</dd>
                </div>
                <p className="pt-1 text-xs text-brand-ink-muted">
                  {FLAT_US_SHIPPING_COPY}. {checkout ? "Any sales tax is calculated by our checkout at payment." : "Any sales tax is shown on your quote."}
                </p>
              </dl>
            </>
          ) : (
            <p className="text-sm text-brand-ink-2">
              This configuration is quoted individually — send it with{" "}
              <Link href={quoteHref} className="text-brand-accent-ink underline underline-offset-3 hover:text-brand-ink">
                a quote request
              </Link>{" "}
              and we price it {QUOTE_CTA.responseTime}.
            </p>
          )}
        </div>

        {/* 8 · Primary CTA */}
        <div className="mt-6">
          {shippingMessage && shippingMessage.placement === "above_cta" && (
            <p data-experiment="product.shipping_message" className="mb-3 rounded-sm bg-brand-accent-soft px-3 py-2 text-sm text-brand-ink-2">
              {shippingMessage.message}
            </p>
          )}
          {checkout ? (
            <Button
              variant="accent"
              size="lg"
              className="w-full"
              disabled={!quote || missingArtwork || needsQuote || added}
              onClick={handleAdd}
              data-state={added ? "success" : undefined}
            >
              {added ? "Added — opening cart" : ctaLabel}
            </Button>
          ) : (
            <Button variant="accent" size="lg" className="w-full" render={<Link href={quoteHref} onClick={onQuoteClick} />}>
              {ctaLabel}
            </Button>
          )}
          <p data-experiment={ctaHelperText ? "product.primary_cta" : undefined} className="mt-3 text-center text-sm text-brand-ink-muted">
            {ctaHelperText ?? (checkout ? `${PROOF_POLICY.headline}. ${PROOF_POLICY.productionStart}` : `Your configuration is attached. Pricing replies ${QUOTE_CTA.responseTime}; ${PROOF_POLICY.headline.toLowerCase()}.`)}
          </p>
          {shippingMessage && shippingMessage.placement === "below_cta" && (
            <p data-experiment="product.shipping_message" className="mt-3 rounded-sm bg-brand-accent-soft px-3 py-2 text-sm text-brand-ink-2">
              {shippingMessage.message}
            </p>
          )}
          {missingArtwork && (
            <p className="mt-2 text-xs text-brand-danger" role="alert">
              {/* Only offer the escape hatch that actually exists: this
                  product has one print option and it always needs artwork. */}
              {product.printOptions.some((o) => !o.requiresArtwork)
                ? "Upload your logo above (or switch printing to “No logo”) to continue."
                : "Upload your logo or artwork above to continue — every bag is custom printed."}
            </p>
          )}
        </div>

        {/* 9 · Production + shipping check */}
        <div className="mt-8 border-t border-brand-hairline pt-6 text-sm">
          <p className="eyebrow">Production</p>
          <p className="mt-1 text-brand-ink">{PROOF_POLICY.leadTime}</p>
          <p className="eyebrow mt-5">Shipping · {FLAT_US_SHIPPING_COPY}</p>
          <p className="mt-1 text-brand-ink-2">Check that we ship to your ZIP code. United States only right now.</p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const est = estimateShipping(postal);
              if (est.mode === "invalid" || est.mode === "unavailable") {
                setShippingMsg({ text: est.message, tone: "error" });
              } else {
                setShippingMsg({ text: est.message, tone: "ok" });
                track({ name: "shipping_estimate_requested", params: { market: postal.trim().slice(0, 2) } });
              }
            }}
          >
            <Input
              id="postal"
              aria-label="ZIP code"
              className="max-w-44"
              placeholder="ZIP code"
              inputMode="numeric"
              value={postal}
              autoComplete="postal-code"
              onChange={(e) => setPostal(e.target.value)}
            />
            <Button type="submit" variant="outline">
              Check
            </Button>
          </form>
          {shippingMsg && (
            <p className={`mt-2 text-xs ${shippingMsg.tone === "error" ? "text-brand-danger" : "text-brand-success"}`} role="status">
              {shippingMsg.text}
            </p>
          )}
        </div>

        {/* Sticky mobile CTA bar — DESIGN.md §8. */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-brand-hairline bg-brand-canvas p-3 shadow-overlay lg:hidden">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
            <div className="min-w-0">
              {priceReady && quote ? (
                <>
                  <p className="truncate text-sm font-medium text-brand-ink tabular">
                    {formatUnitPrice(quote.unitPriceCents, quote.currency)}/bag · {formatMoney(quote.totalCents, quote.currency)}
                  </p>
                  <p className="text-xs text-brand-ink-muted tabular">
                    {formatQty(quantity)} bags · +{formatMoney(FLAT_US_SHIPPING_CENTS, quote.currency)} shipping
                  </p>
                </>
              ) : (
                <p className="text-xs text-brand-ink-muted">Quoted individually</p>
              )}
            </div>
            {checkout ? (
              <Button variant="accent" className="shrink-0" disabled={!quote || missingArtwork || needsQuote || added} onClick={handleAdd}>
                {added ? "Added" : ctaLabel}
              </Button>
            ) : (
              <Button variant="accent" className="shrink-0" render={<Link href={quoteHref} onClick={onQuoteClick} />}>
                {ctaLabel}
              </Button>
            )}
          </div>
        </div>
        {/* Spacer so the sticky bar never covers content on mobile */}
        <div className="h-20 lg:hidden" aria-hidden="true" />
      </div>
    </div>
  );
}
