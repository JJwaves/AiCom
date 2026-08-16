import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { approvals } from "@/db/schema";
import { AiRuntime, FakeAiProvider } from "@/lib/ai";
import {
  buildGoogleAdsContext,
  generateGoogleAdsReview,
  googleAdsRecommendationIdentityKey,
} from "@/lib/ai/agents/google-ads";
import type { GoogleAdsRecommendation } from "@/lib/ai/agents/google-ads/schema";
import { listActions, syncDecisionsToActions } from "@/lib/data/agent-action-service";
import { listDecisions, reviewApproval } from "@/lib/data/agent-service";
import { listGoogleAdsReports } from "@/lib/data/google-ads-report-service";
import { FakeGoogleAdsReportingProvider, runGoogleAdsSync } from "@/lib/google-ads";
import { buildGoogleAdsIntelligenceSnapshot, customPeriod } from "@/modules/google-ads-intelligence";
import { resetDb } from "./db-helpers";
import { seedClassification, seedConversation } from "./ci-helpers";
import { campaignTouch, CONFIGURED_CREDENTIALS, day, seedAdOrder, seedAdSession, UNCONFIGURED_CREDENTIALS } from "./gads-helpers";

/**
 * Session 13 — the Google Ads Intelligence Agent (spec §66).
 *
 * Server-side reference validation, campaign scope validation, the closed
 * recommendation taxonomy, Action Center integration, PII-free context, no
 * tools, no Google Ads access, and fail-safe behaviour when the provider or
 * the budget says no.
 *
 * FakeAiProvider only — no credentials, no network, no real model call. The
 * Google Ads side is always `FakeGoogleAdsReportingProvider`.
 */

const NOW = new Date("2026-08-15T12:00:00Z");
const PERIOD = customPeriod(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-31T23:59:59Z"));

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
  setEnv("AI_GOOGLE_ADS_AGENT_ENABLED", "true");
  setEnv("GOOGLE_ADS_INTELLIGENCE_ENABLED", "true");
});

const output = (value: unknown) => ({ kind: "text" as const, text: JSON.stringify(value) });

const recommendation = (over: Partial<GoogleAdsRecommendation> = {}): GoogleAdsRecommendation =>
  ({
    title: "Review the Restaurant Bags campaign",
    observation: "Restaurant Bags spent 125.00 USD and produced 1 attributed order.",
    recommendation: "Look at what visitors from this campaign actually asked before deciding anything.",
    recommendationType: "CAMPAIGN_REVIEW",
    campaignId: "111",
    metricRefs: ["gads.google.spend"],
    evidenceRefs: [],
    confidence: "MEDIUM",
    risk: "MEDIUM",
    limitations: ["Only visitors who opened the chat are represented in the conversation counts."],
    ...over,
  }) as GoogleAdsRecommendation;

const review = (recommendations: GoogleAdsRecommendation[], signals: { signalId: string; note: string }[] = []) => ({
  executiveSummary: "One campaign accounts for most spend and few identifiable outcomes.",
  signals,
  recommendations,
  openQuestions: [],
});

/** Real synced data + real first-party traffic for the snapshot to describe. */
async function seedAdsEvidence(): Promise<void> {
  const provider = new FakeGoogleAdsReportingProvider({
    days: [day({ campaignId: "111", campaignName: "Restaurant Bags", date: "2026-08-10" })],
  });
  await runGoogleAdsSync({
    provider,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    triggeredBy: "admin:test",
    now: NOW,
  });
  const paid = await seedAdSession(campaignTouch("Restaurant Bags"), { cart: true, priceView: true });
  await seedAdOrder(paid, { totalCents: 235_000 });
  const { conversation, messages } = await seedConversation(paid, ["Do you have a smaller minimum?"]);
  await seedClassification(conversation.id, { questions: [{ theme: "MOQ", messageId: messages[0].id }] });
}

const run = (fake: FakeAiProvider, credentials = CONFIGURED_CREDENTIALS) =>
  generateGoogleAdsReview({ runtime: new AiRuntime({ provider: fake }), period: PERIOD, credentials, now: NOW });

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

describe("google ads context", () => {
  it("offers deterministic numbers and nothing else to cite", async () => {
    await seedAdsEvidence();
    const context = buildGoogleAdsContext(
      await buildGoogleAdsIntelligenceSnapshot(PERIOD, CONFIGURED_CREDENTIALS, NOW),
    );

    expect(context.validMetricRefs.has("gads.google.spend")).toBe(true);
    expect(context.validMetricRefs.has("gads.firstParty.orders")).toBe(true);
    expect(context.validCampaignIds.has("111")).toBe(true);
    expect(context.text).toMatch(/You cannot change anything in Google Ads/);
    expect(context.text).toMatch(/NEVER PROPOSE A SPECIFIC BUDGET|no field for a budget/i);
    expect(context.text).toMatch(/NOT a BagDirect order/);
  });

  it("carries NO PII and NO click id and NO credential", async () => {
    await seedAdsEvidence();
    const context = buildGoogleAdsContext(
      await buildGoogleAdsIntelligenceSnapshot(PERIOD, CONFIGURED_CREDENTIALS, NOW),
    );
    expect(context.text).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(context.text).not.toMatch(/gclid|gbraid|wbraid|EAIaIQob/);
    expect(context.text).not.toMatch(/refresh_token|client_secret|developer-token|ya29\./);
    expect(context.text).not.toMatch(/sess_[a-f0-9]/);
  });

  it("states the profit truth before anything can be recommended", async () => {
    await seedAdsEvidence();
    const context = buildGoogleAdsContext(
      await buildGoogleAdsIntelligenceSnapshot(PERIOD, CONFIGURED_CREDENTIALS, NOW),
    );
    const profitIndex = context.text.indexOf("WHAT WE DO AND DO NOT KNOW ABOUT PROFIT");
    const campaignIndex = context.text.indexOf("== CAMPAIGNS");
    expect(profitIndex).toBeGreaterThan(-1);
    expect(profitIndex).toBeLessThan(campaignIndex);
    expect(context.text).toMatch(/Revenue-based ROAS is NOT profitability/);
  });

  it("tells the model that NOT CONNECTED is not zero spend", async () => {
    const context = buildGoogleAdsContext(
      await buildGoogleAdsIntelligenceSnapshot(PERIOD, UNCONFIGURED_CREDENTIALS, NOW),
    );
    expect(context.text).toMatch(/NOT CONNECTED IS NOT ZERO SPEND/);
  });
});

/* ------------------------------------------------------------------ */
/* Happy path + validation                                             */
/* ------------------------------------------------------------------ */

describe("generateGoogleAdsReview", () => {
  it("persists a report and a pending decision, and changes nothing in Google Ads", async () => {
    await seedAdsEvidence();
    const result = await run(new FakeAiProvider([output(review([recommendation()]))]));

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.created).toBe(1);
    expect(result.droppedInvalid).toBe(0);

    const decisions = await listDecisions("google_ads");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].decisionType).toBe("google_ads_recommendation");
    expect(decisions[0].approvalRequired).toBe(true);
    expect(decisions[0].approvalStatus).toBe("pending");
    expect(decisions[0].executionStatus).toBe("none");

    const reports = await listGoogleAdsReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].promptId).toBe("ai_google_ads_review");
    // The exact snapshot the model saw is stored for audit.
    expect(reports[0].snapshotJson).toHaveProperty("google");
    expect(reports[0].snapshotJson).toHaveProperty("firstParty");
  });

  it("uses exactly ONE model call and no tools", async () => {
    await seedAdsEvidence();
    const fake = new FakeAiProvider([output(review([recommendation()]))]);
    await run(fake);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].method).toBe("generateStructured");
    expect((fake.requests[0].request as { tools?: unknown[] }).tools ?? []).toEqual([]);
  });

  it("DROPS a recommendation whose metric references were all invented", async () => {
    await seedAdsEvidence();
    const result = await run(
      new FakeAiProvider([output(review([recommendation({ metricRefs: ["gads.totally.madeUp"] })]))]),
    );
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.droppedInvalid).toBe(1);
    expect(result.created).toBe(0);
    expect(await listDecisions("google_ads")).toHaveLength(0);
  });

  it("removes invented references but keeps a recommendation with a real one", async () => {
    await seedAdsEvidence();
    const result = await run(
      new FakeAiProvider([
        output(review([recommendation({ metricRefs: ["gads.google.spend", "gads.invented.metric"] })])),
      ]),
    );
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.created).toBe(1);
    expect(result.droppedReferences).toBe(1);
    const params = (await listDecisions("google_ads"))[0].proposedActionJson as { params: Record<string, unknown> };
    expect(params.params.supportingMetricRefs).toEqual(["gads.google.spend"]);
  });

  it("nulls a FABRICATED campaign id rather than attributing to it", async () => {
    await seedAdsEvidence();
    const result = await run(
      new FakeAiProvider([output(review([recommendation({ campaignId: "999999999" })]))]),
    );
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.created).toBe(1);
    expect(result.review.recommendations[0].campaignId).toBeNull();
    expect(result.dropReasons.join(" ")).toMatch(/unknown campaignId/);
  });

  it("DROPS a signal note pointing at a signal the context never printed", async () => {
    await seedAdsEvidence();
    const result = await run(
      new FakeAiProvider([output(review([recommendation()], [{ signalId: "gads.signal.invented", note: "n" }]))]),
    );
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.review.signals).toEqual([]);
  });

  it("rejects an out-of-taxonomy recommendation type at the schema boundary", async () => {
    await seedAdsEvidence();
    const bad = { ...recommendation(), recommendationType: "PAUSE_CAMPAIGN" };
    const result = await run(new FakeAiProvider([output(review([bad as never])), output(review([bad as never]))]));
    // The schema refuses it; after the bounded retry the whole call fails and
    // NOTHING is persisted.
    expect(result.status).toBe("failed");
    expect(await listDecisions("google_ads")).toHaveLength(0);
    expect(await listGoogleAdsReports()).toHaveLength(0);
  });

  it("requires at least one limitation on every recommendation", async () => {
    await seedAdsEvidence();
    const bad = { ...recommendation(), limitations: [] };
    const result = await run(new FakeAiProvider([output(review([bad as never])), output(review([bad as never]))]));
    expect(result.status).toBe("failed");
  });

  it("cannot express a budget — an extra budget field is stripped by the schema", async () => {
    await seedAdsEvidence();
    const smuggled = { ...recommendation(), proposedDailyBudgetCents: 50_000 };
    const result = await run(new FakeAiProvider([output(review([smuggled as never]))]));
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.review.recommendations[0]).not.toHaveProperty("proposedDailyBudgetCents");
    const params = (await listDecisions("google_ads"))[0].proposedActionJson as { params: Record<string, unknown> };
    expect(params.params).not.toHaveProperty("proposedDailyBudgetCents");
  });
});

/* ------------------------------------------------------------------ */
/* Identity + Action Center                                            */
/* ------------------------------------------------------------------ */

describe("dedup and the Action Center", () => {
  it("refreshes a PENDING recommendation in place instead of duplicating it", async () => {
    await seedAdsEvidence();
    await run(new FakeAiProvider([output(review([recommendation()]))]));
    const second = await run(new FakeAiProvider([output(review([recommendation({ observation: "Updated." })]))]));
    if (second.status !== "completed") throw new Error("unreachable");
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);
    const decisions = await listDecisions("google_ads");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].observation).toBe("Updated.");
  });

  it("FREEZES a recommendation a human has already decided on", async () => {
    await seedAdsEvidence();
    const first = await run(new FakeAiProvider([output(review([recommendation()]))]));
    if (first.status !== "completed") throw new Error("unreachable");
    const db = await getDb();
    const [approval] = await db.select().from(approvals).where(eq(approvals.decisionId, first.decisions[0].id));
    await reviewApproval({ approvalId: approval.id, status: "rejected", reviewedBy: "owner" });

    const second = await run(new FakeAiProvider([output(review([recommendation({ observation: "Changed." })]))]));
    if (second.status !== "completed") throw new Error("unreachable");
    expect(second.skippedReviewed).toBe(1);
    expect((await listDecisions("google_ads"))[0].observation).not.toBe("Changed.");
  });

  it("has a stable identity key scoped by type, campaign and period", () => {
    const key = googleAdsRecommendationIdentityKey(recommendation(), 30);
    expect(key).toBe("GOOGLE_ADS:CAMPAIGN_REVIEW:111:gads.google.spend:30d");
    expect(googleAdsRecommendationIdentityKey(recommendation({ campaignId: null }), 30)).toContain(":account:");
  });

  it("materializes into a REVIEW-ONLY action that executes nothing", async () => {
    await seedAdsEvidence();
    await run(new FakeAiProvider([output(review([recommendation()]))]));
    const result = await syncDecisionsToActions("admin:test");
    expect(result.created).toBe(1);

    const actions = await listActions({});
    const action = actions.find((a) => a.sourceAgent === "GOOGLE_ADS_AGENT");
    expect(action?.actionType).toBe("MARKETING_REVIEW");
    expect(action?.executionStatus).toBe("NOT_APPLICABLE");
    expect(action?.status).toBe("PENDING_APPROVAL");
  });

  it("routes a DATA_QUALITY_REVIEW recommendation to the data-quality action type", async () => {
    await seedAdsEvidence();
    await run(
      new FakeAiProvider([
        output(
          review([
            recommendation({
              recommendationType: "DATA_QUALITY_REVIEW",
              campaignId: null,
              metricRefs: ["gads.profit.blockers"],
            }),
          ]),
        ),
      ]),
    );
    await syncDecisionsToActions("admin:test");
    const actions = await listActions({});
    expect(actions.find((a) => a.sourceAgent === "GOOGLE_ADS_AGENT")?.actionType).toBe("DATA_QUALITY_REVIEW");
  });

  it("never produces an executable advertising action, whatever the model asked for", async () => {
    await seedAdsEvidence();
    await run(
      new FakeAiProvider([
        output(review([recommendation({ recommendationType: "BUDGET_REVIEW" })])),
      ]),
    );
    await syncDecisionsToActions("admin:test");
    const actions = await listActions({});
    for (const action of actions) {
      expect(["AD_BUDGET_CHANGE", "AD_PAUSE", "AD_RESUME", "AD_CREATIVE_TEST"]).not.toContain(action.actionType);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Failure isolation                                                   */
/* ------------------------------------------------------------------ */

describe("failure isolation", () => {
  it("persists NOTHING when the provider fails, leaving the previous review visible", async () => {
    await seedAdsEvidence();
    await run(new FakeAiProvider([output(review([recommendation()]))]));
    expect(await listGoogleAdsReports()).toHaveLength(1);

    const failing = new FakeAiProvider([]);
    const result = await run(failing);
    expect(result.status).toBe("failed");
    expect(await listGoogleAdsReports()).toHaveLength(1); // untouched
    expect(await listDecisions("google_ads")).toHaveLength(1);
  });

  it("is unavailable when the agent flag is off — and writes nothing", async () => {
    delete process.env.AI_GOOGLE_ADS_AGENT_ENABLED;
    const result = await generateGoogleAdsReview({ period: PERIOD, credentials: CONFIGURED_CREDENTIALS, now: NOW });
    expect(result.status).toBe("unavailable");
    expect(await listGoogleAdsReports()).toHaveLength(0);
  });

  it("still runs — and reports honestly — when Google Ads is not connected", async () => {
    const result = await run(
      new FakeAiProvider([
        output(
          review([
            recommendation({
              recommendationType: "DATA_QUALITY_REVIEW",
              campaignId: null,
              metricRefs: ["gads.connection.state"],
            }),
          ]),
        ),
      ]),
      UNCONFIGURED_CREDENTIALS,
    );
    if (result.status !== "completed") throw new Error("unreachable");
    expect(result.created).toBe(1);
    const snapshot = (await listGoogleAdsReports())[0].snapshotJson as { connection: { state: string } };
    expect(snapshot.connection.state).toBe("NOT_CONNECTED");
  });
});
