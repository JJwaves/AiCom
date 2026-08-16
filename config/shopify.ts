import { PRODUCTS } from "./products";
import type { Product, ProductConfiguration } from "@/types/commerce";

/**
 * Shopify merchandise configuration (Production Launch Session 02).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CATALOG AUTHORITY vs MERCHANDISE REPRESENTATION — read this before editing
 * ─────────────────────────────────────────────────────────────────────────
 * `config/products.ts` is the BagDirect CATALOG AUTHORITY: what exists, which
 * options are legal, and — through `modules/pricing` — what it costs. Shopify
 * is NOT a second catalog. Shopify is the MERCHANDISE + CHECKOUT + PAYMENT
 * representation: a variant id per purchasable configuration so that Shopify
 * can attach a shipping profile, a tax code and a payment session to it.
 *
 * The price charged is ALWAYS BagDirect's deterministic engine price, sent to
 * Shopify explicitly as a draft-order `priceOverride`. Shopify's own variant
 * price is never the price the customer pays, and never feeds back into
 * BagDirect. See docs/SHOPIFY_PRODUCTION.md §"Price consistency".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THESE FOUR DIMENSIONS
 * ─────────────────────────────────────────────────────────────────────────
 * A BagDirect configuration has six fields that can vary. Only four identify
 * distinct MERCHANDISE:
 *
 *   product · size · material · color   → the physical thing → Shopify variant
 *   printOption                         → a service applied to it → line attribute
 *   quantity                            → the line quantity → line quantity
 *
 * `printOption` and `quantity` change the PRICE, not the item, and BagDirect
 * owns price. Folding them into the variant key would demand
 * 4 products × sizes × materials × colors × 3 print × 5 tiers ≈ 1,700 Shopify
 * variants that exist only to encode arithmetic this codebase already does
 * deterministically. They travel as line-item attributes instead (visible on
 * the order, used by fulfilment).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * OWNER INPUT REQUIRED — the map below ships EMPTY on purpose
 * ─────────────────────────────────────────────────────────────────────────
 * Every value is [TO BE PROVIDED]. This session implemented the mechanism;
 * the owner supplies the real Shopify ids. Until a configuration is mapped,
 * checkout for it FAILS VISIBLY — it never falls back to another variant,
 * never guesses, never fuzzy-matches. Run `requiredMerchandiseKeys()` (or the
 * readiness report on the launch checklist) for the exact list to fill in.
 */

/** Merchandise key: the deterministic identity of one purchasable Shopify item. */
export type MerchandiseKey = string;

/**
 * Build the merchandise key. THE one place this string is constructed —
 * mapping lookups and the required-key report must never disagree.
 */
export function merchandiseKey(input: {
  productId: string;
  sizeId: string;
  materialId: string;
  colorId: string;
}): MerchandiseKey {
  return `${input.productId}|${input.sizeId}|${input.materialId}|${input.colorId}`;
}

/**
 * BagDirect merchandise key → Shopify ProductVariant GID.
 *
 * Fill with real ids from the Shopify admin, e.g.
 *
 *   "p-custom-takeout|m|standard|white": "gid://shopify/ProductVariant/44123456789012",
 *
 * Rules enforced by `validateMerchandiseMap()` and its tests:
 *   - a key that is not in `requiredMerchandiseKeys()` is an ERROR (typo, or
 *     a configuration that cannot be bought)
 *   - two keys pointing at the SAME variant GID is an ERROR (a duplicate
 *     mapping silently sells the wrong item)
 *   - a malformed GID is an ERROR
 *   - a MISSING key is not an error at build time — it is a checkout-time
 *     hard failure for that configuration only, and a launch blocker.
 */
export const SHOPIFY_MERCHANDISE_MAP: Record<MerchandiseKey, string> = {
  /* [TO BE PROVIDED] — see BUSINESS_CONFIG_TODO.md → "Shopify merchandise mapping". */
};

/** Shopify GraphQL Admin API version. ONE constant — never inline a version string. */
export const SHOPIFY_API_VERSION = "2026-07";

/**
 * Versions this codebase is known to work against. An explicit
 * SHOPIFY_API_VERSION env pin outside this list fails LOUDLY rather than
 * silently talking to an API whose contracts were never verified here.
 * Upgrade procedure: docs/SHOPIFY_PRODUCTION.md §"API version".
 */
export const SUPPORTED_SHOPIFY_API_VERSIONS = ["2026-07", "2026-04", "2026-01", "2025-10"] as const;

/** Shopify webhook topics BagDirect subscribes to. Registration is operational — see the launch checklist. */
export const SHOPIFY_WEBHOOK_TOPICS = ["orders/create", "orders/paid", "orders/cancelled", "refunds/create"] as const;

export type ShopifyWebhookTopic = (typeof SHOPIFY_WEBHOOK_TOPICS)[number];

/* ------------------------------------------------------------------ */
/* Required-key derivation                                             */
/* ------------------------------------------------------------------ */

/**
 * A configuration that always routes to the custom-quote flow can never
 * reach checkout, so it needs no Shopify variant. Custom colors and custom
 * sizes are quote-only (modules/pricing) — asking the owner to create
 * Shopify variants for them would be asking for merchandise that can never
 * be sold.
 */
function isPurchasableCombination(product: Product, sizeId: string, materialId: string, colorId: string): boolean {
  const color = product.colors.find((c) => c.id === colorId);
  return Boolean(color && !color.custom && product.sizes.some((s) => s.id === sizeId) && product.materials.some((m) => m.id === materialId));
}

/** Every merchandise key a customer could actually check out with, in stable order. */
export function requiredMerchandiseKeys(products: Product[] = PRODUCTS): { key: MerchandiseKey; label: string }[] {
  const out: { key: MerchandiseKey; label: string }[] = [];
  for (const product of products) {
    for (const size of product.sizes) {
      for (const material of product.materials) {
        for (const color of product.colors) {
          if (!isPurchasableCombination(product, size.id, material.id, color.id)) continue;
          out.push({
            key: merchandiseKey({
              productId: product.id,
              sizeId: size.id,
              materialId: material.id,
              colorId: color.id,
            }),
            label: `${product.title} · ${size.label} · ${material.label} · ${color.label}`,
          });
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Mapping resolution — strict, deterministic, no fallback             */
/* ------------------------------------------------------------------ */

export type MerchandiseResolution =
  | { ok: true; key: MerchandiseKey; variantGid: string }
  | { ok: false; key: MerchandiseKey; reason: "unmapped_configuration" | "invalid_variant_id" };

const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;

/**
 * Resolve a validated BagDirect configuration to its Shopify variant.
 *
 * EXACT-MATCH ONLY. There is deliberately no nearest-match, no default
 * variant, no "first variant of the product", and no AI involvement: an
 * unmapped configuration must be impossible to buy, because shipping a
 * customer the wrong physical bag is worse than failing their checkout.
 */
export function resolveMerchandise(
  config: Pick<ProductConfiguration, "productId" | "sizeId" | "materialId" | "colorId">,
  map: Record<MerchandiseKey, string> = SHOPIFY_MERCHANDISE_MAP,
): MerchandiseResolution {
  const key = merchandiseKey(config);
  const variantGid = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
  if (!variantGid) return { ok: false, key, reason: "unmapped_configuration" };
  if (!VARIANT_GID.test(variantGid)) return { ok: false, key, reason: "invalid_variant_id" };
  return { ok: true, key, variantGid };
}

/* ------------------------------------------------------------------ */
/* Mapping validation + readiness                                      */
/* ------------------------------------------------------------------ */

export type MerchandiseMapIssue = {
  severity: "error" | "missing";
  key: MerchandiseKey;
  message: string;
};

export type MerchandiseMapValidation = {
  /** True only when every required key is mapped and no error-level issue exists. */
  complete: boolean;
  requiredCount: number;
  mappedCount: number;
  issues: MerchandiseMapIssue[];
};

/**
 * Validate the mapping against the real catalog. Loud about present-and-wrong
 * values (unknown key, duplicate variant, malformed GID); an EMPTY map is not
 * an error, it is an unfinished launch checklist item.
 */
export function validateMerchandiseMap(
  map: Record<MerchandiseKey, string> = SHOPIFY_MERCHANDISE_MAP,
  products: Product[] = PRODUCTS,
): MerchandiseMapValidation {
  const required = requiredMerchandiseKeys(products);
  const requiredKeys = new Set(required.map((r) => r.key));
  const issues: MerchandiseMapIssue[] = [];

  const seenVariants = new Map<string, MerchandiseKey>();
  for (const [key, variantGid] of Object.entries(map)) {
    if (!requiredKeys.has(key)) {
      issues.push({
        severity: "error",
        key,
        message: `"${key}" is not a purchasable BagDirect configuration — remove it, or fix the typo (product|size|material|color).`,
      });
      continue;
    }
    if (!VARIANT_GID.test(variantGid)) {
      issues.push({
        severity: "error",
        key,
        message: `"${key}" maps to "${variantGid}", which is not a Shopify ProductVariant GID (expected gid://shopify/ProductVariant/<numeric id>).`,
      });
      continue;
    }
    const duplicate = seenVariants.get(variantGid);
    if (duplicate) {
      issues.push({
        severity: "error",
        key,
        message: `"${key}" and "${duplicate}" both map to ${variantGid} — one of them would sell the wrong item.`,
      });
      continue;
    }
    seenVariants.set(variantGid, key);
  }

  let mappedCount = 0;
  for (const { key, label } of required) {
    if (Object.prototype.hasOwnProperty.call(map, key) && VARIANT_GID.test(map[key])) mappedCount += 1;
    else issues.push({ severity: "missing", key, message: `${label} — [TO BE PROVIDED]` });
  }

  return {
    complete: mappedCount === required.length && !issues.some((i) => i.severity === "error"),
    requiredCount: required.length,
    mappedCount,
    issues,
  };
}
