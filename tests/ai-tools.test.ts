import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AGENT_TOOL_PERMISSIONS,
  createSalesToolRegistry,
  createToolContext,
  ToolRegistry,
  type AnyToolDefinition,
} from "@/lib/ai/tools";
import { listCatalogProducts } from "@/lib/commerce/catalog";
import { calculatePrice } from "@/modules/pricing";
import { applyNeedProfileUpdate, getNeedProfile } from "@/lib/data/customer-need-service";
import { makeSession, resetDb } from "./db-helpers";

const salesCtx = () => createToolContext({ agentType: "sales" });

describe("tool registry mechanics", () => {
  const echoTool: AnyToolDefinition = {
    name: "echo",
    description: "echoes",
    permission: "READ",
    inputSchema: z.object({ value: z.string().max(10) }),
    outputSchema: z.object({ echoed: z.string() }),
    execute: async (input: { value: string }) => ({ echoed: input.value }),
  };
  const financialSpy = vi.fn();
  const refundTool: AnyToolDefinition = {
    name: "issueRefund",
    description: "future restricted tool",
    permission: "FINANCIAL_RESTRICTED",
    inputSchema: z.object({ orderId: z.string() }),
    outputSchema: z.object({ done: z.boolean() }),
    execute: async () => {
      financialSpy();
      return { done: true };
    },
  };
  const brokenTool: AnyToolDefinition = {
    name: "broken",
    description: "throws",
    permission: "READ",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async () => {
      throw new Error("internal kaboom with secrets");
    },
  };
  const badOutputTool: AnyToolDefinition = {
    name: "badOutput",
    description: "returns invalid output",
    permission: "READ",
    inputSchema: z.object({}),
    outputSchema: z.object({ mustExist: z.string() }),
    execute: async () => ({ wrong: true }),
  };
  const registry = new ToolRegistry([echoTool, refundTool, brokenTool, badOutputTool]);

  it("executes a permitted tool through input+output validation", async () => {
    const result = await registry.execute("echo", { value: "hi" }, salesCtx());
    expect(result).toMatchObject({ ok: true, toolName: "echo", data: { echoed: "hi" } });
  });

  it("returns unknown_tool for tools that do not exist (injection has nothing to call)", async () => {
    const result = await registry.execute("modifyPrice", { price: 1 }, salesCtx());
    expect(result).toMatchObject({ ok: false, error: { kind: "unknown_tool" } });
  });

  it("denies restricted tools to the sales agent and never runs them", async () => {
    const result = await registry.execute("issueRefund", { orderId: "o1" }, salesCtx());
    expect(result).toMatchObject({ ok: false, error: { kind: "permission_denied" } });
    expect(financialSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid input before execution", async () => {
    const result = await registry.execute("echo", { value: "way-too-long-for-schema" }, salesCtx());
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
  });

  it("wraps execution failures without leaking internals to the model", async () => {
    const result = await registry.execute("broken", {}, salesCtx());
    expect(result).toMatchObject({ ok: false, error: { kind: "execution_failed" } });
    if (!result.ok) expect(result.error.message).not.toContain("kaboom");
  });

  it("catches schema-invalid tool output (our bug, surfaced)", async () => {
    const result = await registry.execute("badOutput", {}, salesCtx());
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_output" } });
  });

  it("hides denied tools from the model entirely (provider specs are permission-filtered)", () => {
    const specs = registry.providerSpecs(salesCtx());
    expect(specs.map((s) => s.name)).toEqual(["echo", "broken", "badOutput"]);
  });

  it("rejects duplicate tool names at construction", () => {
    expect(() => new ToolRegistry([echoTool, echoTool])).toThrowError(/duplicate tool name/);
  });
});

describe("agent permission map", () => {
  it("sales gets READ + CUSTOMER_WRITE + COMMERCE (S07); ads agents get nothing; nobody gets restricted tiers", () => {
    expect(AGENT_TOOL_PERMISSIONS.sales).toEqual(["READ", "CUSTOMER_WRITE", "COMMERCE"]);
    expect(AGENT_TOOL_PERMISSIONS.google_ads).toEqual([]);
    expect(AGENT_TOOL_PERMISSIONS.meta_ads).toEqual([]);
    for (const permissions of Object.values(AGENT_TOOL_PERMISSIONS)) {
      expect(permissions).not.toContain("FINANCIAL_RESTRICTED");
      expect(permissions).not.toContain("ADMIN_RESTRICTED");
    }
  });
});

describe("sales toolset (Session 04 base + Session 05/06 additions)", () => {
  const registry = createSalesToolRegistry();

  it("contains exactly the customer-safe sales tools", () => {
    expect(registry.names().sort()).toEqual([
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
    ]);
  });

  it("contains none of the forbidden capabilities", () => {
    for (const name of [
      "modifyPrice",
      "issueRefund",
      "changeAdBudget",
      "createAdCampaign",
      "modifyMargin",
      "modifyProductManufacturingRules",
      "adminDatabaseQuery",
      // S07 grants a checkout HANDOFF (startCheckout) — direct provider
      // checkout construction, payments, and price levers still have no tool.
      "createCheckout",
      "applyDiscount",
      "markOrderPaid",
      "capturePayment",
      "setShippingCost",
      "setTax",
    ]) {
      expect(registry.get(name)).toBeUndefined();
    }
  });

  it("searchProducts searches the real catalog facade", async () => {
    const all = await listCatalogProducts();
    const query = all[0].title.split(" ")[0].toLowerCase();
    const result = await registry.execute("searchProducts", { query }, salesCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { products: Array<{ id: string; pricingStatus: string }>; totalCatalogSize: number };
      expect(data.products.length).toBeGreaterThanOrEqual(1);
      expect(data.totalCatalogSize).toBe(all.length);
      expect(data.products[0].pricingStatus).toBe("DEMO");
    }
  });

  it("getProductDetails returns options incl. handle confirmation flags", async () => {
    const [product] = await listCatalogProducts();
    const result = await registry.execute("getProductDetails", { slug: product.slug }, salesCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { found: boolean; handles: Array<{ confirmed: boolean }>; pricingTiers: unknown[] };
      expect(data.found).toBe(true);
      expect(data.handles.some((h) => h.confirmed === false)).toBe(true);
      expect(data.pricingTiers.length).toBeGreaterThan(0);
    }
    const missing = await registry.execute("getProductDetails", { slug: "does-not-exist" }, salesCtx());
    expect(missing.ok).toBe(true);
    if (missing.ok) expect((missing.data as { found: boolean }).found).toBe(false);
  });
});

describe("calculatePrice tool — deterministic engine delegation", () => {
  const registry = createSalesToolRegistry();

  it("returns exactly the engine's sell-side numbers", async () => {
    const [product] = await listCatalogProducts();
    const config = {
      productId: product.id,
      sizeId: product.sizes[0].id,
      materialId: product.materials[1]?.id ?? product.materials[0].id,
      colorId: product.colors.find((c) => !c.custom)!.id,
      printOptionId: "one-color" as const,
      quantity: product.quantityPresets.find((q) => q >= product.minQuantity) ?? product.minQuantity,
    };
    const engine = calculatePrice(product, { ...config, artwork: null });
    expect(engine.ok).toBe(true);
    const result = await registry.execute("calculatePrice", config, salesCtx());
    expect(result.ok).toBe(true);
    if (result.ok && engine.ok) {
      expect(result.data).toMatchObject({
        ok: true,
        unitPriceCents: engine.unitPriceCents,
        totalPriceCents: engine.totalPriceCents,
        savingsPct: engine.savingsPct,
        tier: engine.tier,
        currency: engine.currency,
        pricingStatus: "DEMO",
      });
    }
  });

  it("NEVER exposes cost/margin/floor internals", async () => {
    const [product] = await listCatalogProducts();
    const result = await registry.execute(
      "calculatePrice",
      {
        productId: product.id,
        sizeId: product.sizes[0].id,
        materialId: product.materials[0].id,
        colorId: product.colors[0].id,
        printOptionId: "none",
        quantity: product.minQuantity,
      },
      salesCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const keys = Object.keys(result.data as Record<string, unknown>);
      for (const forbidden of [
        "costs",
        "costStatus",
        "grossProfitCents",
        "grossMarginPct",
        "contributionProfitCents",
        "contributionMarginPct",
        "minimumAllowedPriceCents",
        "minimumAllowedUnitPriceCents",
        "missingCostInputs",
      ]) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });

  it("routes custom color / custom dimensions / below-MOQ to the custom-quote flow", async () => {
    const [product] = await listCatalogProducts();
    const base = {
      productId: product.id,
      sizeId: product.sizes[0].id,
      materialId: product.materials[0].id,
      colorId: product.colors[0].id,
      printOptionId: "none" as const,
      quantity: product.minQuantity,
    };
    const customColor = product.colors.find((c) => c.custom);
    if (customColor) {
      const result = await registry.execute("calculatePrice", { ...base, colorId: customColor.id }, salesCtx());
      if (result.ok) expect(result.data).toMatchObject({ ok: false, reason: "requires_custom_quote" });
    }
    const belowMoq = await registry.execute("calculatePrice", { ...base, quantity: product.minQuantity - 1 }, salesCtx());
    if (belowMoq.ok) expect(belowMoq.data).toMatchObject({ ok: false, reason: "requires_custom_quote" });
    const withDims = await registry.execute(
      "calculatePrice",
      { ...base, customDimensions: { width: 10, height: 10, gusset: 4 } },
      salesCtx(),
    );
    if (withDims.ok) expect(withDims.data).toMatchObject({ ok: false, reason: "requires_custom_quote" });
  });

  it("rejects unknown products and malformed configurations", async () => {
    const unknown = await registry.execute(
      "calculatePrice",
      { productId: "nope", sizeId: "s", materialId: "m", colorId: "c", printOptionId: "none", quantity: 100 },
      salesCtx(),
    );
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.data).toMatchObject({ ok: false, reason: "unknown_product" });

    const malformed = await registry.execute("calculatePrice", { productId: "x", quantity: "lots" }, salesCtx());
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.kind).toBe("invalid_input");
  });

  it("getQuantityPricing prices the preset ladder", async () => {
    const [product] = await listCatalogProducts();
    const result = await registry.execute("getQuantityPricing", { productId: product.id }, salesCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { found: boolean; rows: Array<{ quantity: number; result: { ok: boolean } }> };
      expect(data.found).toBe(true);
      expect(data.rows.length).toBe(product.quantityPresets.length);
      const priced = data.rows.filter((r) => r.result.ok);
      expect(priced.length).toBeGreaterThan(0);
    }
  });
});

describe("getShippingEstimate tool", () => {
  const registry = createSalesToolRegistry();

  it("answers honestly with checkout mode for valid codes and invalid for garbage", async () => {
    const us = await registry.execute("getShippingEstimate", { postalCode: "94107" }, salesCtx());
    expect(us.ok).toBe(true);
    if (us.ok) expect((us.data as { mode: string }).mode).toBe("checkout");
    const ca = await registry.execute("getShippingEstimate", { postalCode: "M5V 2T6" }, salesCtx());
    if (ca.ok) expect((ca.data as { mode: string }).mode).toBe("checkout");
    const bad = await registry.execute("getShippingEstimate", { postalCode: "banana" }, salesCtx());
    if (bad.ok) expect((bad.data as { mode: string }).mode).toBe("invalid");
  });
});

describe("saveCustomerNeed tool — provenance-safe writes", () => {
  const registry = createSalesToolRegistry();
  beforeEach(resetDb);

  it("writes AI_INFERRED fields for the context session", async () => {
    const session = await makeSession();
    const ctx = createToolContext({ agentType: "sales", sessionId: session.id });
    const result = await registry.execute(
      "saveCustomerNeed",
      { update: { businessType: "coffee shop", quantity: 5000 }, confidence: 0.8 },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ saved: true, appliedFields: ["businessType", "quantity"], skippedFields: [] });
    }
    const profile = await getNeedProfile(session.id);
    expect(profile?.businessType).toBe("coffee shop");
    expect(profile?.fieldSourcesJson.businessType).toMatchObject({ source: "AI_INFERRED", confidence: 0.8 });
  });

  it("cannot overwrite USER_STATED facts (rank gate holds)", async () => {
    const session = await makeSession();
    await applyNeedProfileUpdate(session.id, { businessType: "restaurant" }, "USER_STATED");
    const ctx = createToolContext({ agentType: "sales", sessionId: session.id });
    const result = await registry.execute(
      "saveCustomerNeed",
      { update: { businessType: "food truck", location: "Austin" } },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ appliedFields: ["location"], skippedFields: ["businessType"] });
    }
    const profile = await getNeedProfile(session.id);
    expect(profile?.businessType).toBe("restaurant");
    expect(profile?.location).toBe("Austin");
  });

  it("fails safely without a session context", async () => {
    const result = await registry.execute("saveCustomerNeed", { update: { businessType: "cafe" } }, salesCtx());
    expect(result).toMatchObject({ ok: false, error: { kind: "execution_failed" } });
  });

  it("treats an empty update as a no-op", async () => {
    const session = await makeSession();
    const ctx = createToolContext({ agentType: "sales", sessionId: session.id });
    const result = await registry.execute("saveCustomerNeed", { update: {} }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toMatchObject({ saved: false, appliedFields: [] });
  });

  it("rejects out-of-range extraction values at the boundary", async () => {
    const session = await makeSession();
    const ctx = createToolContext({ agentType: "sales", sessionId: session.id });
    const result = await registry.execute("saveCustomerNeed", { update: { quantity: -5 } }, ctx);
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
  });
});
