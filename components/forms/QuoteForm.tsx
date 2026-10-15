"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { quoteSchema, type QuoteRequest } from "@/lib/validation/quote";
import { validateArtworkFile } from "@/lib/validation/artwork";
import { track } from "@/lib/analytics/track";
import { attributionToMetadata, readAttribution } from "@/lib/attribution/attribution";
import { BUSINESS, PROOF_POLICY, QUOTE_CTA } from "@/config/business";
import { formatQty } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Slim catalog view the server page passes in — never config/products directly. */
export type QuoteProductOption = {
  slug: string;
  title: string;
  sizes: { id: string; label: string; dims: string }[];
  colors: { id: string; label: string }[];
  quantityPresets: number[];
  minQuantity: number;
};

export type QuoteFormDefaults = {
  product?: string;
  size?: string;
  color?: string;
  qty?: string;
};

type FieldErrors = Partial<Record<keyof QuoteRequest | "artwork", string>>;

const OPTIONAL: (keyof QuoteRequest)[] = ["phone", "dimensions", "printing", "desiredDelivery", "postalCode", "notes"];
const CUSTOM = "__custom__";

/**
 * Wholesale inquiry form — the Phase 1 primary conversion.
 *
 * Fields per the brief: company, contact, email, product, size, quantity, shipping ZIP,
 * logo upload, additional requirements. The wire contract (`quoteSchema`, multipart to
 * /api/quote) is unchanged: product/size/colour selections are composed into the existing
 * `productType` / `dimensions` / `printing` strings, so the server, the DB persistence and
 * the AI need-profile writers see exactly what they saw before.
 */
export function QuoteForm({ products, defaults = {} }: { products: QuoteProductOption[]; defaults?: QuoteFormDefaults }) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const startedRef = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [artworkName, setArtworkName] = useState<string | null>(null);
  const uid = useId();

  const initialProduct = products.find((p) => p.slug === defaults.product) ?? products[0] ?? null;
  const [productSlug, setProductSlug] = useState<string>(defaults.product === "custom" ? CUSTOM : (initialProduct?.slug ?? CUSTOM));
  const product = products.find((p) => p.slug === productSlug) ?? null;
  const [sizeId, setSizeId] = useState<string>(
    defaults.size === "custom" ? CUSTOM : (product?.sizes.find((s) => s.id === defaults.size)?.id ?? product?.sizes[0]?.id ?? CUSTOM),
  );
  const [colorId, setColorId] = useState<string>(product?.colors.find((c) => c.id === defaults.color)?.id ?? product?.colors[0]?.id ?? "");
  const presetQty = product?.quantityPresets.find((q) => String(q) === defaults.qty);
  const [qtyChoice, setQtyChoice] = useState<string>(presetQty ? String(presetQty) : defaults.qty ? CUSTOM : String(product?.quantityPresets[0] ?? CUSTOM));
  const [customQty, setCustomQty] = useState<string>(presetQty ? "" : (defaults.qty ?? ""));

  const markStarted = () => {
    if (!startedRef.current) {
      startedRef.current = true;
      track({ name: "quote_form_started" });
    }
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    /* Compose the catalog selections into the schema's free-text fields. */
    const selectedSize = product?.sizes.find((s) => s.id === sizeId);
    const selectedColor = product?.colors.find((c) => c.id === colorId);
    fd.set("productType", product ? product.title : "Custom bag (outside the standard catalog)");
    const dims = sizeId === CUSTOM || !selectedSize ? String(fd.get("customDimensions") ?? "") : `${selectedSize.label} · ${selectedSize.dims}`;
    fd.set("dimensions", dims);
    const printing = [selectedColor ? `${selectedColor.label} bag` : null, "custom logo / artwork print", String(fd.get("printingNotes") ?? "")]
      .filter((s) => s && s.trim())
      .join(" · ");
    fd.set("printing", printing);
    fd.set("quantity", qtyChoice === CUSTOM ? String(fd.get("customQuantity") ?? "") : qtyChoice);

    const raw = Object.fromEntries(
      ["businessName", "contactName", "email", "phone", "productType", "dimensions", "quantity", "printing", "desiredDelivery", "postalCode", "notes"].map(
        (k) => [k, String(fd.get(k) ?? "")],
      ),
    );
    const parsed = quoteSchema.safeParse(raw);

    const nextErrors: FieldErrors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof QuoteRequest;
        if (!nextErrors[key]) nextErrors[key] = issue.message;
      }
    }
    const file = fd.get("artwork");
    if (file instanceof File && file.size > 0) {
      const check = validateArtworkFile(file);
      if (!check.ok) nextErrors.artwork = check.reason;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !parsed.success) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }

    setStatus("submitting");
    try {
      fd.set("attribution", JSON.stringify(attributionToMetadata(readAttribution())));
      const res = await fetch("/api/quote", { method: "POST", body: fd });
      if (!res.ok) throw new Error(String(res.status));
      track({ name: "quote_form_submitted" });
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <div className="rounded-md border border-brand-hairline-strong bg-brand-surface p-8" role="status">
        <p className="eyebrow">Request received</p>
        <p className="type-h2 mt-3">We will reply with pricing {QUOTE_CTA.responseTime}.</p>
        <p className="mt-4 max-w-md text-base leading-body text-brand-ink-2">
          Expect an email from us. If it is urgent, say so in a reply to that email. {PROOF_POLICY.detail}
        </p>
        <Button variant="outline" className="mt-8" render={<Link href="/" />}>
          Back to the homepage
        </Button>
      </div>
    );
  }

  const errorEntries = Object.entries(errors) as [string, string][];
  const errId = (name: string) => `${uid}-${name}-err`;
  const required = (name: keyof QuoteRequest) => !OPTIONAL.includes(name);

  /* A render helper, not a component: a component defined inside render would remount (and
     wipe) these uncontrolled inputs on every keystroke-driven re-render. */
  const textField = ({
    name,
    label,
    hint,
    ...props
  }: { name: keyof QuoteRequest; label: string; hint?: string } & React.ComponentProps<"input">) => (
    <div>
      <Label htmlFor={`${uid}-${name}`}>
        {label}
        {!required(name) && <span className="font-normal text-brand-ink-muted">(optional)</span>}
      </Label>
      <Input
        id={`${uid}-${name}`}
        name={name}
        className="mt-2"
        aria-invalid={errors[name] ? "true" : undefined}
        aria-describedby={errors[name] ? errId(name) : hint ? `${uid}-${name}-hint` : undefined}
        aria-required={required(name) || undefined}
        {...props}
      />
      {hint && !errors[name] && (
        <p id={`${uid}-${name}-hint`} className="mt-1.5 text-xs text-brand-ink-muted">
          {hint}
        </p>
      )}
      {errors[name] && (
        <p id={errId(name)} role="alert" className="mt-1.5 text-xs text-brand-danger">
          {errors[name]}
        </p>
      )}
    </div>
  );

  const choiceClass = (selected: boolean) =>
    `flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-sm border px-4 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-focus ${
      selected ? "border-brand-accent bg-brand-accent-soft text-brand-ink ring-1 ring-brand-accent ring-inset" : "border-brand-border-control bg-brand-surface text-brand-ink-2 hover:border-brand-ink"
    }`;

  return (
    <form onSubmit={onSubmit} onFocus={markStarted} noValidate className="grid gap-12">
      {/* Error summary — focused after a failed submit, links to each field. */}
      <div ref={summaryRef} tabIndex={-1} aria-live="assertive" className="outline-none">
        {errorEntries.length > 0 && (
          <div className="rounded-sm border border-brand-danger bg-brand-surface p-4">
            <p className="font-medium text-brand-danger">Please fix {errorEntries.length === 1 ? "this field" : `these ${errorEntries.length} fields`}:</p>
            <ul className="mt-2 list-disc pl-5 text-sm text-brand-ink-2">
              {errorEntries.map(([name, msg]) => (
                <li key={name}>
                  <a href={`#${uid}-${name}`} className="underline underline-offset-3 hover:text-brand-ink">
                    {msg}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 1 · Product, size, colour, quantity */}
      <fieldset className="grid gap-6">
        <legend className="mb-6 w-full border-b border-brand-hairline pb-4">
          <p className="eyebrow">Step 1 of 3</p>
          <h2 className="type-h3 mt-2">The bag</h2>
        </legend>

        <div>
          <Label htmlFor={`${uid}-product`}>Product</Label>
          <select
            id={`${uid}-product`}
            name="productSelect"
            value={productSlug}
            onChange={(e) => {
              const slug = e.target.value;
              setProductSlug(slug);
              const p = products.find((x) => x.slug === slug);
              setSizeId(p?.sizes[0]?.id ?? CUSTOM);
              setColorId(p?.colors[0]?.id ?? "");
              setQtyChoice(String(p?.quantityPresets[0] ?? CUSTOM));
            }}
            className="mt-2 h-11 w-full rounded-sm border border-brand-border-control bg-brand-surface px-3.5 text-base text-brand-ink outline-none focus-visible:border-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-focus"
          >
            {products.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title}
              </option>
            ))}
            <option value={CUSTOM}>Something else — custom bag</option>
          </select>
          <input type="hidden" name="productType" />
          {errors.productType && (
            <p id={errId("productType")} role="alert" className="mt-1.5 text-xs text-brand-danger">
              {errors.productType}
            </p>
          )}
        </div>

        <div>
          <p className="font-body text-sm font-medium text-brand-ink">Size</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {product?.sizes.map((s) => (
              <label key={s.id} className={choiceClass(sizeId === s.id)}>
                <span className="flex flex-col">
                  <span className="font-medium text-brand-ink">{s.label}</span>
                  <span className="text-xs text-brand-ink-muted tabular">{s.dims}</span>
                </span>
                <input type="radio" name="sizeSelect" value={s.id} checked={sizeId === s.id} onChange={() => setSizeId(s.id)} className="size-4 accent-brand-accent-ink" />
              </label>
            ))}
            <label className={choiceClass(sizeId === CUSTOM)}>
              <span className="flex flex-col">
                <span className="font-medium text-brand-ink">Custom size</span>
                <span className="text-xs text-brand-ink-muted">Quoted individually, {formatQty(BUSINESS.MOQ)} minimum</span>
              </span>
              <input type="radio" name="sizeSelect" value={CUSTOM} checked={sizeId === CUSTOM} onChange={() => setSizeId(CUSTOM)} className="size-4 accent-brand-accent-ink" />
            </label>
          </div>
          {sizeId === CUSTOM && (
            <div className="mt-3">
              <Label htmlFor={`${uid}-customDimensions`}>Target dimensions</Label>
              <Input id={`${uid}-customDimensions`} name="customDimensions" className="mt-2" placeholder="e.g. 30 × 30 × 20 cm (width × height × gusset)" />
            </div>
          )}
          <input type="hidden" name="dimensions" />
        </div>

        {product && product.colors.length > 0 && (
          <div>
            <p className="font-body text-sm font-medium text-brand-ink">Bag colour</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {product.colors.map((c) => (
                <label key={c.id} className={choiceClass(colorId === c.id)}>
                  <span className="font-medium text-brand-ink">{c.label}</span>
                  <input type="radio" name="colorSelect" value={c.id} checked={colorId === c.id} onChange={() => setColorId(c.id)} className="size-4 accent-brand-accent-ink" />
                </label>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="font-body text-sm font-medium text-brand-ink">Quantity per design</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(product?.quantityPresets ?? []).map((q) => (
              <label key={q} className={choiceClass(qtyChoice === String(q))}>
                <span className="font-medium text-brand-ink tabular">{formatQty(q)}</span>
                <input type="radio" name="quantitySelect" value={q} checked={qtyChoice === String(q)} onChange={() => setQtyChoice(String(q))} className="size-4 accent-brand-accent-ink" />
              </label>
            ))}
            <label className={choiceClass(qtyChoice === CUSTOM)}>
              <span className="font-medium text-brand-ink">Other</span>
              <input type="radio" name="quantitySelect" value={CUSTOM} checked={qtyChoice === CUSTOM} onChange={() => setQtyChoice(CUSTOM)} className="size-4 accent-brand-accent-ink" />
            </label>
          </div>
          {qtyChoice === CUSTOM && (
            <div className="mt-3">
              <Label htmlFor={`${uid}-customQuantity`}>How many bags?</Label>
              <Input
                id={`${uid}-customQuantity`}
                name="customQuantity"
                className="mt-2 max-w-xs"
                inputMode="numeric"
                placeholder={`e.g. ${formatQty((product?.minQuantity ?? BUSINESS.MOQ) * 3)}`}
                value={customQty}
                onChange={(e) => setCustomQty(e.target.value)}
                aria-invalid={errors.quantity ? "true" : undefined}
              />
            </div>
          )}
          <input type="hidden" name="quantity" id={`${uid}-quantity`} />
          <p className="mt-2 text-xs text-brand-ink-muted">Minimum order {formatQty(product?.minQuantity ?? BUSINESS.MOQ)} pieces per design. Smaller runs may be possible — ask.</p>
          {errors.quantity && (
            <p id={errId("quantity")} role="alert" className="mt-1.5 text-xs text-brand-danger">
              {errors.quantity}
            </p>
          )}
        </div>
      </fieldset>

      {/* 2 · Logo / artwork */}
      <fieldset className="grid gap-6">
        <legend className="mb-6 w-full border-b border-brand-hairline pb-4">
          <p className="eyebrow">Step 2 of 3</p>
          <h2 className="type-h3 mt-2">Your logo</h2>
        </legend>
        <div>
          <Label htmlFor={`${uid}-artwork`}>
            Logo or artwork file <span className="font-normal text-brand-ink-muted">(optional)</span>
          </Label>
          <input
            id={`${uid}-artwork`}
            name="artwork"
            type="file"
            accept=".png,.jpg,.jpeg,.pdf,.ai,.eps"
            className="mt-2 block w-full cursor-pointer rounded-sm border border-dashed border-brand-border-control bg-brand-surface px-4 py-5 text-sm text-brand-ink-2 file:mr-4 file:cursor-pointer file:rounded-sm file:border file:border-brand-ink file:bg-transparent file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-focus"
            aria-invalid={errors.artwork ? "true" : undefined}
            aria-describedby={`${uid}-artwork-hint`}
            onChange={(e) => setArtworkName(e.target.files?.[0]?.name ?? null)}
          />
          <p id={`${uid}-artwork-hint`} className="mt-1.5 text-xs text-brand-ink-muted">
            PNG, JPG, PDF, AI or EPS, up to 25 MB. Vector prints sharpest. No file yet? Skip this — tell us below.
          </p>
          {artworkName && !errors.artwork && (
            <p className="mt-1.5 text-xs text-brand-success" role="status">
              Attached: {artworkName}
            </p>
          )}
          {errors.artwork && (
            <p role="alert" className="mt-1.5 text-xs text-brand-danger">
              {errors.artwork}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor={`${uid}-printingNotes`}>
            Print placement or colour notes <span className="font-normal text-brand-ink-muted">(optional)</span>
          </Label>
          <Input id={`${uid}-printingNotes`} name="printingNotes" className="mt-2" placeholder="e.g. logo on both sides, one-colour white print" />
          <input type="hidden" name="printing" />
          <p className="mt-1.5 text-xs text-brand-ink-muted">{PROOF_POLICY.detail}</p>
        </div>
      </fieldset>

      {/* 3 · Business details */}
      <fieldset className="grid gap-6">
        <legend className="mb-6 w-full border-b border-brand-hairline pb-4">
          <p className="eyebrow">Step 3 of 3</p>
          <h2 className="type-h3 mt-2">Where to send the pricing</h2>
        </legend>
        <div className="grid gap-6 sm:grid-cols-2">
          {textField({ name: "businessName", label: "Company name", autoComplete: "organization" })}
          {textField({ name: "contactName", label: "Contact person", autoComplete: "name" })}
          {textField({ name: "email", label: "Email", type: "email", autoComplete: "email", inputMode: "email" })}
          {textField({ name: "phone", label: "Phone", type: "tel", autoComplete: "tel", inputMode: "tel" })}
          {textField({ name: "postalCode", label: "Shipping ZIP code", autoComplete: "postal-code", inputMode: "numeric", hint: "United States only right now." })}
          {textField({ name: "desiredDelivery", label: "Needed by", type: "date", hint: BUSINESS.STANDARD_PRODUCTION_TIME })}
        </div>
        <div>
          <Label htmlFor={`${uid}-notes`}>
            Additional requirements <span className="font-normal text-brand-ink-muted">(optional)</span>
          </Label>
          <Textarea id={`${uid}-notes`} name="notes" className="mt-2" placeholder="Anything the factory should know — containers you need to fit, reorder plans, deadlines." />
        </div>
      </fieldset>

      <div className="border-t border-brand-hairline pt-8">
        <Button type="submit" variant="accent" size="lg" className="w-full sm:w-auto" disabled={status === "submitting"}>
          {status === "submitting" ? "Sending…" : "Send quote request"}
        </Button>
        <p className="mt-3 text-sm text-brand-ink-muted">Pricing replies {QUOTE_CTA.responseTime}. No account needed.</p>
        {status === "error" && (
          <p role="alert" className="mt-4 rounded-sm border border-brand-danger bg-brand-surface px-4 py-3 text-sm text-brand-danger">
            Something went wrong sending your request. Try again, or email us directly — the address is on the{" "}
            <Link href="/contact" className="underline">
              contact page
            </Link>
            .
          </p>
        )}
      </div>
    </form>
  );
}
