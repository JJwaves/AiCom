import type { Cart, CheckoutResult, Product } from "@/types/commerce";
import type { CommerceProvider } from "./provider";

/**
 * Shopify Storefront API provider.
 *
 * Activated when NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN and
 * NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN are set (Storefront tokens are
 * public-safe by design; the Admin API token must NEVER appear here).
 *
 * Catalog mapping strategy:
 *  - Each Product maps to a Shopify product; size/material/color are variants.
 *  - Pricing tiers live in a product metafield (namespace "b2b", key
 *    "pricing_tiers", JSON) so merchants edit them in Shopify admin.
 *  - Print option + artwork ref + quantity attach as line-item properties.
 *  - Attribution attaches as cart attributes → order attributes.
 */

const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
const API_VERSION = "2025-07";

export function shopifyConfigured(): boolean {
  return Boolean(domain && token);
}

async function storefront<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://${domain}/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token as string,
    },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Storefront API ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}

/* ---------------------------------------------------------------------- */
/* NOTE: full product mapping lands when a store exists. The queries and   */
/* mapping skeleton below compile and run; they return [] until then, and  */
/* lib/commerce/index.ts falls back to the mock catalog for empty results. */
/* ---------------------------------------------------------------------- */

const CART_CREATE = /* GraphQL */ `
  mutation CartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart { id checkoutUrl }
      userErrors { field message }
    }
  }
`;

export const shopifyProvider: CommerceProvider = {
  name: "shopify",

  async listProducts(): Promise<Product[]> {
    // TODO(shopify): map products + b2b.pricing_tiers metafield → Product[].
    return [];
  },

  async getProduct(): Promise<Product | null> {
    // TODO(shopify): single-product query by handle.
    return null;
  },

  async createCheckout(cart: Cart, attribution: Record<string, string>): Promise<CheckoutResult> {
    type CartCreateResp = {
      cartCreate: { cart: { id: string; checkoutUrl: string } | null; userErrors: { message: string }[] };
    };
    const data = await storefront<CartCreateResp>(CART_CREATE, {
      input: {
        lines: cart.lines.map((line) => ({
          // TODO(shopify): resolve variant id from config (size×material×color).
          merchandiseId: "gid://shopify/ProductVariant/REPLACE_ME",
          quantity: line.config.quantity,
          attributes: [
            { key: "Print", value: line.config.printOptionId },
            { key: "Artwork", value: line.config.artwork?.fileName ?? "none" },
            { key: "Artwork notes", value: line.config.artwork?.notes ?? "" },
          ],
        })),
        attributes: Object.entries(attribution).map(([key, value]) => ({ key, value })),
      },
    });
    const url = data.cartCreate.cart?.checkoutUrl;
    if (!url) throw new Error(data.cartCreate.userErrors[0]?.message ?? "cartCreate failed");
    return { kind: "redirect", url };
  },
};
