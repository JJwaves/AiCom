import { AiError } from "../errors";
import { ToolRegistry } from "./registry";
import { searchProductsTool, getProductDetailsTool } from "./catalog-tools";
import { calculatePriceTool, getQuantityPricingTool } from "./pricing-tools";
import { getShippingEstimateTool } from "./shipping-tools";
import { saveCustomerNeedTool } from "./need-tools";
import type { AnyToolDefinition } from "./types";

/**
 * Sales toolset — the ONLY tools a customer-facing sales conversation can
 * ever reach. Session 04 ships the low-risk set that proves the
 * architecture; cart/quote/config tools arrive with S05/S06.
 *
 * Deliberately absent, forever, from any customer-facing toolset:
 * modifyPrice, issueRefund, changeAdBudget, createAdCampaign, modifyMargin,
 * modifyProductManufacturingRules, adminDatabaseQuery — with no tool, a
 * prompt-injected request has nothing to call (capability boundary, not
 * prompt wording).
 */

const SALES_TOOLS: AnyToolDefinition[] = [
  searchProductsTool,
  getProductDetailsTool,
  calculatePriceTool,
  getQuantityPricingTool,
  getShippingEstimateTool,
  saveCustomerNeedTool,
];

/** Hard structural invariant: customer-facing toolsets never contain restricted tools. */
function assertCustomerSafe(tools: AnyToolDefinition[]): AnyToolDefinition[] {
  for (const t of tools) {
    if (t.permission === "FINANCIAL_RESTRICTED" || t.permission === "ADMIN_RESTRICTED") {
      throw new AiError(
        "AI_CONFIGURATION_ERROR",
        `tool "${t.name}" is ${t.permission} and can never be part of a customer-facing toolset`,
      );
    }
  }
  return tools;
}

export function createSalesToolRegistry(): ToolRegistry {
  return new ToolRegistry(assertCustomerSafe(SALES_TOOLS));
}

export { ToolRegistry, createToolContext } from "./registry";
export * from "./types";
