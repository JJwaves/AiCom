import type { Cart, CheckoutResult, Product } from "@/types/commerce";

/**
 * Commerce abstraction layer.
 *
 * The UI only ever talks to this interface through /api/checkout. Two
 * implementations exist and their split is enforced structurally, not by
 * convention (lib/commerce/config.ts):
 *
 *   mock     development and test ONLY — mints a local order id, charges
 *            nobody. Refuses to run in production.
 *   shopify  production commerce — a real Shopify draft order priced by the
 *            BagDirect engine, paid on Shopify's hosted checkout.
 *
 * BOTH serve the SAME catalog (config/products.ts). The catalog is BagDirect
 * authority; the provider only decides how money is taken.
 */
export interface CommerceProvider {
  name: "mock" | "shopify";
  listProducts(): Promise<Product[]>;
  getProduct(slug: string): Promise<Product | null>;
  /**
   * Hand the SERVER-PRICED cart to checkout. Shopify returns a redirect to
   * its hosted checkout; mock returns a local confirmation id.
   *
   * `cart` has already been re-priced by the deterministic engine in
   * /api/checkout — a provider never prices anything. `attribution` travels
   * as order metadata. `context.sessionId` and `context.orderId` are
   * first-party correlation references so the paid order arriving by webhook
   * can find its way back to the session and the BagDirect order row that
   * created it.
   */
  createCheckout(
    cart: Cart,
    attribution: Record<string, string>,
    context?: { sessionId?: string | null; orderId?: string | null },
  ): Promise<CheckoutResult>;
}
