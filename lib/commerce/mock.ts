import { PRODUCTS, getProductBySlug } from "@/config/products";
import type { CheckoutResult, Product } from "@/types/commerce";
import type { CommerceProvider } from "./provider";

/**
 * Mock provider — the BagDirect seed catalog plus a fake checkout that
 * charges nobody. DEVELOPMENT AND TEST ONLY.
 *
 * `getCommerce()` already refuses to select this provider in production
 * (lib/commerce/config.ts). The assertion below is the second lock: even a
 * direct import — a future route, a script, a mis-merged branch — cannot mint
 * a MOCK-* order id in production, because a mock order becomes a real Order
 * row, a real `purchase_completed` event and real reported revenue.
 */
export const mockProvider: CommerceProvider = {
  name: "mock",

  async listProducts(): Promise<Product[]> {
    return PRODUCTS;
  },

  async getProduct(slug: string): Promise<Product | null> {
    return getProductBySlug(slug) ?? null;
  },

  async createCheckout(): Promise<CheckoutResult> {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[commerce] the MOCK commerce provider was invoked with NODE_ENV=production. " +
          "Refusing: mock checkout charges nobody and ships nothing, but writes a real Order row, a real " +
          "purchase_completed event and a real conversion mark, which every downstream system would report as " +
          "revenue. Configure Shopify (SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_TOKEN) — see docs/SHOPIFY_PRODUCTION.md.",
      );
    }
    // Mock checkout: mint a local order id; nothing is charged. Runs
    // server-side in /api/checkout, which persists the server-priced Order
    // (db: orders/order_lines) and also returns the payload for the demo
    // confirmation page (sessionStorage).
    const orderId = `MOCK-${Date.now().toString(36).toUpperCase()}`;
    return { kind: "mock", orderId };
  },
};
