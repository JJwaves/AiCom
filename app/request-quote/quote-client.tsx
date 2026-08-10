"use client";

import { useSearchParams } from "next/navigation";
import { QuoteForm } from "@/components/forms/QuoteForm";

/**
 * Resolves ?product=<slug>&qty=<n> into form defaults. The catalog arrives
 * as a slim prop from the server page (reads go through the commerce
 * provider, never config/products).
 */
export function QuoteClient({ products }: { products: { slug: string; title: string }[] }) {
  const params = useSearchParams();
  const productSlug = params.get("product");
  const qty = params.get("qty");
  const product = productSlug ? products.find((p) => p.slug === productSlug) : undefined;
  return <QuoteForm defaultProduct={product?.title} defaultQty={qty ?? undefined} />;
}
