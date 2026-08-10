import { listCatalogProducts } from "@/lib/commerce/catalog";
import { CartClient } from "./cart-client";

/**
 * Cart — server shell. Loads the catalog through the commerce provider
 * (never config/products directly) and hands it to the client cart, which
 * re-prices quantity changes optimistically; checkout itself is re-quoted
 * server-side in /api/checkout.
 */
export default async function CartPage() {
  const products = await listCatalogProducts();
  return <CartClient products={products} />;
}
