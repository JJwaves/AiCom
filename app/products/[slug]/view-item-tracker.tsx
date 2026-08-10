"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/track";
import { baseUnitPriceCents } from "@/modules/pricing";
import type { Product } from "@/types/commerce";

/** Fires view_item once per product page view. */
export function ViewItemTracker({ product }: { product: Product }) {
  useEffect(() => {
    track({
      name: "view_item",
      params: {
        items: [{ product_id: product.id, product_name: product.title, unit_price: baseUnitPriceCents(product) / 100 }],
        currency: product.currency,
      },
    });
  }, [product]);
  return null;
}
