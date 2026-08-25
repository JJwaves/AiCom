import { recordServerEvent } from "@/lib/data/event-service";
import { createOrder } from "@/lib/data/order-service";
import { ensureSession, recordAttribution } from "@/lib/data/session-service";
import type { GoogleAdsCampaignDay } from "@/lib/google-ads";
import type { Touch } from "@/lib/attribution/attribution";
import type { CredentialSnapshot } from "@/modules/google-ads-intelligence/connection";
import { config, HERO } from "./pi-helpers";

/**
 * Google Ads test fixtures (Session 13). TEST-ONLY seeds driving the REAL
 * services — nothing here bypasses a validation path, and nothing here
 * touches Google: every provider in every test is
 * `FakeGoogleAdsReportingProvider`.
 */

/** A campaign-day row as the ADAPTER would have produced it. */
export function day(over: Partial<GoogleAdsCampaignDay> = {}): GoogleAdsCampaignDay {
  return {
    customerId: "1234567890",
    campaignId: "111",
    campaignName: "Restaurant Bags",
    campaignStatus: "ENABLED",
    advertisingChannelType: "SEARCH",
    date: "2026-08-10",
    impressions: 1_000,
    clicks: 50,
    costCents: 12_500,
    currencyCode: "USD",
    googleConversions: 2,
    googleConversionValueCents: 210_000,
    ...over,
  };
}

const touch = (params: Touch["params"], landing = "/products/custom-insulated-takeout-bags"): Touch => ({
  params,
  landing_page: landing,
  referrer: "",
  ts: new Date().toISOString(),
});

/** Campaign params that mark a session as Google Ads paid traffic. */
export const GCLID_TOUCH = touch({ gclid: "EAIaIQobChMI-test-click-id" });
export const UTM_ONLY_TOUCH = touch({ utm_source: "google", utm_medium: "cpc" });
export const ORGANIC_TOUCH = touch({ utm_source: "google", utm_medium: "organic" });

export const campaignTouch = (utmCampaign: string, withClickId = true): Touch =>
  touch({
    ...(withClickId ? { gclid: "EAIaIQobChMI-test-click-id" } : {}),
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: utmCampaign,
  });

/**
 * A session with a given attribution touch, plus optional funnel events.
 * Returns the session id.
 */
export async function seedAdSession(
  first: Touch | null,
  opts: {
    cart?: boolean;
    checkout?: boolean;
    productView?: boolean;
    priceView?: boolean;
  } = {},
): Promise<string> {
  const { session } = await ensureSession({ userAgent: "vitest" });
  if (first) await recordAttribution(session.id, { first, last: first });
  if (opts.productView !== false) {
    await recordServerEvent({ sessionId: session.id, name: "product_viewed", productId: HERO.id });
  }
  if (opts.priceView) {
    await recordServerEvent({
      sessionId: session.id,
      name: "price_viewed",
      productId: HERO.id,
      props: { unitPrice: 0.42, value: 2100, currency: "USD" },
    });
  }
  if (opts.cart) {
    await recordServerEvent({ sessionId: session.id, name: "add_to_cart", productId: HERO.id, props: { quantity: 5000 } });
  }
  if (opts.checkout) await recordServerEvent({ sessionId: session.id, name: "checkout_started" });
  return session.id;
}

/** An order attached to a session, at a given total. */
export async function seedAdOrder(
  sessionId: string,
  opts: { totalCents?: number; currency?: "USD" | "CAD"; status?: string } = {},
) {
  const totalCents = opts.totalCents ?? 235_000;
  return createOrder({
    sessionId,
    provider: "mock",
    currency: opts.currency ?? "USD",
    status: opts.status ?? "created",
    lines: [
      {
        productId: HERO.id,
        quantity: 5000,
        unitPriceCents: Math.round(totalCents / 5000),
        totalCents,
        title: "Custom Non-Woven Takeout Bag",
        config: config({ quantity: 5000 }),
      },
    ],
  });
}

/** The credential snapshot shape the deterministic module accepts. */
export const CONFIGURED_CREDENTIALS: CredentialSnapshot = {
  configured: true,
  missing: [],
  invalid: [],
  customerId: "1234567890",
  apiVersion: "v25",
};

export const UNCONFIGURED_CREDENTIALS: CredentialSnapshot = {
  configured: false,
  missing: ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_REFRESH_TOKEN"],
  invalid: [],
  customerId: null,
  apiVersion: null,
};
