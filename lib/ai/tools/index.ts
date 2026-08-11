import { AiError } from "../errors";
import { ToolRegistry } from "./registry";
import { searchProductsTool, getProductDetailsTool } from "./catalog-tools";
import { calculatePriceTool, getQuantityPricingTool } from "./pricing-tools";
import { getShippingEstimateTool } from "./shipping-tools";
import { saveCustomerNeedTool } from "./need-tools";
import { recommendProductTool } from "./recommend-tools";
import { requestHumanHelpTool } from "./escalation-tools";
import {
  getCurrentConfigurationTool,
  suggestConfigurationUpdateTool,
  updateConfigurationTool,
} from "./configuration-tools";
import type { AnyToolDefinition } from "./types";

/**
 * Sales toolset — the ONLY tools a customer-facing sales conversation can
 * ever reach. Session 04 shipped the low-risk read/record set; Session 05
 * added recommendProduct (catalog-validated recommendations) and
 * requestHumanHelp (structured escalation). Session 06 adds the shared-
 * configuration tools (getCurrentConfiguration / updateConfiguration /
 * suggestConfigurationUpdate) — the AI mutates the SAME validated
 * configuration path the visual configurator uses, never a parallel state.
 * Cart/quote/order tools arrive with the sessions that grant commerce
 * authority.
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
  recommendProductTool,
  requestHumanHelpTool,
  getCurrentConfigurationTool,
  updateConfigurationTool,
  suggestConfigurationUpdateTool,
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
