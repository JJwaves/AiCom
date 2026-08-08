import { describe, expect, it } from "vitest";
import {
  attributionToMetadata,
  extractCampaignParams,
  mergeAttribution,
  type Touch,
} from "@/lib/attribution/attribution";

const touch = (params: Touch["params"], page = "/"): Touch => ({
  params,
  landing_page: page,
  referrer: "",
  ts: "2026-08-07T00:00:00.000Z",
});

describe("extractCampaignParams", () => {
  it("extracts utm params and click ids", () => {
    const p = extractCampaignParams("?utm_source=google&utm_campaign=restaurant&gclid=abc123");
    expect(p).toEqual({ utm_source: "google", utm_campaign: "restaurant", gclid: "abc123" });
  });
  it("returns null when no campaign params exist", () => {
    expect(extractCampaignParams("?page=2&sort=price")).toBeNull();
  });
  it("ignores unknown params", () => {
    const p = extractCampaignParams("?utm_source=fb&evil=1");
    expect(p).toEqual({ utm_source: "fb" });
  });
});

describe("mergeAttribution", () => {
  it("first visit sets both first and last touch", () => {
    const v = touch({ utm_source: "google" }, "/lp/restaurant-bags");
    const merged = mergeAttribution(null, v);
    expect(merged.first).toBe(v);
    expect(merged.last).toBe(v);
  });

  it("never overwrites first touch", () => {
    const first = touch({ utm_source: "google" });
    const stored = { first, last: first };
    const later = touch({ utm_source: "facebook" });
    const merged = mergeAttribution(stored, later);
    expect(merged.first).toBe(first);
    expect(merged.last).toBe(later);
  });

  it("plain internal navigation does not clobber last campaign touch", () => {
    const first = touch({ utm_source: "google" });
    const stored = { first, last: first };
    const internalNav = touch({}, "/cart");
    const merged = mergeAttribution(stored, internalNav);
    expect(merged.last).toBe(first);
  });
});

describe("attributionToMetadata", () => {
  it("flattens first and last touches with prefixes", () => {
    const first = touch({ utm_source: "google", gclid: "g1" }, "/lp/a");
    const last = touch({ fbclid: "f1" }, "/lp/b");
    const meta = attributionToMetadata({ first, last });
    expect(meta.first_utm_source).toBe("google");
    expect(meta.first_gclid).toBe("g1");
    expect(meta.last_fbclid).toBe("f1");
    expect(meta.first_landing_page).toBe("/lp/a");
    expect(meta.last_landing_page).toBe("/lp/b");
  });
  it("returns {} for null attribution", () => {
    expect(attributionToMetadata(null)).toEqual({});
  });
});
