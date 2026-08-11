import { z } from "zod";
import { getCatalogProductById } from "@/lib/commerce/catalog";
import { calculatePrice } from "@/modules/pricing";
import { configurationSchema } from "@/lib/validation/checkout";
import type { Product } from "@/types/commerce";
import type { ToolDefinition } from "./types";

/**
 * Pricing tools — thin, read-only delegates to the deterministic Pricing
 * Engine (modules/pricing), the sole pricing authority. The model supplies a
 * configuration; the engine supplies every number. There is no input through
 * which the AI could assert a price, discount, floor, or margin.
 *
 * Output is the SELL side only. calculatePrice() also computes costs,
 * margins and price floors — those are business-internal, never enter
 * prompts, and the zod output schemas here make returning them structurally
 * impossible.
 */

/** Price-relevant configuration — artwork metadata is irrelevant to price and excluded. */
const priceConfigSchema = configurationSchema.omit({ artwork: true });

const sellPriceSchema = z.object({
  ok: z.literal(true),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
  totalPriceCents: z.number().int(),
  currency: z.enum(["USD", "CAD"]),
  tier: z.object({ minQty: z.number().int(), unitPriceCents: z.number().int() }),
  /** Savings vs the smallest-quantity tier, fraction 0–1. */
  savingsPct: z.number(),
  /** DEMO pricing must be presented as demo pricing. */
  pricingStatus: z.enum(["DEMO", "LIVE"]),
});

const priceRejectionSchema = z.object({
  ok: z.literal(false),
  reason: z.enum(["unknown_product", "requires_custom_quote", "unpriceable"]),
  message: z.string(),
});

const calculatePriceOutput = z.union([sellPriceSchema, priceRejectionSchema]);

function priceOne(product: Product, config: z.infer<typeof priceConfigSchema>): z.infer<typeof calculatePriceOutput> {
  const result = calculatePrice(product, { ...config, artwork: null });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      message:
        result.reason === "requires_custom_quote"
          ? "This configuration (custom color, custom dimensions, or below-minimum quantity) is priced through the custom-quote flow — offer to collect quote details."
          : "This configuration cannot be priced — check that the size/material/print ids exist and the quantity meets a tier.",
    };
  }
  return {
    ok: true,
    quantity: config.quantity,
    unitPriceCents: result.unitPriceCents,
    totalPriceCents: result.totalPriceCents,
    currency: result.currency,
    tier: { minQty: result.tier.minQty, unitPriceCents: result.tier.unitPriceCents },
    savingsPct: result.savingsPct,
    pricingStatus: product.pricingStatus,
  };
}

export const calculatePriceTool: ToolDefinition<z.infer<typeof priceConfigSchema>, z.infer<typeof calculatePriceOutput>> = {
  name: "calculatePrice",
  description:
    "Compute the exact price for one product configuration (productId, sizeId, materialId, colorId, printOptionId, quantity) " +
    "using the deterministic pricing engine. This is the ONLY source of prices — never state a price that did not come from " +
    "this tool, and never promise discounts. ok:false/requires_custom_quote means the configuration is quoted manually.",
  permission: "READ",
  inputSchema: priceConfigSchema,
  outputSchema: calculatePriceOutput,
  async execute(input) {
    const product = await getCatalogProductById(input.productId);
    if (!product) {
      return { ok: false as const, reason: "unknown_product" as const, message: `no product with id ${input.productId}` };
    }
    return priceOne(product, input);
  },
};

const quantityPricingInput = z.object({
  productId: z.string().trim().min(1).max(100),
  /** Defaults to the product's quantity presets. */
  quantities: z.array(z.number().int().positive().max(1_000_000)).min(1).max(12).optional(),
  sizeId: z.string().trim().min(1).max(100).optional(),
  materialId: z.string().trim().min(1).max(100).optional(),
  printOptionId: z.enum(["none", "one-color", "two-color", "full-custom"]).optional(),
});

const quantityPricingOutput = z.object({
  found: z.boolean(),
  message: z.string().optional(),
  pricingStatus: z.enum(["DEMO", "LIVE"]).optional(),
  currency: z.enum(["USD", "CAD"]).optional(),
  rows: z.array(
    z.object({
      quantity: z.number().int(),
      result: calculatePriceOutput,
    }),
  ),
});

export const getQuantityPricingTool: ToolDefinition<z.infer<typeof quantityPricingInput>, z.infer<typeof quantityPricingOutput>> = {
  name: "getQuantityPricing",
  description:
    "Volume-pricing table for a product: engine-computed unit/total price at several quantities (defaults to the product's " +
    "quantity presets; first size/material and no printing unless specified). Use it to show how unit price drops with volume.",
  permission: "READ",
  inputSchema: quantityPricingInput,
  outputSchema: quantityPricingOutput,
  async execute(input) {
    const product = await getCatalogProductById(input.productId);
    if (!product) return { found: false, message: `no product with id ${input.productId}`, rows: [] };

    const quantities = input.quantities ?? product.quantityPresets.slice(0, 12);
    const base = {
      productId: product.id,
      sizeId: input.sizeId ?? product.sizes[0]?.id ?? "",
      materialId: input.materialId ?? product.materials[0]?.id ?? "",
      colorId: product.colors.find((c) => !c.custom)?.id ?? "",
      printOptionId: input.printOptionId ?? ("none" as const),
    };
    return {
      found: true,
      pricingStatus: product.pricingStatus,
      currency: product.currency,
      rows: quantities.map((quantity) => ({
        quantity,
        result: priceOne(product, { ...base, quantity, customDimensions: null }),
      })),
    };
  },
};
