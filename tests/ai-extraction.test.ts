import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiRuntime, FakeAiProvider } from "@/lib/ai";
import { runNeedExtraction, validateExtraction, type NeedExtraction } from "@/lib/ai/agents/sales";
import { applyNeedProfileUpdate, getNeedProfile } from "@/lib/data/customer-need-service";
import { startConversation } from "@/lib/data/conversation-service";
import { makeSession, resetDb } from "./db-helpers";

/**
 * Evidence-validated need extraction (Session 05 spec §7–§9, §27).
 *
 * The server — not the model — decides provenance: USER_STATED requires
 * verbatim evidence found in the customer's actual message AND a value
 * consistent with that evidence. Hallucinated direct statements are
 * dropped; honest interpretations demote to AI_INFERRED; judgment enums
 * can never be USER_STATED. The provenance rank gate stays the final
 * authority underneath.
 */

const touched = new Set<string>();
function setEnv(key: string, value: string): void {
  touched.add(key);
  process.env[key] = value;
}
afterEach(() => {
  for (const key of touched) delete process.env[key];
  touched.clear();
});
beforeEach(async () => {
  await resetDb();
  setEnv("AI_RUNTIME_ENABLED", "true");
});

const candidates = (list: NeedExtraction["candidates"]): NeedExtraction => ({ candidates: list });

describe("validateExtraction — pure server-side authority", () => {
  it("grants USER_STATED only with verbatim, value-consistent evidence", () => {
    const message = "I own a Thai restaurant in Chicago and need 5,000 large black bags with our logo.";
    const result = validateExtraction(
      candidates([
        { field: "businessType", value: "restaurant", kind: "stated", evidence: "I own a Thai restaurant" },
        { field: "location", value: "Chicago", kind: "stated", evidence: "restaurant in Chicago" },
        { field: "quantity", value: 5000, kind: "stated", evidence: "need 5,000 large black bags" },
        { field: "colorPreference", value: "black", kind: "stated", evidence: "5,000 large black bags" },
        { field: "logoAvailable", value: true, kind: "stated", evidence: "bags with our logo" },
      ]),
      message,
    );
    expect(result.stated).toEqual({
      businessType: "restaurant",
      location: "Chicago",
      quantity: 5000,
      colorPreference: "black",
      logoAvailable: true,
    });
    expect(result.inferred).toEqual({});
    expect(result.dropped).toEqual([]);
  });

  it("DROPS candidates whose evidence is not in the message (hallucinated direct statements)", () => {
    const result = validateExtraction(
      candidates([
        { field: "colorPreference", value: "black", kind: "stated", evidence: "I definitely want black bags" },
        { field: "quantity", value: 9999, kind: "stated", evidence: "I need 9,999 units" },
      ]),
      "I run a coffee shop and want a quote.",
    );
    expect(result.stated).toEqual({});
    expect(result.inferred).toEqual({});
    expect(result.dropped).toEqual([
      { field: "colorPreference", reason: "evidence_not_in_message" },
      { field: "quantity", reason: "evidence_not_in_message" },
    ]);
  });

  it("drops stated candidates with no evidence at all", () => {
    const result = validateExtraction(
      candidates([{ field: "quantity", value: 5000, kind: "stated" }]),
      "I need five thousand bags.",
    );
    expect(result.stated).toEqual({});
    expect(result.dropped).toEqual([{ field: "quantity", reason: "missing_evidence" }]);
  });

  it("demotes to AI_INFERRED when evidence is real but the value is an interpretation", () => {
    const message = "We love dark, moody branding for our bar.";
    const result = validateExtraction(
      candidates([{ field: "colorPreference", value: "black", kind: "stated", evidence: "dark, moody branding" }]),
      message,
    );
    expect(result.stated).toEqual({});
    expect(result.inferred).toEqual({ colorPreference: "black" });
    expect(result.demoted).toEqual(["colorPreference"]);
  });

  it("demotes hedged numbers — 'about 5,000' never becomes an authoritative USER_STATED quantity", () => {
    const message = "We probably need about 5,000 bags for the season.";
    const result = validateExtraction(
      candidates([{ field: "quantity", value: 5000, kind: "stated", evidence: "about 5,000 bags", confidence: 0.9 }]),
      message,
    );
    expect(result.stated).toEqual({});
    expect(result.inferred).toEqual({ quantity: 5000 });
    expect(result.inferredConfidence.quantity).toBe(0.9);
  });

  it("number evidence must contain the value as a COMPLETE number (grouping-tolerant, no partial matches)", () => {
    const message = "I need 5,000 bags.";
    const good = validateExtraction(
      candidates([{ field: "quantity", value: 5000, kind: "stated", evidence: "I need 5,000 bags" }]),
      message,
    );
    expect(good.stated).toEqual({ quantity: 5000 });
    // 500 is a substring of "5000" but NOT a number the customer said — demoted.
    const partial = validateExtraction(
      candidates([{ field: "quantity", value: 500, kind: "stated", evidence: "I need 5,000 bags" }]),
      message,
    );
    expect(partial.stated).toEqual({});
    expect(partial.inferred).toEqual({ quantity: 500 });
    expect(partial.demoted).toEqual(["quantity"]);
    // A number nowhere in the text — also demoted, never USER_STATED.
    const fabricated = validateExtraction(
      candidates([{ field: "quantity", value: 20000, kind: "stated", evidence: "I need 5,000 bags" }]),
      message,
    );
    expect(fabricated.stated).toEqual({});
    expect(fabricated.inferred).toEqual({ quantity: 20000 });
  });

  it("judgment enums (priceSensitivity/purchaseIntent) can NEVER be USER_STATED", () => {
    const message = "Price is my top concern, keep it cheap.";
    const result = validateExtraction(
      candidates([
        { field: "priceSensitivity", value: "high", kind: "stated", evidence: "Price is my top concern" },
        { field: "purchaseIntent", value: "high", kind: "inferred", confidence: 0.4 },
      ]),
      message,
    );
    expect(result.stated).toEqual({});
    expect(result.inferred).toEqual({ priceSensitivity: "high", purchaseIntent: "high" });
    expect(result.demoted).toEqual(["priceSensitivity"]);
  });

  it("rejects values that fail the field schema at either provenance level", () => {
    const result = validateExtraction(
      candidates([
        { field: "quantity", value: -5, kind: "stated", evidence: "-5" },
        { field: "priceSensitivity", value: "extreme", kind: "inferred" },
      ]),
      "-5 extreme",
    );
    expect(result.stated).toEqual({});
    expect(result.inferred).toEqual({});
    expect(result.dropped.map((d) => d.reason)).toEqual(["invalid_value", "invalid_value"]);
  });

  it("boolean evidence needs the field's topic keyword", () => {
    const withKeyword = validateExtraction(
      candidates([{ field: "logoAvailable", value: true, kind: "stated", evidence: "we have a logo ready" }]),
      "Yes, we have a logo ready to go.",
    );
    expect(withKeyword.stated).toEqual({ logoAvailable: true });
    const withoutKeyword = validateExtraction(
      candidates([{ field: "logoAvailable", value: true, kind: "stated", evidence: "Yes, ready to go" }]),
      "Yes, ready to go.",
    );
    expect(withoutKeyword.stated).toEqual({});
    expect(withoutKeyword.inferred).toEqual({ logoAvailable: true });
  });
});

describe("runNeedExtraction — end-to-end with provenance interplay", () => {
  async function extract(sessionId: string, conversationId: string, userMessage: string, scripted: NeedExtraction) {
    const runtime = new AiRuntime({ provider: new FakeAiProvider([{ kind: "text", text: JSON.stringify(scripted) }]) });
    return runNeedExtraction({ runtime, sessionId, conversationId, userMessage });
  }

  it("applies verified statements as USER_STATED and guesses as AI_INFERRED", async () => {
    const session = await makeSession();
    const conv = await startConversation({ sessionId: session.id });
    const message = "I own a Thai restaurant and need 5,000 bags.";
    const outcome = await extract(session.id, conv.id, message, {
      candidates: [
        { field: "businessType", value: "restaurant", kind: "stated", evidence: "I own a Thai restaurant" },
        { field: "quantity", value: 5000, kind: "stated", evidence: "need 5,000 bags" },
        { field: "priceSensitivity", value: "low", kind: "inferred", confidence: 0.4 },
      ],
    });
    expect(outcome.statedApplied.sort()).toEqual(["businessType", "quantity"]);
    expect(outcome.inferredApplied).toEqual(["priceSensitivity"]);

    const profile = await getNeedProfile(session.id);
    expect(profile?.fieldSourcesJson.businessType?.source).toBe("USER_STATED");
    expect(profile?.fieldSourcesJson.quantity?.source).toBe("USER_STATED");
    expect(profile?.fieldSourcesJson.priceSensitivity).toMatchObject({ source: "AI_INFERRED", confidence: 0.4 });
  });

  it("contradiction: a later explicit statement replaces an earlier one; a later AI guess cannot", async () => {
    const session = await makeSession();
    const conv = await startConversation({ sessionId: session.id });

    await extract(session.id, conv.id, "I want black.", {
      candidates: [{ field: "colorPreference", value: "black", kind: "stated", evidence: "I want black" }],
    });
    expect((await getNeedProfile(session.id))?.colorPreference).toBe("black");

    // Explicit reversal — equal rank, newer wins.
    await extract(session.id, conv.id, "Actually make it white.", {
      candidates: [{ field: "colorPreference", value: "white", kind: "stated", evidence: "make it white" }],
    });
    expect((await getNeedProfile(session.id))?.colorPreference).toBe("white");

    // A later model guess of black (no evidence in message) demotes/drops and can never displace white.
    await extract(session.id, conv.id, "What about handles?", {
      candidates: [{ field: "colorPreference", value: "black", kind: "inferred", confidence: 0.9 }],
    });
    const profile = await getNeedProfile(session.id);
    expect(profile?.colorPreference).toBe("white");
    expect(profile?.fieldSourcesJson.colorPreference?.source).toBe("USER_STATED");
  });

  it("over-infer resistance: sparse messages produce sparse profiles (unknown stays unknown)", async () => {
    const session = await makeSession();
    const conv = await startConversation({ sessionId: session.id });
    await extract(session.id, conv.id, "I need bags for my restaurant.", {
      candidates: [
        { field: "businessType", value: "restaurant", kind: "stated", evidence: "for my restaurant" },
        // Model hallucinating extra facts with fabricated evidence — all must die.
        { field: "estimatedDailyOrders", value: 200, kind: "stated", evidence: "we do 200 orders a day" },
        { field: "budgetCents", value: 200000, kind: "stated", evidence: "budget is $2,000" },
        { field: "colorPreference", value: "black", kind: "stated", evidence: "black looks best" },
      ],
    });
    const profile = await getNeedProfile(session.id);
    expect(profile?.businessType).toBe("restaurant");
    expect(profile?.estimatedDailyOrders).toBeNull();
    expect(profile?.budgetCents).toBeNull();
    expect(profile?.colorPreference).toBeNull();
  });

  it("extraction cannot displace what the quote form (USER_STATED) already recorded", async () => {
    const session = await makeSession();
    const conv = await startConversation({ sessionId: session.id });
    await applyNeedProfileUpdate(session.id, { quantity: 10000 }, "USER_STATED");
    // Evidence-verified 5,000 from a NEWER message legitimately replaces it (equal rank, newer wins) —
    // while a demoted/inferred quantity cannot.
    await extract(session.id, conv.id, "Let's do about 3,000 instead.", {
      candidates: [{ field: "quantity", value: 3000, kind: "stated", evidence: "about 3,000 instead" }],
    });
    const profile = await getNeedProfile(session.id);
    // hedged ⇒ AI_INFERRED ⇒ rank 0 < USER_STATED 4 ⇒ 10000 stands.
    expect(profile?.quantity).toBe(10000);
    expect(profile?.fieldSourcesJson.quantity?.source).toBe("USER_STATED");
  });
});
