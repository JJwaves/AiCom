import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/checkout/route";
import { PRODUCTS } from "@/config/products";
import { getOrder } from "@/lib/data/order-service";
import { SESSION_COOKIE } from "@/lib/data/session-service";
import { makeSession, uploadedArtwork } from "./db-helpers";

/**
 * Server-side checkout re-quote. The mock provider is active (no Shopify
 * env in tests), so these exercise the real validation + re-pricing path
 * the storefront uses in development.
 */

/**
 * Product #1 — Custom Insulated Takeout Bag.
 *   Large  5,000 → 19¢/bag   Extra Large 5,000 → 23¢/bag (+4¢ size delta)
 *   Large 10,000 → 15¢/bag   Extra Large 10,000 → 19¢/bag
 * Its only print option requires artwork, so every valid line carries a
 * durable artwork id.
 */
const product = PRODUCTS[0];

function makeRequest(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validLine(overrides: Record<string, unknown> = {}, configOverrides: Record<string, unknown> = {}) {
  return {
    lineId: "L1",
    config: {
      productId: product.id,
      sizeId: "l",
      materialId: "insulated",
      colorId: "black",
      printOptionId: "full-custom",
      quantity: 5000,
      artwork: null,
      ...configOverrides,
    },
    proposedUnitPriceCents: 19,
    proposedTotalCents: 19 * 5000,
    ...overrides,
  };
}

describe("POST /api/checkout", () => {
  it("accepts a valid cart and returns the server-priced order", async () => {
    const { cookie, artwork } = await uploadedArtwork();
    const res = await POST(
      makeRequest({ lines: [validLine({}, { artwork })], attribution: { utm_source: "test" } }, cookie),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.result.kind).toBe("mock");
    expect(data.result.orderId).toMatch(/^MOCK-/);
    // Production Launch Session 03 §3: the response carries BAGDIRECT's own
    // order id and NOT a copy of the order. A client-held order payload was
    // what the old confirmation page fired its purchase event from.
    expect(data.orderId).toMatch(/^ord_/);
    expect(data.order).toBeUndefined();

    const record = await getOrder(data.orderId);
    expect(record?.lines).toHaveLength(1);
    expect(record?.lines[0].unitPriceCents).toBe(19);
    expect(record?.lines[0].totalCents).toBe(19 * 5000);
    expect(record?.lines[0].title).toBe(product.title);
    expect(record?.order.currency).toBe("USD");
    expect(record?.order.attributionJson).toEqual({ utm_source: "test" });
  });

  it("re-prices tampered totals with 409 and the authoritative quote", async () => {
    const { cookie, artwork } = await uploadedArtwork();
    const res = await POST(
      makeRequest({
        lines: [validLine({ proposedUnitPriceCents: 1, proposedTotalCents: 5000 }, { artwork })],
        attribution: {},
      }, cookie),
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("REPRICED");
    expect(data.lines[0]).toEqual({ lineId: "L1", quantity: 5000, unitPriceCents: 19, totalCents: 19 * 5000 });
  });

  it("prices the size delta server-side (Extra Large is +4¢/bag)", async () => {
    const { cookie, artwork } = await uploadedArtwork();
    const res = await POST(
      makeRequest(
        {
          lines: [
            validLine({ proposedUnitPriceCents: 23, proposedTotalCents: 23 * 5000 }, { sizeId: "xl", artwork }),
          ],
          attribution: {},
        },
        cookie,
      ),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    const record = await getOrder(data.orderId);
    expect(record?.lines[0].unitPriceCents).toBe(23);
    expect(record?.lines[0].totalCents).toBe(115_000);
  });

  it("charges the four confirmed launch prices and nothing else", async () => {
    const cases = [
      { sizeId: "l", quantity: 5000, unit: 19, total: 95_000 },
      { sizeId: "l", quantity: 10000, unit: 15, total: 150_000 },
      { sizeId: "xl", quantity: 5000, unit: 23, total: 115_000 },
      { sizeId: "xl", quantity: 10000, unit: 19, total: 190_000 },
    ];
    for (const c of cases) {
      const { cookie, artwork } = await uploadedArtwork();
      const res = await POST(
        makeRequest(
          {
            lines: [
              validLine(
                { proposedUnitPriceCents: c.unit, proposedTotalCents: c.total },
                { sizeId: c.sizeId, quantity: c.quantity, artwork },
              ),
            ],
            attribution: {},
          },
          cookie,
        ),
      );
      expect(res.status, `${c.sizeId} × ${c.quantity}`).toBe(200);
      const record = await getOrder((await res.json()).orderId);
      expect(record?.lines[0].totalCents, `${c.sizeId} × ${c.quantity}`).toBe(c.total);
    }
  });

  it("refuses a quantity that is neither 5,000 nor 10,000 — no price was ever published for it", async () => {
    const { cookie, artwork } = await uploadedArtwork();
    const res = await POST(
      makeRequest(
        {
          lines: [
            validLine({ proposedUnitPriceCents: 15, proposedTotalCents: 15 * 12_000 }, { quantity: 12_000, artwork }),
          ],
          attribution: {},
        },
        cookie,
      ),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).errors[0].reason).toMatch(/custom quote/i);
  });

  it("refuses a printed line whose artwork is only a legacy browser object URL", async () => {
    const res = await POST(
      makeRequest({
        lines: [
          validLine(
            {},
            {
              // A cart saved before durable storage: no artworkId, just a
              // blob: URL that died with the tab.
              artwork: {
                fileName: "logo.png",
                fileType: "image/png",
                fileSizeBytes: 2048,
                url: "blob:http://localhost/9f2c",
              },
            },
          ),
        ],
        attribution: {},
      }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.errors[0].reason).toMatch(/re-upload/i);
  });

  it("refuses an artwork id belonging to a different session", async () => {
    const { artwork } = await uploadedArtwork();
    const other = await makeSession();
    const res = await POST(
      makeRequest(
        {
          lines: [validLine({}, { artwork })],
          attribution: {},
        },
        `${SESSION_COOKIE}=${other.id}`,
      ),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.errors[0].reason).toMatch(/upload it again/i);
  });

  it("rejects printed lines without artwork", async () => {
    const res = await POST(
      makeRequest({ lines: [validLine({}, { artwork: null })], attribution: {} }),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe("INVALID");
    expect(data.errors[0].reason).toMatch(/artwork/i);
  });

  it("rejects below-MOQ quantities (custom-quote territory)", async () => {
    const { cookie, artwork } = await uploadedArtwork();
    const res = await POST(
      makeRequest({
        lines: [
          validLine({ proposedUnitPriceCents: 19, proposedTotalCents: 19 * 100 }, { quantity: 100, artwork }),
        ],
        attribution: {},
      }, cookie),
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.errors[0].reason).toMatch(/custom quote/i);
  });

  it("rejects colors the launch product does not offer", async () => {
    const res = await POST(makeRequest({ lines: [validLine({}, { colorId: "kraft" })], attribution: {} }));
    expect(res.status).toBe(422);
    expect((await res.json()).errors[0].reason).toMatch(/color/i);
  });

  it("rejects a launch-disabled product — it is not in the catalog a customer can buy from", async () => {
    const res = await POST(makeRequest({ lines: [validLine({}, { productId: "p-cafe-carryout" })], attribution: {} }));
    expect(res.status).toBe(422);
    expect((await res.json()).errors[0].reason).toMatch(/unknown product/i);
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
