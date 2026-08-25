import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COST_MODEL, COST_MODEL_VERSION } from "@/config/costs";
import { GUARDRAIL_LIMITS, GUARDED_AUTO_ALLOWED_ACTION_TYPES, AGENT_AUTONOMY_POLICY } from "@/config/guardrails";
import { PRODUCTS } from "@/config/products";
import { createSalesToolRegistry } from "@/lib/ai/tools";
import { ACTION_TYPE_REGISTRY, executorRegistry } from "@/modules/guardrails";
import { calculatePrice, evaluatePriceFloor } from "@/modules/pricing";

/**
 * Session 13.5 — boundary tests (spec §42, §43, §46, §47, §58).
 *
 * The cost model is DETERMINISTIC ACCOUNTING. It may never acquire an AI
 * dependency, and knowing (or not knowing) a cost may never affect whether a
 * customer can buy something. These tests keep both structural: a future
 * session that crosses either line has to delete a test to do it.
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

/** Comments are stripped: a doc block SAYING "no AI here" is not a violation. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const readAll = (dirs: string[]) =>
  dirs
    .flatMap((d) => walk(path.join(repo, d)))
    .map((file) => ({ file: path.relative(repo, file), source: stripComments(readFileSync(file, "utf8")) }));

const COST_FILES = readAll(["modules/pricing"]);
const COST_CONFIG = stripComments(readFileSync(path.join(repo, "config/costs.ts"), "utf8"));

/* ------------------------------------------------------------------ */
/* §42 — no AI anywhere in the cost engine                             */
/* ------------------------------------------------------------------ */

describe("the cost engine contains no AI (§42)", () => {
  it("never imports lib/ai", () => {
    for (const { file, source } of COST_FILES) {
      expect(source, `${file} must not import lib/ai`).not.toMatch(/from\s+["']@\/lib\/ai/);
      expect(source, `${file} must not import lib/ai`).not.toMatch(/require\(["']@\/lib\/ai/);
    }
  });

  it("never calls a model, a provider or the network", () => {
    for (const { file, source } of COST_FILES) {
      expect(source, `${file} must not call a provider`).not.toMatch(/generateStructuredObject|generateText|runToolConversation/);
      expect(source, `${file} must not use anthropic`).not.toMatch(/anthropic|openai|gemini/i);
      expect(source, `${file} must not fetch`).not.toMatch(/\bfetch\(/);
    }
  });

  it("has no field that could carry an estimated, inferred or predicted cost", () => {
    for (const { file, source } of COST_FILES) {
      expect(source, `${file} must not estimate costs`).not.toMatch(
        /estimatedManufacturing|inferredCost|predictedCost|assumedCost|aiEstimated/i,
      );
    }
  });

  it("config/costs.ts contains no numeric business value — only null placeholders", () => {
    const assignments = COST_CONFIG.match(/:\s*-?\d[\d_]*\s*[,;\n}]/g) ?? [];
    expect(assignments, `config/costs.ts must not carry invented numbers: ${assignments.join(" ")}`).toEqual([]);
    expect(COST_CONFIG).toMatch(/\[TO BE PROVIDED\]/);
    expect(COST_MODEL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\./);
  });

  it("never imports the database — costing is pure arithmetic over inputs", () => {
    for (const { file, source } of COST_FILES) {
      expect(source, `${file} must not import db/`).not.toMatch(/from\s+["']@\/db\//);
    }
  });
});

/* ------------------------------------------------------------------ */
/* §46, §47 — cost configuration never blocks a sale                   */
/* ------------------------------------------------------------------ */

describe("missing cost configuration never blocks commerce (§46, §47)", () => {
  const product = PRODUCTS[0];
  const config = {
    productId: product.id,
    sizeId: "l",
    materialId: "insulated",
    colorId: "black",
    printOptionId: "full-custom" as const,
    quantity: 5_000,
    artwork: { fileName: "logo.png", fileType: "image/png", fileSizeBytes: 1024 },
  };

  it("still returns the deterministic sell price with every cost null", () => {
    const calc = calculatePrice(product, config, COST_MODEL);
    expect(calc.ok).toBe(true);
    if (!calc.ok) return;
    expect(calc.unitPriceCents).toBe(19); // 5,000 tier @19¢, Large size delta 0¢
    expect(calc.totalPriceCents).toBe(95_000);
    expect(calc.costStatus).toBe("unconfigured");
    expect(calc.grossProfitCents).toBeNull();
  });

  it("prices come ONLY from the catalog — the cost model changes no sell price", () => {
    // Product #1's confirmed launch tiers, and the untouched seed catalog.
    expect(PRODUCTS[0].pricingTiers.map((t) => t.unitPriceCents)).toEqual([19, 15]);
    expect(PRODUCTS[0].minQuantity).toBe(5_000);
    expect(PRODUCTS[1].pricingTiers.map((t) => t.unitPriceCents)).toEqual([78, 69, 61, 55, 49]);
    expect(PRODUCTS[2].pricingTiers.map((t) => t.unitPriceCents)).toEqual([55, 48, 42, 37, 33]);
    expect(PRODUCTS[3].pricingTiers.map((t) => t.unitPriceCents)).toEqual([92, 83, 74, 66]);
  });

  it("no commerce path consults cost readiness", () => {
    const commerce = readAll(["lib/commerce", "lib/cart", "lib/configuration"]);
    for (const { file, source } of commerce) {
      expect(source, `${file} must not gate on cost readiness`).not.toMatch(
        /assessCostReadiness|isCostModelConfigured|evaluatePriceFloor/,
      );
    }
  });

  it("the checkout route never calls the price floor", () => {
    const checkout = stripComments(readFileSync(path.join(repo, "app/api/checkout/route.ts"), "utf8"));
    expect(checkout).not.toMatch(/evaluatePriceFloor|assessCostReadiness|isCostModelConfigured/);
  });

  it("the price floor still FAILS CLOSED for price deviations", () => {
    const verdict = evaluatePriceFloor(235_000, product, config, COST_MODEL);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.violatedRules).toContain("cost_model_unconfigured");
  });
});

/* ------------------------------------------------------------------ */
/* §43–§45 — no new authority                                          */
/* ------------------------------------------------------------------ */

describe("Session 13.5 grants no new authority (§43–§45)", () => {
  it("adds no cost/finance/factory agent", () => {
    const agents = readdirSync(path.join(repo, "lib/ai/agents"));
    expect(agents).not.toContain("cost");
    expect(agents).not.toContain("finance");
    expect(agents).not.toContain("factory");
    expect(agents.sort()).toEqual(
      ["ceo", "cro", "customer-intelligence", "google-ads", "pricing", "sales"].sort(),
    );
  });

  it("leaves the executor registry EMPTY — approving still executes nothing", () => {
    expect(executorRegistry.list()).toEqual([]);
    expect(executorRegistry.has("PRICE_CHANGE")).toBe(false);
  });

  it("leaves the guarded-auto allow-list EMPTY", () => {
    expect(GUARDED_AUTO_ALLOWED_ACTION_TYPES).toEqual([]);
  });

  it("keeps every business agent capped at RECOMMEND", () => {
    for (const [agent, policy] of Object.entries(AGENT_AUTONOMY_POLICY)) {
      expect(policy.maxMode, `${agent} ceiling`).toBe("RECOMMEND");
    }
  });

  it("adds no PRICE_CHANGE or ad executor and no new action type", () => {
    const types = Object.keys(ACTION_TYPE_REGISTRY);
    expect(types).toContain("PRICE_CHANGE"); // representable since S10…
    expect(ACTION_TYPE_REGISTRY.PRICE_CHANGE.executionSupport).not.toBe("IMPLEMENTED"); // …never executable
    expect(types).not.toContain("COST_CHANGE");
    expect(types).not.toContain("MARGIN_CHANGE");
  });

  it("leaves every guardrail limit null — a null limit blocks, it is never 'no limit'", () => {
    for (const [key, value] of Object.entries(GUARDRAIL_LIMITS)) {
      expect(value, `${key} must stay [TO BE PROVIDED]`).toBeNull();
    }
  });

  it("gives the sales agent no cost, margin or profit tool", () => {
    const names = createSalesToolRegistry().names();
    expect(names).not.toContain("getCosts");
    expect(names).not.toContain("getMargin");
    expect(names).not.toContain("getProfitability");
    expect(names).not.toContain("setCost");
    // No sales tool file may even mention a cost/margin field name.
    for (const { file, source } of readAll(["lib/ai/tools"])) {
      expect(source, `${file} must not expose cost data`).not.toMatch(
        /grossProfitCents|contributionBeforePaidMedia|marginBps|cogs/i,
      );
    }
  });

  it("introduces no Google Ads mutation", () => {
    const gads = readAll(["lib/google-ads", "modules/google-ads-intelligence"]);
    for (const { file, source } of gads) {
      expect(source, `${file} must not mutate`).not.toMatch(/:mutate|mutateCampaign|updateBudget/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* §14, §16, §20 — the levels never collapse into each other           */
/* ------------------------------------------------------------------ */

describe("profit levels are never renamed into each other (§14, §16, §20)", () => {
  it("nothing in the cost engine is called net profit", () => {
    for (const { file, source } of COST_FILES) {
      expect(source, `${file} must not claim net profit`).not.toMatch(/netProfit|profitAfterTax|bottomLine/i);
    }
  });

  it("contribution is always qualified as BEFORE or AFTER paid media", () => {
    const economics = readFileSync(path.join(repo, "modules/pricing/unit-economics.ts"), "utf8");
    const bare = stripComments(economics).match(/contributionProfitCents|contributionCents\b/g) ?? [];
    expect(bare).toEqual([]);
    expect(economics).toMatch(/contributionBeforePaidMediaCents/);
    expect(economics).toMatch(/postAdContributionCents/);
  });

  it("ROAS and POAS remain separate fields with separate formulas", () => {
    const efficiency = readFileSync(path.join(repo, "modules/google-ads-intelligence/efficiency.ts"), "utf8");
    expect(efficiency).toMatch(/firstPartyRoas/);
    expect(efficiency).toMatch(/profitOnAdSpend/);
    const stripped = stripComments(efficiency);
    // No field named merely `roas` or `poas`, and no alias between them.
    expect(stripped).not.toMatch(/\broas:\s*profitOnAdSpend/);
    expect(stripped).not.toMatch(/\bpoas:\s*firstPartyRoas/);
  });
});
