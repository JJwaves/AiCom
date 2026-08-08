import { mockProvider } from "./mock";
import { shopifyConfigured, shopifyProvider } from "./shopify";
import type { CommerceProvider } from "./provider";

/**
 * Provider selection. Shopify activates automatically when its env vars
 * exist; everything else keeps running on the seed catalog.
 */
export function getCommerce(): CommerceProvider {
  if (shopifyConfigured()) return shopifyProvider;
  return mockProvider;
}

export type { CommerceProvider } from "./provider";
