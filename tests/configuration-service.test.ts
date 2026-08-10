import { beforeEach, describe, expect, it } from "vitest";
import { getActiveConfiguration, upsertActiveConfiguration } from "@/lib/data/configuration-service";
import { makeSession, resetDb } from "./db-helpers";

const config = (overrides: Record<string, unknown> = {}) => ({
  productId: "p-1",
  sizeId: "m",
  materialId: "standard",
  colorId: "white",
  printOptionId: "none" as const,
  quantity: 5000,
  artwork: null,
  ...overrides,
});

describe("configuration snapshots", () => {
  beforeEach(resetDb);

  it("keeps ONE versioned row per session × product", async () => {
    const session = await makeSession();
    const v1 = await upsertActiveConfiguration({
      sessionId: session.id,
      productId: "p-1",
      config: config(),
      source: "configurator",
    });
    expect(v1.version).toBe(1);

    const v2 = await upsertActiveConfiguration({
      sessionId: session.id,
      productId: "p-1",
      config: config({ colorId: "black", quantity: 10000 }),
      priceSnapshot: { unitPriceCents: 38, totalCents: 380000, currency: "USD" },
      source: "checkout",
    });
    expect(v2.id).toBe(v1.id); // same row, versioned in place
    expect(v2.version).toBe(2);
    expect(v2.configJson.colorId).toBe("black");
    expect(v2.priceSnapshotJson).toEqual({ unitPriceCents: 38, totalCents: 380000, currency: "USD" });
    expect(v2.source).toBe("checkout");

    const other = await upsertActiveConfiguration({
      sessionId: session.id,
      productId: "p-2",
      config: config({ productId: "p-2" }),
      source: "configurator",
    });
    expect(other.id).not.toBe(v1.id); // separate product, separate row

    const read = await getActiveConfiguration(session.id, "p-1");
    expect(read?.version).toBe(2);
  });

  it("rejects invalid configurations and price snapshots", async () => {
    const session = await makeSession();
    await expect(
      upsertActiveConfiguration({
        sessionId: session.id,
        productId: "p-1",
        config: config({ printOptionId: "glitter" }) as never,
        source: "configurator",
      }),
    ).rejects.toThrow();
    await expect(
      upsertActiveConfiguration({
        sessionId: session.id,
        productId: "p-1",
        config: config(),
        priceSnapshot: { unitPriceCents: -1, totalCents: 0, currency: "USD" },
        source: "checkout",
      }),
    ).rejects.toThrow();
  });
});
