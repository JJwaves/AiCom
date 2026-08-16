import { requiredMerchandiseKeys } from "@/config/shopify";
import type { ShopifyTransport } from "@/lib/commerce/shopify-transport";
import type { Cart } from "@/types/commerce";

/**
 * Offline Shopify test doubles (Production Launch Session 02 §54, §55).
 *
 * NOTHING in the test suite talks to Shopify. The fake transport answers the
 * real GraphQL documents the provider sends and, by default, behaves like a
 * correct store: it echoes back exactly the prices it was given, which is
 * what makes a PRICE MISMATCH test meaningful — the mismatch has to be
 * introduced deliberately.
 */

export const V = (n: number) => `gid://shopify/ProductVariant/${n}`;

/** A complete merchandise map over the REAL catalog. */
export function testMerchandiseMap(): Record<string, string> {
  const out: Record<string, string> = {};
  requiredMerchandiseKeys().forEach(({ key }, i) => {
    out[key] = V(1000 + i);
  });
  return out;
}

export type DraftOrderLineInput = {
  variantId: string;
  quantity: number;
  priceOverride: { amount: string; currencyCode: string };
  customAttributes: { key: string; value: string }[];
};

export type FakeShopifyCall = {
  operation: string;
  variables: Record<string, unknown>;
};

export type FakeShopifyOptions = {
  /** Mutate the echoed draft order to simulate a store that disagrees. */
  distort?: (draft: {
    currencyCode: string;
    subtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
    lineItems: {
      nodes: {
        quantity: number;
        originalUnitPriceSet: { shopMoney: { amount: string; currencyCode: string } };
        originalTotalSet: { shopMoney: { amount: string; currencyCode: string } };
      }[];
    };
  }) => void;
  /** Return Shopify userErrors instead of a draft order. */
  userErrors?: { field: string[] | null; message: string }[];
  /** Throw a transport-level failure. */
  fail?: Error;
  /** Omit the invoiceUrl. */
  withoutInvoiceUrl?: boolean;
};

const centsFromDecimal = (amount: string): number => {
  const [whole, frac = "00"] = amount.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
};

const decimalFromCents = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

export function createFakeShopifyTransport(options: FakeShopifyOptions = {}): {
  transport: ShopifyTransport;
  calls: FakeShopifyCall[];
} {
  const calls: FakeShopifyCall[] = [];

  const transport: ShopifyTransport = async <T,>({
    variables = {},
    operation,
  }: {
    query: string;
    variables?: Record<string, unknown>;
    idempotent?: boolean;
    operation: string;
  }): Promise<T> => {
    calls.push({ operation, variables });
    if (options.fail) throw options.fail;

    if (operation === "draftOrderDelete") {
      return { draftOrderDelete: { deletedId: "gid://shopify/DraftOrder/1", userErrors: [] } } as T;
    }

    if (options.userErrors) {
      return { draftOrderCreate: { draftOrder: null, userErrors: options.userErrors } } as T;
    }

    const input = variables.input as { lineItems: DraftOrderLineInput[]; presentmentCurrencyCode: string };
    const nodes = input.lineItems.map((line) => {
      const unit = centsFromDecimal(line.priceOverride.amount);
      return {
        quantity: line.quantity,
        originalUnitPriceSet: { shopMoney: { amount: line.priceOverride.amount, currencyCode: line.priceOverride.currencyCode } },
        originalTotalSet: {
          shopMoney: { amount: decimalFromCents(unit * line.quantity), currencyCode: line.priceOverride.currencyCode },
        },
      };
    });
    const subtotal = nodes.reduce((sum, n) => sum + centsFromDecimal(n.originalTotalSet.shopMoney.amount), 0);

    const draft = {
      id: "gid://shopify/DraftOrder/1",
      name: "#D1",
      invoiceUrl: options.withoutInvoiceUrl ? null : "https://bagdirect-test.myshopify.com/invoices/abc123",
      currencyCode: input.presentmentCurrencyCode,
      subtotalPriceSet: { shopMoney: { amount: decimalFromCents(subtotal), currencyCode: input.presentmentCurrencyCode } },
      lineItems: { nodes },
    };
    options.distort?.(draft);

    return { draftOrderCreate: { draftOrder: draft, userErrors: [] } } as T;
  };

  return { transport, calls };
}

export const TEST_CREDENTIALS = {
  storeDomain: "bagdirect-test.myshopify.com",
  adminAccessToken: "shpat_testtoken",
  apiVersion: "2026-07",
};

/** Sum of a cart's authoritative line totals. */
export const cartSubtotalCents = (cart: Cart): number => cart.lines.reduce((sum, l) => sum + l.totalCents, 0);
