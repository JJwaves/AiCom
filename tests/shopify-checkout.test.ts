import { describe, expect, it } from "vitest";
import { LAUNCH_PRODUCTS, PRODUCTS } from "@/config/products";
import {
  buildDraftOrderInput,
  buildLineAttributes,
  centsToDecimalString,
  createShopifyProvider,
  decimalStringToCents,
  ShopifyCheckoutError,
  verifyDraftOrderPricing,
} from "@/lib/commerce/shopify";
import type { Cart, CartLine } from "@/types/commerce";
import { FLAT_US_SHIPPING_CENTS, FLAT_US_SHIPPING_COPY } from "@/config/shipping";
import { cartSubtotalCents, createFakeShopifyTransport, TEST_CREDENTIALS, testMerchandiseMap } from "./shopify-helpers";

/**
 * Production Launch Session 02 §4, §9–§12, §54 — real Shopify checkout.
 *
 * Every test runs against a FAKE transport. No network call is made, no
 * credential exists, and the fake echoes back exactly the prices it was
 * given — so a price mismatch only appears when a test deliberately
 * introduces one.
 */

const product = PRODUCTS[0]; // Product #1 — Large × 5,000 → 19¢/unit

function line(overrides: Partial<CartLine> = {}, config: Record<string, unknown> = {}): CartLine {
  return {
    lineId: "L1",
    config: {
      productId: product.id,
      sizeId: "l",
      materialId: "insulated",
      colorId: "black",
      printOptionId: "full-custom",
      quantity: 5000,
      artwork: null,
      ...config,
    },
    unitPriceCents: 19,
    totalCents: 19 * 5000,
    title: product.title,
    optionSummary: "Large · Black · Custom logo / artwork printing",
    ...overrides,
  } as CartLine;
}

const cart = (lines: CartLine[] = [line()]): Cart => ({ currency: "USD", lines });

/** A complete mapping, injected — production always reads config/shopify.ts. */
const MAP = testMerchandiseMap();

describe("money conversion is exact — never floating point", () => {
  it("converts cents to Shopify's decimal string", () => {
    expect(centsToDecimalString(42)).toBe("0.42");
    expect(centsToDecimalString(210000)).toBe("2100.00");
    expect(centsToDecimalString(5)).toBe("0.05");
    expect(centsToDecimalString(0)).toBe("0.00");
  });

  it("refuses to send a fractional or negative amount to Shopify", () => {
    expect(() => centsToDecimalString(42.5)).toThrow();
    expect(() => centsToDecimalString(-1)).toThrow();
  });

  it("parses Shopify decimals back exactly, and refuses anything odd", () => {
    expect(decimalStringToCents("0.42")).toBe(42);
    expect(decimalStringToCents("2100.00")).toBe(210000);
    expect(decimalStringToCents("0.29")).toBe(29); // parseFloat("0.29")*100 = 28.999…
    expect(decimalStringToCents("2100")).toBe(210000);
    expect(decimalStringToCents("1.234")).toBeNull();
    expect(decimalStringToCents("abc")).toBeNull();
  });
});

describe("draft-order input", () => {
  it("sends the BagDirect engine price as an explicit priceOverride", () => {
    const input = buildDraftOrderInput(cart(), {}, {}, MAP);
    expect(input.lineItems).toHaveLength(1);
    expect(input.lineItems[0].priceOverride).toEqual({ amount: "0.19", currencyCode: "USD" });
    expect(input.lineItems[0].quantity).toBe(5000);
    expect(input.lineItems[0].variantId).toMatch(/^gid:\/\/shopify\/ProductVariant\/\d+$/);
  });

  it("supports a multi-line cart with per-line prices and quantities", () => {
    const input = buildDraftOrderInput(
      cart([
        line(),
        line({ lineId: "L2", unitPriceCents: 23, totalCents: 23 * 5000 }, { sizeId: "xl", colorId: "white" }),
      ]),
      {},
      {},
      MAP,
    );
    expect(input.lineItems).toHaveLength(2);
    expect(input.lineItems[1].priceOverride.amount).toBe("0.23");
    expect(input.lineItems[1].quantity).toBe(5000);
    // Different colors → different variants.
    expect(input.lineItems[0].variantId).not.toBe(input.lineItems[1].variantId);
  });

  it("sets ONE flat shippingLine on the ORDER — the customer charge, once", () => {
    const input = buildDraftOrderInput(cart(), {}, {}, MAP);
    expect(input.shippingLine).toEqual({
      title: FLAT_US_SHIPPING_COPY,
      priceWithCurrency: { amount: "100.00", currencyCode: "USD" },
    });
  });

  it("charges shipping ONCE for a multi-configuration order, never once per line", () => {
    const single = buildDraftOrderInput(cart(), {}, {}, MAP);
    const multi = buildDraftOrderInput(
      cart([line(), line({ lineId: "L2", unitPriceCents: 23, totalCents: 23 * 5000 }, { sizeId: "xl", colorId: "white" })]),
      {},
      {},
      MAP,
    );
    expect(multi.lineItems).toHaveLength(2);
    // The shipping charge is a property of the order, so it cannot scale
    // with the line count even by accident.
    expect(multi.shippingLine).toEqual(single.shippingLine);
    for (const item of multi.lineItems) {
      expect(JSON.stringify(item)).not.toContain("100.00");
    }
  });

  it("never puts the shipping charge inside a line price", () => {
    const input = buildDraftOrderInput(cart(), {}, {}, MAP);
    expect(input.lineItems[0].priceOverride.amount).toBe("0.19");
    expect(Number(input.lineItems[0].priceOverride.amount) * 5000).toBe(950);
  });

  it("throws UNMAPPED_CONFIGURATION rather than substituting a variant", () => {
    // No mapping stubbed — the shipped map is empty.
    expect(() => buildDraftOrderInput(cart(), {})).toThrow(ShopifyCheckoutError);
    try {
      buildDraftOrderInput(cart(), {});
    } catch (err) {
      expect((err as ShopifyCheckoutError).code).toBe("UNMAPPED_CONFIGURATION");
    }
  });

  it("carries attribution and correlation ids as order attributes (§40)", () => {
    const input = buildDraftOrderInput(
      cart(),
      { utm_source: "google", gclid: "abc123" },
      { sessionId: "ses_1", orderId: "ord_1" },
      MAP,
    );
    const attrs = Object.fromEntries(input.customAttributes.map((a) => [a.key, a.value]));
    expect(attrs["_bd_attr_utm_source"]).toBe("google");
    expect(attrs["_bd_attr_gclid"]).toBe("abc123");
    expect(attrs["_bd_session_id"]).toBe("ses_1");
    expect(attrs["_bd_order_id"]).toBe("ord_1");
  });
});

describe("line-item attributes — what travels to Shopify (§11)", () => {
  const attrsFor = (config: Record<string, unknown> = {}) =>
    Object.fromEntries(buildLineAttributes(line({}, config), product).map((a) => [a.key, a.value]));

  it("carries the customer-visible configuration, with the dimension unit", () => {
    const attrs = attrsFor();
    expect(attrs.Size).toBe("Large (26×26×17 cm)");
    expect(attrs.Material).toBe("Insulated (PP laminated / non-woven / aluminium foil)");
    expect(attrs.Color).toBe("Black");
    expect(attrs.Printing).toBe("Custom logo / artwork printing");
    expect(attrs.Quantity).toBe("5000");
  });

  it("carries the artwork reference as a durable id, not a signed URL (§31)", () => {
    const attrs = attrsFor({
      artwork: { artworkId: "art_abc", fileName: "logo.png", fileType: "image/png", fileSizeBytes: 100 },
    });
    expect(attrs["_bd_artwork_id"]).toBe("art_abc");
    expect(attrs["Artwork file"]).toBe("logo.png");
    expect(JSON.stringify(attrs)).not.toMatch(/X-Amz-Signature|https?:\/\//);
  });

  it("leaks NO cost, margin, secret or PII", () => {
    const serialized = JSON.stringify(buildLineAttributes(line(), product)).toLowerCase();
    for (const forbidden of [
      "cost",
      "margin",
      "cogs",
      "contribution",
      "floor",
      "token",
      "secret",
      "shpat_",
      "email",
      "@",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("price verification (§12) — the customer never pays a number BagDirect did not compute", () => {
  const draftFor = (c: Cart) => ({
    currencyCode: c.currency as string,
    subtotalPriceSet: { shopMoney: { amount: (cartSubtotalCents(c) / 100).toFixed(2), currencyCode: c.currency as string } },
    totalShippingPriceSet: {
      shopMoney: { amount: (FLAT_US_SHIPPING_CENTS / 100).toFixed(2), currencyCode: c.currency as string },
    },
    lineItems: {
      nodes: c.lines.map((l) => ({
        quantity: l.config.quantity,
        originalUnitPriceSet: { shopMoney: { amount: (l.unitPriceCents / 100).toFixed(2), currencyCode: c.currency as string } },
        originalTotalSet: { shopMoney: { amount: (l.totalCents / 100).toFixed(2), currencyCode: c.currency as string } },
      })),
    },
  });

  it("fails when the shipping charge is not exactly one flat rate", () => {
    const doubled = draftFor(cart());
    doubled.totalShippingPriceSet.shopMoney.amount = "200.00";
    const result = verifyDraftOrderPricing(cart(), doubled);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.problems.join(" ")).toMatch(/shipping/);
  });

  it("passes on an exact match", () => {
    expect(verifyDraftOrderPricing(cart(), draftFor(cart()))).toEqual({ ok: true });
  });

  it("fails on a unit-price difference of one cent", () => {
    const draft = draftFor(cart());
    draft.lineItems.nodes[0].originalUnitPriceSet.shopMoney.amount = "0.20";
    const result = verifyDraftOrderPricing(cart(), draft);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.problems.join(" ")).toMatch(/unit price/);
  });

  it("fails on a line-total difference", () => {
    const draft = draftFor(cart());
    draft.lineItems.nodes[0].originalTotalSet.shopMoney.amount = "2101.00";
    expect(verifyDraftOrderPricing(cart(), draft).ok).toBe(false);
  });

  it("fails on a quantity difference", () => {
    const draft = draftFor(cart());
    draft.lineItems.nodes[0].quantity = 4999;
    expect(verifyDraftOrderPricing(cart(), draft).ok).toBe(false);
  });

  it("fails on a currency difference", () => {
    const draft = draftFor(cart());
    draft.currencyCode = "CAD";
    expect(verifyDraftOrderPricing(cart(), draft).ok).toBe(false);
  });

  it("fails on a missing line", () => {
    const draft = draftFor(cart());
    draft.lineItems.nodes = [];
    expect(verifyDraftOrderPricing(cart(), draft).ok).toBe(false);
  });

  it("fails on a subtotal that disagrees with the lines", () => {
    const draft = draftFor(cart());
    draft.subtotalPriceSet.shopMoney.amount = "2000.00";
    expect(verifyDraftOrderPricing(cart(), draft).ok).toBe(false);
  });

  it("verifies EVERY line of a multi-line cart, not just the first", () => {
    const c = cart([line(), line({ lineId: "L2", unitPriceCents: 55, totalCents: 55000 }, { quantity: 1000 })]);
    const draft = draftFor(c);
    draft.lineItems.nodes[1].originalUnitPriceSet.shopMoney.amount = "0.50";
    const result = verifyDraftOrderPricing(c, draft);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.problems.join(" ")).toMatch(/line 2/);
  });

  it("fails on an unparseable amount rather than rounding it", () => {
    const draft = draftFor(cart());
    draft.lineItems.nodes[0].originalUnitPriceSet.shopMoney.amount = "0.4199999";
    expect(verifyDraftOrderPricing(cart(), draft).ok).toBe(false);
  });
});

describe("the provider end to end (fake transport, no network)", () => {
  it("returns the SHOPIFY-GENERATED checkout URL and the draft order reference", async () => {
    const { transport, calls } = createFakeShopifyTransport();
    const provider = createShopifyProvider(TEST_CREDENTIALS, { transport, merchandiseMap: MAP });
    const result = await provider.createCheckout(cart(), {}, { sessionId: "ses_1", orderId: "ord_1" });
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") throw new Error("unreachable");
    expect(result.url).toBe("https://bagdirect-test.myshopify.com/invoices/abc123");
    expect(result.reference).toBe("gid://shopify/DraftOrder/1");
    expect(calls[0].operation).toBe("draftOrderCreate");
  });

  it("ABORTS and deletes the draft order when Shopify's price disagrees", async () => {
    const { transport, calls } = createFakeShopifyTransport({
      distort: (draft) => {
        draft.lineItems.nodes[0].originalUnitPriceSet.shopMoney.amount = "0.99";
      },
    });
    const provider = createShopifyProvider(TEST_CREDENTIALS, { transport, merchandiseMap: MAP });
    await expect(provider.createCheckout(cart(), {})).rejects.toMatchObject({
      code: "PRICE_MISMATCH",
    });
    expect(calls.map((c) => c.operation)).toEqual(["draftOrderCreate", "draftOrderDelete"]);
  });

  it("fails when Shopify returns userErrors", async () => {
    const { transport } = createFakeShopifyTransport({ userErrors: [{ field: null, message: "Variant not found" }] });
    const provider = createShopifyProvider(TEST_CREDENTIALS, { transport, merchandiseMap: MAP });
    await expect(provider.createCheckout(cart(), {})).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });

  it("fails when the transport fails, and creates no checkout", async () => {
    const { transport } = createFakeShopifyTransport({ fail: new Error("ETIMEDOUT") });
    const provider = createShopifyProvider(TEST_CREDENTIALS, { transport, merchandiseMap: MAP });
    await expect(provider.createCheckout(cart(), {})).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });

  it("fails (and cleans up) when Shopify returns no invoice URL", async () => {
    const { transport, calls } = createFakeShopifyTransport({ withoutInvoiceUrl: true });
    const provider = createShopifyProvider(TEST_CREDENTIALS, { transport, merchandiseMap: MAP });
    await expect(provider.createCheckout(cart(), {})).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
    expect(calls.map((c) => c.operation)).toContain("draftOrderDelete");
  });

  it("refuses an unmapped configuration WITHOUT calling Shopify at all", async () => {
    const { transport, calls } = createFakeShopifyTransport();
    // No mapping injected — this is the shipped state: the map is empty.
    const provider = createShopifyProvider(TEST_CREDENTIALS, { transport });
    await expect(provider.createCheckout(cart(), {})).rejects.toMatchObject({ code: "UNMAPPED_CONFIGURATION" });
    expect(calls).toHaveLength(0);
  });
});

describe("catalog authority stays with BagDirect (§7, §8)", () => {
  it("the Shopify provider serves the BagDirect catalog, never an empty list", async () => {
    const { transport, calls } = createFakeShopifyTransport();
    const provider = createShopifyProvider(TEST_CREDENTIALS, { transport, merchandiseMap: MAP });
    const products = await provider.listProducts();
    // LAUNCH-enabled only: a launch-disabled catalog entry is not sellable,
    // so the commerce provider must not offer it either.
    expect(products).toEqual(LAUNCH_PRODUCTS);
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => p.launchEnabled)).toBe(true);
    expect(PRODUCTS.length).toBeGreaterThan(products.length);
    // A catalog read makes NO Shopify call, so Shopify being down cannot
    // empty the storefront — and there is nothing to "fall back" from.
    expect(calls).toHaveLength(0);
  });

  it("resolves a product by slug without touching Shopify", async () => {
    const { transport, calls } = createFakeShopifyTransport();
    const provider = createShopifyProvider(TEST_CREDENTIALS, { transport, merchandiseMap: MAP });
    expect(await provider.getProduct(product.slug)).toEqual(product);
    expect(await provider.getProduct("nope")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
