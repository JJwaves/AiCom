"use client";

import { useSearchParams } from "next/navigation";
import { getProductBySlug } from "@/config/products";
import { QuoteForm } from "@/components/forms/QuoteForm";

export function QuoteClient() {
  const params = useSearchParams();
  const productSlug = params.get("product");
  const qty = params.get("qty");
  const product = productSlug ? getProductBySlug(productSlug) : undefined;
  return <QuoteForm defaultProduct={product?.title} defaultQty={qty ?? undefined} />;
}
