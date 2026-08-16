import { NextResponse } from "next/server";
import { SHOPIFY_WEBHOOK_TOPICS, type ShopifyWebhookTopic } from "@/config/shopify";
import { resolveShopifyWebhookSecret } from "@/lib/commerce/config";
import {
  reconcileOrderCancelled,
  reconcileOrderCreated,
  reconcileOrderPaid,
  reconcileRefundCreated,
  type ReconciliationOutcome,
} from "@/lib/commerce/order-reconciliation";
import { parseShopifyOrder, parseShopifyRefund } from "@/lib/commerce/shopify-webhook-payload";
import { verifyShopifyWebhook } from "@/lib/commerce/webhook-verify";
import { claimWebhookEvent, completeWebhookEvent, releaseWebhookEvent } from "@/lib/data/webhook-event-service";

/**
 * Shopify webhook endpoint (Production Launch Session 02 §13–§15).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ORDER OF OPERATIONS IS THE SECURITY MODEL
 * ═══════════════════════════════════════════════════════════════════════════
 *   1. read the RAW body (never parsed first — parsing changes the bytes
 *      Shopify signed, and the signature would never match)
 *   2. verify the HMAC
 *   3. ONLY THEN parse, and only then touch the database
 *
 * Step 3 never happens before step 2. An unsigned or wrongly-signed request
 * cannot create an order, mark one paid, or emit a purchase event — it cannot
 * cause a single write. This is asserted by a structural test, because
 * anyone who could forge this endpoint could mint revenue.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RESPONSE CODES ARE INSTRUCTIONS TO SHOPIFY
 * ═══════════════════════════════════════════════════════════════════════════
 *   401  bad signature      → do not retry (it will never become valid)
 *   200  processed/ignored  → stop retrying, we have it
 *   500  processing failed  → RETRY, please; the claim is released so the
 *                             retry is treated as new work rather than a
 *                             duplicate
 *
 * A 200 on an unparseable body is deliberate: Shopify retrying a payload we
 * structurally cannot read for 48 hours helps nobody. It is recorded as
 * failed and surfaced in logs instead.
 */

export const runtime = "nodejs";

/** Shopify does not send unbounded bodies; this bounds a hostile caller. */
const MAX_BODY_BYTES = 1024 * 1024;

function isKnownTopic(topic: string | null): topic is ShopifyWebhookTopic {
  return topic !== null && (SHOPIFY_WEBHOOK_TOPICS as readonly string[]).includes(topic);
}

export async function POST(req: Request) {
  const topic = req.headers.get("x-shopify-topic");
  const deliveryId = req.headers.get("x-shopify-webhook-id");
  const shopDomain = req.headers.get("x-shopify-shop-domain");

  // ---- 1. Raw body, unparsed. ---------------------------------------
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ ok: false, error: "Unreadable body" }, { status: 400 });
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    console.error(`[shopify-webhook] rejected oversized body (${rawBody.length} bytes, topic=${topic})`);
    return NextResponse.json({ ok: false, error: "Body too large" }, { status: 413 });
  }

  // ---- 2. Signature. NOTHING has touched the database yet. -----------
  const secret = resolveShopifyWebhookSecret();
  const verification = verifyShopifyWebhook({
    rawBody,
    signatureHeader: req.headers.get("x-shopify-hmac-sha256"),
    secret,
  });
  if (!verification.valid) {
    if (verification.reason === "missing_secret") {
      // Fail closed: with no secret configured, every delivery is
      // unverifiable and none may be processed. Naming the variable is safe;
      // its value is never touched.
      console.error(
        "[shopify-webhook] SHOPIFY_WEBHOOK_SECRET is not set — refusing every webhook. " +
          "Paid orders will NOT be reconciled until it is configured (docs/SHOPIFY_PRODUCTION.md).",
      );
      return NextResponse.json({ ok: false, error: "Webhook processing is not configured" }, { status: 503 });
    }
    console.warn(`[shopify-webhook] rejected delivery (${verification.reason}, topic=${topic}, shop=${shopDomain})`);
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  // ---- 3. Verified. Parsing and persistence may now happen. ----------
  if (!isKnownTopic(topic)) {
    // Subscribed to something we do not handle. Acknowledged so Shopify
    // stops, logged so it is visible.
    console.warn(`[shopify-webhook] unhandled topic "${topic}" — acknowledged without processing`);
    return NextResponse.json({ ok: true, handled: false });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error(`[shopify-webhook] malformed JSON on ${topic} (delivery ${deliveryId})`);
    return NextResponse.json({ ok: true, handled: false, error: "Malformed payload" });
  }

  // The idempotency SUBJECT: the order id for order topics, the refund id
  // for refunds. Never the delivery id (see webhook-event-service.ts).
  const subject =
    topic === "refunds/create" ? parseShopifyRefund(payload) : parseShopifyOrder(payload);
  if (!subject) {
    console.error(`[shopify-webhook] ${topic} payload missing required identifiers (delivery ${deliveryId})`);
    return NextResponse.json({ ok: true, handled: false, error: "Unrecognized payload" });
  }
  const providerEventId = "refundId" in subject ? subject.refundId : subject.providerOrderId;

  const claim = await claimWebhookEvent({
    provider: "shopify",
    topic,
    providerEventId,
    deliveryId,
  });
  if (!claim.claimed) {
    // A retry, or a manual re-send. Already handled — acknowledge and do
    // nothing. This is what makes replay safe.
    return NextResponse.json({ ok: true, handled: true, duplicate: true });
  }

  try {
    let result: ReconciliationOutcome;
    switch (topic) {
      case "orders/create":
        result = await reconcileOrderCreated(subject as ReturnType<typeof parseShopifyOrder> & object);
        break;
      case "orders/paid":
        result = await reconcileOrderPaid(subject as ReturnType<typeof parseShopifyOrder> & object);
        break;
      case "orders/cancelled":
        result = await reconcileOrderCancelled(subject as ReturnType<typeof parseShopifyOrder> & object);
        break;
      case "refunds/create":
        result = await reconcileRefundCreated(subject as ReturnType<typeof parseShopifyRefund> & object);
        break;
    }

    await completeWebhookEvent({
      id: claim.id,
      outcome: result.outcome,
      orderId: result.orderId,
      detail: result.detail,
    });
    console.log(`[shopify-webhook] ${topic} ${result.outcome}: ${result.detail}`);
    return NextResponse.json({ ok: true, handled: true });
  } catch (err) {
    // Release the claim so Shopify's retry is real work, not a "duplicate".
    await releaseWebhookEvent(claim.id).catch((releaseErr) =>
      console.error("[shopify-webhook] failed to release claim — retries will be skipped", releaseErr),
    );
    console.error(`[shopify-webhook] processing failed for ${topic} (delivery ${deliveryId})`, err);
    return NextResponse.json({ ok: false, error: "Processing failed" }, { status: 500 });
  }
}
