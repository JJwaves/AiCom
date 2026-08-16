import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUARDRAIL_LIMITS, GUARDRAIL_POLICY_VERSION, GUARDED_AUTO_ALLOWED_ACTION_TYPES, AGENT_AUTONOMY_POLICY } from "@/config/guardrails";
import {
  GOOGLE_ADS_RECOMMENDATION_ACTION_TYPE,
  GOOGLE_ADS_RECOMMENDATION_TYPES,
  KEYWORDS_INGESTED,
  SEARCH_TERMS_INGESTED,
  SUPPORTED_API_VERSIONS,
} from "@/config/google-ads";
import { AGENT_TOOL_PERMISSIONS } from "@/lib/ai/tools/types";
import { createSalesToolRegistry } from "@/lib/ai/tools";
import { googleAdsRecommendationSchema, googleAdsReviewSchema } from "@/lib/ai/agents/google-ads/schema";
import {
  ACTION_TYPE_REGISTRY,
  evaluateAgentAction,
  executorRegistry,
  GOOGLE_ADS_RECOMMENDATION_TO_ACTION_TYPE,
  SOURCE_PERMITTED_ACTION_TYPES,
} from "@/modules/guardrails";
import { LiveGoogleAdsReportingProvider, FakeGoogleAdsReportingProvider } from "@/lib/google-ads";

/**
 * Session 13 — READ-ONLY and separation tests (spec §41, §65).
 *
 * The point of this file: a future developer cannot quietly add campaign
 * mutation to this integration. Doing so requires deleting a test here,
 * which is a visible, deliberate act rather than an oversight.
 */

const repo = process.cwd();

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

/**
 * Comments are stripped before scanning. These tests assert what the CODE
 * can do; a doc block that says "there is deliberately no mutate here" is
 * the documentation working, not a violation of it.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const readAll = (dirs: string[]) =>
  dirs
    .flatMap((d) => walk(path.join(repo, d)))
    .map((file) => ({ file: path.relative(repo, file), source: stripComments(readFileSync(file, "utf8")) }));

const GOOGLE_ADS_SOURCE = ["lib/google-ads", "modules/google-ads-intelligence", "lib/ai/agents/google-ads"];

/* ------------------------------------------------------------------ */
/* No mutation capability exists                                       */
/* ------------------------------------------------------------------ */

describe("the Google Ads integration contains no mutation capability", () => {
  it("mentions no Google Ads mutate service anywhere", () => {
    const files = readAll(GOOGLE_ADS_SOURCE);
    expect(files.length).toBeGreaterThan(10);
    for (const { file, source } of files) {
      for (const pattern of [
        /:mutate\b/,
        /\bmutateCampaigns?\b/i,
        /CampaignService\s*\.\s*[Mm]utate/,
        /CampaignBudgetService/i,
        /AdGroupService|AdGroupAdService|AdGroupCriterionService/i,
        /ConversionUploadService|uploadClickConversions|uploadCallConversions/i,
        /CustomerService\s*\.\s*[Mm]utate/,
        /AssetService|AudienceService/i,
      ]) {
        expect(source, `${file} must contain nothing matching ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("defines no campaign/budget/bid/keyword/ad/conversion writer of its own", () => {
    for (const { file, source } of readAll(GOOGLE_ADS_SOURCE)) {
      for (const pattern of [
        /\b(create|update|pause|enable|resume|remove|delete)Campaign\b/i,
        /\bset(Budget|CampaignBudget|Bid|BidModifier|TargetCpa|TargetRoas)\b/i,
        /\b(create|update|remove)(Keyword|Ad|AdGroup|Audience|Asset)\b/i,
        /\buploadConversion\b/i,
        /\bsetTargeting\b/i,
      ]) {
        expect(source, `${file} must define nothing matching ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("exposes NO generic request(method, path, body) escape hatch", () => {
    for (const { file, source } of readAll(["lib/google-ads"])) {
      expect(source, `${file} must not expose a generic request()`).not.toMatch(
        /export\s+(async\s+)?function\s+request\s*\(/,
      );
      expect(source, `${file} must not take an HTTP method as a parameter`).not.toMatch(/method\s*:\s*(string|HttpMethod)/);
    }
  });

  it("builds exactly ONE endpoint, and it is :search", () => {
    const client = stripComments(readFileSync(path.join(repo, "lib/google-ads/client.ts"), "utf8"));
    const endpoints = client.match(/googleAds:[a-zA-Z]+/g) ?? [];
    expect(endpoints.length).toBeGreaterThan(0);
    expect([...new Set(endpoints)]).toEqual(["googleAds:search"]);
    // The method is a literal, not a variable — it cannot be parameterized.
    expect(client).toMatch(/googleAds:search`/);
  });

  it("issues only SELECT queries — GAQL has no mutation verb and none is written", () => {
    const queries = stripComments(readFileSync(path.join(repo, "lib/google-ads/queries.ts"), "utf8"));
    for (const forbidden of [/\bINSERT\b/i, /\bUPDATE\b/i, /\bDELETE\b/i, /\bmutate\b/i]) {
      expect(queries, `queries.ts must contain nothing matching ${forbidden}`).not.toMatch(forbidden);
    }
    expect(queries).toMatch(/SELECT/);
  });

  it("the provider interface exposes only read methods", () => {
    const surface = Object.getOwnPropertyNames(LiveGoogleAdsReportingProvider.prototype)
      .filter((n) => n !== "constructor")
      .sort();
    expect(surface).toEqual(["getAccountInfo", "getCampaignDailyMetrics", "status"]);
    // And the fake matches it exactly, so a test cannot exercise a capability
    // the live provider does not have.
    expect(
      Object.getOwnPropertyNames(FakeGoogleAdsReportingProvider.prototype).filter((n) => n !== "constructor").sort(),
    ).toEqual(surface);
  });

  it("only the sync path may call the provider — analytics and the agent cannot", () => {
    for (const { file, source } of readAll(["modules/google-ads-intelligence", "lib/ai/agents/google-ads"])) {
      expect(source, `${file} must not import the Google Ads adapter`).not.toMatch(/@\/lib\/google-ads(?!\/credential-snapshot)/);
      expect(source, `${file} must not call fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(source, `${file} must not reference the Google Ads host`).not.toMatch(/googleads\.googleapis\.com/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Deterministic authority                                             */
/* ------------------------------------------------------------------ */

describe("modules/google-ads-intelligence is deterministic authority", () => {
  it("never imports the AI runtime and uses no randomness", () => {
    const files = readAll(["modules/google-ads-intelligence"]);
    expect(files.length).toBeGreaterThan(8);
    for (const { file, source } of files) {
      expect(source, `${file} must not import the AI runtime`).not.toMatch(/@\/lib\/ai/);
      expect(source, `${file} must not use randomness`).not.toMatch(/Math\.random/);
    }
  });

  it("never writes to the database — analytics READ", () => {
    for (const { file, source } of readAll(["modules/google-ads-intelligence"])) {
      expect(source, `${file} must not write to the database`).not.toMatch(/\bdb\.(insert|update|delete)\b/);
      expect(source, `${file} must not call a persistence writer`).not.toMatch(
        /upsertCampaignDailyMetrics|upsertAdAccount|startSyncRun|finishSyncRun|markAccountSynced/,
      );
    }
  });

  it("computes no blended 'true CAC' that would merge the two attribution models", () => {
    for (const { file, source } of readAll(["modules/google-ads-intelligence", "lib/ai/agents/google-ads"])) {
      for (const pattern of [/blendedCac/i, /trueCac/i, /reconcileAttribution/i, /correctedConversions/i, /adjustedRoas/i]) {
        expect(source, `${file} must contain nothing matching ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("builds no per-person profile from click ids", () => {
    for (const { file, source } of readAll(["modules/google-ads-intelligence"])) {
      for (const pattern of [/userProfile/i, /crossDevice/i, /identityGraph/i, /fingerprint/i]) {
        expect(source, `${file} must contain nothing matching ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* The agent advises and nothing more                                  */
/* ------------------------------------------------------------------ */

describe("the Google Ads agent advises and nothing more", () => {
  it("has no tools, and never approves its own work", () => {
    for (const { file, source } of readAll(["lib/ai/agents/google-ads"])) {
      expect(source, `${file} must not build a tool registry`).not.toMatch(
        /createSalesToolRegistry|new ToolRegistry|runToolConversation/,
      );
      expect(source, `${file} must not write proposed-action approvals`).not.toMatch(/agent-action-service/);
      expect(source, `${file} must not sync or test the connection`).not.toMatch(
        /runGoogleAdsSync|testGoogleAdsConnection/,
      );
    }
  });

  it("is granted ZERO tools by the permission map", () => {
    expect(AGENT_TOOL_PERMISSIONS.google_ads).toEqual([]);
  });

  it("has no budget, status, bid, keyword or ad field anywhere in its output schema", () => {
    const keys = Object.keys(googleAdsRecommendationSchema.shape);
    for (const forbidden of [
      "proposedDailyBudgetCents",
      "newDailyBudgetCents",
      "budgetChangePct",
      "budgetCents",
      "newStatus",
      "pause",
      "bidCents",
      "targetCpaCents",
      "targetRoas",
      "keywordText",
      "adCopy",
      "conversionValue",
    ]) {
      expect(keys, `the recommendation schema must not expose ${forbidden}`).not.toContain(forbidden);
    }
    expect(keys).toContain("recommendationType");
    expect(keys).toContain("metricRefs");
    expect(keys).toContain("limitations");
    expect(Object.keys(googleAdsReviewSchema.shape).sort()).toEqual([
      "executiveSummary",
      "openQuestions",
      "recommendations",
      "signals",
    ]);
  });

  it("keeps the recommendation taxonomy closed and REVIEW-ONLY", () => {
    expect([...GOOGLE_ADS_RECOMMENDATION_TYPES].sort()).toEqual([
      "ATTRIBUTION_REVIEW",
      "BUDGET_REVIEW",
      "CAMPAIGN_REVIEW",
      "DATA_QUALITY_REVIEW",
      "KEYWORD_REVIEW",
      "LANDING_PAGE_REVIEW",
      "SEARCH_TERM_REVIEW",
    ]);
    for (const type of GOOGLE_ADS_RECOMMENDATION_TYPES) {
      const actionType = GOOGLE_ADS_RECOMMENDATION_ACTION_TYPE[type];
      expect(ACTION_TYPE_REGISTRY[actionType].executionSupport).toBe("REVIEW_ONLY");
    }
  });

  it("keeps the guardrail and config mapping tables in agreement", () => {
    expect(GOOGLE_ADS_RECOMMENDATION_TO_ACTION_TYPE).toEqual(GOOGLE_ADS_RECOMMENDATION_ACTION_TYPE);
  });

  it("can never map a recommendation to an executable advertising action", () => {
    const mapped = Object.values(GOOGLE_ADS_RECOMMENDATION_ACTION_TYPE);
    for (const executable of ["AD_BUDGET_CHANGE", "AD_PAUSE", "AD_RESUME", "AD_CREATIVE_TEST"]) {
      expect(mapped, `${executable} must be absent from the Session 13 mapping`).not.toContain(executable);
    }
  });
});

/* ------------------------------------------------------------------ */
/* No execution capability was introduced                              */
/* ------------------------------------------------------------------ */

describe("no automated execution capability was introduced", () => {
  it("registers ZERO executors — approving still executes nothing", () => {
    expect(executorRegistry.list()).toEqual([]);
    for (const type of ["AD_BUDGET_CHANGE", "AD_PAUSE", "AD_RESUME", "AD_CREATIVE_TEST"]) {
      expect(executorRegistry.has(type)).toBe(false);
    }
  });

  it("keeps every advertising action type representable but unexecutable", () => {
    for (const type of ["AD_BUDGET_CHANGE", "AD_PAUSE", "AD_RESUME", "AD_CREATIVE_TEST"]) {
      expect(ACTION_TYPE_REGISTRY[type].executionSupport).toBe("NOT_IMPLEMENTED");
    }
  });

  it("keeps the ad-spend limits unfilled, so any spend action stays blocked regardless", () => {
    expect(GUARDRAIL_LIMITS.maximumDailyAdSpendCents).toBeNull();
    expect(GUARDRAIL_LIMITS.maximumCampaignBudgetChangePct).toBeNull();
    expect(GUARDRAIL_LIMITS.maximumNewCampaignTestBudgetCents).toBeNull();
  });

  it("keeps the Google Ads agent capped at RECOMMEND with an empty guarded-auto list", () => {
    expect(AGENT_AUTONOMY_POLICY.GOOGLE_ADS_AGENT.maxMode).toBe("RECOMMEND");
    expect(GUARDED_AUTO_ALLOWED_ACTION_TYPES).toEqual([]);
  });

  it("bumped the guardrail policy version for the Session 13 change", () => {
    expect(GUARDRAIL_POLICY_VERSION).not.toBe("2026-08-15.s12.1");
  });

  it("blocks execution of a budget change even when a HUMAN proposes it", () => {
    const { decision } = evaluateAgentAction({
      source: "HUMAN_ADMIN",
      actionType: "AD_BUDGET_CHANGE",
      autonomyMode: "RECOMMEND",
      payload: {
        platform: "google_ads",
        campaignId: "111",
        campaignName: "Restaurant Bags",
        currentDailyBudgetCents: 5_000,
        proposedDailyBudgetCents: 50_000,
        currency: "USD",
        reason: "It looks efficient.",
        metricRefs: [],
        evidenceRefs: [],
      },
    });
    // A human may PROPOSE it; nothing can carry it out.
    expect(decision.allowed).toBe(true);
    expect(decision.executionEligible).toBe(false);
    expect(decision.approvalRequired).toBe(true);
    expect(decision.missingConfiguration.some((m) => m.includes("maximumDailyAdSpendCents"))).toBe(true);
    expect(decision.missingConfiguration.some((m) => m.includes("maximumCampaignBudgetChangePct"))).toBe(true);
  });

  it("keeps the Google Ads agent's permitted types to reviews plus the four unexecutable ad types", () => {
    expect([...SOURCE_PERMITTED_ACTION_TYPES.GOOGLE_ADS_AGENT].sort()).toEqual([
      "AD_BUDGET_CHANGE",
      "AD_CREATIVE_TEST",
      "AD_PAUSE",
      "AD_RESUME",
      "DATA_QUALITY_REVIEW",
      "MARKETING_REVIEW",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Commerce and the storefront are untouched                           */
/* ------------------------------------------------------------------ */

describe("commerce and the storefront are untouched", () => {
  it("no commerce, cart, checkout, configuration or pricing file imports the Google Ads layer", () => {
    const commerce = readAll([
      "lib/commerce",
      "lib/cart",
      "lib/configuration",
      "app/api/checkout",
      "app/api/cart",
      "app/api/configuration",
      "modules/pricing",
    ]);
    expect(commerce.length).toBeGreaterThan(0);
    for (const { file, source } of commerce) {
      expect(source, `${file} must not depend on Google Ads intelligence`).not.toMatch(/@\/modules\/google-ads-intelligence/);
      expect(source, `${file} must not depend on the Google Ads adapter`).not.toMatch(/@\/lib\/google-ads/);
      expect(source, `${file} must not depend on the Google Ads agent`).not.toMatch(/agents\/google-ads/);
    }
  });

  it("keeps the Session 05–07 sales toolset at exactly 15 tools", () => {
    expect(createSalesToolRegistry().names()).toHaveLength(15);
  });

  it("adds no customer-facing surface — Google Ads code appears in /admin only", () => {
    const appFiles = walk(path.join(repo, "app")).map((f) => path.relative(repo, f));
    const offenders = appFiles.filter((file) => {
      if (file.startsWith("app/admin/") || file.startsWith("app/api/admin/")) return false;
      const source = stripComments(readFileSync(path.join(repo, file), "utf8"));
      return /google-ads/.test(source);
    });
    expect(offenders, "Session 13 is admin intelligence only").toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Tests never touch Google                                            */
/* ------------------------------------------------------------------ */

describe("the automated suite performs zero real Google calls", () => {
  it("every live-provider construction in the suite injects a stub fetch", () => {
    // A `LiveGoogleAdsReportingProvider` built WITHOUT `fetchImpl` would use
    // the platform fetch and could reach Google. Every construction in the
    // suite must therefore either pass a stub or never issue a request.
    for (const { file, source } of readAll(["tests"])) {
      const constructions = source.match(/new LiveGoogleAdsReportingProvider\([^)]*\)/g) ?? [];
      for (const construction of constructions) {
        // The one exception is the surface-comparison test, which reads the
        // prototype and never calls a method.
        const inspectsOnly = source.includes("surfaceOf(live)");
        expect(
          construction.includes("fetchImpl") || inspectsOnly,
          `${file}: ${construction} must inject a stub fetch`,
        ).toBe(true);
      }
    }
  });

  it("no test issues a real network request to Google", () => {
    // The suite's only Google-host reference is the ASSERTION that the
    // adapter builds the `:search` URL. Nothing performs it: `fetch` is
    // stubbed everywhere a request is made.
    for (const { file, source } of readAll(["tests"])) {
      if (/googleads\.googleapis\.com/.test(source)) {
        expect(source, `${file} references the Google host and must stub fetch`).toMatch(/fetchImpl/);
      }
    }
  });

  it("clears every GOOGLE_ADS_* variable before any test module loads", () => {
    const setup = readFileSync(path.join(repo, "tests/setup.ts"), "utf8");
    expect(setup).toMatch(/GOOGLE_ADS_/);
    // …and the process actually has none, so the live provider is unreachable.
    expect(Object.keys(process.env).filter((k) => k.startsWith("GOOGLE_ADS_"))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Honest scope                                                        */
/* ------------------------------------------------------------------ */

describe("deferred ingestion is declared rather than faked", () => {
  it("states that search terms and keywords are not ingested", () => {
    expect(SEARCH_TERMS_INGESTED).toBe(false);
    expect(KEYWORDS_INGESTED).toBe(false);
  });

  it("stores no search-term or keyword table", () => {
    const schema = readFileSync(path.join(repo, "db/schema.ts"), "utf8");
    expect(schema).not.toMatch(/searchTermDailyMetrics|keywordDailyMetrics/);
  });

  it("supports exactly the API versions the adapter has been verified against", () => {
    expect([...SUPPORTED_API_VERSIONS]).toEqual(["v25"]);
  });
});
