import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDemoPricing, showsDemoPricing } from "@/config/business";

/**
 * Production Launch Session 04 §15/§16 — a demo price must never be shown or
 * published as a real one.
 *
 * Two inputs describe the same fact and can disagree:
 *   `product.pricingStatus`      catalog EVIDENCE — what the price actually is
 *   NEXT_PUBLIC_DEMO_PRICING     owner ASSERTION — a build-time env var
 *
 * Three surfaces each combined them differently, and setting the flag to
 * "false" before replacing the prices (the exact order §16 warns about)
 * produced two customer-visible failures on a real production build:
 *   - the configurator's "Demo pricing" badge disappeared over demo numbers;
 *   - the product page published AggregateOffer lowPrice 0.33 / highPrice
 *     0.62 to search engines as real prices.
 *
 * The rule is OR, so neither input can silently overrule the other into
 * presenting a fake number as real.
 */

const saved = process.env.NEXT_PUBLIC_DEMO_PRICING;

const demoProduct = { pricingStatus: "DEMO" as const };
const liveProduct = { pricingStatus: "LIVE" as const };

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_DEMO_PRICING;
});

afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_DEMO_PRICING;
  else process.env.NEXT_PUBLIC_DEMO_PRICING = saved;
});

describe("demo pricing disclosure", () => {
  it("defaults to demo when the flag is unset", () => {
    expect(isDemoPricing()).toBe(true);
    expect(showsDemoPricing(liveProduct)).toBe(true);
  });

  it("still reports DEMO when the flag says false but the catalog says DEMO", () => {
    process.env.NEXT_PUBLIC_DEMO_PRICING = "false";
    expect(isDemoPricing()).toBe(false);
    expect(showsDemoPricing(demoProduct)).toBe(true);
  });

  it("still reports DEMO when the catalog says LIVE but the flag is not set to false", () => {
    process.env.NEXT_PUBLIC_DEMO_PRICING = "true";
    expect(showsDemoPricing(liveProduct)).toBe(true);
  });

  it("reports LIVE only when BOTH the flag and the catalog agree", () => {
    process.env.NEXT_PUBLIC_DEMO_PRICING = "false";
    expect(showsDemoPricing(liveProduct)).toBe(false);
  });

  it("treats any value other than the exact string 'false' as demo", () => {
    for (const value of ["FALSE", "0", "no", "", " false"]) {
      process.env.NEXT_PUBLIC_DEMO_PRICING = value;
      expect(showsDemoPricing(liveProduct), `value=${JSON.stringify(value)}`).toBe(true);
    }
  });
});
