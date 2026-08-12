import { z } from "zod";
import { prepareCartLineFromConfiguration } from "@/lib/commerce/cart-line";
import { getCatalogProductById } from "@/lib/commerce/catalog";
import { resolveCurrentConfiguration } from "@/lib/configuration/server";
import { markConversationOutcomeForSession } from "@/lib/data/conversation-service";
import { recordServerEvent, type PlatformEventName } from "@/lib/data/event-service";
import { quoteConfiguration, requiresCustomQuote } from "@/modules/pricing";
import type { ProductConfiguration } from "@/types/commerce";
import { aiLog } from "../log";
import type { CartSnapshot, ToolDefinition, ToolExecutionContext } from "./types";

/**
 * Cart & checkout tools (Session 07) — the AI's ONLY channel into commerce,
 * and it is a channel of INTENT, never authority:
 *
 * - The model can request that the session's AUTHORITATIVE configuration
 *   (at a stated revision + at the price the customer was shown) become a
 *   cart line. The server loads, validates, and prices everything; there is
 *   no input through which the model can assert a configuration, a price, a
 *   discount, or a checkout URL — the schemas are STRICT, so injected keys
 *   fail loudly.
 * - The cart itself lives in the customer's browser. Prepared lines travel
 *   to the client as server-validated payloads (the S06 pattern); the
 *   client adds them through the SAME useCart().addLine the manual
 *   configurator uses; /api/checkout re-quotes everything before any order
 *   exists. Payment never comes near this file: checkout is a handoff to
 *   the existing provider flow, and no payment-capable tool exists.
 * - Explicit customer intent is REQUIRED for addConfiguredProductToCart and
 *   startCheckout (prompt contract, exercised by the intent tests): "add it
 *   to my cart" / "checkout" count; "looks good" / "how much is it?" never
 *   do. suggestAddToCart is the no-side-effect alternative that renders an
 *   Add-to-cart button the customer taps.
 */

const pricePairSchema = z.object({
  unitPriceCents: z.number().int(),
  totalCents: z.number().int(),
  currency: z.enum(["USD", "CAD"]),
  /** DEMO pricing must be presented as demo pricing. */
  pricingStatus: z.enum(["DEMO", "LIVE"]),
});

/** The validated line the client will add — customer-visible fields only (no cost/margin/floor path exists). */
const preparedLineSchema = z.object({
  config: z.custom<ProductConfiguration>(),
  unitPriceCents: z.number().int(),
  totalCents: z.number().int(),
  title: z.string(),
  optionSummary: z.string(),
});

async function emitCartEvent(
  ctx: ToolExecutionContext,
  name: Extract<PlatformEventName, "ai_add_to_cart_proposed" | "ai_add_to_cart_requested" | "ai_checkout_requested">,
  productId: string | null,
  props: Record<string, string | number | boolean | null>,
): Promise<void> {
  if (!ctx.sessionId) return;
  try {
    await recordServerEvent({
      sessionId: ctx.sessionId,
      name,
      productId,
      conversationId: ctx.conversationId ?? null,
      props,
    });
  } catch (err) {
    aiLog("event_write_failed", { event: name, requestId: ctx.requestId, error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------
// addConfiguredProductToCart
// ---------------------------------------------------------------------------

/**
 * STRICT: expectedRevision and expectedTotalCents are the model's statement
 * of what the CUSTOMER was last shown — pure drift detection, mirrored from
 * /api/checkout's proposed prices. They confer no authority: the server
 * re-reads and re-prices everything, and any unexpected key (unitPrice,
 * discount, config, url…) is a loud validation error.
 */
const addToCartInput = z.strictObject({
  productId: z.string().trim().min(1).max(100),
  /** The configuration revision you last read (getCurrentConfiguration). */
  expectedRevision: z.number().int().nonnegative(),
  /** The engine total the customer was last shown, in cents. */
  expectedTotalCents: z.number().int().positive(),
});

const addToCartOutput = z.union([
  z.object({
    status: z.literal("added"),
    productId: z.string(),
    productTitle: z.string(),
    line: preparedLineSchema,
    revision: z.number().int(),
    price: pricePairSchema,
    message: z.string(),
  }),
  z.object({
    status: z.literal("price_changed"),
    productId: z.string(),
    productTitle: z.string(),
    /** What the customer was last shown (echoed from your call). */
    previousTotalCents: z.number().int(),
    /** The validated CURRENT price — confirm with the customer before retrying with it. */
    currentPrice: pricePairSchema,
    revision: z.number().int(),
    message: z.string(),
  }),
  z.object({
    status: z.literal("stale_configuration"),
    message: z.string(),
    /** What the configuration ACTUALLY is now — reconcile with the customer against this. */
    configuration: z.object({
      productId: z.string(),
      productTitle: z.string(),
      quantity: z.number().int(),
      revision: z.number().int(),
      requiresCustomQuote: z.boolean(),
      price: pricePairSchema.nullable(),
    }),
  }),
  z.object({ status: z.literal("custom_quote_required"), message: z.string() }),
  z.object({ status: z.literal("artwork_required"), printLabel: z.string(), message: z.string() }),
  z.object({ status: z.literal("not_configured"), message: z.string() }),
  z.object({ status: z.literal("unknown_product"), message: z.string() }),
]);

export const addConfiguredProductToCartTool: ToolDefinition<
  z.infer<typeof addToCartInput>,
  z.infer<typeof addToCartOutput>
> = {
  name: "addConfiguredProductToCart",
  description:
    "Add the customer's CURRENT configuration to their cart. Call this ONLY when the customer explicitly asked for it " +
    "in their own words (\"add it to my cart\", \"yes, add it\", \"let's buy this\") — NEVER infer it from interest, " +
    "approval (\"looks good\"), or price questions; when unsure, ask or use suggestAddToCart for a button instead. " +
    "Read getCurrentConfiguration first: pass its revision as expectedRevision and its engine total as " +
    "expectedTotalCents (the price the customer was shown). The server re-validates and re-prices the authoritative " +
    "configuration: price_changed means the price moved — tell the customer the new price and only retry after they " +
    "confirm it; stale_configuration means they changed the configuration meanwhile — reconcile first. After a " +
    "successful add, confirm what was added and its price; do NOT start checkout unless they also asked for that.",
  permission: "COMMERCE",
  inputSchema: addToCartInput,
  outputSchema: addToCartOutput,
  async execute(input, ctx) {
    if (!ctx.sessionId) throw new Error("addConfiguredProductToCart requires a session-scoped ToolExecutionContext");
    const result = await prepareCartLineFromConfiguration({
      sessionId: ctx.sessionId,
      productId: input.productId,
      expectedRevision: input.expectedRevision,
      expectedTotalCents: input.expectedTotalCents,
    });
    await emitCartEvent(ctx, "ai_add_to_cart_requested", input.productId, {
      via: "conversation",
      outcome: result.status,
    });

    switch (result.status) {
      case "prepared": {
        try {
          await markConversationOutcomeForSession(ctx.sessionId, "cart_added");
        } catch (err) {
          aiLog("outcome_stamp_failed", { requestId: ctx.requestId, error: err instanceof Error ? err.message : String(err) });
        }
        return {
          status: "added" as const,
          productId: result.productId,
          productTitle: result.productTitle,
          line: result.line,
          revision: result.revision,
          price: {
            unitPriceCents: result.line.unitPriceCents,
            totalCents: result.line.totalCents,
            currency: result.currency,
            pricingStatus: result.pricingStatus,
          },
          message:
            "The item is in the customer's cart at the server-validated price. Confirm what was added; " +
            "offer checkout only if they ask (or already asked in the same message).",
        };
      }
      case "repriced":
        return {
          status: "price_changed" as const,
          productId: result.productId,
          productTitle: result.productTitle,
          previousTotalCents: result.expectedTotalCents,
          currentPrice: result.currentPrice,
          revision: result.revision,
          message:
            "The current price differs from what the customer was shown. Nothing was added. Tell them the updated " +
            "price and ask whether to continue; if they confirm, call again with expectedTotalCents set to the current total.",
        };
      case "stale_configuration": {
        const d = result.current.description;
        return {
          status: "stale_configuration" as const,
          message:
            "The configuration changed since you last read it (the customer likely edited it manually). Nothing was " +
            "added. Reconcile with the configuration returned here, confirm with the customer, then retry with its revision.",
          configuration: {
            productId: d.productId,
            productTitle: d.productTitle,
            quantity: d.quantity,
            revision: result.current.revision,
            requiresCustomQuote: result.current.requiresCustomQuote,
            price: result.current.price
              ? {
                  unitPriceCents: result.current.price.unitPriceCents,
                  totalCents: result.current.price.totalCents,
                  currency: result.current.price.currency,
                  pricingStatus: result.current.price.pricingStatus,
                }
              : null,
          },
        };
      }
      case "custom_quote_required":
        return { status: "custom_quote_required" as const, message: result.message };
      case "artwork_required":
        return { status: "artwork_required" as const, printLabel: result.printLabel, message: result.message };
      case "not_configured":
        return { status: "not_configured" as const, message: result.message };
      case "unknown_product":
        return { status: "unknown_product" as const, message: result.message };
    }
  },
};

// ---------------------------------------------------------------------------
// suggestAddToCart
// ---------------------------------------------------------------------------

const suggestAddInput = z.strictObject({
  productId: z.string().trim().min(1).max(100),
  /** Short button label the customer will see, e.g. "Add 10,000 to cart". */
  label: z.string().trim().min(1).max(60),
});

const suggestAddOutput = z.union([
  z.object({
    status: z.literal("proposed"),
    label: z.string(),
    productId: z.string(),
    productTitle: z.string(),
    /** Revision + price the button is based on — the tap re-validates server-side anyway. */
    basedOnRevision: z.number().int(),
    price: pricePairSchema,
    summary: z.string(),
  }),
  z.object({ status: z.literal("custom_quote_required"), message: z.string() }),
  z.object({ status: z.literal("artwork_required"), printLabel: z.string(), message: z.string() }),
  z.object({ status: z.literal("not_configured"), message: z.string() }),
  z.object({ status: z.literal("unknown_product"), message: z.string() }),
]);

export const suggestAddToCartTool: ToolDefinition<z.infer<typeof suggestAddInput>, z.infer<typeof suggestAddOutput>> = {
  name: "suggestAddToCart",
  description:
    "OFFER adding the customer's current configuration to the cart WITHOUT doing it — the customer sees an " +
    "\"Add to cart\" button and decides. Use when the configuration is complete and adding is a natural next step " +
    "the customer has NOT explicitly requested yet. The button carries the validated current price; a tap is " +
    "re-validated server-side against the then-current configuration. Nothing changes until the customer taps.",
  permission: "READ",
  inputSchema: suggestAddInput,
  outputSchema: suggestAddOutput,
  async execute(input, ctx) {
    if (!ctx.sessionId) throw new Error("suggestAddToCart requires a session-scoped ToolExecutionContext");
    const current = await resolveCurrentConfiguration(ctx.sessionId, input.productId);
    if (current === null) {
      return { status: "not_configured" as const, message: "This customer has not configured any product yet." };
    }
    if ("status" in current) {
      return { status: "unknown_product" as const, message: `no product with id "${input.productId}" exists` };
    }
    const d = current.description;
    if (current.requiresCustomQuote) {
      return {
        status: "custom_quote_required" as const,
        message: "This configuration is priced through a custom quote and cannot be added to the cart — offer /request-quote.",
      };
    }
    if (d.printOption.requiresArtwork && !d.hasArtwork) {
      return {
        status: "artwork_required" as const,
        printLabel: d.printOption.label,
        message: `"${d.printOption.label}" needs a logo upload (configurator uploader) before adding to the cart.`,
      };
    }
    const price = current.price;
    if (!price) {
      return {
        status: "custom_quote_required" as const,
        message: "This configuration cannot be auto-priced — route it to the custom-quote flow.",
      };
    }
    await emitCartEvent(ctx, "ai_add_to_cart_proposed", d.productId, { revision: current.revision });
    return {
      status: "proposed" as const,
      label: input.label,
      productId: d.productId,
      productTitle: d.productTitle,
      basedOnRevision: current.revision,
      price: {
        unitPriceCents: price.unitPriceCents,
        totalCents: price.totalCents,
        currency: price.currency,
        pricingStatus: price.pricingStatus,
      },
      summary: `${d.size.label} · ${d.color.label} · ${d.printOption.label} · ${d.quantity.toLocaleString("en-US")} units`,
    };
  },
};

// ---------------------------------------------------------------------------
// getCartSummary
// ---------------------------------------------------------------------------

const cartSummaryInput = z.strictObject({});

const cartSummaryLineSchema = z.object({
  title: z.string(),
  optionSummary: z.string(),
  quantity: z.number().int(),
  /** Engine-computed current prices — null when the line needs a custom quote. */
  unitPriceCents: z.number().int().nullable(),
  totalCents: z.number().int().nullable(),
  hasArtwork: z.boolean(),
  issue: z.string().nullable(),
});

const cartSummaryOutput = z.union([
  z.object({
    available: z.literal(true),
    lines: z.array(cartSummaryLineSchema),
    lineCount: z.number().int(),
    /** Sum of priceable lines, current engine prices. */
    subtotalCents: z.number().int(),
    currency: z.enum(["USD", "CAD"]).nullable(),
    pricingStatus: z.enum(["DEMO", "LIVE"]).nullable(),
    /** True when the cart has ≥1 line and no line has an issue. */
    checkoutReady: z.boolean(),
  }),
  z.object({ available: z.literal(false), message: z.string() }),
]);

/** Engine-priced view of the client-reported cart — shared by getCartSummary and startCheckout. */
async function summarizeCartSnapshot(snapshot: CartSnapshot) {
  const lines: z.infer<typeof cartSummaryLineSchema>[] = [];
  let subtotalCents = 0;
  let currency: "USD" | "CAD" | null = null;
  let pricingStatus: "DEMO" | "LIVE" | null = null;
  let blocked = false;

  for (const line of snapshot.lines) {
    const product = await getCatalogProductById(line.productId);
    if (!product) {
      blocked = true;
      lines.push({
        title: line.productId,
        optionSummary: "",
        quantity: line.quantity,
        unitPriceCents: null,
        totalCents: null,
        hasArtwork: line.hasArtwork,
        issue: "unknown product — ask the customer to review this cart line on the cart page",
      });
      continue;
    }
    const config: ProductConfiguration = {
      productId: product.id,
      sizeId: line.sizeId,
      materialId: line.materialId,
      colorId: line.colorId,
      printOptionId: line.printOptionId,
      quantity: line.quantity,
      artwork: null,
    };
    const size = product.sizes.find((s) => s.id === line.sizeId);
    const color = product.colors.find((c) => c.id === line.colorId);
    const print = product.printOptions.find((p) => p.id === line.printOptionId);
    const optionSummary = [size?.label, color?.label, print?.label].filter(Boolean).join(" · ");

    let issue: string | null = null;
    let unitPriceCents: number | null = null;
    let totalCents: number | null = null;
    if (requiresCustomQuote(product, config)) {
      issue = "needs a custom quote — cannot check out directly";
    } else {
      const quote = quoteConfiguration(product, config);
      if (!quote) {
        issue = "cannot be priced — needs review";
      } else {
        unitPriceCents = quote.unitPriceCents;
        totalCents = quote.totalCents;
        subtotalCents += quote.totalCents;
        currency = currency ?? quote.currency;
        pricingStatus = pricingStatus ?? product.pricingStatus;
      }
    }
    if (!issue && print?.requiresArtwork && !line.hasArtwork) {
      issue = "logo printing selected but no artwork uploaded";
    }
    if (issue) blocked = true;
    lines.push({
      title: product.title,
      optionSummary,
      quantity: line.quantity,
      unitPriceCents,
      totalCents,
      hasArtwork: line.hasArtwork,
      issue,
    });
  }

  return {
    lines,
    lineCount: lines.length,
    subtotalCents,
    currency,
    pricingStatus,
    checkoutReady: lines.length > 0 && !blocked,
  };
}

export const getCartSummaryTool: ToolDefinition<z.infer<typeof cartSummaryInput>, z.infer<typeof cartSummaryOutput>> = {
  name: "getCartSummary",
  description:
    "Read the customer's current cart (lines, quantities, current engine prices, subtotal, checkout readiness). " +
    "Use it to answer \"what's in my cart?\" / \"did you add it?\" and BEFORE offering checkout. Prices shown are " +
    "current engine prices; checkout itself re-validates everything. The cart lives in the customer's browser — " +
    "when it isn't available in this conversation, say so instead of guessing.",
  permission: "READ",
  inputSchema: cartSummaryInput,
  outputSchema: cartSummaryOutput,
  async execute(_input, ctx) {
    if (!ctx.cartSnapshot) {
      return {
        available: false as const,
        message:
          "The cart contents were not reported in this conversation. The customer can see their cart at /cart; " +
          "do not guess what is in it.",
      };
    }
    const summary = await summarizeCartSnapshot(ctx.cartSnapshot);
    return { available: true as const, ...summary };
  },
};

// ---------------------------------------------------------------------------
// startCheckout
// ---------------------------------------------------------------------------

/** No inputs AT ALL — the model cannot construct checkout contents, amounts, or destinations. */
const startCheckoutInput = z.strictObject({});

const startCheckoutOutput = z.union([
  z.object({
    status: z.literal("ready"),
    lineCount: z.number().int(),
    subtotalCents: z.number().int(),
    currency: z.enum(["USD", "CAD"]),
    pricingStatus: z.enum(["DEMO", "LIVE"]),
    message: z.string(),
  }),
  z.object({ status: z.literal("cart_empty"), message: z.string() }),
  z.object({ status: z.literal("blocked"), issues: z.array(z.string()), message: z.string() }),
  z.object({ status: z.literal("cart_unavailable"), message: z.string() }),
]);

export const startCheckoutTool: ToolDefinition<z.infer<typeof startCheckoutInput>, z.infer<typeof startCheckoutOutput>> = {
  name: "startCheckout",
  description:
    "Hand the customer to the standard secure checkout for their EXISTING cart. Call this ONLY when the customer " +
    "explicitly asked to check out / pay / continue to checkout — never because a configuration or cart merely exists. " +
    "It validates cart readiness and surfaces a \"Continue to checkout\" action the CUSTOMER confirms; the checkout " +
    "destination and every price come from the server-side commerce provider — you cannot set, skip, or alter prices, " +
    "shipping, taxes, or payment (say shipping/taxes are calculated at checkout if asked). If the cart is empty or " +
    "blocked, explain what is missing instead.",
  permission: "COMMERCE",
  inputSchema: startCheckoutInput,
  outputSchema: startCheckoutOutput,
  async execute(_input, ctx) {
    if (!ctx.sessionId) throw new Error("startCheckout requires a session-scoped ToolExecutionContext");
    if (!ctx.cartSnapshot) {
      await emitCartEvent(ctx, "ai_checkout_requested", null, { outcome: "cart_unavailable" });
      return {
        status: "cart_unavailable" as const,
        message:
          "The cart contents were not reported in this conversation — direct the customer to /cart to check out manually.",
      };
    }
    const summary = await summarizeCartSnapshot(ctx.cartSnapshot);
    if (summary.lineCount === 0) {
      await emitCartEvent(ctx, "ai_checkout_requested", null, { outcome: "cart_empty" });
      return {
        status: "cart_empty" as const,
        message: "The cart is empty — add the configured product first (with the customer's explicit go-ahead).",
      };
    }
    const issues = summary.lines.filter((l) => l.issue !== null).map((l) => `${l.title}: ${l.issue}`);
    if (issues.length > 0 || summary.currency === null) {
      await emitCartEvent(ctx, "ai_checkout_requested", null, { outcome: "blocked", issues: issues.length });
      return {
        status: "blocked" as const,
        issues,
        message: "The cart has lines that cannot be checked out yet — explain the issues and how to resolve them.",
      };
    }
    await emitCartEvent(ctx, "ai_checkout_requested", null, {
      outcome: "ready",
      lines: summary.lineCount,
      subtotalCents: summary.subtotalCents,
    });
    return {
      status: "ready" as const,
      lineCount: summary.lineCount,
      subtotalCents: summary.subtotalCents,
      currency: summary.currency,
      pricingStatus: summary.pricingStatus ?? "DEMO",
      message:
        "A \"Continue to checkout\" action is now shown to the customer — they confirm it to enter the standard " +
        "secure checkout. Tell them the subtotal (label demo pricing as such) and that shipping/taxes are calculated " +
        "at checkout. Do not promise delivery dates.",
    };
  },
};
