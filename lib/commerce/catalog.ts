import { PRODUCTS, getProductBySlug } from "@/config/products";
import type { Product } from "@/types/commerce";

/**
 * THE catalog read facade — every catalog read outside `lib/commerce` and
 * `config/products.ts` goes through here (audit risk 7).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE MOCK-CATALOG FALLBACK IS GONE (Production Launch Session 02 §8)
 * ─────────────────────────────────────────────────────────────────────────
 * These functions used to call the ACTIVE PROVIDER and, when a Shopify
 * catalog read came back empty or failing, quietly serve the mock catalog
 * instead. That was a genuine production hazard: "Shopify is down" would have
 * silently become "show the customer demo products".
 *
 * It is gone, and so is the provider hop that made it necessary. The
 * BagDirect catalog is BagDirect's OWN authority: `config/products.ts`
 * defines which products exist, which options are legal and which quantity
 * tiers apply, and `modules/pricing` computes the price from it. Shopify has
 * no representation for any of that — Shopify is the merchandise, checkout
 * and payment layer (docs/SHOPIFY_PRODUCTION.md §"Catalog authority").
 *
 * Both providers therefore serve exactly this data, so routing a catalog read
 * through a provider changed nothing except adding a way for it to fail.
 * Consequences, all deliberate:
 *   - the storefront renders whether or not Shopify is reachable
 *   - there is no remote catalog read to fail, so nothing to fall back FROM
 *   - a catalog read makes no network call and needs no credential
 *   - `next build` can prerender product pages without commerce configured
 *
 * A COMMERCE misconfiguration is not hidden by this — it surfaces where it
 * actually matters. `getCommerce()` throws in production with missing Shopify
 * configuration, so `/api/checkout` answers a loud 503 and no order is
 * created. Customers can browse a storefront that cannot yet take money;
 * they are never sold a mock order.
 */

export async function listCatalogProducts(): Promise<Product[]> {
  return PRODUCTS;
}

export async function getCatalogProduct(slug: string): Promise<Product | null> {
  return getProductBySlug(slug) ?? null;
}

export async function getCatalogProductById(id: string): Promise<Product | null> {
  return PRODUCTS.find((p) => p.id === id) ?? null;
}

export async function getHeroCatalogProduct(): Promise<Product> {
  return PRODUCTS.find((p) => p.hero) ?? PRODUCTS[0];
}
