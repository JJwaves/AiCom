import { getCatalogProductById } from "@/lib/commerce/catalog";
import { resolveCurrentConfiguration, type CurrentConfiguration } from "@/lib/configuration/server";
import { formatDimensions } from "@/lib/format";
import type { Product, ProductConfiguration } from "@/types/commerce";

/**
 * AI-assisted add-to-cart preparation (Session 07) — the ONE server-side
 * validation path behind every AI-path cart addition:
 *
 *   addConfiguredProductToCart tool (explicit conversational intent)  ┐
 *   /api/cart/line (an "Add to cart" chip the customer tapped)        ├─► here
 *                                                                     ┘
 *
 * The cart itself stays where it always lived: client-side (bd_cart_v1),
 * fed by the SAME `useCart().addLine` call the manual configurator uses,
 * and re-quoted authoritatively by /api/checkout before any order exists.
 * This module's job is to guarantee that what enters the cart from an AI
 * conversation is EXACTLY the session's authoritative shared configuration
 * at a known revision, priced by the deterministic engine — never a
 * model-asserted config or price.
 *
 * Reprice semantics mirror /api/checkout's 409 REPRICED: callers state the
 * total the customer was last shown (`expectedTotalCents` — drift detection
 * ONLY, never authority); any difference from the fresh engine quote comes
 * back as `repriced` and requires explicit customer confirmation at the new
 * price. Stale-revision protection mirrors Session 06: `expectedRevision`
 * makes an add based on a configuration the customer has since changed
 * impossible.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/commerce/cart-line is server-only — never import it from client components");
}

/** A validated, engine-priced cart line — the exact shape `useCart().addLine` consumes (minus lineId). */
export type PreparedCartLine = {
  config: ProductConfiguration;
  unitPriceCents: number;
  totalCents: number;
  title: string;
  optionSummary: string;
};

export type PrepareCartLineResult =
  | {
      status: "prepared";
      productId: string;
      productTitle: string;
      line: PreparedCartLine;
      revision: number;
      currency: "USD" | "CAD";
      pricingStatus: "DEMO" | "LIVE";
    }
  | {
      /** Engine total differs from what the customer was last shown — confirm before adding. */
      status: "repriced";
      productId: string;
      productTitle: string;
      expectedTotalCents: number;
      currentPrice: { unitPriceCents: number; totalCents: number; currency: "USD" | "CAD"; pricingStatus: "DEMO" | "LIVE" };
      revision: number;
    }
  | { status: "stale_configuration"; current: CurrentConfiguration }
  | { status: "custom_quote_required"; productId: string; productTitle: string; message: string }
  | { status: "artwork_required"; productId: string; productTitle: string; printLabel: string; message: string }
  | { status: "not_configured"; message: string }
  | { status: "unknown_product"; message: string };

/** The manual configurator's exact option-summary format — AI lines must be indistinguishable. */
export function cartLineOptionSummary(product: Product, config: ProductConfiguration): string {
  const size = product.sizes.find((s) => s.id === config.sizeId);
  const color = product.colors.find((c) => c.id === config.colorId);
  const print = product.printOptions.find((p) => p.id === config.printOptionId);
  return [size ? `${size.label} (${formatDimensions({ ...size.dimensions, unit: size.unit })})` : "", color?.label, print?.label]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Validate the session's CURRENT shared configuration for adding to the
 * cart and price it with the engine. Reads only the authoritative row —
 * there is no input through which a caller can supply a configuration or a
 * price. Add-to-cart legality matches the manual configurator exactly:
 * custom-quote configurations and printed configurations without artwork
 * cannot become cart lines.
 */
export async function prepareCartLineFromConfiguration(opts: {
  sessionId: string;
  productId: string;
  /** Revision the caller last saw — a mismatch means the customer changed things meanwhile. */
  expectedRevision: number;
  /** Total the customer was last shown — drift detection only, never authoritative. */
  expectedTotalCents: number;
}): Promise<PrepareCartLineResult> {
  const current = await resolveCurrentConfiguration(opts.sessionId, opts.productId);
  if (current === null) {
    return { status: "not_configured", message: "This customer has not configured any product yet." };
  }
  if ("status" in current) {
    return { status: "unknown_product", message: `no product with id "${opts.productId}" exists` };
  }

  if (opts.expectedRevision !== current.revision) {
    return { status: "stale_configuration", current };
  }

  const d = current.description;
  if (current.requiresCustomQuote) {
    return {
      status: "custom_quote_required",
      productId: d.productId,
      productTitle: d.productTitle,
      message:
        "This configuration is priced through a custom quote (below-minimum quantity, custom color, or custom size) " +
        "and cannot be added to the cart — offer the custom-quote flow at /request-quote instead.",
    };
  }
  if (d.printOption.requiresArtwork && !d.hasArtwork) {
    return {
      status: "artwork_required",
      productId: d.productId,
      productTitle: d.productTitle,
      printLabel: d.printOption.label,
      message:
        `"${d.printOption.label}" needs a logo file before this can be added to the cart. ` +
        "The customer uploads it with the configurator's artwork uploader (you cannot upload it for them), " +
        "or they can switch printing to \"No logo\".",
    };
  }

  const price = current.price;
  if (!price) {
    // Defensive: unpriceable without a custom-quote flag would be a catalog bug.
    return {
      status: "custom_quote_required",
      productId: d.productId,
      productTitle: d.productTitle,
      message: "This configuration cannot be auto-priced — route it to the custom-quote flow.",
    };
  }

  if (opts.expectedTotalCents !== price.totalCents) {
    return {
      status: "repriced",
      productId: d.productId,
      productTitle: d.productTitle,
      expectedTotalCents: opts.expectedTotalCents,
      currentPrice: {
        unitPriceCents: price.unitPriceCents,
        totalCents: price.totalCents,
        currency: price.currency,
        pricingStatus: price.pricingStatus,
      },
      revision: current.revision,
    };
  }

  const product = await getCatalogProductById(d.productId);
  if (!product) return { status: "unknown_product", message: `no product with id "${d.productId}" exists` };

  return {
    status: "prepared",
    productId: product.id,
    productTitle: product.title,
    line: {
      config: current.config,
      unitPriceCents: price.unitPriceCents,
      totalCents: price.totalCents,
      title: product.title,
      optionSummary: cartLineOptionSummary(product, current.config),
    },
    revision: current.revision,
    currency: price.currency,
    pricingStatus: price.pricingStatus,
  };
}
