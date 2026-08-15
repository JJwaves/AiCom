import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUARDRAIL_LIMITS } from "@/config/guardrails";
import { createSalesToolRegistry } from "@/lib/ai/tools";
import { ACTION_TYPE_REGISTRY, executorRegistry, SOURCE_PERMITTED_ACTION_TYPES } from "@/modules/guardrails";
import { EXPERIMENT_TARGET_KEYS } from "@/modules/experiments";

/**
 * Session 11 — boundary tests (spec §4, §26, §40, §50).
 *
 * The experiment engine is a MEASUREMENT authority and the CRO agent is a
 * proposal author. Neither may acquire the ability to change commerce,
 * pricing, checkout or the site itself. These tests keep those boundaries
 * structural rather than aspirational.
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

const readAll = (dirs: string[]) =>
  dirs
    .flatMap((d) => walk(path.join(repo, d)))
    .map((file) => ({ file: path.relative(repo, file), source: readFileSync(file, "utf8") }));

describe("modules/experiments is deterministic authority", () => {
  it("imports neither the AI runtime nor the database", () => {
    const files = readAll(["modules/experiments"]);
    expect(files.length).toBeGreaterThan(5);
    for (const { file, source } of files) {
      expect(source, `${file} must not import the AI runtime`).not.toMatch(/@\/lib\/ai/);
      expect(source, `${file} must not import the database`).not.toMatch(/@\/db\//);
      expect(source, `${file} must not call fetch`).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("contains no randomness or clock in assignment or statistics", () => {
    for (const name of ["assignment.ts", "statistics.ts", "results.ts", "allocation.ts"]) {
      const source = readFileSync(path.join(repo, "modules/experiments", name), "utf8");
      expect(source, `${name} must not use Math.random`).not.toMatch(/Math\.random/);
      expect(source, `${name} must not read the clock`).not.toMatch(/Date\.now|new Date\(/);
    }
  });
});

describe("the CRO agent proposes and nothing more", () => {
  it("never imports the action service — agents do not approve their own work", () => {
    for (const { file, source } of readAll(["lib/ai/agents"])) {
      expect(source, `${file} must not write proposed-action approvals`).not.toMatch(/agent-action-service/);
    }
  });

  it("never launches, stops, or assigns", () => {
    for (const { file, source } of readAll(["lib/ai/agents/cro"])) {
      expect(source, `${file} must not launch an experiment`).not.toMatch(/launchExperiment/);
      expect(source, `${file} must not stop an experiment`).not.toMatch(/stopExperiment/);
      expect(source, `${file} must not create experiment rows`).not.toMatch(/createExperimentDraft/);
      expect(source, `${file} must not assign traffic`).not.toMatch(/recordAssignment|markExposed/);
      expect(source, `${file} must not build a tool registry`).not.toMatch(
        /createSalesToolRegistry|new ToolRegistry|runToolConversation/,
      );
    }
  });

  it("cannot reach pricing, checkout, catalog mutation, or ads", () => {
    for (const { file, source } of readAll(["lib/ai/agents/cro", "lib/experiments"])) {
      for (const pattern of [
        /createCheckout\s*\(/,
        /applyDiscount|capturePayment|markOrderPaid/,
        /setPrice\s*\(|updateProduct\s*\(|writeCatalog/,
        /updateCampaignBudget|createCampaign|pauseCampaign/,
        /issueRefund|createRefund/,
      ]) {
        expect(source, `${file} must contain no ${pattern} call`).not.toMatch(pattern);
      }
    }
  });
});

describe("commerce is untouched by the experiment engine", () => {
  it("no commerce, cart, configuration or checkout file imports the experiment engine", () => {
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
      expect(source, `${file} must not depend on the experiment engine`).not.toMatch(/@\/modules\/experiments/);
      expect(source, `${file} must not depend on the experiment service`).not.toMatch(/experiment-service/);
      expect(source, `${file} must not resolve experiment variants`).not.toMatch(/lib\/experiments/);
    }
  });

  it("keeps the Session 05–07 sales toolset at exactly 15 tools", () => {
    expect(createSalesToolRegistry().names()).toHaveLength(15);
  });
});

describe("no pricing experiment is activated (spec §40)", () => {
  it("registers no price or checkout experiment target", () => {
    for (const key of EXPERIMENT_TARGET_KEYS) {
      expect(key).not.toMatch(/price|pricing|checkout|payment/i);
    }
  });

  it("keeps PRICE_EXPERIMENT representable but unexecutable, and CRO may not propose it", () => {
    const spec = ACTION_TYPE_REGISTRY.PRICE_EXPERIMENT;
    expect(spec.executionSupport).toBe("NOT_IMPLEMENTED");
    expect(spec.priceAffecting).toBe(true);
    expect(SOURCE_PERMITTED_ACTION_TYPES.CRO_AGENT).not.toContain("PRICE_EXPERIMENT");
    expect(SOURCE_PERMITTED_ACTION_TYPES.CRO_AGENT).not.toContain("PRICE_CHANGE");
  });

  it("no experiment code path imports the pricing engine's mutation surface", () => {
    for (const { file, source } of readAll(["modules/experiments", "lib/experiments"])) {
      expect(source, `${file} must not import the pricing module`).not.toMatch(/@\/modules\/pricing/);
      expect(source, `${file} must not import the cost model`).not.toMatch(/@\/config\/costs/);
    }
  });
});

describe("no automated execution capability was introduced (spec §26)", () => {
  it("registers ZERO executors — approving still executes nothing", () => {
    expect(executorRegistry.list()).toEqual([]);
  });

  it("keeps CRO_EXPERIMENT_LAUNCH unexecutable and dependent on an unset business limit", () => {
    const spec = ACTION_TYPE_REGISTRY.CRO_EXPERIMENT_LAUNCH;
    expect(spec.executionSupport).toBe("NOT_IMPLEMENTED");
    expect(spec.requiredLimits).toContain("maximumExperimentTrafficPct");
    expect(GUARDRAIL_LIMITS.maximumExperimentTrafficPct).toBeNull();
  });

  it("calls launchExperiment ONLY from the human admin route (plus its own service)", () => {
    const callers = readAll(["app", "lib", "modules"])
      .filter(({ source }) => /\blaunchExperiment\s*\(/.test(source))
      .map(({ file }) => file)
      .sort();
    expect(callers).toEqual([
      "app/api/admin/experiments/[id]/launch/route.ts",
      "lib/data/experiment-service.ts",
    ]);
  });
});
