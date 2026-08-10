/**
 * Analytics abstraction — one clean event model (section 17 of the spec),
 * pushed to a dataLayer. GTM/GA4/Meta read from it; IDs come from env vars
 * and no vendor SDK is hard-wired into components.
 *
 * Consent-aware: events buffer until analytics consent is granted, then
 * flush. No artwork contents or personal data ever enter the dataLayer.
 */

import { forwardFirstParty } from "./first-party";

export type EcommerceItem = {
  product_id: string;
  product_name: string;
  variant?: string;
  quantity?: number;
  unit_price?: number;
};

export type AnalyticsEvent =
  | { name: "page_view"; params?: Record<string, unknown> }
  | { name: "view_item"; params: { items: EcommerceItem[]; currency: string; value?: number } }
  | { name: "select_item"; params: { items: EcommerceItem[] } }
  | { name: "product_config_started"; params: { product_id: string } }
  | { name: "select_size"; params: { product_id: string; size: string } }
  | { name: "select_color"; params: { product_id: string; color: string } }
  | { name: "select_print_option"; params: { product_id: string; print_option: string } }
  | { name: "upload_artwork"; params: { product_id: string; file_type: string } }
  | { name: "select_quantity"; params: { product_id: string; quantity: number } }
  | { name: "view_price"; params: { product_id: string; unit_price: number; value: number; currency: string } }
  | { name: "shipping_estimate_requested"; params: { market: string } }
  | { name: "add_to_cart"; params: { items: EcommerceItem[]; value: number; currency: string } }
  | { name: "view_cart"; params: { items: EcommerceItem[]; value: number; currency: string } }
  | { name: "begin_checkout"; params: { items: EcommerceItem[]; value: number; currency: string } }
  | { name: "add_shipping_info"; params: Record<string, unknown> }
  | { name: "add_payment_info"; params: Record<string, unknown> }
  | { name: "purchase"; params: { transaction_id: string; items: EcommerceItem[]; value: number; currency: string } }
  | { name: "request_custom_quote"; params: { product_id?: string } }
  | { name: "quote_form_started"; params?: Record<string, unknown> }
  | { name: "quote_form_submitted"; params?: Record<string, unknown> };

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

let consentGranted = false;
const buffer: AnalyticsEvent[] = [];
const firedPurchases = new Set<string>();

export function grantAnalyticsConsent(): void {
  consentGranted = true;
  while (buffer.length) push(buffer.shift() as AnalyticsEvent);
}

export function hasAnalyticsConsent(): boolean {
  return consentGranted;
}

function push(event: AnalyticsEvent): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer ?? [];
  // event_id enables browser/server dedup (Meta CAPI); purchases also
  // dedup client-side by transaction_id.
  window.dataLayer.push({
    event: event.name,
    event_id: `${event.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...("params" in event && event.params ? event.params : {}),
  });
}

export function track(event: AnalyticsEvent): void {
  // First-party dual-write: selected events also persist to /api/events
  // (non-blocking, exception-safe). The dataLayer path below is unchanged.
  // See lib/analytics/first-party.ts for the mapping table + consent notes.
  forwardFirstParty(event);
  if (event.name === "purchase") {
    const tid = event.params.transaction_id;
    if (firedPurchases.has(tid)) return; // duplicate purchase guard
    firedPurchases.add(tid);
  }
  if (!consentGranted) {
    buffer.push(event);
    return;
  }
  push(event);
}
