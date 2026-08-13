import { beforeEach, describe, expect, it } from "vitest";
import { CUSTOMER_INTELLIGENCE } from "@/config/customer-intelligence";
import { applyNeedProfileUpdate } from "@/lib/data/customer-need-service";
import { recordServerEvent } from "@/lib/data/event-service";
import {
  createInsight,
  listInsights,
  listOpportunities,
  setInsightStatus,
  setOpportunityStatus,
} from "@/lib/data/insight-service";
import {
  buildInsightCandidates,
  buildOpportunityCandidates,
  generateInsightsForPeriod,
  loadConversationCorpus,
  loadDemandSignals,
  periodFromDays,
  persistInsights,
  persistOpportunities,
} from "@/modules/customer-intelligence";
import { makeSession, resetDb } from "./db-helpers";
import { seedClassification, seedConversation } from "./ci-helpers";

/**
 * Session 08 — insight & opportunity generation: minimum-evidence gating,
 * stable identity (no duplicates), dismissed suppression, human-only
 * validation, and structural traceability. Generation is deterministic —
 * no model runs in any of these tests.
 */

beforeEach(async () => {
  await resetDb();
});

const period = () => periodFromDays(30);

/** Seed N qualified conversations that each asked an MOQ question. */
async function seedMoqConversations(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const s = await makeSession();
    const { conversation, messages } = await seedConversation(s.id, ["What is your MOQ?"]);
    await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
    await seedClassification(conversation.id, { questions: [{ theme: "MOQ", messageId: messages[0].id }] });
  }
}

describe("minimum evidence threshold (§15)", () => {
  it("persists nothing below the threshold, generates at the threshold", async () => {
    await seedMoqConversations(CUSTOMER_INTELLIGENCE.MIN_EVIDENCE_FOR_INSIGHT - 1);
    let summary = await generateInsightsForPeriod(await loadConversationCorpus(period()));
    expect(summary.created).toBe(0);
    expect(await listInsights()).toHaveLength(0);

    await seedMoqConversations(1); // reaches the documented floor
    summary = await generateInsightsForPeriod(await loadConversationCorpus(period()));
    const insights = await listInsights();
    const moq = insights.find((i) => i.insightType === "CUSTOMER_QUESTION");
    expect(moq).toBeDefined();
    expect(moq!.evidenceCount).toBe(CUSTOMER_INTELLIGENCE.MIN_EVIDENCE_FOR_INSIGHT);
    expect(moq!.sourceRefsJson.length).toBeGreaterThan(0);
    expect(moq!.periodStart).not.toBeNull();
    expect(moq!.periodEnd).not.toBeNull();
    // MOQ questions at threshold also produce the combined MOQ_SIGNAL — both traceable.
    for (const insight of insights) {
      expect(insight.evidenceCount).toBeGreaterThanOrEqual(insight.sourceRefsJson.length);
      expect((insight.valueJson as { identityKey?: string }).identityKey).toBeTruthy();
    }
  });
});

describe("stable identity — no duplicate insights (§35)", () => {
  it("re-running generation updates rows in place instead of duplicating", async () => {
    await seedMoqConversations(3);
    const corpus = await loadConversationCorpus(period());
    await generateInsightsForPeriod(corpus);
    const countAfterFirst = (await listInsights()).length;

    const second = await generateInsightsForPeriod(await loadConversationCorpus(period()));
    expect(second.created).toBe(0);
    expect(second.updated).toBe(countAfterFirst);
    expect(await listInsights()).toHaveLength(countAfterFirst);
  });

  it("keeps dismissed insights dismissed unless evidence materially grows", async () => {
    await seedMoqConversations(3);
    await generateInsightsForPeriod(await loadConversationCorpus(period()));
    const moq = (await listInsights()).find((i) => i.insightType === "CUSTOMER_QUESTION")!;
    await setInsightStatus(moq.id, "dismissed");

    // Same evidence → stays dismissed, not regenerated.
    const rerun = await generateInsightsForPeriod(await loadConversationCorpus(period()));
    expect(rerun.resurrected).toBe(0);
    const stillDismissed = (await listInsights()).find((i) => i.id === moq.id)!;
    expect(stillDismissed.status).toBe("dismissed");

    // Materially new evidence → resurrected to candidate for review.
    await seedMoqConversations(2);
    const grown = await generateInsightsForPeriod(await loadConversationCorpus(period()));
    expect(grown.resurrected).toBeGreaterThan(0);
    const revived = (await listInsights()).find((i) => i.id === moq.id)!;
    expect(revived.status).toBe("candidate");
    expect(revived.evidenceCount).toBe(5);
  });
});

describe("traceability is structural (§18–§19)", () => {
  it("rejects insights whose evidenceCount understates their refs", async () => {
    await expect(
      createInsight({
        insightType: "CUSTOMER_QUESTION",
        title: "Fabricated",
        sourceRefs: [
          { table: "conversations", id: "conv_a" },
          { table: "conversations", id: "conv_b" },
        ],
        evidenceCount: 1,
      }),
    ).rejects.toThrow(/evidenceCount/);
  });

  it("candidate refs point at real conversations from the corpus", async () => {
    await seedMoqConversations(3);
    const corpus = await loadConversationCorpus(period());
    const demand = await loadDemandSignals(period());
    const candidates = buildInsightCandidates(corpus, demand);
    const realIds = new Set(corpus.facts.map((f) => f.conversation.id));
    for (const c of candidates) {
      for (const ref of c.sourceRefs) {
        if (ref.table === "conversations") expect(realIds.has(ref.id)).toBe(true);
      }
    }
  });
});

describe("question-vs-objection separation carries into insights (§5, §40)", () => {
  it("MOQ questions alone never produce an OBJECTION_PATTERN insight", async () => {
    await seedMoqConversations(3);
    await generateInsightsForPeriod(await loadConversationCorpus(period()));
    const insights = await listInsights();
    expect(insights.some((i) => i.insightType === "CUSTOMER_QUESTION")).toBe(true);
    expect(insights.some((i) => i.insightType === "OBJECTION_PATTERN")).toBe(false);
  });
});

describe("product opportunities (§21–§22)", () => {
  async function seedInsulatedDemand(n: number): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      const s = await makeSession();
      const { conversation, messages } = await seedConversation(s.id, ["Do you sell insulated bags?"]);
      await recordServerEvent({ sessionId: s.id, name: "price_viewed" });
      await seedClassification(conversation.id, {
        requests: [{ kind: "product", normalized: "insulated bag", messageId: messages[0].id, support: "unsupported" }],
      });
    }
  }

  it("creates proposed opportunities with humanValidationRequired from real evidence", async () => {
    await seedInsulatedDemand(3);
    const s = await makeSession();
    await seedConversation(s.id, ["I only need 200 bags"]);
    await applyNeedProfileUpdate(s.id, { quantity: 200 }, "USER_STATED");
    for (let i = 0; i < 2; i += 1) {
      const s2 = await makeSession();
      const { conversation, messages } = await seedConversation(s2.id, ["500 is too many for me"]);
      await recordServerEvent({ sessionId: s2.id, name: "price_viewed" });
      await seedClassification(conversation.id, {
        objections: [{ type: "MOQ_TOO_HIGH", messageId: messages[0].id }],
      });
    }

    const corpus = await loadConversationCorpus(period());
    const demand = await loadDemandSignals(period());
    const summary = await persistOpportunities(buildOpportunityCandidates(corpus, demand));
    expect(summary.created).toBe(2);

    const opportunities = await listOpportunities();
    const insulated = opportunities.find((o) => o.opportunityType === "unsupported_product")!;
    expect(insulated.title).toContain("insulated bag");
    expect(insulated.status).toBe("proposed");
    expect(insulated.humanValidationRequired).toBe(true);
    expect(insulated.evidenceCount).toBeGreaterThanOrEqual(3);

    const lowerMoq = opportunities.find((o) => o.opportunityType === "lower_moq")!;
    expect(lowerMoq.description).toContain("below the current 500 MOQ");
    expect(lowerMoq.humanValidationRequired).toBe(true);
    // estimatedDemand is a sentence with real counts, never a projection.
    expect(lowerMoq.estimatedDemand).toMatch(/^\d+ below-MOQ signals/);
  });

  it("never touches human review decisions on regeneration", async () => {
    await seedInsulatedDemand(3);
    const corpus = await loadConversationCorpus(period());
    const demand = await loadDemandSignals(period());
    await persistOpportunities(buildOpportunityCandidates(corpus, demand));
    const [opp] = await listOpportunities();

    // A human validates feasibility — generation must never override it.
    await setOpportunityStatus(opp.id, "validated");
    await seedInsulatedDemand(2);
    const corpus2 = await loadConversationCorpus(period());
    const demand2 = await loadDemandSignals(period());
    const rerun = await persistOpportunities(buildOpportunityCandidates(corpus2, demand2));
    expect(rerun.created).toBe(0);
    expect(rerun.skipped).toBe(1);

    const after = (await listOpportunities()).find((o) => o.id === opp.id)!;
    expect(after.status).toBe("validated");
    expect(after.evidenceCount).toBe(opp.evidenceCount); // metrics frozen once human-decided
  });

  it("generation can only create proposed rows — validated is unreachable from generation", async () => {
    await seedInsulatedDemand(3);
    const corpus = await loadConversationCorpus(period());
    const demand = await loadDemandSignals(period());
    const candidates = buildOpportunityCandidates(corpus, demand);
    await persistOpportunities(candidates);
    for (const o of await listOpportunities()) {
      expect(o.status).toBe("proposed");
    }
  });
});

describe("insight persistence honors period stamps (§13)", () => {
  it("every generated insight records its period", async () => {
    await seedMoqConversations(3);
    const corpus = await loadConversationCorpus(period());
    const demand = await loadDemandSignals(period());
    await persistInsights(buildInsightCandidates(corpus, demand));
    for (const i of await listInsights()) {
      expect(i.periodStart?.getTime()).toBe(corpus.period.start.getTime());
      expect(i.periodEnd?.getTime()).toBe(corpus.period.end.getTime());
    }
  });
});
