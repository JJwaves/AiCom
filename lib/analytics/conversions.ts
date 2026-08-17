import { hasAdvertisingConsent, hasAnalyticsConsent, type EcommerceItem } from "./track";

/**
 * Ad-platform and GA4 purchase delivery (Production Launch Session 03
 * §6–§10).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THREE DESTINATIONS, ONE TRUTH, AND THEY ARE NOT THE SAME THING
 * ═══════════════════════════════════════════════════════════════════════════
 *   BagDirect `purchase_completed`  the authoritative transaction. Written
 *                                   server-side from a signed webhook. Every
 *                                   number the business runs on comes from
 *                                   here.
 *   GA4 `purchase`                  analytics DELIVERY.
 *   Google Ads conversion           ad-platform SIGNAL.
 *   Meta `Purchase`                 ad-platform SIGNAL.
 *
 * The last three are copies sent to vendors. If every one of them fails, the
 * customer's order is still complete, still paid, still fulfilled, and still
 * counted in BagDirect's own reporting (§10). Nothing in this file can
 * mutate an order, and nothing in this file is awaited by anything that can.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEDUPLICATION
 * ═══════════════════════════════════════════════════════════════════════════
 * Every destination is given the SAME `transaction_id` — the provider order
 * id (§5). GA4 and Meta both drop a repeat purchase with a transaction id
 * they have already seen, so a refresh, a back-button, or a second visit to
 * the confirmation page cannot inflate reported revenue even if this code
 * runs again. Google Ads deduplicates on `transaction_id` too when it is
 * supplied, which is why it always is.
 *
 * A local guard (lib/analytics/purchase.ts) additionally stops the repeat
 * from being sent at all — belt and braces, because "the vendor will
 * deduplicate it" is a claim about someone else's system.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT NEVER CROSSES
 * ═══════════════════════════════════════════════════════════════════════════
 * No cost, no margin, no cost-model version, no artwork metadata, no email,
 * no phone, no address, no session or customer id. The payload is an
 * identifier, a value, a currency and the items — the minimum a conversion
 * needs.
 */

type GtagFn = (...args: unknown[]) => void;
type FbqFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
    fbq?: FbqFn;
  }
}

const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID;
const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const GOOGLE_ADS_PURCHASE_LABEL = process.env.NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL;
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

export type PurchaseConversion = {
  transactionId: string;
  value: number;
  currency: string;
  items: EcommerceItem[];
};

export type ConversionDelivery = {
  ga4: "sent" | "unconfigured" | "no_consent" | "no_transport";
  googleAds: "sent" | "unconfigured" | "no_consent" | "no_transport";
  meta: "sent" | "unconfigured" | "no_consent" | "no_transport";
};

/**
 * Which ad/analytics destinations this build could deliver to.
 *
 * `NEXT_PUBLIC_*` ids are inlined at BUILD time, so this is a property of
 * the deployed bundle, not of the running server — which is exactly why
 * changing them requires a redeploy, and why the admin readiness surface
 * reports them from the same env vars rather than guessing.
 */
export function analyticsDestinationsConfigured(): { ga4: boolean; googleAds: boolean; meta: boolean } {
  return {
    ga4: Boolean(GA4_ID),
    googleAds: Boolean(GOOGLE_ADS_ID && GOOGLE_ADS_PURCHASE_LABEL),
    meta: Boolean(META_PIXEL_ID),
  };
}

/**
 * Deliver ONE purchase to the configured destinations.
 *
 * Called only from the paid-confirmation path. Never from checkout creation,
 * never from a redirect, never from the AI asking for a checkout.
 *
 * Every branch is individually try/caught: a Pixel that failed to load must
 * not stop GA4, and none of them may throw into the caller (§10).
 */
export function deliverPurchaseConversions(purchase: PurchaseConversion): ConversionDelivery {
  const delivery: ConversionDelivery = { ga4: "unconfigured", googleAds: "unconfigured", meta: "unconfigured" };
  if (typeof window === "undefined") return delivery;

  const gtag = typeof window.gtag === "function" ? window.gtag : null;
  const fbq = typeof window.fbq === "function" ? window.fbq : null;

  /* ---- GA4 (measurement — analytics consent) --------------------- */
  if (GA4_ID) {
    if (!hasAnalyticsConsent()) delivery.ga4 = "no_consent";
    else if (!gtag) {
      // GTM-managed installs have no `gtag` on the page. That is NOT a
      // failure: the `purchase` dataLayer event fired by `track()` is what a
      // GTM GA4 tag is configured to listen for. Reported honestly so the
      // readiness surface can say "delivered via GTM" instead of "sent".
      delivery.ga4 = "no_transport";
    } else {
      try {
        gtag("event", "purchase", {
          transaction_id: purchase.transactionId,
          value: purchase.value,
          currency: purchase.currency,
          items: purchase.items.map((item, index) => ({
            item_id: item.product_id,
            item_name: item.product_name,
            item_variant: item.variant,
            price: item.unit_price,
            quantity: item.quantity,
            index,
          })),
        });
        delivery.ga4 = "sent";
      } catch {
        delivery.ga4 = "no_transport";
      }
    }
  }

  /* ---- Google Ads (advertising consent) --------------------------- */
  if (GOOGLE_ADS_ID && GOOGLE_ADS_PURCHASE_LABEL) {
    if (!hasAdvertisingConsent()) delivery.googleAds = "no_consent";
    else if (!gtag) delivery.googleAds = "no_transport";
    else {
      try {
        gtag("event", "conversion", {
          send_to: `${GOOGLE_ADS_ID}/${GOOGLE_ADS_PURCHASE_LABEL}`,
          value: purchase.value,
          currency: purchase.currency,
          transaction_id: purchase.transactionId,
        });
        delivery.googleAds = "sent";
      } catch {
        delivery.googleAds = "no_transport";
      }
    }
  }

  /* ---- Meta Pixel (advertising consent) --------------------------- */
  if (META_PIXEL_ID) {
    if (!hasAdvertisingConsent()) delivery.meta = "no_consent";
    else if (!fbq) delivery.meta = "no_transport";
    else {
      try {
        fbq(
          "track",
          "Purchase",
          { value: purchase.value, currency: purchase.currency, num_items: purchase.items.length },
          // eventID is what a future server-side Conversions API send would
          // deduplicate against. Meta CAPI itself is DEFERRED this session
          // (§8) and documented as such in docs/ANALYTICS_PRODUCTION.md;
          // emitting the id now costs nothing and makes that upgrade a
          // server change only.
          { eventID: purchase.transactionId },
        );
        delivery.meta = "sent";
      } catch {
        delivery.meta = "no_transport";
      }
    }
  }

  return delivery;
}
