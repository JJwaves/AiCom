import { getCommerce } from "./index";
import { mockProvider } from "./mock";
import type { Product } from "@/types/commerce";

/**
 * Catalog read facade — every catalog read outside lib/commerce goes
 * through these functions, never through config/products directly, so the
 * provider switch switches the whole storefront (audit risk 7).
 *
 * Safety fallback: the Shopify provider's product/variant mapping is still
 * TODO(shopify) and returns an empty catalog. If Shopify env vars are set
 * before the mapping is complete, the active provider would serve nothing —
 * so an empty (or failing) catalog read logs loudly and serves the mock
 * catalog instead of an empty storefront. Checkout still uses the real
 * provider. Remove the fallback once the Shopify mapping is complete and
 * verified (LAUNCH_CHECKLIST).
 */

function warnFallback(providerName: string, detail: string): void {
  console.warn(
    `[commerce] ${providerName} catalog ${detail} — serving the mock catalog as fallback. ` +
      "Complete the Shopify product/variant mapping (lib/commerce/shopify.ts) before launch.",
  );
}

export async function listCatalogProducts(): Promise<Product[]> {
  const provider = getCommerce();
  if (provider.name === "mock") return provider.listProducts();
  try {
    const products = await provider.listProducts();
    if (products.length > 0) return products;
    warnFallback(provider.name, "is empty");
  } catch (err) {
    warnFallback(provider.name, `read failed (${err instanceof Error ? err.message : String(err)})`);
  }
  return mockProvider.listProducts();
}

export async function getCatalogProduct(slug: string): Promise<Product | null> {
  const provider = getCommerce();
  if (provider.name === "mock") return provider.getProduct(slug);
  try {
    const product = await provider.getProduct(slug);
    if (product) return product;
    warnFallback(provider.name, `has no product "${slug}"`);
  } catch (err) {
    warnFallback(provider.name, `read failed (${err instanceof Error ? err.message : String(err)})`);
  }
  return mockProvider.getProduct(slug);
}

export async function getCatalogProductById(id: string): Promise<Product | null> {
  const products = await listCatalogProducts();
  return products.find((p) => p.id === id) ?? null;
}

export async function getHeroCatalogProduct(): Promise<Product> {
  const products = await listCatalogProducts();
  return products.find((p) => p.hero) ?? products[0];
}
