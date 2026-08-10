import { PRODUCTS, getProductBySlug } from "@/config/products";
import type { CheckoutResult, Product } from "@/types/commerce";
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

  async createCheckout(): Promise<CheckoutResult> {
    // Mock checkout: mint a local order id; nothing is charged. Runs
    // server-side in /api/checkout, which persists the server-priced Order
    // (db: orders/order_lines) and also returns the payload for the demo
    // confirmation page (sessionStorage).
    const orderId = `MOCK-${Date.now().toString(36).toUpperCase()}`;
    return { kind: "mock", orderId };
  },
};
