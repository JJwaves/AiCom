import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUSINESS, PROOF_POLICY, showsDemoPricing } from "@/config/business";
import { COST_MODEL } from "@/config/costs";
import { LAUNCH_PRODUCTS, PRODUCTS, getProductBySlug } from "@/config/products";
import { estimateShipping, FLAT_US_SHIPPING_CENTS, FLAT_US_SHIPPING_COPY } from "@/config/shipping";
import { requiredMerchandiseKeys, SHOPIFY_MERCHANDISE_MAP, validateMerchandiseMap } from "@/config/shopify";
import {
  getCatalogProduct,
  getCatalogProductById,
  listAllCatalogProducts,
  listCatalogProducts,
} from "@/lib/commerce/catalog";
import { buildDraftOrderInput, verifyDraftOrderPricing } from "@/lib/commerce/shopify";
import { calculatePrice, quoteConfiguration, requiresCustomQuote } from "@/modules/pricing";
import { productChecks } from "@/modules/launch-readiness/checks";
import { testMerchandiseMap } from "./shopify-helpers";
import type { Cart, CartLine, ProductConfiguration } from "@/types/commerce";

/**
 * PRODUCT #1 — Custom Insulated Takeout Bag.
 *
 * The launch contract, asserted end to end. Where a number is a business
 * fact the owner confirmed (a price, the MOQ, the shipping charge), it is
 * written out as a literal rather than recomputed from the same constants
 * the code uses — otherwise the test would agree with a typo.
 */

const product = PRODUCTS[0];

const config = (over: Partial<ProductConfiguration> = {}): ProductConfiguration => ({
  productId: product.id,
  sizeId: "l",
  materialId: "insulated",
  colorId: "black",
  printOptionId: "full-custom",
  quantity: 5000,
  artwork: { artworkId: "art_test", fileName: "logo.png", fileType: "image/png", fileSizeBytes: 1024 },
  ...over,
});

const repoFile = (relative: string): string => readFileSync(join(process.cwd(), relative), "utf8");

/* ------------------------------------------------------------------ */
/* Launch scope                                                        */
/* ------------------------------------------------------------------ */

describe("only Product #1 is launch-enabled", () => {
  it("exactly one catalog entry is launch-enabled, and it is the insulated bag", () => {
    expect(LAUNCH_PRODUCTS).toHaveLength(1);
    expect(LAUNCH_PRODUCTS[0].id).toBe("p-custom-takeout");
    expect(LAUNCH_PRODUCTS[0].title).toBe("Custom Insulated Takeout Bag");
    expect(LAUNCH_PRODUCTS[0].slug).toBe("custom-insulated-takeout-bags");
  });

  it("the demo seed products still exist but are launch-disabled", () => {
    const disabled = PRODUCTS.filter((p) => !p.launchEnabled);
    // Kept as catalog architecture, not deleted — and every one still
    // carries DEMO pricing, which is exactly why none may be reachable.
    expect(disabled.length).toBeGreaterThan(0);
    expect(disabled.every((p) => p.pricingStatus === "DEMO")).toBe(true);
  });

  it("a launch-disabled product cannot be reached through the catalog facade", async () => {
    for (const p of PRODUCTS.filter((x) => !x.launchEnabled)) {
      expect(await getCatalogProduct(p.slug)).toBeNull();
      expect(await getCatalogProductById(p.id)).toBeNull();
      expect(getProductBySlug(p.slug)).toBeUndefined();
    }
    expect(await listCatalogProducts()).toEqual(LAUNCH_PRODUCTS);
    // Configuration validation still sees the whole file.
    expect(await listAllCatalogProducts()).toEqual(PRODUCTS);
  });

  it("no other product can masquerade as a live launch offer", () => {
    for (const p of PRODUCTS) {
      if (p.launchEnabled) continue;
      expect(p.pricingStatus).toBe("DEMO");
      // showsDemoPricing is OR, so a demo product is demo whatever the flag says.
      expect(showsDemoPricing(p)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Sizes, colors, material, printing                                   */
/* ------------------------------------------------------------------ */

describe("what the customer may choose", () => {
  it("offers exactly two sizes with the confirmed centimetre dimensions", () => {
    expect(product.sizes.map((s) => [s.id, s.label, s.dimensions, s.unit])).toEqual([
      ["l", "Large", { width: 26, height: 26, gusset: 17 }, "cm"],
      ["xl", "Extra Large", { width: 30, height: 30, gusset: 20 }, "cm"],
    ]);
  });

  it("does not launch Small, Medium, bubble-tea or cake sizes", () => {
    expect(product.sizes.map((s) => s.id).sort()).toEqual(["l", "xl"]);
  });

  it("offers exactly Black and White, with no custom-color selector", () => {
    expect(product.colors.map((c) => c.id)).toEqual(["black", "white"]);
    expect(product.colors.some((c) => c.custom)).toBe(false);
  });

  it("makes the construction a SPECIFICATION, not a selectable material", () => {
    // One material entry means the configurator renders no material control
    // (it only renders one when there is a choice) and the AI has nothing to
    // offer. GSM/thickness/insulation structure are not options at all.
    expect(product.materials).toHaveLength(1);
    expect(product.materials[0].id).toBe("insulated");
    const specs = product.specifications.map((s) => `${s.label}: ${s.value}`).join(" | ");
    expect(specs).toContain("PP laminated");
    expect(specs).toContain("Non-woven fabric");
    expect(specs).toContain("Aluminium foil");
  });

  it("exposes NO print-colour-count selector — one printing option, artwork required", () => {
    expect(product.printOptions).toHaveLength(1);
    expect(product.printOptions[0].id).toBe("full-custom");
    expect(product.printOptions[0].requiresArtwork).toBe(true);
    // Nothing offers "1 colour / 2 colours / 3 colours".
    expect(product.printOptions.some((o) => /\b(one|two|three|\d)[- ]?colou?r/i.test(o.label))).toBe(false);
  });

  it("promises no handle style, because none is factory-confirmed", () => {
    expect(product.handles).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* MOQ + quantity rules                                                */
/* ------------------------------------------------------------------ */

describe("MOQ and orderable quantities", () => {
  it("MOQ is 5,000 per design and is marked CONFIRMED", () => {
    expect(product.minQuantity).toBe(5_000);
    expect(BUSINESS.MOQ).toBe(5_000);
    expect(BUSINESS.MOQ_CONFIRMED).toBe(true);
  });

  it("direct checkout offers only 5,000 and 10,000", () => {
    expect(product.quantityPresets).toEqual([5_000, 10_000]);
    expect(product.allowCustomQuantity).toBe(false);
  });

  it("below 5,000 routes to the quote flow, never to checkout", () => {
    for (const quantity of [1, 500, 2_500, 4_999]) {
      expect(requiresCustomQuote(product, config({ quantity }))).toBe(true);
      const calc = calculatePrice(product, config({ quantity }));
      expect(calc.ok).toBe(false);
      if (!calc.ok) expect(calc.reason).toBe("requires_custom_quote");
    }
  });

  it("above 10,000 routes to the quote flow — no >10k price is invented", () => {
    for (const quantity of [10_001, 12_000, 25_000, 100_000]) {
      expect(requiresCustomQuote(product, config({ quantity }))).toBe(true);
    }
  });

  it("an off-tier quantity between the tiers is also a quote", () => {
    expect(requiresCustomQuote(product, config({ quantity: 7_500 }))).toBe(true);
  });

  it("a custom size routes to the quote flow", () => {
    expect(requiresCustomQuote(product, config({ customDimensions: { width: 40, height: 40, gusset: 25 } }))).toBe(
      true,
    );
  });
});

/* ------------------------------------------------------------------ */
/* The four confirmed prices                                           */
/* ------------------------------------------------------------------ */

describe("sell prices are the four confirmed launch numbers", () => {
  const total = (sizeId: string, quantity: number) =>
    quoteConfiguration(product, config({ sizeId, quantity }))!.totalCents;

  it("Large 5,000 = $950", () => expect(total("l", 5_000)).toBe(95_000));
  it("Large 10,000 = $1,500", () => expect(total("l", 10_000)).toBe(150_000));
  it("Extra Large 5,000 = $1,150", () => expect(total("xl", 5_000)).toBe(115_000));
  it("Extra Large 10,000 = $1,900", () => expect(total("xl", 10_000)).toBe(190_000));

  it("is marked LIVE, not DEMO", () => {
    expect(product.pricingStatus).toBe("LIVE");
  });

  it("uses whole cents everywhere — no fractional-cent money is introduced", () => {
    // The supplier's historic XL job implies $0.185/bag; the MVP deliberately
    // sells at $0.19 rather than making the money model fractional.
    for (const size of product.sizes) {
      for (const quantity of product.quantityPresets) {
        const q = quoteConfiguration(product, config({ sizeId: size.id, quantity }))!;
        expect(Number.isInteger(q.unitPriceCents)).toBe(true);
        expect(Number.isInteger(q.totalCents)).toBe(true);
      }
    }
    expect(quoteConfiguration(product, config({ sizeId: "xl", quantity: 10_000 }))!.unitPriceCents).toBe(19);
  });

  it("prices are deterministic — the same configuration always gives the same number", () => {
    const a = quoteConfiguration(product, config({ sizeId: "xl", quantity: 10_000 }));
    const b = quoteConfiguration(product, config({ sizeId: "xl", quantity: 10_000 }));
    expect(a).toEqual(b);
  });
});

/* ------------------------------------------------------------------ */
/* Shipping                                                            */
/* ------------------------------------------------------------------ */

describe("flat U.S. shipping", () => {
  it("is $100 per order", () => {
    expect(FLAT_US_SHIPPING_CENTS).toBe(10_000);
    expect(FLAT_US_SHIPPING_COPY).toContain("$100 per order");
  });

  it("is charged once per ORDER, not once per line", () => {
    const line = (lineId: string, sizeId: string, unit: number): CartLine => ({
      lineId,
      config: config({ sizeId }),
      unitPriceCents: unit,
      totalCents: unit * 5_000,
      title: product.title,
      optionSummary: sizeId,
    });
    const cart: Cart = { currency: "USD", lines: [line("L1", "l", 19), line("L2", "xl", 23)] };
    const input = buildDraftOrderInput(cart, {}, {}, testMerchandiseMap());

    expect(input.lineItems).toHaveLength(2);
    expect(input.shippingLine.priceWithCurrency.amount).toBe("100.00");
    // There is exactly one shipping charge in the whole request.
    expect(JSON.stringify(input).match(/100\.00/g)).toHaveLength(1);
  });

  it("checkout verification rejects a doubled shipping charge", () => {
    const cart: Cart = {
      currency: "USD",
      lines: [
        {
          lineId: "L1",
          config: config(),
          unitPriceCents: 19,
          totalCents: 95_000,
          title: product.title,
          optionSummary: "Large",
        },
      ],
    };
    const draft = {
      currencyCode: "USD",
      subtotalPriceSet: { shopMoney: { amount: "950.00", currencyCode: "USD" } },
      totalShippingPriceSet: { shopMoney: { amount: "200.00", currencyCode: "USD" } },
      lineItems: {
        nodes: [
          {
            quantity: 5_000,
            originalUnitPriceSet: { shopMoney: { amount: "0.19", currencyCode: "USD" } },
            originalTotalSet: { shopMoney: { amount: "950.00", currencyCode: "USD" } },
          },
        ],
      },
    };
    const result = verifyDraftOrderPricing(cart, draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toMatch(/shipping/);
  });

  it("the product subtotal never includes shipping", () => {
    // Large 5,000: product $950, shipping $100, pre-tax total $1,050.
    const subtotal = quoteConfiguration(product, config())!.totalCents;
    expect(subtotal).toBe(95_000);
    expect(subtotal + FLAT_US_SHIPPING_CENTS).toBe(105_000);
    // XL 10,000: product $1,900, shipping $100, pre-tax total $2,000.
    const xl = quoteConfiguration(product, config({ sizeId: "xl", quantity: 10_000 }))!.totalCents;
    expect(xl + FLAT_US_SHIPPING_CENTS).toBe(200_000);
  });

  it("quotes the flat rate for the US and refuses markets we do not serve", () => {
    expect(estimateShipping("94107")).toMatchObject({ mode: "flat", costCents: 10_000 });
    expect(estimateShipping("M5V 2T6")).toMatchObject({ mode: "unavailable" });
  });

  it("markets are US-only during the launch", () => {
    expect(BUSINESS.MARKETS).toEqual(["US"]);
  });
});

/* ------------------------------------------------------------------ */
/* Artwork, proof and lead time                                        */
/* ------------------------------------------------------------------ */

describe("artwork, digital proof and production lead time", () => {
  it("artwork is required — a configuration without it cannot be a cart line", () => {
    expect(product.printOptions.every((o) => o.requiresArtwork)).toBe(true);
  });

  it("the proof copy says a proof comes BEFORE production, and production starts after approval", () => {
    expect(PROOF_POLICY.included).toBe(true);
    expect(PROOF_POLICY.detail).toBe(
      "A digital proof will be provided for your approval before production begins.",
    );
    expect(PROOF_POLICY.productionStart).toBe("Production starts after artwork approval.");
  });

  it("lead time is 15–30 days AFTER proof approval, never 'ships in 15 days'", () => {
    expect(PROOF_POLICY.leadTime).toBe(
      "Production typically takes 15–30 days after you approve your digital proof.",
    );
    expect(BUSINESS.STANDARD_PRODUCTION_TIME).toBe("15–30 days after artwork approval");
    expect(PROOF_POLICY.leadTime).not.toMatch(/ships in/i);
  });

  it("transit time stays [TO BE PROVIDED] — no carrier is contracted, so none is promised", () => {
    expect(BUSINESS.STANDARD_SHIPPING_TIME).toContain("TO BE PROVIDED");
  });
});

/* ------------------------------------------------------------------ */
/* Shopify merchandise requirements                                    */
/* ------------------------------------------------------------------ */

describe("Shopify merchandise requirements", () => {
  it("requires exactly the four enabled combinations: 2 sizes × 2 colors", () => {
    const required = requiredMerchandiseKeys();
    expect(required).toHaveLength(4);
    expect(required.map((r) => r.key).sort()).toEqual([
      "p-custom-takeout|l|insulated|black",
      "p-custom-takeout|l|insulated|white",
      "p-custom-takeout|xl|insulated|black",
      "p-custom-takeout|xl|insulated|white",
    ]);
  });

  it("neither quantity nor printing nor artwork multiplies the variant count", () => {
    const keys = requiredMerchandiseKeys().map((r) => r.key);
    for (const key of keys) {
      expect(key).not.toMatch(/5000|10000|full-custom|art_/);
    }
  });

  it("reports 4 required / 0 mapped / 4 missing until the owner supplies GIDs", () => {
    const validation = validateMerchandiseMap(SHOPIFY_MERCHANDISE_MAP);
    expect(validation.requiredCount).toBe(4);
    expect(validation.mappedCount).toBe(0);
    expect(validation.issues.filter((i) => i.severity === "missing")).toHaveLength(4);
    expect(validation.complete).toBe(false);
  });

  it("a missing GID remains a launch blocker and fails checkout closed", () => {
    // No fake mapping is shipped, and building a draft order without one
    // throws rather than substituting a variant.
    expect(Object.keys(SHOPIFY_MERCHANDISE_MAP)).toHaveLength(0);
    const cart: Cart = {
      currency: "USD",
      lines: [
        {
          lineId: "L1",
          config: config(),
          unitPriceCents: 19,
          totalCents: 95_000,
          title: product.title,
          optionSummary: "Large",
        },
      ],
    };
    expect(() => buildDraftOrderInput(cart, {})).toThrow(/UNMAPPED|no Shopify variant/i);
  });
});

/* ------------------------------------------------------------------ */
/* Unit economics stay honest                                          */
/* ------------------------------------------------------------------ */

describe("unit economics", () => {
  it("no supplier CNY figure is injected into the USD cost model", () => {
    const costs = repoFile("config/costs.ts");
    // The CNY reference numbers may appear ONLY inside the explanatory
    // comment block, never as configured values.
    const configuredSection = costs.slice(costs.indexOf("export const COST_MODEL: CostModelConfig"));
    for (const cny of ["0.67", "0.81", "310", "400", "10500", "10,500"]) {
      expect(configuredSection, `CNY reference ${cny} must not be configured`).not.toContain(cny);
    }
    expect(costs).toContain("¥"); // documented as a non-authoritative reference
  });

  it("Product #1 costs are all null, so profit analytics stay unavailable", () => {
    const entry = COST_MODEL.products[product.id];
    expect(entry.baseManufacturingCentsPerUnit).toBeNull();
    expect(entry.sizeAdjustmentCentsPerUnit).toBeNull();
    expect(entry.materialAdjustmentCentsPerUnit).toBeNull();
    expect(entry.printing).toBeNull();
    expect(entry.packagingCentsPerUnit).toBeNull();
    expect(entry.shipping).toBeNull();
    expect(entry.otherVariableCentsPerUnit).toBeNull();

    const calc = calculatePrice(product, config());
    expect(calc.ok).toBe(true);
    if (!calc.ok) return;
    expect(calc.costStatus).toBe("unconfigured");
    expect(calc.grossProfitCents).toBeNull();
    expect(calc.contributionProfitCents).toBeNull();
    expect(calc.grossMarginPct).toBeNull();
  });

  it("missing costs still do not block the sale — the price is unaffected", () => {
    const calc = calculatePrice(product, config());
    expect(calc.ok).toBe(true);
    if (calc.ok) expect(calc.totalPriceCents).toBe(95_000);
  });

  it("the $100 shipping charge is recorded as a CUSTOMER CHARGE, not as freight cost", () => {
    expect(COST_MODEL.shippingPolicy.customerCharge).toEqual({
      kind: "flat_per_order",
      centsPerOrder: FLAT_US_SHIPPING_CENTS,
    });
    // The freight COST it would offset is still unknown, and is not faked.
    expect(COST_MODEL.products[product.id].shipping).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Launch readiness                                                    */
/* ------------------------------------------------------------------ */

describe("launch readiness reflects the real state", () => {
  const saved = process.env.NEXT_PUBLIC_DEMO_PRICING;
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_DEMO_PRICING;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_DEMO_PRICING;
    else process.env.NEXT_PUBLIC_DEMO_PRICING = saved;
  });

  it("the MOQ check is READY now that 5,000 is confirmed", () => {
    const moq = productChecks().find((c) => c.id === "product.moq")!;
    expect(moq.state).toBe("READY");
  });

  it("product photography is still reported as incomplete", () => {
    const images = productChecks().find((c) => c.id === "product.images")!;
    expect(images.state).toBe("WARNING");
    expect(images.summary).toContain("hero-black");
    expect(images.action).toMatch(/never AI-generated/i);
  });

  it("pricing stays BLOCKED until the owner also sets NEXT_PUBLIC_DEMO_PRICING=false", () => {
    const blocked = productChecks().find((c) => c.id === "product.pricing_live")!;
    expect(blocked.state).toBe("BLOCKED");
    process.env.NEXT_PUBLIC_DEMO_PRICING = "false";
    const ready = productChecks().find((c) => c.id === "product.pricing_live")!;
    expect(ready.state).toBe("READY");
  });

  it("readiness is not made green: the Shopify mapping is still a blocker", () => {
    expect(validateMerchandiseMap(SHOPIFY_MERCHANDISE_MAP).complete).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Price authority regression (§32)                                    */
/* ------------------------------------------------------------------ */

describe("price authority is unchanged", () => {
  it("the checkout route still re-prices with the engine and answers 409 REPRICED", () => {
    const route = repoFile("app/api/checkout/route.ts");
    expect(route).toContain('from "@/modules/pricing"');
    expect(route).toContain('code: "REPRICED"');
    expect(route).toContain("status: 409");
  });

  it("the client cannot submit a price — only a PROPOSED one, compared against the server quote", () => {
    const schema = repoFile("lib/validation/checkout.ts");
    expect(schema).toContain("proposedUnitPriceCents");
    expect(schema).not.toMatch(/\bprice:\s*z\./);
  });

  it("Shopify receives the engine price as an explicit override and is read back for verification", () => {
    const source = repoFile("lib/commerce/shopify.ts");
    expect(source).toContain("priceOverride");
    expect(source).toContain("verifyDraftOrderPricing");
    // The provider computes no price of its own.
    expect(source).not.toMatch(/pricingTiers|calculatePrice|@\/modules\/pricing/);
  });

  it("the pricing module never imports AI", () => {
    for (const file of ["modules/pricing/engine.ts", "modules/pricing/index.ts", "modules/pricing/cost-model.ts"]) {
      expect(repoFile(file)).not.toMatch(/@\/lib\/ai/);
    }
  });
});
