"use client";

import { useRef, useState } from "react";
import { quoteSchema, type QuoteRequest } from "@/lib/validation/quote";
import { validateArtworkFile } from "@/lib/validation/artwork";
import { track } from "@/lib/analytics/track";
import { attributionToMetadata, readAttribution } from "@/lib/attribution/attribution";

type FieldErrors = Partial<Record<keyof QuoteRequest | "artwork", string>>;

export function QuoteForm({ defaultProduct, defaultQty }: { defaultProduct?: string; defaultQty?: string }) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const startedRef = useRef(false);
  const [artworkName, setArtworkName] = useState<string | null>(null);

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
    if (Object.keys(nextErrors).length > 0 || !parsed.success) return;

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
      <div className="surface p-8 text-center" role="status">
        <p className="text-2xl" style={{ fontWeight: 600 }}>
          Request received ✓
        </p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-3">
          We&apos;ll reply with pricing within one business day. If it&apos;s urgent, mention it in a reply to the
          confirmation email.
        </p>
      </div>
    );
  }

  const field = (
    name: keyof QuoteRequest,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
    hint?: string,
  ) => (
    <div>
      <label htmlFor={name} className="label-mono mb-1 block">
        {label}
        {!["phone", "dimensions", "printing", "desiredDelivery", "postalCode", "notes"].includes(name) && (
          <span aria-hidden="true" className="ml-1 text-error">
            *
          </span>
        )}
      </label>
      <input
        id={name}
        name={name}
        className="input"
        aria-invalid={errors[name] ? "true" : undefined}
        aria-describedby={errors[name] ? `${name}-err` : undefined}
        {...props}
      />
      {hint && !errors[name] && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
      {errors[name] && (
        <p id={`${name}-err`} role="alert" className="mt-1 text-xs text-error">
          {errors[name]}
        </p>
      )}
    </div>
  );

  return (
    <form onSubmit={onSubmit} onFocus={markStarted} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("businessName", "Business name", { autoComplete: "organization" })}
        {field("contactName", "Contact name", { autoComplete: "name" })}
        {field("email", "Email", { type: "email", autoComplete: "email" })}
        {field("phone", "Phone (optional)", { type: "tel", autoComplete: "tel" })}
        {field("productType", "Product type", { defaultValue: defaultProduct ?? "Custom Insulated Takeout Bag" })}
        {field("dimensions", "Dimensions (optional)", { placeholder: 'e.g. 12"W × 10"H × 8"G' })}
        {field("quantity", "Quantity", { defaultValue: defaultQty ?? "", inputMode: "numeric", placeholder: "e.g. 5,000" })}
        {field("printing", "Printing requirements (optional)", { placeholder: "e.g. 2-color logo, both sides" })}
        {field("desiredDelivery", "Desired delivery date (optional)", { type: "date" })}
        {field("postalCode", "Shipping ZIP / postal code (optional)", { autoComplete: "postal-code" })}
      </div>

      <div className="mt-4">
        <label htmlFor="artwork" className="label-mono mb-1 block">
          Artwork (optional)
        </label>
        <input
          id="artwork"
          name="artwork"
          type="file"
          accept=".png,.jpg,.jpeg,.pdf,.ai,.eps"
          className="input cursor-pointer file:mr-3 file:cursor-pointer file:rounded-[6px] file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink"
          aria-invalid={errors.artwork ? "true" : undefined}
          onChange={(e) => setArtworkName(e.target.files?.[0]?.name ?? null)}
        />
        {artworkName && !errors.artwork && <p className="mt-1 text-xs text-ok">✓ {artworkName}</p>}
        {errors.artwork && (
          <p role="alert" className="mt-1 text-xs text-error">
            {errors.artwork}
          </p>
        )}
      </div>

      <div className="mt-4">
        <label htmlFor="notes" className="label-mono mb-1 block">
          Additional notes (optional)
        </label>
        <textarea id="notes" name="notes" className="input min-h-24 resize-y" />
      </div>

      <button type="submit" className="btn btn--primary mt-6 w-full sm:w-auto" disabled={status === "submitting"}>
        {status === "submitting" ? "Sending…" : "Request custom pricing"}
      </button>
      {status === "error" && (
        <p role="alert" className="mt-3 rounded-[6px] bg-error-soft px-3 py-2 text-sm text-error">
          Something went wrong sending your request. Try again, or email us directly — the address is on the
          contact page.
        </p>
      )}
    </form>
  );
}
