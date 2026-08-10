import { beforeEach, describe, expect, it } from "vitest";
import { applyNeedProfileUpdate, getNeedProfile } from "@/lib/data/customer-need-service";
import { makeSession, resetDb } from "./db-helpers";

describe("CustomerNeedProfile progressive enrichment + provenance", () => {
  beforeEach(resetDb);

  it("enriches progressively — unknown stays unknown", async () => {
    const session = await makeSession();

    await applyNeedProfileUpdate(session.id, { businessType: "restaurant" }, "USER_STATED");
    let profile = await getNeedProfile(session.id);
    expect(profile?.businessType).toBe("restaurant");
    expect(profile?.quantity).toBeNull(); // not fabricated

    await applyNeedProfileUpdate(session.id, { quantity: 5000 }, "CONFIGURATOR");
    await applyNeedProfileUpdate(session.id, { colorPreference: "black" }, "CONFIGURATOR");
    profile = await getNeedProfile(session.id);
    expect(profile?.businessType).toBe("restaurant");
    expect(profile?.quantity).toBe(5000);
    expect(profile?.colorPreference).toBe("black");
    expect(profile?.fieldSourcesJson.businessType.source).toBe("USER_STATED");
    expect(profile?.fieldSourcesJson.quantity.source).toBe("CONFIGURATOR");
  });

  it("weaker sources never overwrite stronger ones", async () => {
    const session = await makeSession();
    await applyNeedProfileUpdate(session.id, { quantity: 5000 }, "USER_STATED");

    const { appliedFields } = await applyNeedProfileUpdate(session.id, { quantity: 9999 }, "AI_INFERRED", {
      confidence: 0.9,
    });
    expect(appliedFields).toEqual([]);
    expect((await getNeedProfile(session.id))?.quantity).toBe(5000);

    // CONFIGURATOR (2) < USER_STATED (4): still blocked.
    await applyNeedProfileUpdate(session.id, { quantity: 7777 }, "CONFIGURATOR");
    expect((await getNeedProfile(session.id))?.quantity).toBe(5000);
  });

  it("stronger or equal sources do overwrite (newer same-rank info wins)", async () => {
    const session = await makeSession();
    await applyNeedProfileUpdate(session.id, { priceSensitivity: "high" }, "AI_INFERRED", { confidence: 0.4 });
    let profile = await getNeedProfile(session.id);
    expect(profile?.priceSensitivity).toBe("high");
    expect(profile?.fieldSourcesJson.priceSensitivity.confidence).toBe(0.4);

    // AI refines its own inference (equal rank).
    await applyNeedProfileUpdate(session.id, { priceSensitivity: "medium" }, "AI_INFERRED", { confidence: 0.8 });
    expect((await getNeedProfile(session.id))?.priceSensitivity).toBe("medium");

    // The customer states it: overwrites, and afterwards AI can't take it back.
    await applyNeedProfileUpdate(session.id, { priceSensitivity: "low" }, "USER_STATED");
    await applyNeedProfileUpdate(session.id, { priceSensitivity: "high" }, "AI_INFERRED", { confidence: 0.99 });
    profile = await getNeedProfile(session.id);
    expect(profile?.priceSensitivity).toBe("low");
    expect(profile?.fieldSourcesJson.priceSensitivity.source).toBe("USER_STATED");

    // ORDER_DATA (3) outranks CONFIGURATOR (2).
    await applyNeedProfileUpdate(session.id, { quantity: 1000 }, "CONFIGURATOR");
    await applyNeedProfileUpdate(session.id, { quantity: 5000 }, "ORDER_DATA");
    await applyNeedProfileUpdate(session.id, { quantity: 250 }, "CONFIGURATOR");
    expect((await getNeedProfile(session.id))?.quantity).toBe(5000);
  });

  it("rejects invalid input instead of storing it", async () => {
    const session = await makeSession();
    await expect(applyNeedProfileUpdate(session.id, { quantity: -5 }, "USER_STATED")).rejects.toThrow();
    await expect(
      applyNeedProfileUpdate(session.id, { priceSensitivity: "extreme" as never }, "USER_STATED"),
    ).rejects.toThrow();
    await expect(
      applyNeedProfileUpdate(session.id, { businessName: "x".repeat(501) }, "USER_STATED"),
    ).rejects.toThrow();
    await expect(applyNeedProfileUpdate(session.id, { quantity: 10 }, "AI_INFERRED", { confidence: 3 })).rejects.toThrow();
    expect(await getNeedProfile(session.id)).toBeNull(); // nothing partial was written
  });

  it("requires a real session (no orphan profiles)", async () => {
    await expect(
      applyNeedProfileUpdate(`sess_${"0".repeat(32)}`, { businessType: "cafe" }, "USER_STATED"),
    ).rejects.toThrow();
  });
});
