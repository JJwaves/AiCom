import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/checkout/route";
import { PRODUCTS } from "@/config/products";

/**
 * Server-side checkout re-quote. The mock provider is active (no Shopify
 * env in tests), so these exercise the real validation + re-pricing path
 * the storefront uses in development.
 */

const product = PRODUCTS[0]; // tiers: 5000 → 42¢; one-color +5¢

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validLine(overrides: Record<string, unknown> = {}, configOverrides: Record<string, unknown> = {}) {
  return {
    lineId: "L1",
    config: {
      productId: product.id,
      sizeId: "m",
      materialId: "standard",
      colorId: "white",
      printOptionId: "none",
      quantity: 5000,
      artwork: null,
      ...configOverrides,
    },
    proposedUnitPriceCents: 42,
    proposedTotalCents: 42 * 5000,
    ...overrides,
  };
}

describe("POST /api/checkout", () => {
  it("accepts a valid cart and returns the server-priced order", async () => {
    const res = await POST(makeRequest({ lines: [validLine()], attribution: { utm_source: "test" } }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.result.kind).toBe("mock");
    expect(data.result.orderId).toMatch(/^MOCK-/);
    expect(data.order.cart.lines).toHaveLength(1);
    expect(data.order.cart.lines[0].unitPriceCents).toBe(42);
    expect(data.order.cart.lines[0].totalCents).toBe(42 * 5000);
    expect(data.order.cart.lines[0].title).toBe(product.title);
    expect(data.order.cart.currency).toBe("USD");
    expect(data.order.attribution).toEqual({ utm_source: "test" });
    expect(typeof data.order.createdAt).toBe("string");
  });

  it("re-prices tampered totals with 409 and the authoritative quote", async () => {
    const res = await POST(
      makeRequest({
        lines: [validLine({ proposedUnitPriceCents: 1, proposedTotalCents: 5000 })],
        attribution: {},
      }),
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("REPRICED");
    expect(data.lines[0]).toEqual({ lineId: "L1", quantity: 5000, unitPriceCents: 42, totalCents: 42 * 5000 });
  });

  it("prices option deltas server-side (one-color print with artwork)", async () => {
    const res = await POST(
      makeRequest({
        lines: [
          validLine(
            { proposedUnitPriceCents: 47, proposedTotalCents: 47 * 5000 },
            {
              printOptionId: "one-color",
              artwork: { fileName: "logo.png", fileType: "image/png", fileSizeBytes: 2048 },
            },
          ),
        ],
        attribution: {},
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.order.cart.lines[0].unitPriceCents).toBe(47);
  });

  it("rejects printed lines without artwork", async () => {
    const res = await POST(
      makeRequest({ lines: [validLine({}, { printOptionId: "one-color", artwork: null })], attribution: {} }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe("INVALID");
    expect(data.errors[0].reason).toMatch(/artwork/i);
  });

  it("rejects below-MOQ quantities (custom-quote territory)", async () => {
    const res = await POST(
      makeRequest({
        lines: [validLine({ proposedUnitPriceCents: 62, proposedTotalCents: 62 * 100 }, { quantity: 100 })],
        attribution: {},
      }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.errors[0].reason).toMatch(/custom quote/i);
  });

  it("rejects custom colors (custom-quote territory)", async () => {
    const res = await POST(makeRequest({ lines: [validLine({}, { colorId: "custom" })], attribution: {} }));
    expect(res.status).toBe(422);
  });

  it("rejects unknown products and unknown option ids", async () => {
    const unknownProduct = await POST(
      makeRequest({ lines: [validLine({}, { productId: "p-nope" })], attribution: {} }),
    );
    expect(unknownProduct.status).toBe(422);

    const unknownSize = await POST(makeRequest({ lines: [validLine({}, { sizeId: "xxl" })], attribution: {} }));
    expect(unknownSize.status).toBe(422);
    const data = await unknownSize.json();
    expect(data.errors[0].reason).toMatch(/size/i);
  });

  it("rejects malformed JSON with 400 and schema violations with 422", async () => {
    const malformed = await POST(makeRequest("{not json"));
    expect(malformed.status).toBe(400);

    const badShape = await POST(makeRequest({ lines: [] }));
    expect(badShape.status).toBe(422);

    const negativeQty = await POST(makeRequest({ lines: [validLine({}, { quantity: -5 })], attribution: {} }));
    expect(negativeQty.status).toBe(422);
  });
});
