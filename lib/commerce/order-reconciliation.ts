import { markConversationOutcomeForSession } from "@/lib/data/conversation-service";
import { applyNeedProfileUpdate } from "@/lib/data/customer-need-service";
import { recordServerEvent } from "@/lib/data/event-service";
import {
  attachProviderOrderId,
  findOrderByProviderOrderId,
  getOrder,
  markOrderCancelled,
  markOrderPaid,
  recordOrderRefund,
} from "@/lib/data/order-service";
import { markConverted } from "@/lib/data/session-service";
import { listCatalogProducts } from "@/lib/commerce/catalog";
import type { ShopifyOrderPayload, ShopifyRefundPayload } from "./shopify-webhook-payload";
import { isPaidFinancialStatus } from "./shopify-webhook-payload";

/**
 * Shopify → BagDirect order reconciliation (Production Launch Session 02
 * §16, §17, §19).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW A PAID ORDER FINDS ITS WAY HOME
 * ─────────────────────────────────────────────────────────────────────────
 * /api/checkout creates the BagDirect order row FIRST, with status
 * `pending_payment`, carrying the exact server-priced lines, the immutable
 * configuration snapshots, the artwork links, the attribution and the cost
 * snapshot. Its id travels to Shopify as the draft order's `_bd_order_id`
 * custom attribute, which Shopify copies onto the resulting order's
 * `note_attributes`.
 *
 * So reconciliation is a LOOKUP, not a reconstruction. That matters: the
 * alternative — rebuilding a BagDirect order from Shopify's line items —
 * would have to re-derive the configuration from display attributes, and any
 * gap between what we sent and what we could parse back would silently
 * corrupt what the factory prints.
 *
 * `pending_payment` is excluded from revenue (modules/business-intelligence/
 * revenue.ts), so an abandoned checkout is never reported as a sale. It stays
 * as honest abandoned-checkout data.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EXACTLY ONCE
 * ─────────────────────────────────────────────────────────────────────────
 * `purchase_completed`, the conversion mark and the `purchased` conversation
 * outcome all fire from ONE place: the `transitioned` flag returned by
 * `markOrderPaid`, which flips inside a row-locked transaction. A replayed
 * webhook, an `orders/paid` following an already-paid `orders/create`, or two
 * concurrent deliveries all see `transitioned: false` and do nothing.
 */

export type ReconciliationOutcome = {
  outcome: "processed" | "ignored";
  orderId: string | null;
  detail: string;
};

/** Resolve the BagDirect order this Shopify order belongs to. */
async function resolveOrder(payload: ShopifyOrderPayload) {
  if (payload.bagdirectOrderId) {
    const found = await getOrder(payload.bagdirectOrderId);
    if (found) return found;
  }
  const byProvider = await findOrderByProviderOrderId("shopify", payload.providerOrderId);
  return byProvider ? await getOrder(byProvider.id) : null;
}

/**
 * `orders/create` — the order now exists in Shopify. It may or may not be
 * paid yet: Shopify sends this for unpaid orders too, so payment is decided
 * by `financial_status`, never by the topic's name.
 */
export async function reconcileOrderCreated(payload: ShopifyOrderPayload): Promise<ReconciliationOutcome> {
  const record = await resolveOrder(payload);
  if (!record) {
    // An order created directly in the Shopify admin, or one whose
    // correlation attribute was stripped. Acknowledged and recorded, never
    // fabricated into a BagDirect order with invented configuration.
    return {
      outcome: "ignored",
      orderId: null,
      detail: `Shopify order ${payload.providerOrderId} has no matching BagDirect order (created outside BagDirect checkout)`,
    };
  }

  const attach = await attachProviderOrderId({
    orderId: record.order.id,
    providerOrderId: payload.providerOrderId,
  });
  if (attach.conflict) {
    return {
      outcome: "ignored",
      orderId: record.order.id,
      detail: `BagDirect order ${record.order.id} is already linked to a different Shopify order — refusing to relink`,
    };
  }

  if (!isPaidFinancialStatus(payload.financialStatus)) {
    return {
      outcome: "processed",
      orderId: record.order.id,
      detail: `linked to Shopify order ${payload.providerOrderId} (financial_status=${payload.financialStatus ?? "unknown"}, not yet paid)`,
    };
  }

  return applyPayment(payload, record.order.id);
}

/** `orders/paid` — money captured. The authoritative purchase moment. */
export async function reconcileOrderPaid(payload: ShopifyOrderPayload): Promise<ReconciliationOutcome> {
  const record = await resolveOrder(payload);
  if (!record) {
    return {
      outcome: "ignored",
      orderId: null,
      detail: `Shopify order ${payload.providerOrderId} paid, but no matching BagDirect order exists`,
    };
  }
  await attachProviderOrderId({ orderId: record.order.id, providerOrderId: payload.providerOrderId });
  return applyPayment(payload, record.order.id);
}

async function applyPayment(payload: ShopifyOrderPayload, orderId: string): Promise<ReconciliationOutcome> {
  const result = await markOrderPaid({
    orderId,
    // Shopify's total includes shipping and tax, which BagDirect's
    // subtotal deliberately does not. Recording it would silently redefine
    // `orders.totalCents` — the figure every profit calculation divides by —
    // so the BagDirect product subtotal stays the order total and Shopify's
    // grand total is not copied over it.
    providerTotalCents: null,
  });
  if (!result) return { outcome: "ignored", orderId, detail: "order disappeared during payment reconciliation" };

  if (!result.transitioned) {
    return {
      outcome: "processed",
      orderId,
      detail: `already paid (status=${result.order.status}) — no duplicate purchase event`,
    };
  }

  // ── Everything below runs EXACTLY ONCE per order, by construction. ──
  const order = result.order;

  if (order.sessionId) {
    // `events` requires a session, so a Shopify-admin-created order has no
    // funnel event. Revenue is read from the orders table, not from events,
    // so that absence understates the funnel rather than the money.
    await recordServerEvent({
      sessionId: order.sessionId,
      customerId: order.customerId,
      name: "purchase_completed",
      orderId: order.id,
      props: {
        totalCents: order.totalCents,
        currency: order.currency,
        providerOrderId: payload.providerOrderId,
        provider: "shopify",
        aiAssisted: order.aiAssisted,
      },
    }).catch((err) => console.error(`[reconcile] purchase_completed failed for ${order.id}`, err));

    await markConverted(order.sessionId).catch((err) =>
      console.error(`[reconcile] conversion mark failed for ${order.id}`, err),
    );
    await markConversationOutcomeForSession(order.sessionId, "purchased").catch((err) =>
      console.error(`[reconcile] conversation outcome failed for ${order.id}`, err),
    );
    await enrichNeedProfile(order.id, order.sessionId, order.customerId).catch((err) =>
      console.error(`[reconcile] need-profile enrichment failed for ${order.id}`, err),
    );
  }

  return { outcome: "processed", orderId, detail: `paid — purchase_completed recorded once` };
}

/**
 * What the customer actually PAID for is the strongest behavioural signal
 * (mirrors the mock checkout's ORDER_DATA enrichment, so both paths teach the
 * profile the same things).
 */
async function enrichNeedProfile(orderId: string, sessionId: string, customerId: string | null): Promise<void> {
  const record = await getOrder(orderId);
  const line = record?.lines[0];
  if (!line) return;
  const products = await listCatalogProducts();
  const product = products.find((p) => p.id === line.productId);
  const size = product?.sizes.find((s) => s.id === line.configJson.sizeId);

  await applyNeedProfileUpdate(
    sessionId,
    {
      productInterest: line.productId,
      quantity: line.quantity,
      materialPreference: line.configJson.materialId,
      colorPreference: line.configJson.colorId,
      printingRequirement: line.configJson.printOptionId,
      ...(line.artworkJson ? { logoAvailable: true } : {}),
      ...(size
        ? {
            desiredWidth: size.dimensions.width,
            desiredHeight: size.dimensions.height,
            desiredGusset: size.dimensions.gusset,
          }
        : {}),
    },
    "ORDER_DATA",
    { customerId },
  );
}

/** `orders/cancelled` — the order will not be fulfilled. */
export async function reconcileOrderCancelled(payload: ShopifyOrderPayload): Promise<ReconciliationOutcome> {
  const record = await resolveOrder(payload);
  if (!record) {
    return {
      outcome: "ignored",
      orderId: null,
      detail: `Shopify order ${payload.providerOrderId} cancelled, but no matching BagDirect order exists`,
    };
  }
  const result = await markOrderCancelled({
    orderId: record.order.id,
    cancelledAt: payload.cancelledAt ?? undefined,
  });
  if (!result) return { outcome: "ignored", orderId: record.order.id, detail: "order disappeared" };
  return {
    outcome: "processed",
    orderId: record.order.id,
    detail: result.transitioned
      ? "cancelled — excluded from revenue from now on"
      : "already cancelled — no change",
  };
}

/** `refunds/create` — Shopify remains the refund authority; BagDirect records. */
export async function reconcileRefundCreated(payload: ShopifyRefundPayload): Promise<ReconciliationOutcome> {
  const order = await findOrderByProviderOrderId("shopify", payload.providerOrderId);
  if (!order) {
    return {
      outcome: "ignored",
      orderId: null,
      detail: `refund for Shopify order ${payload.providerOrderId}, which has no BagDirect order`,
    };
  }
  const result = await recordOrderRefund({
    orderId: order.id,
    refundAmountCents: payload.refundAmountCents,
  });
  if (!result) return { outcome: "ignored", orderId: order.id, detail: "order disappeared" };
  return {
    outcome: "processed",
    orderId: order.id,
    detail: result.fullyRefunded
      ? `fully refunded (${result.order.refundedTotalCents}c) — excluded from revenue`
      : `partial refund recorded (${result.order.refundedTotalCents}c of ${result.order.totalCents}c) — order remains paid`,
  };
}
