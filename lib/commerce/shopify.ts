import { LAUNCH_PRODUCTS, getProductBySlug } from "@/config/products";
import { FLAT_US_SHIPPING_CENTS, FLAT_US_SHIPPING_COPY } from "@/config/shipping";
import { resolveMerchandise, SHOPIFY_MERCHANDISE_MAP, type MerchandiseKey } from "@/config/shopify";
import type { Cart, CartLine, CheckoutResult, Product } from "@/types/commerce";
import type { ShopifyCredentials } from "./config";
import type { CommerceProvider } from "./provider";
import { createShopifyTransport, ShopifyApiError, type ShopifyTransport } from "./shopify-transport";

/**
 * Shopify commerce provider (Production Launch Session 02).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT SHOPIFY IS, AND IS NOT, IN THIS SYSTEM
 * ═══════════════════════════════════════════════════════════════════════════
 * IS:   payment, hosted checkout, shipping calculation, tax calculation,
 *       order-of-record for money, fulfilment surface.
 * IS NOT: the catalog, and NOT the price.
 *
 * ── Catalog (§7) ──────────────────────────────────────────────────────────
 * `listProducts()` / `getProduct()` serve the BAGDIRECT catalog
 * (`config/products.ts`), the same rows the mock provider serves. That is not
 * a fallback and not a stub — it is the architecture. The catalog defines
 * which configurations are legal and which quantity tiers exist; those rules
 * drive the deterministic pricing engine and the configurator, and Shopify
 * has no representation for them. Consequences worth stating plainly:
 *   - the storefront renders even if Shopify is unreachable
 *   - a catalog read can never fail, so it can never "fall back" (§8)
 *   - Shopify is queried ONLY to take money
 *
 * ── Price (§9, §12) ───────────────────────────────────────────────────────
 * Shopify's Storefront cart API cannot express a custom line price, and a
 * BagDirect price is quantity-tier × material × print-option arithmetic that
 * a single variant price cannot encode. So checkout is a DRAFT ORDER, and
 * every line carries an explicit `priceOverride` set to the engine price that
 * /api/checkout already computed and the customer already confirmed.
 *
 * The draft order is then READ BACK and verified line by line against that
 * same authoritative quote. Any divergence — in unit price, line total,
 * quantity or currency — aborts the checkout and the draft order is deleted.
 * The customer never reaches a Shopify checkout showing a price BagDirect did
 * not compute.
 *
 * ── Merchandise (§5) ──────────────────────────────────────────────────────
 * product × size × material × color → a Shopify variant GID, via the strict
 * exact-match table in `config/shopify.ts`. No fuzzy matching, no AI, no
 * default variant. An unmapped configuration fails visibly and cannot create
 * a checkout.
 *
 * ── Secrets ───────────────────────────────────────────────────────────────
 * The Admin API token lives only inside the transport closure. Nothing in
 * this file logs it, returns it, or puts it in an error message. There is no
 * NEXT_PUBLIC Shopify variable anywhere in the system.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/commerce/shopify is server-only — never import it from client components");
}

/* ------------------------------------------------------------------ */
/* GraphQL documents                                                   */
/* ------------------------------------------------------------------ */

const DRAFT_ORDER_CREATE = /* GraphQL */ `
  mutation BagDirectDraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
        currencyCode
        subtotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalShippingPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        lineItems(first: 50) {
          nodes {
            quantity
            originalUnitPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            originalTotalSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DRAFT_ORDER_DELETE = /* GraphQL */ `
  mutation BagDirectDraftOrderDelete($input: DraftOrderDeleteInput!) {
    draftOrderDelete(input: $input) {
      deletedId
      userErrors {
        field
        message
      }
    }
  }
`;

type Money = { amount: string; currencyCode: string };

type DraftOrderCreateResponse = {
  draftOrderCreate: {
    draftOrder: {
      id: string;
      name: string | null;
      invoiceUrl: string | null;
      currencyCode: string;
      subtotalPriceSet: { shopMoney: Money };
      totalShippingPriceSet: { shopMoney: Money };
      lineItems: { nodes: { quantity: number; originalUnitPriceSet: { shopMoney: Money }; originalTotalSet: { shopMoney: Money } }[] };
    } | null;
    userErrors: { field: string[] | null; message: string }[];
  };
};

/* ------------------------------------------------------------------ */
/* Money conversion — integer cents is the only internal representation */
/* ------------------------------------------------------------------ */

/** Integer cents → the decimal string Shopify's MoneyInput expects. */
export function centsToDecimalString(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`[commerce] refusing to send a non-integer or negative amount to Shopify: ${cents}`);
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * Shopify decimal string → integer cents, EXACTLY. A value that is not a
 * clean 2-decimal amount is a verification failure, never a rounded guess:
 * silently rounding is exactly how a customer ends up paying a different
 * number than the one BagDirect computed.
 */
export function decimalStringToCents(amount: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const frac = (match[2] ?? "").padEnd(2, "0");
  return whole * 100 + Number(frac);
}

/* ------------------------------------------------------------------ */
/* Line-item attributes — what travels to Shopify (§11)                */
/* ------------------------------------------------------------------ */

/**
 * Attributes attached to each draft-order line. Two kinds:
 *
 *  - CUSTOMER-VISIBLE (no underscore): what they configured, echoed on the
 *    Shopify checkout, the confirmation email and the packing slip so both
 *    the customer and the factory can see it.
 *  - INTERNAL (leading `_`, hidden by Shopify convention): first-party
 *    correlation ids so the paid order arriving by webhook can be tied back
 *    to the BagDirect session, configuration and artwork.
 *
 * DELIBERATELY ABSENT — asserted by tests, not just by this comment:
 * unit cost, COGS, margin, margin floor, contribution profit, any
 * config/costs.ts value, any API token, any AI prompt or model output, and
 * any contact detail. Shopify collects its own customer PII at checkout;
 * BagDirect does not push any into it.
 */
export function buildLineAttributes(line: CartLine, product: Product): { key: string; value: string }[] {
  const size = product.sizes.find((s) => s.id === line.config.sizeId);
  const material = product.materials.find((m) => m.id === line.config.materialId);
  const color = product.colors.find((c) => c.id === line.config.colorId);
  const print = product.printOptions.find((p) => p.id === line.config.printOptionId);

  const attributes: { key: string; value: string }[] = [
    {
      key: "Size",
      value: size
        ? `${size.label} (${size.dimensions.width}×${size.dimensions.height}×${size.dimensions.gusset} ${size.unit})`
        : line.config.sizeId,
    },
    { key: "Material", value: material?.label ?? line.config.materialId },
    { key: "Color", value: color?.label ?? line.config.colorId },
    { key: "Printing", value: print?.label ?? line.config.printOptionId },
    { key: "Quantity", value: String(line.config.quantity) },
  ];

  if (line.config.artwork?.artworkId) {
    // The BagDirect artwork id — a stable, non-secret handle. NOT a signed
    // URL: those expire, and the factory needs this reference to still
    // resolve months later. BagDirect's database remains the authoritative
    // artwork association (§31).
    attributes.push({ key: "Artwork file", value: line.config.artwork.fileName });
    attributes.push({ key: "_bd_artwork_id", value: line.config.artwork.artworkId });
  }
  if (line.config.artwork?.notes) {
    attributes.push({ key: "Artwork notes", value: line.config.artwork.notes.slice(0, 500) });
  }

  attributes.push({ key: "_bd_product_id", value: product.id });
  attributes.push({ key: "_bd_line_id", value: line.lineId });

  return attributes;
}

/* ------------------------------------------------------------------ */
/* Checkout failures — typed, customer-safe                            */
/* ------------------------------------------------------------------ */

export type ShopifyCheckoutFailureCode =
  | "UNMAPPED_CONFIGURATION"
  | "UNKNOWN_PRODUCT"
  | "PRICE_MISMATCH"
  | "PROVIDER_ERROR";

export class ShopifyCheckoutError extends Error {
  constructor(
    readonly code: ShopifyCheckoutFailureCode,
    /** Operator-facing detail. Logged server-side; never returned to a customer. */
    message: string,
  ) {
    super(message);
    this.name = "ShopifyCheckoutError";
  }
}

/* ------------------------------------------------------------------ */
/* Price verification (§12)                                            */
/* ------------------------------------------------------------------ */

export type PriceVerificationResult = { ok: true } | { ok: false; problems: string[] };

/**
 * Compare what Shopify says the draft order costs against what BagDirect
 * authoritatively computed. Every line, both unit price and line total, plus
 * the subtotal and the currency.
 *
 * This is not defensive paranoia about Shopify's arithmetic — it is the
 * guard against a mis-built request: a dropped `priceOverride`, a variant
 * whose catalog price won, a quantity that did not survive serialisation, a
 * currency the store is not configured for. Any of those would charge the
 * customer a number BagDirect never quoted.
 */
export function verifyDraftOrderPricing(
  cart: Cart,
  draft: {
    currencyCode: string;
    subtotalPriceSet: { shopMoney: Money };
    totalShippingPriceSet: { shopMoney: Money };
    lineItems: { nodes: { quantity: number; originalUnitPriceSet: { shopMoney: Money }; originalTotalSet: { shopMoney: Money } }[] };
  },
): PriceVerificationResult {
  const problems: string[] = [];
  const nodes = draft.lineItems.nodes;

  if (draft.currencyCode !== cart.currency) {
    problems.push(`currency: Shopify says ${draft.currencyCode}, BagDirect priced in ${cart.currency}`);
  }
  if (nodes.length !== cart.lines.length) {
    problems.push(`line count: Shopify returned ${nodes.length}, BagDirect sent ${cart.lines.length}`);
    return { ok: false, problems };
  }

  cart.lines.forEach((line, i) => {
    const node = nodes[i];
    if (node.quantity !== line.config.quantity) {
      problems.push(`line ${i + 1} quantity: Shopify ${node.quantity} vs BagDirect ${line.config.quantity}`);
    }
    const unit = decimalStringToCents(node.originalUnitPriceSet.shopMoney.amount);
    if (unit === null || unit !== line.unitPriceCents) {
      problems.push(
        `line ${i + 1} unit price: Shopify ${node.originalUnitPriceSet.shopMoney.amount} vs BagDirect ${centsToDecimalString(line.unitPriceCents)}`,
      );
    }
    const total = decimalStringToCents(node.originalTotalSet.shopMoney.amount);
    if (total === null || total !== line.totalCents) {
      problems.push(
        `line ${i + 1} total: Shopify ${node.originalTotalSet.shopMoney.amount} vs BagDirect ${centsToDecimalString(line.totalCents)}`,
      );
    }
    const currency = node.originalUnitPriceSet.shopMoney.currencyCode;
    if (currency !== cart.currency) {
      problems.push(`line ${i + 1} currency: Shopify ${currency} vs BagDirect ${cart.currency}`);
    }
  });

  const expectedSubtotal = cart.lines.reduce((sum, l) => sum + l.totalCents, 0);
  const actualSubtotal = decimalStringToCents(draft.subtotalPriceSet.shopMoney.amount);
  if (actualSubtotal === null || actualSubtotal !== expectedSubtotal) {
    problems.push(
      `subtotal: Shopify ${draft.subtotalPriceSet.shopMoney.amount} vs BagDirect ${centsToDecimalString(expectedSubtotal)}`,
    );
  }

  // Shipping is ONE flat charge per ORDER. Verifying the order-level total
  // (not a per-line figure) is what catches the failure that matters: a
  // shipping charge that scaled with the number of configurations.
  const actualShipping = decimalStringToCents(draft.totalShippingPriceSet.shopMoney.amount);
  if (actualShipping === null || actualShipping !== FLAT_US_SHIPPING_CENTS) {
    problems.push(
      `shipping: Shopify ${draft.totalShippingPriceSet.shopMoney.amount} vs BagDirect ${centsToDecimalString(FLAT_US_SHIPPING_CENTS)} (flat, once per order)`,
    );
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/* ------------------------------------------------------------------ */
/* Draft-order input                                                   */
/* ------------------------------------------------------------------ */

export type DraftOrderLineInput = {
  variantId: string;
  quantity: number;
  priceOverride: { amount: string; currencyCode: string };
  customAttributes: { key: string; value: string }[];
};

/** ONE per order — never per line. See buildDraftOrderInput. */
export type DraftOrderShippingLineInput = {
  title: string;
  priceWithCurrency: { amount: string; currencyCode: string };
};

export type DraftOrderInput = {
  lineItems: DraftOrderLineInput[];
  shippingLine: DraftOrderShippingLineInput;
  customAttributes: { key: string; value: string }[];
  tags: string[];
  presentmentCurrencyCode: string;
};

/**
 * Build the draft-order request from an ALREADY server-priced cart.
 *
 * `cart` arrives from /api/checkout, which re-priced every line with the
 * deterministic engine and answered 409 REPRICED if the browser disagreed.
 * Nothing here recomputes a price and nothing here can accept one from a
 * client: `priceOverride` is a straight restatement of that authoritative
 * quote in Shopify's wire format.
 *
 * SHIPPING: exactly ONE `shippingLine` is set, carrying the MVP flat U.S.
 * charge (config/shipping.ts → FLAT_US_SHIPPING_CENTS). It is attached to
 * the ORDER, not to a line item, which is what makes a six-configuration
 * B2B order pay $100 rather than $600 — the structure enforces "once per
 * order", not a comment. The customer sees it on the Shopify checkout before
 * paying, and it is read back and verified below like every other amount.
 *
 * It is a CUSTOMER CHARGE, not a freight cost and not tax: it never enters
 * BagDirect's product revenue and never enters supplier cost.
 *
 * TAX is still Shopify's: no tax fields are set, Shopify's tax configuration
 * applies (§38), and that is not claimed to be verified until it is tested in
 * a real store.
 */
export function buildDraftOrderInput(
  cart: Cart,
  attribution: Record<string, string>,
  context: { sessionId?: string | null; orderId?: string | null } = {},
  /** Injected in tests. Production always uses the config/shopify.ts table. */
  merchandiseMap: Record<MerchandiseKey, string> = SHOPIFY_MERCHANDISE_MAP,
): DraftOrderInput {
  const lineItems = cart.lines.map((line) => {
    const product = LAUNCH_PRODUCTS.find((p) => p.id === line.config.productId);
    if (!product) {
      throw new ShopifyCheckoutError("UNKNOWN_PRODUCT", `cart line references unknown product "${line.config.productId}"`);
    }
    const merchandise = resolveMerchandise(line.config, merchandiseMap);
    if (!merchandise.ok) {
      throw new ShopifyCheckoutError(
        "UNMAPPED_CONFIGURATION",
        merchandise.reason === "invalid_variant_id"
          ? `merchandise key "${merchandise.key}" maps to a malformed Shopify variant id — fix config/shopify.ts`
          : `no Shopify variant is mapped for merchandise key "${merchandise.key}" — complete config/shopify.ts before selling this configuration`,
      );
    }

    return {
      variantId: merchandise.variantGid,
      quantity: line.config.quantity,
      priceOverride: { amount: centsToDecimalString(line.unitPriceCents), currencyCode: cart.currency },
      customAttributes: buildLineAttributes(line, product),
    };
  });

  // Order-level attributes: first-party attribution (so the paid order can
  // recover which campaign produced it, §40) plus the session correlation
  // reference. Shopify copies these onto the resulting order's
  // note_attributes, which is how the webhook finds its way home.
  const customAttributes: { key: string; value: string }[] = Object.entries(attribution)
    .slice(0, 40)
    .map(([key, value]) => ({ key: `_bd_attr_${key}`.slice(0, 64), value: String(value).slice(0, 512) }));
  if (context.sessionId) customAttributes.push({ key: "_bd_session_id", value: context.sessionId });
  // THE reconciliation key. Shopify copies draft-order custom attributes onto
  // the resulting order's note_attributes, so the paid order names the
  // BagDirect order row it belongs to and reconciliation is a lookup rather
  // than a reconstruction (lib/commerce/order-reconciliation.ts).
  if (context.orderId) customAttributes.push({ key: "_bd_order_id", value: context.orderId });

  return {
    lineItems,
    shippingLine: {
      title: FLAT_US_SHIPPING_COPY,
      priceWithCurrency: { amount: centsToDecimalString(FLAT_US_SHIPPING_CENTS), currencyCode: cart.currency },
    },
    customAttributes,
    tags: ["bagdirect"],
    presentmentCurrencyCode: cart.currency,
  };
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

export type ShopifyProviderOptions = {
  /** Injected in tests; the live provider builds its own from credentials. */
  transport?: ShopifyTransport;
  /** Injected in tests; production always uses config/shopify.ts. */
  merchandiseMap?: Record<MerchandiseKey, string>;
};

export function createShopifyProvider(
  credentials: ShopifyCredentials,
  options: ShopifyProviderOptions = {},
): CommerceProvider {
  const transport = options.transport ?? createShopifyTransport(credentials);
  const merchandiseMap = options.merchandiseMap ?? SHOPIFY_MERCHANDISE_MAP;

  async function deleteDraftOrder(id: string): Promise<void> {
    try {
      await transport({
        query: DRAFT_ORDER_DELETE,
        variables: { input: { id } },
        operation: "draftOrderDelete",
      });
    } catch (err) {
      // Best effort. An orphan draft order is an unpaid, un-invoiced record
      // in the Shopify admin — untidy, never chargeable.
      console.error(`[commerce] failed to delete unverified draft order ${id}`, err);
    }
  }

  return {
    name: "shopify",

    /**
     * BagDirect catalog authority (§7). Not a Shopify read, not a fallback:
     * the storefront's catalog does not depend on Shopify being up.
     */
    async listProducts(): Promise<Product[]> {
      return LAUNCH_PRODUCTS;
    },

    async getProduct(slug: string): Promise<Product | null> {
      return getProductBySlug(slug) ?? null;
    },

    async createCheckout(
      cart: Cart,
      attribution: Record<string, string>,
      context: { sessionId?: string | null; orderId?: string | null } = {},
    ): Promise<CheckoutResult> {
      const input = buildDraftOrderInput(cart, attribution, context, merchandiseMap);

      let data: DraftOrderCreateResponse;
      try {
        data = await transport<DraftOrderCreateResponse>({
          query: DRAFT_ORDER_CREATE,
          variables: { input },
          // A mutation: never retried (see shopify-transport.ts).
          idempotent: false,
          operation: "draftOrderCreate",
        });
      } catch (err) {
        throw new ShopifyCheckoutError(
          "PROVIDER_ERROR",
          `draftOrderCreate failed: ${err instanceof ShopifyApiError ? err.message : String(err)}`,
        );
      }

      const { draftOrder, userErrors } = data.draftOrderCreate;
      if (userErrors?.length || !draftOrder) {
        throw new ShopifyCheckoutError(
          "PROVIDER_ERROR",
          `draftOrderCreate rejected the request: ${userErrors?.map((e) => e.message).join("; ") || "no draft order returned"}`,
        );
      }

      const verification = verifyDraftOrderPricing(cart, draftOrder);
      if (!verification.ok) {
        await deleteDraftOrder(draftOrder.id);
        throw new ShopifyCheckoutError(
          "PRICE_MISMATCH",
          `Shopify draft order ${draftOrder.id} does not match the BagDirect authoritative quote and was deleted: ${verification.problems.join("; ")}`,
        );
      }

      if (!draftOrder.invoiceUrl) {
        await deleteDraftOrder(draftOrder.id);
        throw new ShopifyCheckoutError("PROVIDER_ERROR", `draft order ${draftOrder.id} has no invoiceUrl`);
      }

      // The checkout URL is whatever Shopify generated. Nothing in BagDirect
      // constructs, rewrites or accepts a checkout URL from anywhere else.
      return { kind: "redirect", url: draftOrder.invoiceUrl, reference: draftOrder.id };
    },
  };
}

export type { MerchandiseKey };
