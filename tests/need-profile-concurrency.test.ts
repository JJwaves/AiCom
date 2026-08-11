import { beforeEach, describe, expect, it } from "vitest";
import {
  applyNeedProfileUpdate,
  getNeedProfile,
  type NeedProfileUpdate,
} from "@/lib/data/customer-need-service";
import { makeSession, resetDb } from "./db-helpers";

/**
 * Session 05 prerequisite — CustomerNeedProfile concurrent-writer safety.
 *
 * applyNeedProfileUpdate is read-merge-write over a jsonb provenance map;
 * without the SELECT … FOR UPDATE transaction added in Session 05, two
 * concurrent writers could read the same snapshot and the later UPDATE
 * would erase the earlier writer's fields and provenance entries. These
 * tests drive real concurrent writers through the service and assert no
 * update — and no provenance rank decision — is ever lost.
 */

beforeEach(async () => {
  await resetDb();
});

describe("concurrent disjoint writers", () => {
  it("keeps every field when many writers update different fields at once", async () => {
    const session = await makeSession();
    const writes: NeedProfileUpdate[] = [
      { businessType: "restaurant" },
      { quantity: 5000 },
      { colorPreference: "black" },
      { location: "Chicago" },
      { printingRequirement: "logo front" },
      { logoAvailable: true },
      { materialPreference: "heavy" },
      { desiredCapacity: "3 takeout containers" },
    ];

    await Promise.all(writes.map((update) => applyNeedProfileUpdate(session.id, update, "AI_INFERRED")));

    const profile = await getNeedProfile(session.id);
    expect(profile).not.toBeNull();
    expect(profile).toMatchObject({
      businessType: "restaurant",
      quantity: 5000,
      colorPreference: "black",
      location: "Chicago",
      printingRequirement: "logo front",
      logoAvailable: true,
      materialPreference: "heavy",
      desiredCapacity: "3 takeout containers",
    });
    // Every field's provenance entry survived the concurrent merges too.
    const sourceKeys = Object.keys(profile!.fieldSourcesJson);
    for (const update of writes) {
      expect(sourceKeys).toContain(Object.keys(update)[0]);
    }
  });

  it("resolves a concurrent creation race to exactly one profile row holding all writes", async () => {
    const session = await makeSession();
    // No profile exists yet — all writers race through the insert path.
    await Promise.all([
      applyNeedProfileUpdate(session.id, { businessType: "cafe" }, "AI_INFERRED"),
      applyNeedProfileUpdate(session.id, { quantity: 1000 }, "AI_INFERRED"),
      applyNeedProfileUpdate(session.id, { colorPreference: "kraft" }, "AI_INFERRED"),
      applyNeedProfileUpdate(session.id, { location: "Toronto" }, "AI_INFERRED"),
    ]);
    const profile = await getNeedProfile(session.id);
    expect(profile).toMatchObject({
      businessType: "cafe",
      quantity: 1000,
      colorPreference: "kraft",
      location: "Toronto",
    });
  });
});

describe("provenance precedence under concurrency", () => {
  it("a concurrent AI_INFERRED write never displaces a USER_STATED value (either arrival order)", async () => {
    // Run several rounds — interleaving is scheduler-dependent; the invariant must hold every time.
    for (let round = 0; round < 5; round++) {
      await resetDb();
      const session = await makeSession();
      await Promise.all([
        applyNeedProfileUpdate(session.id, { colorPreference: "white" }, "USER_STATED"),
        applyNeedProfileUpdate(session.id, { colorPreference: "black" }, "AI_INFERRED", { confidence: 0.9 }),
      ]);
      const profile = await getNeedProfile(session.id);
      // If AI committed first, USER_STATED overwrote it (rank 4 ≥ 0).
      // If USER_STATED committed first, the AI write was dropped (0 < 4).
      expect(profile?.colorPreference).toBe("white");
      expect(profile?.fieldSourcesJson.colorPreference?.source).toBe("USER_STATED");
    }
  });

  it("serialized merges see prior committed provenance: stale-map overwrite is impossible", async () => {
    const session = await makeSession();
    // Seed a strong fact, then fire a burst of weak writers against it plus other fields.
    await applyNeedProfileUpdate(session.id, { quantity: 5000 }, "USER_STATED");
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        applyNeedProfileUpdate(session.id, { quantity: 100 + i, painPoints: [`concern-${i}`] }, "AI_INFERRED"),
      ),
    );
    const profile = await getNeedProfile(session.id);
    expect(profile?.quantity).toBe(5000);
    expect(profile?.fieldSourcesJson.quantity?.source).toBe("USER_STATED");
    // The weak writers' own field DID land (last committed burst member wins among equals).
    expect(profile?.painPointsJson?.[0]).toMatch(/^concern-/);
  });
});

describe("per-field confidence (Session 05 extraction support)", () => {
  it("fieldConfidence overrides the update-wide confidence per field", async () => {
    const session = await makeSession();
    const { appliedFields } = await applyNeedProfileUpdate(
      session.id,
      { businessType: "restaurant", quantity: 5000 },
      "AI_INFERRED",
      { confidence: 0.5, fieldConfidence: { quantity: 0.95 } },
    );
    expect(appliedFields.sort()).toEqual(["businessType", "quantity"]);
    const profile = await getNeedProfile(session.id);
    expect(profile?.fieldSourcesJson.businessType?.confidence).toBe(0.5);
    expect(profile?.fieldSourcesJson.quantity?.confidence).toBe(0.95);
  });

  it("rejects out-of-range fieldConfidence", async () => {
    const session = await makeSession();
    await expect(
      applyNeedProfileUpdate(session.id, { quantity: 10 }, "AI_INFERRED", { fieldConfidence: { quantity: 1.5 } }),
    ).rejects.toThrow(/confidence/);
  });
});
