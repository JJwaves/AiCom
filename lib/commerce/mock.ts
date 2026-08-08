import { PRODUCTS, getProductBySlug } from "@/config/products";
import type { Cart, CheckoutResult, Product } from "@/types/commerce";
import type { CommerceProvider } from "./provider";

/** Mock provider — serves the seed catalog. Used until Shopify env vars exist. */
export const mockProvider: CommerceProvider = {
  name: "mock",

  async listProducts(): Promise<Product[]> {
    return PRODUCTS;
  },

  async getProduct(slug: string): Promise<Product | null> {
    return getProductBySlug(slug) ?? null;
  },

  async createCheckout(cart: Cart, attribution: Record<string, string>): Promise<CheckoutResult> {
    // Mock checkout: mint a local order id. The mock confirmation page
    // renders the order summary; nothing is charged.
    const orderId = `MOCK-${Date.now().toString(36).toUpperCase()}`;
    if (typeof window !== "undefined") {
      sessionStorage.setItem(
        `order:${orderId}`,
        JSON.stringify({ cart, attribution, createdAt: new Date().toISOString() }),
      );
    }
    return { kind: "mock", orderId };
  },
};
