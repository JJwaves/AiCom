import { describe, expect, it } from "vitest";
import { validateArtworkFile, ARTWORK_MAX_BYTES } from "@/lib/validation/artwork";
import { quoteSchema } from "@/lib/validation/quote";
import { detectMarket, estimateShipping } from "@/config/shipping";

describe("validateArtworkFile", () => {
  it("accepts a PNG", () => {
    expect(validateArtworkFile({ name: "logo.png", type: "image/png", size: 1024 })).toEqual({ ok: true });
  });
  it("accepts .ai with empty MIME (browser quirk)", () => {
    expect(validateArtworkFile({ name: "logo.ai", type: "", size: 1024 }).ok).toBe(true);
  });
  it("rejects unsupported extensions", () => {
    expect(validateArtworkFile({ name: "logo.docx", type: "application/msword", size: 10 }).ok).toBe(false);
  });
  it("rejects a spoofed extension with wrong MIME", () => {
    expect(validateArtworkFile({ name: "logo.png", type: "application/x-msdownload", size: 10 }).ok).toBe(false);
  });
  it("rejects oversized files", () => {
    expect(validateArtworkFile({ name: "logo.pdf", type: "application/pdf", size: ARTWORK_MAX_BYTES + 1 }).ok).toBe(false);
  });
  it("rejects empty files", () => {
    expect(validateArtworkFile({ name: "logo.pdf", type: "application/pdf", size: 0 }).ok).toBe(false);
  });
});

describe("quoteSchema", () => {
  const valid = {
    businessName: "Blue Fin Sushi",
    contactName: "Sam Lee",
    email: "sam@bluefin.example",
    productType: "Custom takeout bag",
    quantity: "5000",
  };
  it("accepts a minimal valid request", () => {
    expect(quoteSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects a bad email", () => {
    expect(quoteSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });
  it("rejects missing business name", () => {
    expect(quoteSchema.safeParse({ ...valid, businessName: "" }).success).toBe(false);
  });
});

describe("shipping market detection", () => {
  it("detects US ZIP codes", () => {
    expect(detectMarket("10001")).toBe("US");
    expect(detectMarket("94103-1234")).toBe("US");
  });
  it("detects Canadian postal codes", () => {
    expect(detectMarket("M5V 2T6")).toBe("CA");
    expect(detectMarket("m5v2t6")).toBe("CA");
  });
  it("rejects garbage", () => {
    expect(detectMarket("hello")).toBeNull();
  });
  it("returns checkout mode (no invented prices) when no rate source is set", () => {
    const est = estimateShipping("10001");
    expect(est.mode).toBe("checkout");
  });
});
