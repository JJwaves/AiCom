"use client";

import { useSearchParams } from "next/navigation";
import { QuoteForm, type QuoteProductOption } from "@/components/forms/QuoteForm";

/**
 * Resolves ?product=<slug>&size=<id>&color=<id>&qty=<n> (what the configurator's
 * "Request a quote" carries) into form defaults. The catalog arrives as a slim prop from
 * the server page (reads go through the commerce provider, never config/products).
 */
export function QuoteClient({ products }: { products: QuoteProductOption[] }) {
  const params = useSearchParams();
  return (
    <QuoteForm
      products={products}
      defaults={{
        product: params.get("product") ?? undefined,
        size: params.get("size") ?? undefined,
        color: params.get("color") ?? undefined,
        qty: params.get("qty") ?? undefined,
      }}
    />
  );
}
