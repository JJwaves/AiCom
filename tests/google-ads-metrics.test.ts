import { beforeEach, describe, expect, it } from "vitest";
import { FakeGoogleAdsReportingProvider, runGoogleAdsSync } from "@/lib/google-ads";
import {
  aggregateNative,
  buildGoogleAdsIntelligenceSnapshot,
  CampaignMatcher,
  checkCurrencyCompatibility,
  computeDiscrepancy,
  computeEfficiency,
  isGoogleAdsSession,
  normalizeCampaignName,
  periodFromDays,
  customPeriod,
} from "@/modules/google-ads-intelligence";
import { loadAdSpendSummary } from "@/modules/google-ads-intelligence/spend";
import { resetDb } from "./db-helpers";
import {
  campaignTouch,
  CONFIGURED_CREDENTIALS,
  day,
  GCLID_TOUCH,
  ORGANIC_TOUCH,
  seedAdOrder,
  seedAdSession,
  UNCONFIGURED_CREDENTIALS,
  UTM_ONLY_TOUCH,
} from "./gads-helpers";

/**
 * Session 13 — metric tests (spec §63) and SEMANTIC BOUNDARY tests (spec §64).
 *
 * The §64 block is the one that matters most: it asserts, in code, that
 * Google's conversions are never BagDirect orders, Google's conversion value
 * is never BagDirect revenue, Google's cost-per-conversion is never our CAC,
 * Google's ROAS is never our ROAS, ROAS is never profit, and a missing
 * integration is never zero.
 */

const NOW = new Date("2026-08-15T12:00:00Z");
const PERIOD = customPeriod(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-31T23:59:59Z"));

beforeEach(async () => {
  await resetDb();
});

async function sync(days: Parameters<typeof day>[0][] | ReturnType<typeof day>[], account = {}) {
  const provider = new FakeGoogleAdsReportingProvider({
    account,
    days: days as ReturnType<typeof day>[],
  });
  await runGoogleAdsSync({
    provider,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    triggeredBy: "admin:test",
    now: NOW,
  });
}

const snapshot = (credentials = CONFIGURED_CREDENTIALS) =>
  buildGoogleAdsIntelligenceSnapshot(PERIOD, credentials, NOW);

/* ------------------------------------------------------------------ */
/* Google-native metrics                                               */
/* ------------------------------------------------------------------ */

describe("Google-native metrics", () => {
  it("sums spend, impressions, clicks and conversions across days and campaigns", async () => {
    await sync([
      day({ campaignId: "111", date: "2026-08-10", impressions: 1_000, clicks: 50, costCents: 12_500, googleConversions: 2, googleConversionValueCents: 210_000 }),
      day({ campaignId: "222", date: "2026-08-11", impressions: 500, clicks: 10, costCents: 2_500, googleConversions: 0, googleConversionValueCents: 0 }),
    ]);
    const s = await snapshot();
    expect(s.google.impressions).toBe(1_500);
    expect(s.google.clicks).toBe(60);
    expect(s.google.costCents).toBe(15_000);
    expect(s.google.googleConversions).toBe(2);
    expect(s.google.campaigns).toBe(2);
    expect(s.google.daysWithData).toBe(2);
  });

  it("computes CTR and CPC from the real denominators", () => {
    const totals = aggregateNative([
      { impressions: 1_000, clicks: 50, costCents: 10_000, currencyCode: "USD", googleConversions: 5, googleConversionValueCents: 100_000, campaignId: "1", date: "2026-08-01" } as never,
    ]);
    expect(totals.ctrPct).toBe(5); // 50 / 1000
    expect(totals.cpcCents).toBe(200); // 10_000 / 50
    expect(totals.googleReportedCostPerConversionCents).toBe(2_000);
    expect(totals.googleReportedRoas).toBe(10);
  });

  it("returns NULL — never 0, never Infinity — for a zero denominator", () => {
    const totals = aggregateNative([
      { impressions: 0, clicks: 0, costCents: 5_000, currencyCode: "USD", googleConversions: 0, googleConversionValueCents: 0, campaignId: "1", date: "2026-08-01" } as never,
    ]);
    expect(totals.ctrPct).toBeNull();
    expect(totals.cpcCents).toBeNull();
    expect(totals.googleReportedCostPerConversionCents).toBeNull();
    expect(Number.isFinite(totals.googleReportedRoas ?? 0)).toBe(true);
  });

  it("suppresses a rate whose denominator is below the documented minimum", () => {
    const totals = aggregateNative([
      { impressions: 3, clicks: 1, costCents: 100, currencyCode: "USD", googleConversions: 0, googleConversionValueCents: 0, campaignId: "1", date: "2026-08-01" } as never,
    ]);
    expect(totals.ctrPct).toBeNull();
  });

  it("reports a null currency when a window mixes currencies, rather than summing money silently", () => {
    const totals = aggregateNative([
      { impressions: 1, clicks: 1, costCents: 100, currencyCode: "USD", googleConversions: 0, googleConversionValueCents: 0, campaignId: "1", date: "2026-08-01" } as never,
      { impressions: 1, clicks: 1, costCents: 100, currencyCode: "EUR", googleConversions: 0, googleConversionValueCents: 0, campaignId: "1", date: "2026-08-02" } as never,
    ]);
    expect(totals.currencyCode).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* First-party attribution                                             */
/* ------------------------------------------------------------------ */

describe("identifying Google Ads traffic", () => {
  const session = (first: unknown) => ({ firstTouchJson: first, lastTouchJson: null }) as never;

  it("treats a click id as proof", () => {
    expect(isGoogleAdsSession(session(GCLID_TOUCH))).toBe(true);
  });

  it("treats google/cpc utm parameters as Google Ads traffic", () => {
    expect(isGoogleAdsSession(session(UTM_ONLY_TOUCH))).toBe(true);
  });

  it("does NOT treat google/organic as paid traffic", () => {
    expect(isGoogleAdsSession(session(ORGANIC_TOUCH))).toBe(false);
  });

  it("does not treat an untagged session as paid traffic", () => {
    expect(isGoogleAdsSession(session(null))).toBe(false);
    expect(isGoogleAdsSession(null)).toBe(false);
  });
});

describe("campaign matching", () => {
  const matcher = () => new CampaignMatcher([{ campaignId: "111", campaignName: "Restaurant Bags" }]);
  const session = (utmCampaign: string) =>
    ({ firstTouchJson: campaignTouch(utmCampaign), lastTouchJson: campaignTouch(utmCampaign) }) as never;

  it("matches the campaign ID as EXACT", () => {
    expect(matcher().match(session("111"))).toEqual({ campaignId: "111", quality: "EXACT" });
  });

  it("matches the campaign NAME as MAPPED, normalizing case, spaces, underscores and hyphens", () => {
    expect(normalizeCampaignName("Restaurant_Bags")).toBe("restaurant bags");
    expect(matcher().match(session("restaurant-bags"))).toEqual({ campaignId: "111", quality: "MAPPED" });
  });

  it("does NOT fuzzy match — a near-miss name is UNMATCHED, not guessed", () => {
    expect(matcher().match(session("Restaurant Bags 2026")).quality).toBe("UNMATCHED");
  });

  it("refuses to attribute when two campaigns normalize to the same name", () => {
    const ambiguous = new CampaignMatcher([
      { campaignId: "111", campaignName: "Restaurant Bags" },
      { campaignId: "222", campaignName: "restaurant_bags" },
    ]);
    expect(ambiguous.ambiguousNameCount).toBe(1);
    expect(ambiguous.match(session("Restaurant Bags")).quality).toBe("UNMATCHED");
  });
});

describe("first-party performance", () => {
  it("counts sessions, funnel stages, orders and revenue for Google Ads traffic only", async () => {
    await sync([day({ campaignId: "111", campaignName: "Restaurant Bags", date: "2026-08-10" })]);
    const paid = await seedAdSession(campaignTouch("Restaurant Bags"), { cart: true, checkout: true, priceView: true });
    await seedAdOrder(paid, { totalCents: 235_000 });
    await seedAdSession(ORGANIC_TOUCH, { cart: true }); // must NOT count
    const organic = await seedAdSession(null, {});
    await seedAdOrder(organic, { totalCents: 999_999 }); // must NOT count

    const s = await snapshot();
    expect(s.firstParty.sessions).toBe(1);
    expect(s.firstParty.cartSessions).toBe(1);
    expect(s.firstParty.checkoutSessions).toBe(1);
    expect(s.firstParty.orders).toBe(1);
    expect(s.firstParty.revenueCents).toBe(235_000);
  });

  it("counts UNMATCHED sessions' revenue in the account total but under no campaign", async () => {
    await sync([day({ campaignId: "111", campaignName: "Restaurant Bags", date: "2026-08-10" })]);
    const unmatched = await seedAdSession(campaignTouch("Some Other Campaign"), {});
    await seedAdOrder(unmatched, { totalCents: 100_000 });

    const s = await snapshot();
    expect(s.firstParty.orders).toBe(1);
    expect(s.firstParty.revenueCents).toBe(100_000);
    expect(s.coverage.unmatchedSessions).toBe(1);
    const campaign = s.campaigns.find((c) => c.campaignId === "111");
    expect(campaign?.firstPartyOrders).toBe(0);
  });

  it("excludes cancelled orders exactly as Session 09 does", async () => {
    await sync([day({ date: "2026-08-10" })]);
    const paid = await seedAdSession(GCLID_TOUCH, {});
    await seedAdOrder(paid, { totalCents: 50_000, status: "cancelled" });
    const s = await snapshot();
    expect(s.firstParty.orders).toBe(0);
    expect(s.firstParty.revenueCents).toBe(0);
  });

  it("reports attribution coverage with an interpretation, not a bare score", async () => {
    await sync([day({ campaignId: "111", campaignName: "Restaurant Bags", date: "2026-08-10" })]);
    for (let i = 0; i < 6; i += 1) await seedAdSession(campaignTouch("Restaurant Bags"), {});
    for (let i = 0; i < 6; i += 1) await seedAdSession(GCLID_TOUCH, {}); // no utm_campaign ⇒ unmatched

    const s = await snapshot();
    expect(s.coverage.googleAdsSessions).toBe(12);
    expect(s.coverage.exactSessions + s.coverage.mappedSessions).toBe(6);
    expect(s.coverage.unmatchedSessions).toBe(6);
    expect(s.coverage.matchedPct).toBe(50);
    expect(s.coverage.interpretation).toMatch(/understated|incomplete|tied to a campaign/i);
  });
});

/* ------------------------------------------------------------------ */
/* Efficiency: CAC / ROAS / POAS                                       */
/* ------------------------------------------------------------------ */

describe("CAC and ROAS", () => {
  const base = {
    costCents: 100_000,
    adCurrency: "USD",
    googleConversions: 5,
    googleConversionValueCents: 500_000,
    firstPartyOrders: 4,
    firstPartyRevenueCents: 400_000,
    revenueCurrencies: ["USD"],
    attributionMatchedPct: 100,
    noAdData: false,
    // Session 13.5: profit inputs. Null here = the shipped state (no cost
    // snapshot on any attributed order), so POAS stays unavailable.
    contributionBeforePaidMediaCents: null as number | null,
    ordersWithContribution: 0,
  };

  it("computes first-party cost per attributed ORDER, with the denominator named", () => {
    const e = computeEfficiency(base);
    expect(e.firstPartyCostPerOrderCents).toEqual({ status: "AVAILABLE", value: 25_000 });
    expect(e.firstPartyCacDenominator).toMatch(/BagDirect orders/);
    expect(e.firstPartyCacDenominator).toMatch(/NOT Google-reported conversions/);
  });

  it("computes Google's cost per conversion SEPARATELY from ours", () => {
    const e = computeEfficiency(base);
    expect(e.googleReportedCostPerConversionCents).toEqual({ status: "AVAILABLE", value: 20_000 });
    // 100_000/5 = 20_000 (Google) vs 100_000/4 = 25_000 (ours). Different numbers.
    expect(e.googleReportedCostPerConversionCents).not.toEqual(e.firstPartyCostPerOrderCents);
  });

  it("computes both ROAS variants separately", () => {
    const e = computeEfficiency({ ...base, googleConversionValueCents: 500_000, firstPartyRevenueCents: 400_000 });
    expect(e.googleReportedRoas).toEqual({ status: "AVAILABLE", value: 5 });
    expect(e.firstPartyRoas).toEqual({ status: "AVAILABLE", value: 4 });
  });

  it("marks first-party figures PARTIAL when attribution coverage is low", () => {
    const e = computeEfficiency({ ...base, attributionMatchedPct: 20 });
    expect(e.firstPartyCostPerOrderCents.status).toBe("PARTIAL");
    expect(e.firstPartyRoas.status).toBe("PARTIAL");
  });

  it("reports UNAVAILABLE with a reason when there is no spend to divide", () => {
    const e = computeEfficiency({ ...base, costCents: 0 });
    expect(e.firstPartyCostPerOrderCents.status).toBe("UNAVAILABLE");
    expect(e.firstPartyRoas.status).toBe("UNAVAILABLE");
    expect(e.googleReportedRoas.status).toBe("UNAVAILABLE");
  });

  it("reports UNAVAILABLE — not zero — when NO ad data has been synced", () => {
    const e = computeEfficiency({ ...base, costCents: 0, noAdData: true });
    expect(e.firstPartyCostPerOrderCents.status).toBe("UNAVAILABLE");
    if (e.firstPartyCostPerOrderCents.status !== "UNAVAILABLE") throw new Error("unreachable");
    expect(e.firstPartyCostPerOrderCents.reason).toMatch(/not zero spend/i);
    expect(e.firstPartyCostPerOrderCents).not.toHaveProperty("value");
  });

  it("reports UNAVAILABLE when there is spend but no attributed order — never division by zero", () => {
    const e = computeEfficiency({ ...base, firstPartyOrders: 0, firstPartyRevenueCents: 0 });
    expect(e.firstPartyCostPerOrderCents.status).toBe("UNAVAILABLE");
    // ROAS is still computable (0 revenue / real spend) but is PARTIAL with a caveat.
    expect(e.firstPartyRoas.status).toBe("PARTIAL");
    if (e.firstPartyRoas.status !== "PARTIAL") throw new Error("unreachable");
    expect(e.firstPartyRoas.reason).toMatch(/not by proof/i);
  });

  it("says Google reported no conversions rather than implying nobody bought", () => {
    const e = computeEfficiency({ ...base, googleConversions: 0 });
    expect(e.googleReportedCostPerConversionCents.status).toBe("UNAVAILABLE");
    if (e.googleReportedCostPerConversionCents.status !== "UNAVAILABLE") throw new Error("unreachable");
    expect(e.googleReportedCostPerConversionCents.reason).toMatch(/does not mean nobody bought/i);
  });
});

describe("currency compatibility gates financial comparison", () => {
  it("allows the comparison when both sides are the same currency", () => {
    expect(checkCurrencyCompatibility("USD", ["USD"])).toEqual({ compatible: true, currency: "USD" });
  });

  it("allows it when there are no orders at all", () => {
    expect(checkCurrencyCompatibility("USD", []).compatible).toBe(true);
  });

  it("BLOCKS CAC and ROAS when the ad account and orders differ", () => {
    const e = computeEfficiency({
      costCents: 100_000,
      adCurrency: "USD",
      googleConversions: 5,
      googleConversionValueCents: 500_000,
      firstPartyOrders: 4,
      firstPartyRevenueCents: 400_000,
      revenueCurrencies: ["CAD"],
      attributionMatchedPct: 100,
      noAdData: false,
      contributionBeforePaidMediaCents: null,
      ordersWithContribution: 0,
    });
    expect(e.currency.compatible).toBe(false);
    expect(e.firstPartyCostPerOrderCents.status).toBe("UNAVAILABLE");
    expect(e.firstPartyRoas.status).toBe("UNAVAILABLE");
    if (e.firstPartyRoas.status !== "UNAVAILABLE") throw new Error("unreachable");
    expect(e.firstPartyRoas.reason).toMatch(/exchange-rate model/i);
    // Google's own ratio is UNAFFECTED: both its sides are in the account currency.
    expect(e.googleReportedRoas.status).toBe("AVAILABLE");
  });

  it("BLOCKS when orders themselves span multiple currencies", () => {
    const result = checkCurrencyCompatibility("USD", ["USD", "CAD"]);
    expect(result.compatible).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* SEMANTIC BOUNDARIES (spec §64)                                      */
/* ------------------------------------------------------------------ */

describe("semantic boundaries — Google's numbers are never ours", () => {
  it("Google conversions ≠ first-party orders", async () => {
    await sync([day({ date: "2026-08-10", googleConversions: 12, googleConversionValueCents: 820_000 })]);
    const paid = await seedAdSession(GCLID_TOUCH, {});
    await seedAdOrder(paid, { totalCents: 710_000 });

    const s = await snapshot();
    expect(s.google.googleConversions).toBe(12);
    expect(s.firstParty.orders).toBe(1);
    expect(s.google.googleConversions).not.toBe(s.firstParty.orders);
    // Structurally: the Google totals object has no `orders` field at all.
    expect(s.google).not.toHaveProperty("orders");
    expect(s.google).not.toHaveProperty("revenueCents");
  });

  it("Google conversion value ≠ BagDirect revenue", async () => {
    await sync([day({ date: "2026-08-10", googleConversionValueCents: 820_000 })]);
    const paid = await seedAdSession(GCLID_TOUCH, {});
    await seedAdOrder(paid, { totalCents: 710_000 });

    const s = await snapshot();
    expect(s.google.googleConversionValueCents).toBe(820_000);
    expect(s.firstParty.revenueCents).toBe(710_000);
    // Structurally: the first-party funnel has no `googleConversions` field.
    expect(s.firstParty).not.toHaveProperty("googleConversions");
    expect(s.firstParty).not.toHaveProperty("googleConversionValueCents");
  });

  it("Google reported CPA ≠ first-party CAC (different denominators, different names)", async () => {
    await sync([day({ date: "2026-08-10", costCents: 100_000, googleConversions: 5 })]);
    const paid = await seedAdSession(GCLID_TOUCH, {});
    await seedAdOrder(paid, { totalCents: 400_000 });

    const s = await snapshot();
    expect(s.efficiency).toHaveProperty("googleReportedCostPerConversionCents");
    expect(s.efficiency).toHaveProperty("firstPartyCostPerOrderCents");
    // There is deliberately no field simply called "cac".
    expect(s.efficiency).not.toHaveProperty("cac");
    expect(s.efficiency).not.toHaveProperty("costPerAcquisition");
  });

  it("Google reported ROAS ≠ first-party ROAS", async () => {
    await sync([day({ date: "2026-08-10", costCents: 100_000, googleConversionValueCents: 500_000 })]);
    const paid = await seedAdSession(GCLID_TOUCH, {});
    await seedAdOrder(paid, { totalCents: 200_000 });

    const s = await snapshot();
    expect(s.efficiency.googleReportedRoas).toEqual({ status: "AVAILABLE", value: 5 });
    expect(s.efficiency.firstPartyRoas).toEqual({ status: "AVAILABLE", value: 2 });
    expect(s.efficiency).not.toHaveProperty("roas");
  });

  it("ROAS is never profit — POAS stays UNAVAILABLE with the config paths named", async () => {
    await sync([day({ date: "2026-08-10", costCents: 100_000, googleConversionValueCents: 500_000 })]);
    const s = await snapshot();
    expect(s.efficiency.profitOnAdSpend.status).toBe("UNAVAILABLE");
    if (s.efficiency.profitOnAdSpend.status !== "UNAVAILABLE") throw new Error("unreachable");
    expect(s.efficiency.profitOnAdSpend.reason).toMatch(/manufacturing costs are not configured/i);
    expect(s.efficiency.profitOnAdSpend).not.toHaveProperty("value");
    expect(s.efficiency.profitBlockers.some((p) => p.includes("config/costs.ts"))).toBe(true);
  });

  it("MISSING CREDENTIALS ≠ ZERO SPEND", async () => {
    const s = await snapshot(UNCONFIGURED_CREDENTIALS);
    expect(s.connection.state).toBe("NOT_CONNECTED");
    expect(s.connection.reason).toMatch(/absent rather than zero/i);
    expect(s.efficiency.firstPartyRoas.status).toBe("UNAVAILABLE");
    expect(s.dataQuality.some((w) => w.code === "GOOGLE_ADS_NOT_CONNECTED")).toBe(true);
    expect(s.signals.some((sig) => sig.kind === "NO_SUCCESSFUL_SYNC")).toBe(true);
  });

  it("CREDENTIALS REMOVED but data already synced: the data stays real, and says so", async () => {
    // A credential rotated away mid-life is a real production state. The
    // previously synced numbers are still real measurements; the page must not
    // blank them out, and must not pretend they are current either.
    await sync([day({ date: "2026-08-10", costCents: 42_500, clicks: 180 })]);
    const s = await snapshot(UNCONFIGURED_CREDENTIALS);

    expect(s.connection.state).toBe("NOT_CONNECTED");
    expect(s.google.costCents).toBe(42_500); // NOT blanked
    expect(s.google.daysWithData).toBe(1);
    expect(s.freshness.state).toBe("NOT_CONNECTED");
    expect(s.freshness.reason).toMatch(/DATA WE PREVIOUSLY SYNCED/);
    expect(s.dataQuality.find((w) => w.code === "GOOGLE_ADS_NOT_CONNECTED")?.message).toMatch(/real but frozen/);
    // The other signals still describe real numbers rather than being skipped.
    expect(s.signals.some((sig) => sig.kind === "PROFIT_UNAVAILABLE")).toBe(true);
    expect(s.signals.find((sig) => sig.kind === "NO_SUCCESSFUL_SYNC")?.title).toMatch(/no longer connected/);
  });

  it("A CONNECTED account with no synced rows is also not zero spend", async () => {
    // Connect the account but sync no rows for this window.
    await sync([]);
    const s = await snapshot();
    expect(s.connection.state).toBe("CONNECTED");
    expect(s.google.daysWithData).toBe(0);
    expect(s.efficiency.firstPartyCostPerOrderCents.status).toBe("UNAVAILABLE");
    expect(s.dataQuality.some((w) => w.code === "NO_DATA_FOR_PERIOD")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Discrepancy                                                         */
/* ------------------------------------------------------------------ */

describe("Google vs first-party discrepancy", () => {
  it("reports both sides and never picks a winner", () => {
    const d = computeDiscrepancy({
      googleConversions: 12,
      googleConversionValueCents: 820_000,
      firstPartyOrders: 9,
      firstPartyRevenueCents: 710_000,
      currencyCompatible: true,
    });
    expect(d.googleConversions).toBe(12);
    expect(d.firstPartyOrders).toBe(9);
    expect(d.conversionDifference).toBe(3);
    expect(d.knownCauses.length).toBeGreaterThan(3);
    expect(d.interpretation).not.toMatch(/wrong|incorrect|bug/i);
  });

  it("flags a material gap without calling it a bug", () => {
    const d = computeDiscrepancy({
      googleConversions: 20,
      googleConversionValueCents: 100,
      firstPartyOrders: 2,
      firstPartyRevenueCents: 100,
      currencyCompatible: true,
    });
    expect(d.material).toBe(true);
    expect(d.interpretation).toMatch(/not automatically a bug/i);
  });

  it("explains the one-sided cases in owner language", () => {
    const noGoogle = computeDiscrepancy({
      googleConversions: 0,
      googleConversionValueCents: 0,
      firstPartyOrders: 5,
      firstPartyRevenueCents: 100,
      currencyCompatible: true,
    });
    expect(noGoogle.interpretation).toMatch(/conversion tracking is not configured/i);

    const noOurs = computeDiscrepancy({
      googleConversions: 5,
      googleConversionValueCents: 100,
      firstPartyOrders: 0,
      firstPartyRevenueCents: 0,
      currencyCompatible: true,
    });
    expect(noOurs.interpretation).toMatch(/measurement question before/i);
  });

  it("suppresses the VALUE gap when currencies are incompatible", () => {
    const d = computeDiscrepancy({
      googleConversions: 5,
      googleConversionValueCents: 500_000,
      firstPartyOrders: 5,
      firstPartyRevenueCents: 400_000,
      currencyCompatible: false,
    });
    expect(d.valueDifferencePct).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Snapshot assembly                                                   */
/* ------------------------------------------------------------------ */

describe("snapshot assembly", () => {
  it("is JSON-serializable and carries NO PII and NO credentials", async () => {
    await sync([day({ date: "2026-08-10" })]);
    const paid = await seedAdSession(campaignTouch("Restaurant Bags"), { cart: true });
    await seedAdOrder(paid);

    const s = await snapshot();
    const serialized = JSON.stringify(s);
    expect(() => JSON.parse(serialized)).not.toThrow();
    // Click ids are used only as a boolean inside the module.
    expect(serialized).not.toContain("EAIaIQobChMI-test-click-id");
    expect(serialized).not.toMatch(/gclid|gbraid|wbraid/);
    expect(serialized).not.toMatch(/refresh_token|client_secret|developer-token|ya29\./);
    expect(serialized).not.toContain(paid); // no session ids
  });

  it("records the account-calendar reporting window and flags a non-UTC account", async () => {
    await sync([day({ date: "2026-08-10" })], { timeZone: "America/New_York" });
    const s = await snapshot();
    expect(s.reportingWindow.timeZone).toBe("America/New_York");
    expect(s.reportingWindow.timeZoneDiffersFromUtc).toBe(true);
    expect(s.reportingWindow.explanation).toMatch(/OVERLAP the period rather than matching it exactly/);
  });

  it("does not claim search-term coverage it does not have", async () => {
    await sync([day({ date: "2026-08-10" })]);
    const s = await snapshot();
    expect(s.notIngested.searchTerms).toBe(true);
    expect(s.signals.some((sig) => sig.kind === "SEARCH_TERMS_NOT_INGESTED")).toBe(true);
  });

  it("raises SPEND_WITHOUT_SESSIONS as an attribution question, not click fraud", async () => {
    await sync([day({ campaignId: "111", campaignName: "Ghost", date: "2026-08-10", clicks: 80 })]);
    const s = await snapshot();
    const signal = s.signals.find((sig) => sig.kind === "SPEND_WITHOUT_SESSIONS");
    expect(signal).toBeDefined();
    expect(signal?.route).toBe("ATTRIBUTION_REVIEW");
    expect(signal?.limitations.join(" ")).toMatch(/NOT evidence of click fraud/i);
  });

  it("every signal carries at least one limitation", async () => {
    await sync([day({ date: "2026-08-10", clicks: 0, costCents: 5_000 })]);
    const s = await snapshot();
    expect(s.signals.length).toBeGreaterThan(0);
    for (const signal of s.signals) expect(signal.limitations.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Business Intelligence integration (spec §52)                        */
/* ------------------------------------------------------------------ */

describe("business-intelligence ad-spend summary", () => {
  it("is UNAVAILABLE with a reason when Google Ads is not connected", async () => {
    const summary = await loadAdSpendSummary(periodFromDays(30, NOW));
    expect(summary.connected).toBe(false);
    expect(summary.spendCents.status).toBe("UNAVAILABLE");
    expect(summary.spendCents).not.toHaveProperty("value");
    expect(summary.statement).toMatch(/NOT zero spend/i);
  });

  it("reports real spend once data exists, with the account currency", async () => {
    await sync([day({ date: "2026-08-14", costCents: 12_500, clicks: 50, googleConversions: 2 })]);
    const summary = await loadAdSpendSummary(PERIOD);
    expect(summary.spendCents).toEqual({ status: "AVAILABLE", value: 12_500 });
    expect(summary.currencyCode).toBe("USD");
    expect(summary.statement).toMatch(/are NOT BagDirect orders/);
  });

  it("stays UNAVAILABLE for a window with no synced rows even when connected", async () => {
    await sync([day({ date: "2026-08-14" })]);
    const summary = await loadAdSpendSummary(
      customPeriod(new Date("2026-06-01T00:00:00Z"), new Date("2026-06-30T23:59:59Z")),
    );
    expect(summary.connected).toBe(true);
    expect(summary.spendCents.status).toBe("UNAVAILABLE");
    expect(summary.statement).toMatch(/unknown, not zero/i);
  });
});
