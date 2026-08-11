import { z } from "zod";
import { getCatalogProductById } from "@/lib/commerce/catalog";
import { recordServerEvent } from "@/lib/data/event-service";
import { baseUnitPriceCents } from "@/modules/pricing";
import { aiLog } from "../log";
import type { ToolDefinition } from "./types";

/**
 * recommendProduct — makes a product recommendation STRUCTURED instead of
 * prose the frontend would have to parse (Session 05 spec §17). The tool
 * validates the product against the real catalog: a hallucinated productId
 * comes back ok:false, so the model can only ever register recommendations
 * for products that exist. The agent layer lifts the last successful call
 * into SalesAgentResult.recommendedProductId and the tool records the
 * `ai_product_recommended` first-party event (non-fatal, like all
 * analytics writes).
 */

const recommendInput = z.object({
  productId: z.string().trim().min(1).max(100),
  /** Customer-relevant justification — shown to a human reviewing the conversation, never invented capability claims. */
  reason: z.string().trim().min(1).max(300),
});

const recommendOutput = z.union([
  z.object({
    ok: z.literal(true),
    productId: z.string(),
    slug: z.string(),
    title: z.string(),
    positioning: z.string(),
    minQuantity: z.number().int(),
    startingAtUnitPriceCents: z.number().int(),
    currency: z.enum(["USD", "CAD"]),
    pricingStatus: z.enum(["DEMO", "LIVE"]),
    /** Storefront path the customer can be pointed to. */
    configuratorPath: z.string(),
  }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);

export const recommendProductTool: ToolDefinition<z.infer<typeof recommendInput>, z.infer<typeof recommendOutput>> = {
  name: "recommendProduct",
  description:
    "Register your product recommendation for this customer. Only productIds returned by searchProducts/getProductDetails " +
    "are valid — unknown ids are rejected. Call it when you have settled on a product to suggest; include a short reason " +
    "grounded in the customer's stated needs.",
  permission: "READ",
  inputSchema: recommendInput,
  outputSchema: recommendOutput,
  async execute(input, ctx) {
    const product = await getCatalogProductById(input.productId);
    if (!product) {
      return {
        ok: false as const,
        message: `no product with id "${input.productId}" exists — recommend only products returned by searchProducts`,
      };
    }
    if (ctx.sessionId) {
      try {
        await recordServerEvent({
          sessionId: ctx.sessionId,
          name: "ai_product_recommended",
          productId: product.id,
          conversationId: ctx.conversationId ?? null,
          props: {},
        });
      } catch (err) {
        aiLog("event_write_failed", {
          event: "ai_product_recommended",
          requestId: ctx.requestId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return {
      ok: true as const,
      productId: product.id,
      slug: product.slug,
      title: product.title,
      positioning: product.positioning,
      minQuantity: product.minQuantity,
      startingAtUnitPriceCents: baseUnitPriceCents(product),
      currency: product.currency,
      pricingStatus: product.pricingStatus,
      configuratorPath: `/products/${product.slug}`,
    };
  },
};
