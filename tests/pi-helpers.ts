import { PRODUCTS } from "@/config/products";
import { upsertActiveConfiguration } from "@/lib/data/configuration-service";
import { applyNeedProfileUpdate } from "@/lib/data/customer-need-service";
import { recordServerEvent } from "@/lib/data/event-service";
import { createOrder } from "@/lib/data/order-service";
import type { ProductConfiguration } from "@/types/commerce";

/**
 * Pricing-intelligence test fixtures (Session 12). TEST-ONLY seeds driving
 * the REAL services — nothing here bypasses a validation path, and nothing
 * here runs outside vitest.
 */

export const HERO = PRODUCTS[0];

export const config = (over: Partial<ProductConfiguration> = {}): ProductConfiguration => ({
  productId: HERO.id,
  sizeId: "m",
  materialId: "standard",
  colorId: "white",
  printOptionId: "one-color",
  quantity: 5000,
  ...over,
});

/** A session that viewed a product, saw a price, and optionally continued. */
export async function seedPricingSession(
  sessionId: string,
  opts: {
    productId?: string;
    quantity?: number;
    cart?: boolean;
    checkout?: boolean;
    purchase?: boolean;
    quote?: boolean;
    handoff?: boolean;
  } = {},
): Promise<void> {
  const productId = opts.productId ?? HERO.id;
  await recordServerEvent({ sessionId, name: "product_viewed", productId });
  if (opts.quantity !== undefined) {
    await recordServerEvent({ sessionId, name: "quantity_selected", productId, props: { quantity: opts.quantity } });
  }
  await recordServerEvent({ sessionId, name: "price_viewed", productId, props: { unitPrice: 0.42, value: 2100, currency: "USD" } });
  if (opts.cart) {
    await recordServerEvent({ sessionId, name: "add_to_cart", productId, props: { quantity: opts.quantity ?? 5000 } });
  }
  if (opts.checkout) await recordServerEvent({ sessionId, name: "checkout_started" });
  if (opts.purchase) await recordServerEvent({ sessionId, name: "purchase_completed" });
  if (opts.quote) await recordServerEvent({ sessionId, name: "quote_started", productId });
  if (opts.handoff) await recordServerEvent({ sessionId, name: "human_handoff_requested" });
}

/** An order priced at the CURRENT catalog price for its configuration. */
export async function seedOrder(
  sessionId: string,
  opts: { quantity?: number; unitPriceCents?: number; productId?: string; status?: string } = {},
) {
  const productId = opts.productId ?? HERO.id;
  const quantity = opts.quantity ?? 5000;
  // 42¢ tier at 5,000 + 5¢ one-colour print delta = 47¢ for the hero product.
  const unitPriceCents = opts.unitPriceCents ?? 47;
  return createOrder({
    sessionId,
    provider: "mock",
    currency: "USD",
    status: opts.status ?? "created",
    lines: [
      {
        productId,
        quantity,
        unitPriceCents,
        totalCents: unitPriceCents * quantity,
        title: "Custom Non-Woven Takeout Bag",
        config: config({ productId, quantity }),
      },
    ],
  });
}

export async function seedConfiguredQuantity(sessionId: string, quantity: number, productId = HERO.id) {
  return upsertActiveConfiguration({
    sessionId,
    productId,
    config: config({ productId, quantity }),
    source: "configurator",
  });
}

export async function seedRequestedQuantity(
  sessionId: string,
  quantity: number,
  source: "USER_STATED" | "AI_INFERRED" = "USER_STATED",
  extra: { businessType?: string; productInterest?: string } = {},
) {
  return applyNeedProfileUpdate(sessionId, { quantity, ...extra }, source);
}
