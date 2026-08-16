import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSalesToolRegistry } from "@/lib/ai/tools";
import { ACTION_TYPES, executorRegistry } from "@/modules/guardrails";

/**
 * Session 10 — boundary tests (spec §24, §31–§32, §36–§37).
 *
 * The Guardrail Engine governs BUSINESS-MANAGEMENT actions. It must not
 * touch the customer-facing commerce flow, which has its own already-bounded
 * permission model (typed tools + customer confirmation + server re-quote).
 * These tests keep the two systems structurally separate and prove that no
 * mutation capability was introduced anywhere in this session.
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

describe("customer transaction tools vs business management actions (spec §32)", () => {
  it("keeps the Session 05–07 sales toolset exactly as it was (15 tools)", () => {
    const names = createSalesToolRegistry().names().sort();
    expect(names).toEqual(
      [
        "addConfiguredProductToCart",
        "calculatePrice",
        "getCartSummary",
        "getCurrentConfiguration",
        "getProductDetails",
        "getQuantityPricing",
        "getShippingEstimate",
        "recommendProduct",
        "requestHumanHelp",
        "saveCustomerNeed",
        "searchProducts",
        "startCheckout",
        "suggestAddToCart",
        "suggestConfigurationUpdate",
        "updateConfiguration",
      ].sort(),
    );
    expect(names).toHaveLength(15);
  });

  it("shares no vocabulary between customer tools and business action types", () => {
    const toolNames = new Set(createSalesToolRegistry().names());
    for (const actionType of ACTION_TYPES) expect(toolNames.has(actionType)).toBe(false);
  });

  it("never routes cart/checkout/configuration through the Action Center", () => {
    const commerce = readAll(["lib/commerce", "lib/cart", "lib/configuration", "app/api/checkout", "app/api/cart", "app/api/configuration"]);
    expect(commerce.length).toBeGreaterThan(0);
    for (const { file, source } of commerce) {
      expect(source, `${file} must not depend on the guardrail/action layer`).not.toMatch(/@\/modules\/guardrails/);
      expect(source, `${file} must not depend on the action service`).not.toMatch(/agent-action-service/);
    }
  });

  it("keeps the sales agent out of the business-action source list", () => {
    const salesAgent = readAll(["lib/ai/agents/sales"]);
    for (const { file, source } of salesAgent) {
      expect(source, `${file} must not import the guardrail action layer`).not.toMatch(/@\/modules\/guardrails/);
    }
  });
});

describe("no execution capability was introduced (spec §22–§24, §36–§37)", () => {
  it("registers zero executors", () => {
    expect(executorRegistry.list()).toEqual([]);
  });

  it("contains no price, ads, refund, or catalog mutation call in the guardrail/action layer", () => {
    const files = [
      ...readAll(["modules/guardrails"]),
      { file: "lib/data/agent-action-service.ts", source: readFileSync(path.join(repo, "lib/data/agent-action-service.ts"), "utf8") },
      ...readAll(["app/api/admin/ai-actions"]),
    ];
    const forbidden = [
      /issueRefund|createRefund|refundOrder\s*\(/,
      /capturePayment|markOrderPaid|applyDiscount/,
      /updateCampaignBudget|createCampaign|pauseCampaign/,
      /**
       * No ADS API CLIENT may be reachable from the guardrail/action layer.
       *
       * Session 13 narrowed this from a bare /googleads/i: the mapping table
       * `mapGoogleAdsDecisionToAction` legitimately names the Google Ads
       * AGENT (a review-only decision source), while the thing that must stay
       * unreachable is the Google Ads CLIENT. The pattern now names the client
       * SDKs, the API host, and this repo's own adapter — which is strictly
       * stronger than what it replaced.
       */
      /google-ads-api|facebook-nodejs|googleads\.googleapis|@\/lib\/google-ads/i,
      /updateProduct\s*\(|writeCatalog|setPrice\s*\(/,
      /createCheckout\s*\(/,
    ];
    for (const { file, source } of files) {
      for (const pattern of forbidden) {
        expect(source, `${file} must contain no ${pattern} call`).not.toMatch(pattern);
      }
    }
  });

  it("makes no network or AI-provider call from the guardrail layer", () => {
    for (const { file, source } of readAll(["modules/guardrails"])) {
      expect(source, `${file} must not call fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(source, `${file} must not import the AI runtime`).not.toMatch(/@\/lib\/ai/);
      expect(source, `${file} must not import the database`).not.toMatch(/@\/db\//);
    }
  });
});

describe("CEO agent stays recommendation-only (spec §20, §43)", () => {
  it("still declares no tools and no execution path", () => {
    const ceo = readAll(["lib/ai/agents/ceo"]);
    for (const { file, source } of ceo) {
      expect(source, `${file} must not build a tool registry`).not.toMatch(/createSalesToolRegistry|new ToolRegistry|runToolConversation/);
      expect(source, `${file} must not approve anything`).not.toMatch(/reviewAction|reviewApproval|setExecutionStatus/);
    }
  });

  it("does not import the action service — agents never approve their own work", () => {
    for (const { file, source } of readAll(["lib/ai/agents"])) {
      expect(source, `${file} must not write proposed-action approvals`).not.toMatch(/agent-action-service/);
    }
  });
});
