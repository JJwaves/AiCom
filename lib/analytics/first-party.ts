import { readAttribution } from "@/lib/attribution/attribution";
import { newId } from "@/lib/data/id";
// Type-only imports — this module runs in the BROWSER; lib/data/event-service
// itself is server-only and must never be imported here at runtime.
import type { PlatformEventName } from "@/lib/data/event-service";
import type { AnalyticsEvent, EcommerceItem } from "./track";

/**
 * First-party event dual-write (client side).
 *
 * `track()` keeps its GA4-shaped dataLayer output byte-for-byte unchanged;
 * this module additionally forwards SELECTED events to /api/events so the
 * platform's own database — not GA4/Meta — is the source of behavioral
 * truth. The GA4 name → platform taxonomy mapping lives in ONE explicit
 * table below; an event absent there (mapper `null`) is dataLayer-only.
 *
 * Consent: the dataLayer path stays consent-gated exactly as before
 * (marketing tags). First-party operational persistence has a separate
 * switch — NEXT_PUBLIC_FIRST_PARTY_EVENTS=false disables it entirely.
 * Consent requirements differ by jurisdiction; the owner reviews policy
 * copy before launch (BUSINESS_CONFIG_TODO).
 *
 * Performance: events queue in memory and flush via sendBeacon (or
 * keepalive fetch) — the storefront never blocks on analytics persistence,
 * and failures are silently dropped (the dataLayer copy is unaffected).
 */

export type MappedEvent = {
  name: PlatformEventName;
  productId?: string;
  page?: string;
  props?: Record<string, string | number | boolean | null>;
};

const firstItemId = (items: EcommerceItem[] | undefined): string | undefined => items?.[0]?.product_id;

type Mapper<K extends AnalyticsEvent["name"]> = (event: Extract<AnalyticsEvent, { name: K }>) => MappedEvent | null;

/**
 * THE mapping table — every GA4-facing event name must appear here so new
 * events force an explicit first-party decision. `null` = dataLayer-only.
 *
 * `purchase` is deliberately null: purchase_completed is written
 * SERVER-side at order creation (/api/checkout) — the authoritative record,
 * immune to ad-blockers and double-fires. `begin_checkout` maps client-side
 * because the intent exists before any server call succeeds.
 */
const GA4_TO_PLATFORM: { [K in AnalyticsEvent["name"]]: Mapper<K> | null } = {
  page_view: (e) => ({
    name: "page_view",
    page: typeof e.params?.page_path === "string" ? e.params.page_path : undefined,
  }),
  view_item: (e) => ({ name: "product_viewed", productId: firstItemId(e.params.items) }),
  select_item: null,
  product_config_started: (e) => ({ name: "configurator_started", productId: e.params.product_id }),
  select_size: (e) => ({
    name: "configurator_updated",
    productId: e.params.product_id,
    props: { option: "size", value: e.params.size },
  }),
  select_color: (e) => ({
    name: "configurator_updated",
    productId: e.params.product_id,
    props: { option: "color", value: e.params.color },
  }),
  select_print_option: (e) => ({
    name: "configurator_updated",
    productId: e.params.product_id,
    props: { option: "print", value: e.params.print_option },
  }),
  upload_artwork: (e) => ({
    name: "artwork_uploaded",
    productId: e.params.product_id,
    props: { fileType: e.params.file_type },
  }),
  select_quantity: (e) => ({
    name: "quantity_selected",
    productId: e.params.product_id,
    props: { quantity: e.params.quantity },
  }),
  view_price: (e) => ({
    name: "price_viewed",
    productId: e.params.product_id,
    props: { unitPrice: e.params.unit_price, value: e.params.value, currency: e.params.currency },
  }),
  shipping_estimate_requested: (e) => ({
    name: "shipping_estimate_requested",
    props: { market: e.params.market },
  }),
  add_to_cart: (e) => ({
    name: "add_to_cart",
    productId: firstItemId(e.params.items),
    props: {
      value: e.params.value,
      currency: e.params.currency,
      quantity: e.params.items?.[0]?.quantity ?? null,
      // AI-assistance metadata on the GENERIC commerce event (S07) —
      // preferred over a parallel ai_* copy; absent for manual adds.
      ...(e.params.added_via ? { addedVia: e.params.added_via } : {}),
    },
  }),
  view_cart: null,
  begin_checkout: (e) => ({
    name: "checkout_started",
    props: {
      value: e.params.value,
      currency: e.params.currency,
      lines: e.params.items?.length ?? 0,
      ...(e.params.trigger ? { trigger: e.params.trigger } : {}),
    },
  }),
  add_shipping_info: null,
  add_payment_info: null,
  purchase: null, // server-authoritative: purchase_completed at order creation
  request_custom_quote: (e) => ({
    name: "quote_started",
    productId: e.params.product_id,
    props: { trigger: "configurator" },
  }),
  quote_form_started: () => ({ name: "quote_started", props: { trigger: "form" } }),
  quote_form_submitted: () => ({ name: "quote_submitted" }),
};

/** Pure mapping — unit-tested in tests/first-party-mapping.test.ts. */
export function mapAnalyticsEvent(event: AnalyticsEvent): MappedEvent | null {
  const mapper = GA4_TO_PLATFORM[event.name] as Mapper<AnalyticsEvent["name"]> | null;
  return mapper ? mapper(event) : null;
}

export function firstPartyEnabled(): boolean {
  return process.env.NEXT_PUBLIC_FIRST_PARTY_EVENTS !== "false";
}

/* ---- Non-blocking send queue ---- */

type QueuedEvent = {
  name: PlatformEventName;
  clientEventId: string;
  occurredAt: string;
  page?: string;
  productId?: string;
  props: Record<string, string | number | boolean | null>;
};

const FLUSH_DELAY_MS = 1500;
const MAX_BATCH = 20; // matches the /api/events batch cap

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listenersInstalled = false;

export function forwardFirstParty(event: AnalyticsEvent): void {
  try {
    if (typeof window === "undefined" || !firstPartyEnabled()) return;
    const mapped = mapAnalyticsEvent(event);
    if (!mapped) return;
    queue.push({
      name: mapped.name,
      clientEventId: newId("evt"),
      occurredAt: new Date().toISOString(),
      page: mapped.page ?? window.location.pathname,
      ...(mapped.productId ? { productId: mapped.productId } : {}),
      props: sanitizeProps(mapped.props),
    });
    installFlushListeners();
    if (queue.length >= MAX_BATCH) flush();
    else if (timer === null) timer = setTimeout(flush, FLUSH_DELAY_MS);
  } catch {
    /* analytics must never break the storefront */
  }
}

/** Drop undefined values and coerce anything odd away — props are bounded scalars only. */
function sanitizeProps(props: MappedEvent["props"]): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (typeof v === "string") out[k] = v.slice(0, 500);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

function flush(): void {
  try {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (queue.length === 0) return;
    const batch = queue.splice(0, MAX_BATCH);
    const body = JSON.stringify({ events: batch, attribution: readAttribution() ?? undefined });
    // sendBeacon as text/plain: fire-and-forget, survives page unload.
    const sent =
      typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
        ? navigator.sendBeacon("/api/events", new Blob([body], { type: "text/plain" }))
        : false;
    if (!sent) {
      void fetch("/api/events", { method: "POST", body, keepalive: true }).catch(() => {});
    }
    if (queue.length > 0) timer = setTimeout(flush, 0);
  } catch {
    queue = [];
  }
}

function installFlushListeners(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
