import { describe, expect, it } from "vitest";
import { PRODUCTS } from "@/config/products";
import { CUSTOMER_INTELLIGENCE, VOLUME_GROUPS, volumeGroupFor } from "@/config/customer-intelligence";
import {
  checkRequestSupport,
  isBelowMoq,
  isQualifiedConversation,
  OBJECTION_TYPES,
  periodFromDays,
  previousPeriod,
  QUESTION_THEMES,
  safePercentage,
  safeTrendPct,
} from "@/modules/customer-intelligence";

/**
 * Session 08 — controlled taxonomies, deterministic catalog support, the
 * qualified-conversation rule, and denominator/trend math. All pure logic:
 * no database, no model.
 */

describe("controlled taxonomies", () => {
  it("question themes are the documented closed set", () => {
    expect(QUESTION_THEMES).toContain("MOQ");
    expect(QUESTION_THEMES).toContain("DELIVERY_TIME");
    expect(QUESTION_THEMES).toContain("PRODUCT_AVAILABILITY");
    expect(QUESTION_THEMES).toContain("OTHER");
    expect(QUESTION_THEMES).toHaveLength(14);
  });

  it("objection types are separate from question themes", () => {
    expect(OBJECTION_TYPES).toContain("MOQ_TOO_HIGH");
    expect(OBJECTION_TYPES).toContain("SHIPPING_COST");
    expect(OBJECTION_TYPES).toHaveLength(12);
    // The vocabularies never overlap (OTHER is each list's own catch-all).
    for (const theme of QUESTION_THEMES) {
      if (theme === "OTHER") continue;
      expect(OBJECTION_TYPES).not.toContain(theme);
    }
  });
});

describe("checkRequestSupport — the catalog is the authority", () => {
  it("flags insulated bags as unsupported (a real product gap)", () => {
    const decision = checkRequestSupport(PRODUCTS, { kind: "product", normalized: "insulated bag" });
    expect(decision.verdict).toBe("unsupported");
  });

  it("recognizes the catalog's own product family as supported", () => {
    expect(checkRequestSupport(PRODUCTS, { kind: "product", normalized: "non-woven takeout bag" }).verdict).toBe("supported");
    expect(checkRequestSupport(PRODUCTS, { kind: "product", normalized: "catering bag" }).verdict).toBe("supported");
  });

  it("routes non-standard colors to the custom-quote path, not a gap", () => {
    expect(checkRequestSupport(PRODUCTS, { kind: "color", normalized: "pink" }).verdict).toBe("custom_quote_path");
    expect(checkRequestSupport(PRODUCTS, { kind: "color", normalized: "kraft" }).verdict).toBe("supported");
  });

  it("flags unavailable materials and printing as unsupported", () => {
    expect(checkRequestSupport(PRODUCTS, { kind: "material", normalized: "paper" }).verdict).toBe("unsupported");
    expect(checkRequestSupport(PRODUCTS, { kind: "material", normalized: "heavy duty" }).verdict).toBe("supported");
    expect(checkRequestSupport(PRODUCTS, { kind: "printing", normalized: "full color photo print" }).verdict).toBe("unsupported");
  });

  it("routes size and capacity requests to custom quotes instead of calling them gaps", () => {
    expect(checkRequestSupport(PRODUCTS, { kind: "size", normalized: "large" }).verdict).toBe("supported");
    expect(checkRequestSupport(PRODUCTS, { kind: "size", normalized: "20x30 inches" }).verdict).toBe("custom_quote_path");
    expect(checkRequestSupport(PRODUCTS, { kind: "capacity", normalized: "fits 3 takeout containers" }).verdict).toBe("custom_quote_path");
  });

  it("every decision carries an explaining reason", () => {
    const d = checkRequestSupport(PRODUCTS, { kind: "product", normalized: "insulated bag" });
    expect(d.reason.length).toBeGreaterThan(0);
  });
});

describe("below-MOQ and volume groups derive from real catalog numbers", () => {
  it("uses the product's actual minQuantity", () => {
    expect(isBelowMoq(PRODUCTS, 300, "p-custom-takeout")).toBe(true);
    expect(isBelowMoq(PRODUCTS, 500, "p-custom-takeout")).toBe(false);
    expect(isBelowMoq(PRODUCTS, 499)).toBe(true);
    expect(isBelowMoq(PRODUCTS, 0)).toBe(false);
  });

  it("volume groups match the documented boundaries", () => {
    expect(volumeGroupFor(300)).toBe("below_moq");
    expect(volumeGroupFor(500)).toBe("standard_small");
    expect(volumeGroupFor(2499)).toBe("standard_small");
    expect(volumeGroupFor(2500)).toBe("standard_medium");
    expect(volumeGroupFor(10000)).toBe("high_volume");
    expect(VOLUME_GROUPS[0].max).toBe(500);
  });
});

describe("qualified conversation — deterministic rule (§9)", () => {
  const base = { conversation: { status: "active", outcome: null as string | null }, sessionHasQualifyingEvent: false, needProfile: null };

  it("small talk alone never qualifies", () => {
    expect(isQualifiedConversation(base)).toBe(false);
  });

  it("funnel outcomes qualify", () => {
    expect(isQualifiedConversation({ ...base, conversation: { status: "active", outcome: "cart_added" } })).toBe(true);
    expect(isQualifiedConversation({ ...base, conversation: { status: "escalated", outcome: null } })).toBe(true);
  });

  it("a qualifying session event qualifies", () => {
    expect(isQualifiedConversation({ ...base, sessionHasQualifyingEvent: true })).toBe(true);
  });

  it("a supplied requirement qualifies only with trustworthy provenance", () => {
    const profile = (source: string) => ({
      quantity: 5000,
      productInterest: null,
      fieldSourcesJson: { quantity: { source } },
    });
    expect(isQualifiedConversation({ ...base, needProfile: profile("USER_STATED") })).toBe(true);
    expect(isQualifiedConversation({ ...base, needProfile: profile("CONFIGURATOR") })).toBe(true);
    // AI_INFERRED alone is a guess about the customer — it never qualifies (§7).
    expect(isQualifiedConversation({ ...base, needProfile: profile("AI_INFERRED") })).toBe(false);
  });
});

describe("denominators, percentages, trends (§13–§14, §28)", () => {
  it("never emits a percentage under the minimum denominator", () => {
    expect(safePercentage(2, CUSTOMER_INTELLIGENCE.MIN_DENOMINATOR_FOR_PERCENTAGE - 1)).toBeNull();
    expect(safePercentage(8, 42)).toBe(19);
  });

  it("never labels a trend off a tiny base", () => {
    expect(safeTrendPct(3, CUSTOMER_INTELLIGENCE.MIN_TREND_BASE - 1)).toBeNull();
    expect(safeTrendPct(18, 7)).toBe(157);
  });

  it("previous period is the equivalent immediately-preceding window", () => {
    const p = periodFromDays(30, new Date("2026-08-12T00:00:00Z"));
    const prev = previousPeriod(p);
    expect(prev.end.getTime()).toBe(p.start.getTime());
    expect(prev.end.getTime() - prev.start.getTime()).toBe(p.end.getTime() - p.start.getTime());
  });
});
