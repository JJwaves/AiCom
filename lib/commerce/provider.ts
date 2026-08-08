import type { Cart, CheckoutResult, Product } from "@/types/commerce";

/**
 * Commerce abstraction layer.
 *
 * The UI only ever talks to this interface. `mock` serves the seed catalog
 * from config/products.ts; `shopify` maps the same shapes onto the
 * Storefront API once env vars exist (see lib/commerce/shopify.ts).
 */
export interface CommerceProvider {
  name: "mock" | "shopify";
  listProducts(): Promise<Product[]>;
  getProduct(slug: string): Promise<Product | null>;
  /**
   * Hand the cart to checkout. Shopify returns a redirect to its secure
   * checkout; mock returns a local confirmation id.
   * `attribution` is attached as order metadata (cart attributes on Shopify).
   */
  createCheckout(cart: Cart, attribution: Record<string, string>): Promise<CheckoutResult>;
}
