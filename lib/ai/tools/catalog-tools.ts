import { z } from "zod";
import { getCatalogProduct, getCatalogProductById, listCatalogProducts } from "@/lib/commerce/catalog";
import { baseUnitPriceCents } from "@/modules/pricing";
import type { Product } from "@/types/commerce";
import type { ToolDefinition } from "./types";

/**
 * Product tools — read-only views over the EXISTING catalog facade
 * (lib/commerce/catalog.ts). No second AI product database; the provider
 * switch switches these tools too. Outputs expose only the fields AI Sales
 * needs (public storefront data — never cost/margin figures, no image
 * dumps), keeping prompts small.
 */

const dimensionsSchema = z.object({ width: z.number(), height: z.number(), gusset: z.number() });

const productSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  positioning: z.string(),
  minQuantity: z.number().int(),
  /** Lowest-tier base unit price (public "starting at" figure). */
  startingAtUnitPriceCents: z.number().int(),
  currency: z.enum(["USD", "CAD"]),
  /** "DEMO" prices must be presented as demo pricing, never as final. */
  pricingStatus: z.enum(["DEMO", "LIVE"]),
  hero: z.boolean(),
});

const searchProductsOutput = z.object({
  products: z.array(productSummarySchema),
  totalCatalogSize: z.number().int(),
});

function summarize(p: Product): z.infer<typeof productSummarySchema> {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    positioning: p.positioning,
    minQuantity: p.minQuantity,
    startingAtUnitPriceCents: baseUnitPriceCents(p),
    currency: p.currency,
    pricingStatus: p.pricingStatus,
    hero: p.hero === true,
  };
}

const searchProductsInput = z.object({
  query: z.string().trim().max(200).optional(),
  maxResults: z.number().int().min(1).max(10).default(5),
});

export const searchProductsTool: ToolDefinition<
  z.infer<typeof searchProductsInput>,
  z.infer<typeof searchProductsOutput>
> = {
  name: "searchProducts",
  description:
    "Search the product catalog by free-text query over title, positioning and description. " +
    "Omit the query to list the catalog. Returns compact summaries; use getProductDetails for options and tiers.",
  permission: "READ",
  inputSchema: searchProductsInput,
  outputSchema: searchProductsOutput,
  async execute(input) {
    const all = await listCatalogProducts();
    const q = input.query?.toLowerCase();
    const matches = !q
      ? all
      : all.filter((p) => [p.title, p.positioning, p.description].some((s) => s.toLowerCase().includes(q)));
    return {
      products: matches.slice(0, input.maxResults).map(summarize),
      totalCatalogSize: all.length,
    };
  },
};

const productDetailsOutput = z.object({
  found: z.literal(true),
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  positioning: z.string(),
  description: z.string(),
  minQuantity: z.number().int(),
  quantityPresets: z.array(z.number().int()),
  currency: z.enum(["USD", "CAD"]),
  pricingStatus: z.enum(["DEMO", "LIVE"]),
  sizes: z.array(z.object({ id: z.string(), label: z.string(), dimensionsInches: dimensionsSchema })),
  materials: z.array(
    z.object({ id: z.string(), label: z.string(), gsm: z.number().nullable(), priceDeltaCents: z.number().int() }),
  ),
  colors: z.array(z.object({ id: z.string(), label: z.string(), custom: z.boolean() })),
  /** confirmed:false handles are NOT promisable — route those requests to the custom-quote flow. */
  handles: z.array(z.object({ id: z.string(), label: z.string(), confirmed: z.boolean() })),
  printOptions: z.array(
    z.object({
      id: z.enum(["none", "one-color", "two-color", "full-custom"]),
      label: z.string(),
      description: z.string(),
      priceDeltaCents: z.number().int(),
      requiresArtwork: z.boolean(),
    }),
  ),
  /** Public volume tiers (base price before option deltas). */
  pricingTiers: z.array(z.object({ minQty: z.number().int(), unitPriceCents: z.number().int() })),
});

const getProductDetailsOutput = z.union([productDetailsOutput, z.object({ found: z.literal(false), message: z.string() })]);

export const getProductDetailsTool: ToolDefinition<
  { productId?: string; slug?: string },
  z.infer<typeof getProductDetailsOutput>
> = {
  name: "getProductDetails",
  description:
    "Full public details for one product (by productId or slug): sizes, materials, colors, handles " +
    "(only confirmed:true handles may be promised — others require a custom quote), print options, volume tiers. " +
    "Prices are per-unit cents; pricingStatus DEMO means demo pricing that must be labeled as such.",
  permission: "READ",
  inputSchema: z
    .object({
      productId: z.string().trim().min(1).max(100).optional(),
      slug: z.string().trim().min(1).max(100).optional(),
    })
    .refine((v) => v.productId !== undefined || v.slug !== undefined, {
      message: "provide productId or slug",
    }),
  outputSchema: getProductDetailsOutput,
  async execute(input) {
    const product = input.productId
      ? await getCatalogProductById(input.productId)
      : await getCatalogProduct(input.slug as string);
    if (!product) {
      return { found: false as const, message: `no product matches ${input.productId ?? input.slug}` };
    }
    return {
      found: true as const,
      id: product.id,
      slug: product.slug,
      title: product.title,
      positioning: product.positioning,
      description: product.description,
      minQuantity: product.minQuantity,
      quantityPresets: product.quantityPresets,
      currency: product.currency,
      pricingStatus: product.pricingStatus,
      sizes: product.sizes.map((s) => ({ id: s.id, label: s.label, dimensionsInches: s.dimensions })),
      materials: product.materials.map((m) => ({ id: m.id, label: m.label, gsm: m.gsm, priceDeltaCents: m.priceDeltaCents })),
      colors: product.colors.map((c) => ({ id: c.id, label: c.label, custom: c.custom === true })),
      handles: product.handles.map((h) => ({ id: h.id, label: h.label, confirmed: h.confirmed })),
      printOptions: product.printOptions.map((p) => ({
        id: p.id,
        label: p.label,
        description: p.description,
        priceDeltaCents: p.priceDeltaCents,
        requiresArtwork: p.requiresArtwork,
      })),
      pricingTiers: product.pricingTiers.map((t) => ({ minQty: t.minQty, unitPriceCents: t.unitPriceCents })),
    };
  },
};
