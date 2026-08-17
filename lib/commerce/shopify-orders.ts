import type { ShopifyCredentials } from "./config";
import { createShopifyTransport, type ShopifyTransport } from "./shopify-transport";
import { moneyStringToCents } from "./shopify-webhook-payload";

/**
 * READ-ONLY Shopify order queries, for reconciliation only (Production
 * Launch Session 03 §24–§26).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AT ALL
 * ═══════════════════════════════════════════════════════════════════════════
 * Webhooks are authoritative, and their DELIVERY is not guaranteed. Shopify
 * retries for roughly 48 hours and then stops. An endpoint that was down for
 * that whole window — a bad deploy, an expired certificate, a database
 * outage — loses that payment's notification permanently. The customer's
 * money is gone from their account and the BagDirect order sits at
 * `pending_payment` forever: excluded from revenue, invisible to fulfilment,
 * and no amount of waiting fixes it.
 *
 * So there has to be a way to ASK. This is it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SCOPE REQUIRED: read_orders
 * ═══════════════════════════════════════════════════════════════════════════
 * `write_draft_orders` (checkout) does NOT permit reading orders. The
 * reconciliation feature needs `read_orders` added to the same Admin API
 * access token, and nothing beyond it: no write_orders, no read_customers,
 * no read_products. Documented precisely in docs/SHOPIFY_PRODUCTION.md so
 * the token is not broadened past what this needs.
 *
 * Without the scope, Shopify answers with an access error and the
 * reconciliation run is recorded as `failed` with that reason — it never
 * degrades into "found nothing", which would read as "everything is fine".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS FILE CANNOT MUTATE ANYTHING
 * ═══════════════════════════════════════════════════════════════════════════
 * One GraphQL document, a `query`. No mutation is defined here and none is
 * importable from here — asserted structurally, exactly as the Google Ads
 * reporting provider is.
 */

const RECENT_ORDERS_QUERY = /* GraphQL */ `
  query BagDirectRecentOrders($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        createdAt
        cancelledAt
        displayFinancialStatus
        currencyCode
        totalPriceSet {
          shopMoney {
            amount
          }
        }
        totalRefundedSet {
          shopMoney {
            amount
          }
        }
        customAttributes {
          key
          value
        }
      }
    }
  }
`;

export type ShopifyOrderSummary = {
  /** Numeric id, extracted from the GID — the same identity webhooks use. */
  providerOrderId: string;
  gid: string;
  name: string | null;
  createdAt: Date | null;
  cancelledAt: Date | null;
  /** Lowercased to match the webhook payload's `financial_status` vocabulary. */
  financialStatus: string | null;
  currency: string | null;
  totalCents: number | null;
  refundedTotalCents: number;
  /** `_bd_order_id` — the correlation key set at draft-order creation. */
  bagdirectOrderId: string | null;
};

type OrdersQueryResponse = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      id: string;
      name: string | null;
      createdAt: string | null;
      cancelledAt: string | null;
      displayFinancialStatus: string | null;
      currencyCode: string | null;
      totalPriceSet: { shopMoney: { amount: string } } | null;
      totalRefundedSet: { shopMoney: { amount: string } } | null;
      customAttributes: { key: string; value: string | null }[] | null;
    }[];
  };
};

/** `gid://shopify/Order/12345` → `12345`. Webhooks send the numeric form. */
export function orderIdFromGid(gid: string): string {
  const tail = gid.split("/").pop();
  return tail && /^\d+$/.test(tail) ? tail : gid;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Page size and page cap — a bounded sweep, never an unbounded catalog crawl. */
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

export type RecentOrdersResult = {
  orders: ShopifyOrderSummary[];
  /** True when the page cap stopped the sweep: the window is INCOMPLETE. */
  truncated: boolean;
};

export type ShopifyOrderReader = (input: { start: Date; end: Date }) => Promise<RecentOrdersResult>;

/**
 * Read the orders Shopify created in a bounded window.
 *
 * The filter is Shopify's own search syntax over `created_at`, which is the
 * field an order is stamped with when the customer completes checkout —
 * whether or not we ever heard about it.
 */
export function createShopifyOrderReader(
  credentials: ShopifyCredentials,
  options: { transport?: ShopifyTransport } = {},
): ShopifyOrderReader {
  const transport = options.transport ?? createShopifyTransport(credentials);

  return async function readRecentOrders({ start, end }): Promise<RecentOrdersResult> {
    const query = `created_at:>='${start.toISOString()}' AND created_at:<='${end.toISOString()}'`;
    const orders: ShopifyOrderSummary[] = [];
    let after: string | null = null;
    let truncated = false;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data: OrdersQueryResponse = await transport<OrdersQueryResponse>({
        query: RECENT_ORDERS_QUERY,
        variables: { first: PAGE_SIZE, after, query },
        // A read: bounded retries on transport failures are correct here.
        idempotent: true,
        operation: "orders",
      });

      for (const node of data.orders.nodes ?? []) {
        const attributes = node.customAttributes ?? [];
        orders.push({
          providerOrderId: orderIdFromGid(node.id),
          gid: node.id,
          name: node.name,
          createdAt: parseDate(node.createdAt),
          cancelledAt: parseDate(node.cancelledAt),
          financialStatus: node.displayFinancialStatus ? node.displayFinancialStatus.toLowerCase() : null,
          currency: node.currencyCode,
          totalCents: moneyStringToCents(node.totalPriceSet?.shopMoney?.amount),
          refundedTotalCents: moneyStringToCents(node.totalRefundedSet?.shopMoney?.amount) ?? 0,
          bagdirectOrderId: attributes.find((a) => a.key === "_bd_order_id")?.value || null,
        });
      }

      if (!data.orders.pageInfo?.hasNextPage) return { orders, truncated };
      after = data.orders.pageInfo.endCursor;
      if (page === MAX_PAGES - 1) truncated = true;
    }

    return { orders, truncated };
  };
}
