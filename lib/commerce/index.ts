import { resolveCommerceConfiguration } from "./config";
import { mockProvider } from "./mock";
import { createShopifyProvider } from "./shopify";
import type { CommerceProvider } from "./provider";

/**
 * Provider selection — the ONE place a commerce provider is chosen.
 *
 * Production Launch Session 02: this function can no longer return the mock
 * provider in production. `resolveCommerceConfiguration()` THROWS instead of
 * degrading (lib/commerce/config.ts explains why at length), and nothing here
 * catches it: a missing Shopify configuration must surface as a loud checkout
 * failure, never as a silent fake sale.
 */
export function getCommerce(): CommerceProvider {
  const config = resolveCommerceConfiguration();
  if (config.mode === "shopify") return createShopifyProvider(config.shopify);
  return mockProvider;
}

export { CommerceConfigurationError, describeCommerceReadiness, resolveCommerceConfiguration } from "./config";
export type { CommerceProvider } from "./provider";
