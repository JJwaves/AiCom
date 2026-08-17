import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Production Launch Session 03 §6–§10, §60 — analytics DELIVERY.
 *
 * These modules read `NEXT_PUBLIC_*` ids at module scope (they are inlined
 * at build time in the real bundle), so each case sets the environment and
 * imports a fresh module graph. That is also the honest shape of the thing
 * being tested: which destinations a BUILD can reach.
 */

const ORIGINAL_ENV = { ...process.env };

type Sent = { fn: "gtag" | "fbq"; args: unknown[] };

function installBrowser(): Sent[] {
  const sent: Sent[] = [];
  const win = {
    gtag: (...args: unknown[]) => sent.push({ fn: "gtag", args }),
    fbq: (...args: unknown[]) => sent.push({ fn: "fbq", args }),
    dataLayer: [] as Record<string, unknown>[],
    location: { pathname: "/order-status" },
    addEventListener: () => {},
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
  vi.stubGlobal("navigator", { sendBeacon: () => true });
  return sent;
}

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("NEXT_PUBLIC_")) delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

const PURCHASE = {
  transactionId: "99123",
  value: 2100,
  currency: "USD",
  items: [{ product_id: "bag", product_name: "Takeout bag", quantity: 5000, unit_price: 0.42 }],
};

async function loadModules() {
  const conversions = await import("@/lib/analytics/conversions");
  const track = await import("@/lib/analytics/track");
  return { conversions, track };
}

/* ------------------------------------------------------------------ */

describe("consent gates each destination independently (§6, §60)", () => {
  it("sends nothing at all when consent was declined", async () => {
    process.env.NEXT_PUBLIC_GA4_ID = "G-TEST";
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = "AW-TEST";
    process.env.NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL = "abcLABEL";
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "123";
    const sent = installBrowser();
    const { conversions, track } = await loadModules();
    track.setConsent({ analytics: false, advertising: false });

    const delivery = conversions.deliverPurchaseConversions(PURCHASE);
    expect(sent).toHaveLength(0);
    expect(delivery).toEqual({ ga4: "no_consent", googleAds: "no_consent", meta: "no_consent" });
  });

  it('"analytics only" delivers GA4 and NOT the ad platforms', async () => {
    process.env.NEXT_PUBLIC_GA4_ID = "G-TEST";
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = "AW-TEST";
    process.env.NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL = "abcLABEL";
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "123";
    const sent = installBrowser();
    const { conversions, track } = await loadModules();
    track.setConsent({ analytics: true, advertising: false });

    const delivery = conversions.deliverPurchaseConversions(PURCHASE);
    expect(delivery.ga4).toBe("sent");
    expect(delivery.googleAds).toBe("no_consent");
    expect(delivery.meta).toBe("no_consent");
    expect(sent.filter((s) => s.fn === "fbq")).toHaveLength(0);
  });

  it("full consent delivers all three with the same transaction id", async () => {
    process.env.NEXT_PUBLIC_GA4_ID = "G-TEST";
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = "AW-TEST";
    process.env.NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL = "abcLABEL";
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "123";
    const sent = installBrowser();
    const { conversions, track } = await loadModules();
    track.setConsent({ analytics: true, advertising: true });

    const delivery = conversions.deliverPurchaseConversions(PURCHASE);
    expect(delivery).toEqual({ ga4: "sent", googleAds: "sent", meta: "sent" });

    const ga4 = sent.find((s) => s.args[1] === "purchase");
    expect((ga4?.args[2] as Record<string, unknown>).transaction_id).toBe("99123");
    expect((ga4?.args[2] as Record<string, unknown>).value).toBe(2100);
    expect((ga4?.args[2] as Record<string, unknown>).currency).toBe("USD");

    const ads = sent.find((s) => s.args[1] === "conversion");
    expect((ads?.args[2] as Record<string, unknown>).send_to).toBe("AW-TEST/abcLABEL");
    expect((ads?.args[2] as Record<string, unknown>).transaction_id).toBe("99123");

    const meta = sent.find((s) => s.fn === "fbq");
    expect(meta?.args[1]).toBe("Purchase");
    expect((meta?.args[3] as Record<string, unknown>).eventID).toBe("99123");
  });
});

describe("unconfigured destinations are silent, not broken (§6)", () => {
  it("sends nothing and reports unconfigured when no ids exist", async () => {
    const sent = installBrowser();
    const { conversions, track } = await loadModules();
    track.setConsent({ analytics: true, advertising: true });

    const delivery = conversions.deliverPurchaseConversions(PURCHASE);
    expect(sent).toHaveLength(0);
    expect(delivery).toEqual({ ga4: "unconfigured", googleAds: "unconfigured", meta: "unconfigured" });
    expect(conversions.analyticsDestinationsConfigured()).toEqual({ ga4: false, googleAds: false, meta: false });
  });

  it("an Ads id with no conversion label is NOT considered configured — a conversion cannot be addressed", async () => {
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = "AW-TEST";
    installBrowser();
    const { conversions } = await loadModules();
    expect(conversions.analyticsDestinationsConfigured().googleAds).toBe(false);
  });
});

describe("a vendor failure cannot affect anything else (§10)", () => {
  it("a throwing gtag does not stop the Meta send and does not propagate", async () => {
    process.env.NEXT_PUBLIC_GA4_ID = "G-TEST";
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "123";
    const sent = installBrowser();
    (window as unknown as { gtag: () => void }).gtag = () => {
      throw new Error("tag manager exploded");
    };
    const { conversions, track } = await loadModules();
    track.setConsent({ analytics: true, advertising: true });

    const delivery = conversions.deliverPurchaseConversions(PURCHASE);
    expect(delivery.ga4).toBe("no_transport");
    expect(delivery.meta).toBe("sent");
    expect(sent.some((s) => s.fn === "fbq")).toBe(true);
  });

  it("a GTM-only install reports no_transport rather than pretending to have sent", async () => {
    process.env.NEXT_PUBLIC_GA4_ID = "G-TEST";
    installBrowser();
    delete (window as unknown as { gtag?: unknown }).gtag;
    const { conversions, track } = await loadModules();
    track.setConsent({ analytics: true, advertising: true });

    expect(conversions.deliverPurchaseConversions(PURCHASE).ga4).toBe("no_transport");
  });
});

describe("no cost or margin data can leak to a vendor (§60)", () => {
  it("the delivered payloads contain only identifier, value, currency and items", async () => {
    process.env.NEXT_PUBLIC_GA4_ID = "G-TEST";
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = "AW-TEST";
    process.env.NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL = "abcLABEL";
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "123";
    const sent = installBrowser();
    const { conversions, track } = await loadModules();
    track.setConsent({ analytics: true, advertising: true });
    conversions.deliverPurchaseConversions(PURCHASE);

    const raw = JSON.stringify(sent);
    for (const forbidden of ["cost", "margin", "profit", "artwork", "email", "sessionId", "customerId"]) {
      expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe("the client purchase guard (§5)", () => {
  it("REFUSES to fire for an unpaid order", async () => {
    installBrowser();
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const { firePurchase } = await import("@/lib/analytics/purchase");

    const result = firePurchase({
      orderId: "ord_1",
      transactionId: "tx_1",
      paid: false,
      status: "pending_payment",
      currency: "USD",
      valueCents: 100,
      placedAt: new Date().toISOString(),
      paidAt: null,
      demo: false,
      lines: [],
    });
    expect(result.fired).toBe(false);
  });

  it("fires ONCE per transaction, so a refresh cannot duplicate it", async () => {
    installBrowser();
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const { firePurchase } = await import("@/lib/analytics/purchase");
    const paid = {
      orderId: "ord_1",
      transactionId: "tx_1",
      paid: true,
      status: "paid",
      currency: "USD",
      valueCents: 210_000,
      placedAt: new Date().toISOString(),
      paidAt: new Date().toISOString(),
      demo: false,
      lines: [],
    };

    expect(firePurchase(paid).fired).toBe(true);
    expect(firePurchase(paid).fired).toBe(false);
    expect(firePurchase(paid).fired).toBe(false);
  });
});
