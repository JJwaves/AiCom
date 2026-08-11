import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJsonText, parseStructured, toProviderJsonSchema } from "@/lib/ai/schemas/structured";
import { estimateCostMicros, isModelPriced } from "@/lib/ai/usage/cost";
import { AI_MODEL_PRICING } from "@/config/ai-pricing";

describe("structured output parsing (untrusted AI JSON)", () => {
  const schema = z.object({ name: z.string(), qty: z.number().int().positive() });

  it("extracts JSON from fences and surrounding prose", () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonText('Sure! Here you go: {"a":1} — anything else?')).toBe('{"a":1}');
    expect(extractJsonText('{"a":1}')).toBe('{"a":1}');
  });

  it("accepts schema-valid output", () => {
    const result = parseStructured('{"name":"tote","qty":500}', schema);
    expect(result).toEqual({ ok: true, value: { name: "tote", qty: 500 } });
  });

  it("rejects unparsable JSON with a typed reason", () => {
    const result = parseStructured("not json at all", schema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unparsable_json");
  });

  it("rejects schema mismatches with the offending paths", () => {
    const result = parseStructured('{"name":"tote","qty":-2}', schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("schema_mismatch");
      expect(result.issues).toContain("qty");
    }
  });

  it("never lets extra unvalidated structure through zod strict objects", () => {
    const strict = z.strictObject({ a: z.number() });
    const result = parseStructured('{"a":1,"injected":"x"}', strict);
    expect(result.ok).toBe(false);
  });
});

describe("provider JSON-schema sanitizer", () => {
  it("strips constraints providers reject but keeps shape, enums and required", () => {
    const schema = z.object({
      title: z.string().min(1).max(100),
      qty: z.number().int().min(1).max(9999),
      mode: z.enum(["a", "b"]),
      tags: z.array(z.string().max(10)).max(5).optional(),
    });
    const json = toProviderJsonSchema(schema);
    const str = JSON.stringify(json);
    expect(str).not.toContain("maxLength");
    expect(str).not.toContain("minimum");
    expect(str).not.toContain("maxItems");
    expect(str).not.toContain("$schema");
    expect(json.additionalProperties).toBe(false);
    const props = json.properties as Record<string, Record<string, unknown>>;
    expect(props.mode.enum).toEqual(["a", "b"]);
    expect(json.required).toContain("title");
  });

  it("keeps supported string formats and drops unsupported ones", () => {
    const schema = z.object({ mail: z.email(), other: z.string().regex(/^x/) });
    const json = toProviderJsonSchema(schema);
    const props = json.properties as Record<string, Record<string, unknown>>;
    expect(props.mail.format).toBe("email");
    expect(props.other.pattern).toBeUndefined();
  });
});

describe("AI cost model (config/ai-pricing.ts)", () => {
  it("ships null placeholders — no invented prices, cost estimates null", () => {
    for (const model of Object.keys(AI_MODEL_PRICING)) {
      expect(isModelPriced(model)).toBe(false);
    }
    expect(estimateCostMicros("claude-sonnet-5", 1000, 1000)).toBeNull();
    expect(estimateCostMicros("completely-unknown-model", 1000, 1000)).toBeNull();
  });

  it("computes micro-dollar costs once pricing is configured", () => {
    AI_MODEL_PRICING["test-priced-model"] = { usdPerMTokIn: 1, usdPerMTokOut: 5 };
    try {
      expect(isModelPriced("test-priced-model")).toBe(true);
      // 1200 in × $1/MTok + 300 out × $5/MTok = 1200 + 1500 micro-dollars.
      expect(estimateCostMicros("test-priced-model", 1200, 300)).toBe(2700);
      expect(estimateCostMicros("test-priced-model", undefined, 300)).toBeNull();
    } finally {
      delete AI_MODEL_PRICING["test-priced-model"];
    }
  });
});
