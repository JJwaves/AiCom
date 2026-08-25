import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/configuration/route";
import { PRODUCTS } from "@/config/products";
import { defaultConfiguration } from "@/lib/configuration/validation";
import { getActiveConfiguration } from "@/lib/data/configuration-service";
import { applyNeedProfileUpdate, getNeedProfile } from "@/lib/data/customer-need-service";
import { makeSession, resetDb } from "./db-helpers";

/**
 * Session 06 — /api/configuration: the persistence route behind the shared
 * configurator store (manual UI sync + tapped AI suggestions). Everything
 * revalidates server-side; CONFIGURATOR provenance flows to the need
 * profile; GET restores the session's configuration after reload.
 */

const product = PRODUCTS[0];

const post = (body: unknown, cookie?: string): Promise<Response> =>
  POST(
    new Request("http://localhost/api/configuration", {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const get = (productId: string, cookie?: string): Promise<Response> =>
  GET(
    new Request(`http://localhost/api/configuration?productId=${encodeURIComponent(productId)}`, {
      method: "GET",
      headers: cookie ? { cookie } : {},
    }),
  );

const sidCookie = (res: Response): string =>
  res.headers
    .getSetCookie()
    .find((c) => c.startsWith("bd_sid="))!
    .split(";")[0];

beforeEach(resetDb);

describe("POST /api/configuration — full-config sync (the configurator's debounced write)", () => {
  it("persists the configuration with source configurator, returns revision, sets cookies", async () => {
    const config = { ...defaultConfiguration(product), colorId: "black", quantity: 5000 };
    const res = await post({ productId: product.id, config });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; configuration: { revision: number; price: { totalCents: number } | null } };
    expect(data.ok).toBe(true);
    expect(data.configuration.revision).toBe(1);
    expect(data.configuration.price).not.toBeNull();
    expect(res.headers.getSetCookie().some((c) => c.startsWith("bd_sid="))).toBe(true);
  });

  it("increments the revision on every sync (same session cookie)", async () => {
    const config = defaultConfiguration(product);
    const first = await post({ productId: product.id, config });
    const cookie = sidCookie(first);
    const second = await post({ productId: product.id, config: { ...config, quantity: 10_000 } }, cookie);
    const data = (await second.json()) as { configuration: { revision: number } };
    expect(data.configuration.revision).toBe(2);
  });

  it("writes CONFIGURATOR need-profile evidence through the rank gate", async () => {
    const session = await makeSession();
    await applyNeedProfileUpdate(session.id, { quantity: 3000 }, "USER_STATED");
    const config = { ...defaultConfiguration(product), colorId: "white", quantity: 5000 };
    const res = await post({ productId: product.id, config }, `bd_sid=${session.id}`);
    expect(res.status).toBe(200);
    const profile = await getNeedProfile(session.id);
    expect(profile?.colorPreference).toBe("white");
    expect(profile?.fieldSourcesJson.colorPreference).toMatchObject({ source: "CONFIGURATOR" });
    // USER_STATED quantity survives the configurator write.
    expect(profile?.quantity).toBe(3000);
    expect(profile?.fieldSourcesJson.quantity).toMatchObject({ source: "USER_STATED" });
  });

  it("rejects configurations with unknown option ids (422 + structured issues)", async () => {
    const config = { ...defaultConfiguration(product), colorId: "purple" };
    const res = await post({ productId: product.id, config });
    expect(res.status).toBe(422);
    const data = (await res.json()) as { code: string; issues: Array<{ field: string; available: string[] }> };
    expect(data.code).toBe("UNSUPPORTED_OPTION");
    expect(data.issues[0].field).toBe("colorId");
    expect(data.issues[0].available).toContain("black");
  });

  it("404s unknown products and 400s malformed JSON", async () => {
    const unknown = await post({ productId: "p-nope", config: defaultConfiguration(product) });
    expect(unknown.status).toBe(404);
    const malformed = await post("{not json");
    expect(malformed.status).toBe(400);
  });

  it("413s oversized bodies", async () => {
    const res = await post({
      productId: product.id,
      config: { ...defaultConfiguration(product), artwork: { fileName: "x".repeat(40_000), fileType: "image/png", fileSizeBytes: 1 } },
    });
    expect(res.status).toBe(413);
  });
});

describe("POST /api/configuration — patch apply (tapped AI suggestion)", () => {
  it("applies a valid patch on top of the CURRENT configuration", async () => {
    const seeded = await post({ productId: product.id, config: { ...defaultConfiguration(product), colorId: "white" } });
    const cookie = sidCookie(seeded);
    const res = await post({ productId: product.id, patch: { quantity: 10_000 } }, cookie);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { configuration: { config: { colorId: string; quantity: number }; revision: number } };
    expect(data.configuration.config.colorId).toBe("white"); // preserved
    expect(data.configuration.config.quantity).toBe(10_000);
    expect(data.configuration.revision).toBe(2);
  });

  it("a stale suggestion cannot blindly overwrite — expectedRevision mismatch answers 409 with current state", async () => {
    const seeded = await post({ productId: product.id, config: defaultConfiguration(product) });
    const cookie = sidCookie(seeded);
    await post({ productId: product.id, config: { ...defaultConfiguration(product), quantity: 7500 } }, cookie); // rev 2
    const res = await post({ productId: product.id, patch: { quantity: 10_000 }, expectedRevision: 1 }, cookie);
    expect(res.status).toBe(409);
    const data = (await res.json()) as { code: string; configuration: { config: { quantity: number }; revision: number } };
    expect(data.code).toBe("STALE_REVISION");
    expect(data.configuration.config.quantity).toBe(7500);
    expect(data.configuration.revision).toBe(2);
  });

  it("re-validates the patch against the catalog on apply (a stale/corrupt chip cannot inject options)", async () => {
    const seeded = await post({ productId: product.id, config: defaultConfiguration(product) });
    const cookie = sidCookie(seeded);
    const res = await post({ productId: product.id, patch: { colorId: "purple" } }, cookie);
    expect(res.status).toBe(422);
  });

  it("rejects patches with price/artwork/unknown fields at the schema boundary", async () => {
    for (const patch of [{ unitPriceCents: 1 }, { artwork: { fileName: "x" } }, {}]) {
      const res = await post({ productId: product.id, patch });
      expect(res.status).toBe(422);
    }
  });
});

describe("GET /api/configuration — session restore", () => {
  it("returns null without a session cookie and for sessions with no row", async () => {
    const noCookie = await get(product.id);
    expect(((await noCookie.json()) as { configuration: unknown }).configuration).toBeNull();
    const session = await makeSession();
    const empty = await get(product.id, `bd_sid=${session.id}`);
    expect(((await empty.json()) as { configuration: unknown }).configuration).toBeNull();
  });

  it("returns the live configuration + revision for the session (reload restoration)", async () => {
    const seeded = await post({
      productId: product.id,
      config: { ...defaultConfiguration(product), sizeId: "l", colorId: "black", quantity: 5000 },
    });
    const cookie = sidCookie(seeded);
    const res = await get(product.id, cookie);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      configuration: { config: { sizeId: string; colorId: string; quantity: number }; revision: number };
    };
    expect(data.configuration.config).toMatchObject({ sizeId: "l", colorId: "black", quantity: 5000 });
    expect(data.configuration.revision).toBe(1);
  });

  it("does not leak configurations across sessions", async () => {
    const seeded = await post({ productId: product.id, config: { ...defaultConfiguration(product), quantity: 25_000 } });
    expect(seeded.status).toBe(200);
    const stranger = await makeSession();
    const res = await get(product.id, `bd_sid=${stranger.id}`);
    expect(((await res.json()) as { configuration: unknown }).configuration).toBeNull();
  });
});

describe("cart consistency (spec §34) — the cart line and the persisted row are the same state", () => {
  it("the row the AI/UI wrote is exactly what a checkout line for this session would carry", async () => {
    // The cart snapshots the SAME client store state that syncs here, so
    // asserting row ↔ config equality pins the server half of the loop.
    const session = await makeSession();
    const config = {
      ...defaultConfiguration(product),
      sizeId: "l",
      colorId: "black",
      quantity: 5000,
      artwork: { fileName: "logo.png", fileType: "image/png", fileSizeBytes: 123 },
    };
    const res = await post({ productId: product.id, config }, `bd_sid=${session.id}`);
    expect(res.status).toBe(200);
    const row = await getActiveConfiguration(session.id, product.id);
    // customDimensions normalizes to null through the validated path.
    expect(row?.configJson).toEqual({ ...config, customDimensions: null });
  });
});
