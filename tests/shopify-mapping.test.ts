import { describe, expect, it } from "vitest";
import { PRODUCTS } from "@/config/products";
import {
  merchandiseKey,
  requiredMerchandiseKeys,
  resolveMerchandise,
  SHOPIFY_MERCHANDISE_MAP,
  validateMerchandiseMap,
} from "@/config/shopify";

/**
 * Production Launch Session 02 §5, §53 — deterministic merchandise mapping.
 *
 * The rule under test: an unmapped configuration must be IMPOSSIBLE to buy.
 * Shipping a customer the wrong physical bag is worse than failing their
 * checkout, so there is no nearest match, no default variant, no "first
 * variant of the product", and no AI anywhere near this.
 */

const V = (n: number) => `gid://shopify/ProductVariant/${n}`;

/** A complete, valid test mapping built from the REAL catalog. */
function fullMap(): Record<string, string> {
  const out: Record<string, string> = {};
  requiredMerchandiseKeys().forEach(({ key }, i) => {
    out[key] = V(1000 + i);
  });
  return out;
}

describe("merchandise keys", () => {
  it("are built from product · size · material · color and nothing else", () => {
    expect(merchandiseKey({ productId: "p-custom-takeout", sizeId: "m", materialId: "standard", colorId: "white" })).toBe(
      "p-custom-takeout|m|standard|white",
    );
  });

  it("are deterministic — the same configuration always produces the same key", () => {
    const config = { productId: "p-custom-takeout", sizeId: "l", materialId: "heavy", colorId: "navy" };
    expect(merchandiseKey(config)).toBe(merchandiseKey({ ...config }));
  });

  it("do NOT include print option or quantity — those are price, not merchandise", () => {
    const key = merchandiseKey({ productId: "p-custom-takeout", sizeId: "m", materialId: "standard", colorId: "white" });
    expect(key).not.toMatch(/one-color|two-color|none/);
    expect(key).not.toMatch(/\d{3,}/);
  });
});

describe("the required key set comes from the real catalog", () => {
  const required = requiredMerchandiseKeys();

  it("covers every product in the catalog", () => {
    for (const product of PRODUCTS) {
      expect(required.some((r) => r.key.startsWith(`${product.id}|`))).toBe(true);
    }
  });

  it("only lists a product's OWN sizes and materials", () => {
    // p-heavy-duty drops the small size and offers only the heavy material.
    const heavy = required.filter((r) => r.key.startsWith("p-heavy-duty|"));
    expect(heavy.length).toBeGreaterThan(0);
    for (const { key } of heavy) {
      const [, sizeId, materialId] = key.split("|");
      expect(["m", "l", "xl"]).toContain(sizeId);
      expect(materialId).toBe("heavy");
    }
  });

  it("EXCLUDES custom colors — they are quote-only and can never reach checkout", () => {
    expect(required.some((r) => r.key.endsWith("|custom"))).toBe(false);
  });

  it("contains no duplicates", () => {
    expect(new Set(required.map((r) => r.key)).size).toBe(required.length);
  });

  it("carries a human label for each key so the owner knows what to map", () => {
    for (const { label } of required) expect(label).toMatch(/ · /);
  });
});

describe("resolution is exact-match only — no fallback of any kind", () => {
  const map = fullMap();

  it("resolves a mapped configuration", () => {
    const result = resolveMerchandise(
      { productId: "p-custom-takeout", sizeId: "m", materialId: "standard", colorId: "white" },
      map,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.variantGid).toMatch(/^gid:\/\/shopify\/ProductVariant\/\d+$/);
  });

  it("fails on an unknown product rather than picking another product's variant", () => {
    const result = resolveMerchandise({ productId: "p-nope", sizeId: "m", materialId: "standard", colorId: "white" }, map);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("unmapped_configuration");
  });

  it("fails on an unknown size rather than falling back to a mapped size", () => {
    const result = resolveMerchandise(
      { productId: "p-custom-takeout", sizeId: "xxl", materialId: "standard", colorId: "white" },
      map,
    );
    expect(result.ok).toBe(false);
  });

  it("fails on an unknown material", () => {
    const result = resolveMerchandise(
      { productId: "p-custom-takeout", sizeId: "m", materialId: "titanium", colorId: "white" },
      map,
    );
    expect(result.ok).toBe(false);
  });

  it("fails on an unknown color", () => {
    const result = resolveMerchandise(
      { productId: "p-custom-takeout", sizeId: "m", materialId: "standard", colorId: "chartreuse" },
      map,
    );
    expect(result.ok).toBe(false);
  });

  it("fails on a MISSING mapping even though the configuration is valid", () => {
    const partial = { ...map };
    delete partial["p-custom-takeout|m|standard|white"];
    const result = resolveMerchandise(
      { productId: "p-custom-takeout", sizeId: "m", materialId: "standard", colorId: "white" },
      partial,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("unmapped_configuration");
  });

  it("fails on a malformed variant id rather than sending it to Shopify", () => {
    const result = resolveMerchandise(
      { productId: "p-custom-takeout", sizeId: "m", materialId: "standard", colorId: "white" },
      { "p-custom-takeout|m|standard|white": "44123456789012" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("invalid_variant_id");
  });

  it("is not fooled by inherited Object prototype keys", () => {
    const result = resolveMerchandise(
      { productId: "constructor", sizeId: "m", materialId: "standard", colorId: "white" },
      {},
    );
    expect(result.ok).toBe(false);
  });

  it("performs NO fuzzy matching — a near-miss key resolves to nothing", () => {
    const result = resolveMerchandise(
      { productId: "p-custom-takeout ", sizeId: "M", materialId: "Standard", colorId: "White" },
      map,
    );
    expect(result.ok).toBe(false);
  });
});

describe("mapping validation", () => {
  it("reports the shipped EMPTY map as incomplete, not as an error", () => {
    const result = validateMerchandiseMap(SHOPIFY_MERCHANDISE_MAP);
    expect(result.complete).toBe(false);
    expect(result.mappedCount).toBe(0);
    expect(result.requiredCount).toBeGreaterThan(0);
    expect(result.issues.every((i) => i.severity === "missing")).toBe(true);
    expect(result.issues[0].message).toContain("[TO BE PROVIDED]");
  });

  it("accepts a complete valid map", () => {
    const result = validateMerchandiseMap(fullMap());
    expect(result.complete).toBe(true);
    expect(result.mappedCount).toBe(result.requiredCount);
    expect(result.issues).toEqual([]);
  });

  it("ERRORS on a DUPLICATE variant — one of them would sell the wrong item", () => {
    const map = fullMap();
    const keys = Object.keys(map);
    map[keys[1]] = map[keys[0]];
    const result = validateMerchandiseMap(map);
    expect(result.complete).toBe(false);
    expect(result.issues.some((i) => i.severity === "error" && /both map to/.test(i.message))).toBe(true);
  });

  it("ERRORS on a key that is not a purchasable configuration (typo)", () => {
    const map = fullMap();
    map["p-custom-takeout|m|standard|puce"] = V(9999);
    const result = validateMerchandiseMap(map);
    expect(result.issues.some((i) => i.severity === "error" && /not a purchasable/.test(i.message))).toBe(true);
  });

  it("ERRORS on a malformed GID", () => {
    const map = fullMap();
    map[Object.keys(map)[0]] = "gid://shopify/Product/123";
    const result = validateMerchandiseMap(map);
    expect(result.issues.some((i) => i.severity === "error" && /ProductVariant GID/.test(i.message))).toBe(true);
  });

  it("counts a partially filled map honestly", () => {
    const map = fullMap();
    const keys = Object.keys(map);
    delete map[keys[0]];
    delete map[keys[1]];
    const result = validateMerchandiseMap(map);
    expect(result.complete).toBe(false);
    expect(result.mappedCount).toBe(result.requiredCount - 2);
    expect(result.issues.filter((i) => i.severity === "missing")).toHaveLength(2);
  });
});

describe("no production ids are hard-coded (§6)", () => {
  it("the shipped mapping is empty — the owner supplies every id", () => {
    expect(Object.keys(SHOPIFY_MERCHANDISE_MAP)).toEqual([]);
  });
});
