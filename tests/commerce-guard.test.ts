import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCommerce } from "@/lib/commerce";
import {
  CommerceConfigurationError,
  describeCommerceReadiness,
  resolveCommerceConfiguration,
  resolveShopifyWebhookSecret,
} from "@/lib/commerce/config";
import { mockProvider } from "@/lib/commerce/mock";

/**
 * Production Launch Session 02 §3, §52 — THE production commerce guard.
 *
 * The bug this closes: production with missing Shopify configuration used to
 * silently select the mock provider, which mints MOCK-* order ids, writes
 * Order rows, fires purchase_completed and marks sessions converted — fake
 * revenue that every downstream system would report as real.
 *
 * These tests are the lock. Making production able to fall back to mock again
 * requires deleting one of them.
 */

const COMMERCE_ENV = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_API_TOKEN", "SHOPIFY_API_VERSION", "SHOPIFY_WEBHOOK_SECRET"];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = { NODE_ENV: process.env.NODE_ENV };
  for (const key of COMMERCE_ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else Object.defineProperty(process.env, key, { value, configurable: true, writable: true, enumerable: true });
  }
});

function setNodeEnv(value: string): void {
  Object.defineProperty(process.env, "NODE_ENV", { value, configurable: true, writable: true, enumerable: true });
}

function configureShopify(): void {
  process.env.SHOPIFY_STORE_DOMAIN = "bagdirect-test.myshopify.com";
  process.env.SHOPIFY_ADMIN_API_TOKEN = "shpat_testtoken";
}

describe("development and test may use mock commerce", () => {
  it("selects the mock provider in development with nothing configured", () => {
    setNodeEnv("development");
    const config = resolveCommerceConfiguration();
    expect(config.mode).toBe("mock");
    expect(getCommerce().name).toBe("mock");
  });

  it("selects the mock provider in test with nothing configured", () => {
    setNodeEnv("test");
    expect(resolveCommerceConfiguration().mode).toBe("mock");
    expect(getCommerce().name).toBe("mock");
  });
});

describe("production refuses mock commerce", () => {
  it("throws when NOTHING is configured", () => {
    setNodeEnv("production");
    expect(() => resolveCommerceConfiguration()).toThrow(CommerceConfigurationError);
    expect(() => getCommerce()).toThrow(/NODE_ENV=production/);
  });

  it("names the missing variables and explains the consequence, without leaking a value", () => {
    setNodeEnv("production");
    let message = "";
    try {
      resolveCommerceConfiguration();
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("SHOPIFY_STORE_DOMAIN");
    expect(message).toContain("SHOPIFY_ADMIN_API_TOKEN");
    expect(message).toMatch(/mock/i);
    expect(message).toMatch(/revenue/i);
    // Nothing was configured, so there is no value to leak — but the message
    // must also never contain a token-shaped string.
    expect(message).not.toMatch(/shpat_/);
  });

  it("throws on PARTIAL configuration (domain without token)", () => {
    setNodeEnv("production");
    process.env.SHOPIFY_STORE_DOMAIN = "bagdirect-test.myshopify.com";
    expect(() => resolveCommerceConfiguration()).toThrow(/PARTIALLY configured/);
  });

  it("throws on PARTIAL configuration (token without domain)", () => {
    setNodeEnv("production");
    process.env.SHOPIFY_ADMIN_API_TOKEN = "shpat_testtoken";
    expect(() => resolveCommerceConfiguration()).toThrow(/PARTIALLY configured/);
  });

  it("never leaks the admin token in a partial-configuration error", () => {
    setNodeEnv("production");
    process.env.SHOPIFY_ADMIN_API_TOKEN = "shpat_supersecretvalue";
    let message = "";
    try {
      resolveCommerceConfiguration();
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("SHOPIFY_ADMIN_API_TOKEN");
    expect(message).not.toContain("shpat_supersecretvalue");
  });

  it("selects Shopify with COMPLETE configuration", () => {
    setNodeEnv("production");
    configureShopify();
    const config = resolveCommerceConfiguration();
    expect(config.mode).toBe("shopify");
    expect(getCommerce().name).toBe("shopify");
  });

  it("refuses a malformed store domain rather than calling an unverifiable store", () => {
    setNodeEnv("production");
    process.env.SHOPIFY_STORE_DOMAIN = "https://bagdirect.myshopify.com/";
    process.env.SHOPIFY_ADMIN_API_TOKEN = "shpat_testtoken";
    expect(() => resolveCommerceConfiguration()).toThrow(/myshopify domain/);
  });

  it("treats whitespace-only configuration as missing, not as configured", () => {
    setNodeEnv("production");
    process.env.SHOPIFY_STORE_DOMAIN = "   ";
    process.env.SHOPIFY_ADMIN_API_TOKEN = "   ";
    expect(() => resolveCommerceConfiguration()).toThrow(/NODE_ENV=production/);
  });
});

describe("partial configuration is refused in EVERY environment", () => {
  it("throws in development too — half-set credentials always mean Shopify was intended", () => {
    setNodeEnv("development");
    process.env.SHOPIFY_STORE_DOMAIN = "bagdirect-test.myshopify.com";
    expect(() => resolveCommerceConfiguration()).toThrow(/PARTIALLY configured/);
  });

  it("a webhook secret alone does NOT count as partial checkout configuration", () => {
    // A developer testing webhooks locally against mock commerce is a real,
    // valid state — the webhook secret is resolved separately.
    setNodeEnv("development");
    process.env.SHOPIFY_WEBHOOK_SECRET = "whsec_local";
    expect(resolveCommerceConfiguration().mode).toBe("mock");
    expect(resolveShopifyWebhookSecret()).toBe("whsec_local");
  });
});

describe("API version pinning", () => {
  it("uses the centralized default when unpinned", () => {
    setNodeEnv("production");
    configureShopify();
    const config = resolveCommerceConfiguration();
    expect(config.mode).toBe("shopify");
    if (config.mode !== "shopify") throw new Error("unreachable");
    expect(config.shopify.apiVersion).toBe("2026-07");
  });

  it("accepts a supported pin", () => {
    setNodeEnv("production");
    configureShopify();
    process.env.SHOPIFY_API_VERSION = "2025-10";
    const config = resolveCommerceConfiguration();
    if (config.mode !== "shopify") throw new Error("unreachable");
    expect(config.shopify.apiVersion).toBe("2025-10");
  });

  it("REFUSES an unverified version instead of silently falling back", () => {
    setNodeEnv("production");
    configureShopify();
    process.env.SHOPIFY_API_VERSION = "2019-04";
    expect(() => resolveCommerceConfiguration()).toThrow(/not a version this codebase has been verified against/);
  });
});

describe("the mock provider cannot mint an order in production (§18, §52)", () => {
  it("throws when invoked directly with NODE_ENV=production", async () => {
    setNodeEnv("production");
    await expect(mockProvider.createCheckout({ currency: "USD", lines: [] }, {})).rejects.toThrow(
      /MOCK commerce provider was invoked with NODE_ENV=production/,
    );
  });

  it("still mints a MOCK- id in development", async () => {
    setNodeEnv("development");
    const result = await mockProvider.createCheckout({ currency: "USD", lines: [] }, {});
    expect(result.kind).toBe("mock");
    if (result.kind !== "mock") throw new Error("unreachable");
    expect(result.orderId).toMatch(/^MOCK-/);
  });
});

describe("readiness reporting never throws and never leaks", () => {
  it("reports misconfigured with the missing variables named", () => {
    setNodeEnv("production");
    const readiness = describeCommerceReadiness();
    expect(readiness.mode).toBe("misconfigured");
    expect(readiness.missingEnv).toEqual(["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_API_TOKEN"]);
    expect(readiness.error).toBeTruthy();
  });

  it("reports shopify when complete", () => {
    setNodeEnv("production");
    configureShopify();
    const readiness = describeCommerceReadiness();
    expect(readiness.mode).toBe("shopify");
    expect(readiness.missingEnv).toEqual([]);
    expect(readiness.error).toBeNull();
  });
});
