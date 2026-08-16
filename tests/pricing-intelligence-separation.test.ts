import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COST_MODEL } from "@/config/costs";
import { GUARDRAIL_LIMITS, GUARDRAIL_POLICY_VERSION, GUARDED_AUTO_ALLOWED_ACTION_TYPES, AGENT_AUTONOMY_POLICY } from "@/config/guardrails";
import {
  PRICING_RECOMMENDATION_ACTION_TYPE,
  PRICING_RECOMMENDATION_TYPES,
} from "@/config/pricing-intelligence";
import { createSalesToolRegistry } from "@/lib/ai/tools";
import { pricingRecommendationSchema, pricingReviewSchema } from "@/lib/ai/agents/pricing/schema";
import {
  ACTION_TYPE_REGISTRY,
  evaluateAgentAction,
  executorRegistry,
  PRICING_RECOMMENDATION_TO_ACTION_TYPE,
  SOURCE_PERMITTED_ACTION_TYPES,
} from "@/modules/guardrails";
import { EXPERIMENT_TARGET_KEYS, EXPERIMENT_TYPES } from "@/modules/experiments";
import { PRICE_EXPERIMENT_SUPPORTED } from "@/modules/pricing-intelligence";

/**
 * Session 12 — boundary tests (spec §51).
 *
 * Pricing intelligence is an ANALYTICS authority and the Pricing Agent is an
 * advisor. Neither may acquire the ability to price anything. These tests
 * keep those boundaries structural rather than aspirational — a future
 * session that wires a price mutation in has to delete a test to do it.
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
 * can do; a doc block that says "there is deliberately no optimalPrice here"
 * is the documentation working, not a violation of it.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const readAll = (dirs: string[]) =>
  dirs
    .flatMap((d) => walk(path.join(repo, d)))
    .map((file) => ({ file: path.relative(repo, file), source: stripComments(readFileSync(file, "utf8")) }));

/* ------------------------------------------------------------------ */
/* modules/pricing-intelligence is deterministic authority             */
/* ------------------------------------------------------------------ */

describe("modules/pricing-intelligence is deterministic authority", () => {
  it("never imports the AI runtime", () => {
    const files = readAll(["modules/pricing-intelligence"]);
    expect(files.length).toBeGreaterThan(8);
    for (const { file, source } of files) {
      expect(source, `${file} must not import the AI runtime`).not.toMatch(/@\/lib\/ai/);
      expect(source, `${file} must not call fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(source, `${file} must not use randomness`).not.toMatch(/Math\.random/);
    }
  });

  it("never mutates a price, a tier, an MOQ or the catalog", () => {
    for (const { file, source } of readAll(["modules/pricing-intelligence"])) {
      for (const pattern of [
        /setPrice\s*\(|updatePrice\s*\(|writePrice/,
        /updateProduct\s*\(|writeCatalog|setMoq\s*\(|updateMoq/,
        /applyDiscount|createDiscount|capturePayment|markOrderPaid|createCheckout\s*\(/,
        /issueRefund|createRefund/,
        /\bdb\.(insert|update|delete)\b/,
      ]) {
        expect(source, `${file} must contain no ${pattern} call`).not.toMatch(pattern);
      }
    }
  });

  it("implements no calculateOptimalPrice and no elasticity coefficient (spec §2–§3)", () => {
    for (const { file, source } of readAll(["modules/pricing-intelligence", "lib/ai/agents/pricing"])) {
      expect(source, `${file} must not compute an optimal price`).not.toMatch(
        /calculateOptimalPrice|optimalPrice|recommendedPriceCents|suggestedPriceCents/,
      );
      expect(source, `${file} must not compute an elasticity coefficient`).not.toMatch(
        /elasticityCoefficient|priceElasticityValue|computeElasticity/,
      );
    }
  });

  it("implements no personalized pricing of any kind (spec §17)", () => {
    for (const { file, source } of readAll(["modules/pricing-intelligence", "lib/ai/agents/pricing"])) {
      for (const pattern of [
        /priceFor(Customer|Segment|Session|Visitor|Device|Geo)/i,
        /willingnessToPay/i,
        /personalized(Price|Pricing)/i,
        /customerPriceOverride/i,
      ]) {
        expect(source, `${file} must contain nothing matching ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* The Pricing Agent proposes and nothing more                         */
/* ------------------------------------------------------------------ */

describe("the Pricing Agent advises and nothing more", () => {
  it("has no tools, and never approves its own work", () => {
    for (const { file, source } of readAll(["lib/ai/agents/pricing"])) {
      expect(source, `${file} must not build a tool registry`).not.toMatch(
        /createSalesToolRegistry|new ToolRegistry|runToolConversation/,
      );
      expect(source, `${file} must not write proposed-action approvals`).not.toMatch(/agent-action-service/);
      expect(source, `${file} must not launch an experiment`).not.toMatch(/launchExperiment|createExperimentDraft/);
    }
  });

  it("cannot reach pricing mutation, checkout, cart or the catalog writer", () => {
    for (const { file, source } of readAll(["lib/ai/agents/pricing"])) {
      for (const pattern of [
        /createCheckout\s*\(/,
        /applyDiscount|capturePayment|markOrderPaid/,
        /upsertActiveConfiguration|updateConfigurationChecked/,
        /modules\/pricing\/cost-model/,
      ]) {
        expect(source, `${file} must contain no ${pattern} call`).not.toMatch(pattern);
      }
    }
  });

  it("has no price field anywhere in its output schema (spec §26)", () => {
    const keys = Object.keys(pricingRecommendationSchema.shape);
    for (const forbidden of [
      "proposedUnitPriceCents",
      "newUnitPriceCents",
      "priceCents",
      "discountPct",
      "proposedMoq",
      "elasticity",
      "optimalPrice",
    ]) {
      expect(keys, `the recommendation schema must not expose ${forbidden}`).not.toContain(forbidden);
    }
    // What it DOES expose is a review question and its evidence.
    expect(keys).toContain("recommendationType");
    expect(keys).toContain("metricRefs");
    expect(keys).toContain("limitations");
    // The whole review has exactly four sections and no price anywhere.
    expect(Object.keys(pricingReviewSchema.shape).sort()).toEqual([
      "executiveSummary",
      "openQuestions",
      "recommendations",
      "signals",
    ]);
  });

  it("keeps the recommendation taxonomy closed and review-only", () => {
    expect([...PRICING_RECOMMENDATION_TYPES].sort()).toEqual([
      "DATA_QUALITY",
      "MOQ_REVIEW",
      "PRICE_EXPERIMENT_REVIEW",
      "PRICE_PRESENTATION_REVIEW",
      "PRICING_REVIEW",
      "TIER_STRUCTURE_REVIEW",
    ]);
    for (const type of PRICING_RECOMMENDATION_TYPES) {
      const actionType = PRICING_RECOMMENDATION_ACTION_TYPE[type];
      expect(ACTION_TYPE_REGISTRY[actionType].executionSupport).toBe("REVIEW_ONLY");
    }
  });

  it("keeps the guardrail and config mapping tables in agreement", () => {
    expect(PRICING_RECOMMENDATION_TO_ACTION_TYPE).toEqual(PRICING_RECOMMENDATION_ACTION_TYPE);
  });

  it("can never map a recommendation to PRICE_CHANGE or PRICE_EXPERIMENT", () => {
    const mapped = Object.values(PRICING_RECOMMENDATION_ACTION_TYPE);
    expect(mapped).not.toContain("PRICE_CHANGE");
    expect(mapped).not.toContain("PRICE_EXPERIMENT");
    expect(mapped).not.toContain("MOQ_CHANGE");
  });
});

/* ------------------------------------------------------------------ */
/* Commerce and the pricing engine are untouched                       */
/* ------------------------------------------------------------------ */

describe("commerce and the pricing engine are untouched", () => {
  it("no commerce, cart, configuration, checkout or pricing file imports pricing intelligence", () => {
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
      expect(source, `${file} must not depend on pricing intelligence`).not.toMatch(/@\/modules\/pricing-intelligence/);
      expect(source, `${file} must not depend on the pricing agent`).not.toMatch(/agents\/pricing/);
      expect(source, `${file} must not read pricing-intelligence data`).not.toMatch(/pricing-intelligence-service|pricing-report-service/);
    }
  });

  it("keeps the Session 05–07 sales toolset at exactly 15 tools", () => {
    expect(createSalesToolRegistry().names()).toHaveLength(15);
  });

  it("leaves modules/pricing as the sole pricing authority", () => {
    // The engine is READ by pricing intelligence and never modified by it.
    const engine = readFileSync(path.join(repo, "modules/pricing/engine.ts"), "utf8");
    expect(engine).not.toMatch(/pricing-intelligence/);
    const costModel = readFileSync(path.join(repo, "modules/pricing/cost-model.ts"), "utf8");
    expect(costModel).not.toMatch(/pricing-intelligence/);
  });

  it("keeps every production cost input unfilled — no economics were invented", () => {
    expect(COST_MODEL.paymentFee.percentBps).toBeNull();
    expect(COST_MODEL.paymentFee.fixedCents).toBeNull();
    expect(COST_MODEL.marginPolicy.minimumGrossMarginBps).toBeNull();
    expect(COST_MODEL.marginPolicy.minimumContributionMarginBps).toBeNull();
    for (const pc of Object.values(COST_MODEL.products)) {
      expect(pc.baseManufacturingCentsPerUnit).toBeNull();
      expect(pc.printing).toBeNull();
      expect(pc.shipping).toBeNull();
    }
  });

  it("keeps every guardrail price limit unfilled", () => {
    expect(GUARDRAIL_LIMITS.maximumPriceDecreasePct).toBeNull();
    expect(GUARDRAIL_LIMITS.maximumPriceIncreasePct).toBeNull();
    expect(GUARDRAIL_LIMITS.maximumDiscountPct).toBeNull();
    expect(GUARDRAIL_LIMITS.maximumMoqChangePct).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* No execution capability was introduced (spec §28–§29)               */
/* ------------------------------------------------------------------ */

describe("no automated execution capability was introduced", () => {
  it("registers ZERO executors — approving still executes nothing", () => {
    expect(executorRegistry.list()).toEqual([]);
  });

  it("keeps PRICE_CHANGE representable but unexecutable", () => {
    const spec = ACTION_TYPE_REGISTRY.PRICE_CHANGE;
    expect(spec.executionSupport).toBe("NOT_IMPLEMENTED");
    expect(spec.priceAffecting).toBe(true);
    expect(spec.baseRisk).toBe("HIGH");
    expect(executorRegistry.has("PRICE_CHANGE")).toBe(false);
  });

  it("keeps PRICE_EXPERIMENT unexecutable and unlaunchable", () => {
    const spec = ACTION_TYPE_REGISTRY.PRICE_EXPERIMENT;
    expect(spec.executionSupport).toBe("NOT_IMPLEMENTED");
    expect(spec.requiredLimits).toContain("maximumExperimentTrafficPct");
    expect(PRICE_EXPERIMENT_SUPPORTED).toBe(false);
  });

  it("keeps every business agent capped at RECOMMEND with an empty guarded-auto list", () => {
    expect(AGENT_AUTONOMY_POLICY.PRICING_AGENT.maxMode).toBe("RECOMMEND");
    expect(GUARDED_AUTO_ALLOWED_ACTION_TYPES).toEqual([]);
  });

  it("bumped the guardrail policy version for the Session 12 taxonomy change", () => {
    expect(GUARDRAIL_POLICY_VERSION).not.toBe("2026-08-12.s11.1");
  });

  it("blocks execution of a HUMAN-proposed price change while costs are unconfigured", () => {
    const { decision } = evaluateAgentAction({
      source: "HUMAN_ADMIN",
      actionType: "PRICE_CHANGE",
      autonomyMode: "RECOMMEND",
      payload: {
        productId: "p-custom-takeout",
        quantityTier: 5000,
        currentUnitPriceCents: 42,
        proposedUnitPriceCents: 37,
        currency: "USD",
        reason: "Objections cluster in this band.",
        metricRefs: [],
        evidenceRefs: [],
      },
    });
    // A human may PROPOSE it; the margin floor still refuses to bless it.
    expect(decision.allowed).toBe(true);
    expect(decision.executionEligible).toBe(false);
    expect(decision.approvalRequired).toBe(true);
    expect(decision.missingConfiguration.some((m) => m.includes("config/costs.ts"))).toBe(true);
    expect(decision.missingConfiguration.some((m) => m.includes("maximumPriceDecreasePct"))).toBe(true);
    expect(decision.violatedRules.some((r) => r.id === "price_floor_unverified")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Real price experiments remain impossible (spec §30–§32)             */
/* ------------------------------------------------------------------ */

describe("real price experiments remain unsupported", () => {
  it("registers no price or checkout experiment target", () => {
    for (const key of EXPERIMENT_TARGET_KEYS) {
      expect(key).not.toMatch(/price|pricing|checkout|payment/i);
    }
  });

  it("keeps PRICE_EXPERIMENT out of the experiment engine's own type list", () => {
    expect(EXPERIMENT_TYPES).not.toContain("PRICE_EXPERIMENT");
  });

  it("does not let the Pricing Agent propose or launch a CRO experiment", () => {
    expect(SOURCE_PERMITTED_ACTION_TYPES.PRICING_AGENT).not.toContain("CRO_EXPERIMENT_PROPOSAL");
    expect(SOURCE_PERMITTED_ACTION_TYPES.PRICING_AGENT).not.toContain("CRO_EXPERIMENT_LAUNCH");
  });

  it("keeps the Pricing Agent's permitted types to reviews plus the two unexecutable price types", () => {
    expect([...SOURCE_PERMITTED_ACTION_TYPES.PRICING_AGENT].sort()).toEqual([
      "DATA_QUALITY_REVIEW",
      "MOQ_REVIEW",
      "PRICE_CHANGE",
      "PRICE_EXPERIMENT",
      "PRICING_REVIEW",
    ]);
  });

  it("no pricing-intelligence code path routes a price variant into the experiment engine", () => {
    for (const { file, source } of readAll(["modules/pricing-intelligence", "lib/ai/agents/pricing"])) {
      expect(source, `${file} must not create experiments`).not.toMatch(/createExperimentDraft|launchExperiment|recordAssignment/);
      expect(source, `${file} must not import the experiment runtime`).not.toMatch(/@\/lib\/experiments/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Ethical boundaries (spec §43)                                       */
/* ------------------------------------------------------------------ */

describe("ethical pricing boundaries", () => {
  it("implements no fake reference price, fake discount, or fake scarcity", () => {
    for (const { file, source } of readAll([
      "modules/pricing-intelligence",
      "lib/ai/agents/pricing",
      "app/admin/pricing-intelligence",
    ])) {
      for (const pattern of [
        /compareAtPrice|wasPriceCents|strikeThroughPrice/i,
        /fakeDiscount|syntheticDiscount/i,
        /countdown|scarcity|onlyXLeft/i,
        /hiddenFee|surchargeAtCheckout/i,
      ]) {
        expect(source, `${file} must contain nothing matching ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("states the elasticity limitation in the agent prompt rather than relying on a filter", () => {
    const registry = readFileSync(path.join(repo, "lib/ai/prompts/registry.ts"), "utf8");
    expect(registry).toMatch(/NEVER CLAIM ELASTICITY/);
    expect(registry).toMatch(/NEVER STATE AN OPTIMAL PRICE/);
    expect(registry).toMatch(/Revenue is not profit/);
  });
});
