import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { events } from "@/db/schema";
import { PRODUCTS } from "@/config/products";
import { createSalesToolRegistry, createToolContext } from "@/lib/ai/tools";
import { defaultConfiguration } from "@/lib/configuration/validation";
import { syncConfigurationForSession } from "@/lib/configuration/server";
import { getActiveConfiguration } from "@/lib/data/configuration-service";
import { applyNeedProfileUpdate, getNeedProfile } from "@/lib/data/customer-need-service";
import { quoteConfiguration } from "@/modules/pricing";
import { makeSession, resetDb } from "./db-helpers";

/**
 * Session 06 — shared-configuration AI tools. The AI mutates the SAME
 * validated path the UI uses; these tests pin the authority boundaries:
 * catalog validation, partial-patch preservation, stale-revision safety,
 * provenance, and the structural impossibility of price/cost injection.
 */

const product = PRODUCTS[0];
const registry = createSalesToolRegistry();

const sessionCtx = async () => {
  const session = await makeSession();
  const { startConversation } = await import("@/lib/data/conversation-service");
  const conversation = await startConversation({ sessionId: session.id });
  return {
    session,
    conversation,
    ctx: createToolContext({ agentType: "sales", sessionId: session.id, conversationId: conversation.id }),
  };
};

const seedConfiguration = async (sessionId: string, overrides: Partial<ReturnType<typeof defaultConfiguration>> = {}) => {
  const result = await syncConfigurationForSession({
    sessionId,
    productId: product.id,
    config: { ...defaultConfiguration(product), ...overrides },
  });
  if (result.status !== "applied") throw new Error(`seed failed: ${result.status}`);
  return result.current;
};

beforeEach(resetDb);

describe("getCurrentConfiguration", () => {
  it("reports nothing configured for a fresh session", async () => {
    const { ctx } = await sessionCtx();
    const result = await registry.execute("getCurrentConfiguration", {}, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toMatchObject({ found: false });
  });

  it("returns the session's manual configuration — the AI sees what the customer built", async () => {
    const { session, ctx } = await sessionCtx();
    await seedConfiguration(session.id, { colorId: "black", quantity: 5000 });
    const result = await registry.execute("getCurrentConfiguration", {}, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        found: boolean;
        configuration: { color: { id: string }; quantity: number; revision: number; price: { totalCents: number } | null };
      };
      expect(data.found).toBe(true);
      expect(data.configuration.color.id).toBe("black");
      expect(data.configuration.quantity).toBe(5000);
      expect(data.configuration.revision).toBe(1);
      const engine = quoteConfiguration(product, { ...defaultConfiguration(product), colorId: "black", quantity: 5000 });
      expect(data.configuration.price?.totalCents).toBe(engine!.totalCents);
    }
  });

  it("returns catalog defaults at revision 0 for a product the session never touched", async () => {
    const { ctx } = await sessionCtx();
    const result = await registry.execute("getCurrentConfiguration", { productId: product.id }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { found: boolean; configuration: { revision: number; quantity: number } };
      expect(data.found).toBe(true);
      expect(data.configuration.revision).toBe(0);
      expect(data.configuration.quantity).toBe(defaultConfiguration(product).quantity);
    }
  });

  it("NEVER exposes cost/margin/floor internals or raw config ids beyond the customer view", async () => {
    const { session, ctx } = await sessionCtx();
    await seedConfiguration(session.id);
    const result = await registry.execute("getCurrentConfiguration", {}, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const configuration = (result.data as { configuration: Record<string, unknown> }).configuration;
      for (const forbidden of [
        "costs",
        "costStatus",
        "grossProfitCents",
        "grossMarginPct",
        "contributionProfitCents",
        "contributionMarginPct",
        "minimumAllowedPriceCents",
        "missingCostInputs",
        "source",
      ]) {
        expect(Object.keys(configuration)).not.toContain(forbidden);
      }
      const price = configuration.price as Record<string, unknown>;
      expect(Object.keys(price).sort()).toEqual(["currency", "pricingStatus", "savingsPct", "tier", "totalCents", "unitPriceCents"]);
    }
  });

  it("rejects unknown products", async () => {
    const { ctx } = await sessionCtx();
    const result = await registry.execute("getCurrentConfiguration", { productId: "p-nope" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toMatchObject({ found: false });
  });
});

describe("updateConfiguration — the AI commit path", () => {
  it("creates a configuration from defaults + patch when none exists", async () => {
    const { session, ctx } = await sessionCtx();
    const result = await registry.execute(
      "updateConfiguration",
      { productId: product.id, patch: { colorId: "white", sizeId: "xl", quantity: 5000 } },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { status: string; configuration: { revision: number; color: { id: string } } };
      expect(data.status).toBe("applied");
      expect(data.configuration.revision).toBe(1);
      expect(data.configuration.color.id).toBe("white");
    }
    const row = await getActiveConfiguration(session.id, product.id);
    expect(row?.source).toBe("ai");
    expect(row?.configJson.colorId).toBe("white");
    expect(row?.configJson.quantity).toBe(5000);
    // Untouched fields came from the SAME defaults the UI uses.
    expect(row?.configJson.materialId).toBe(product.materials[0].id);
    expect(row?.configJson.printOptionId).toBe("full-custom");
  });

  it("patches only requested fields — manual choices survive (partial-patch preservation)", async () => {
    const { session, ctx } = await sessionCtx();
    await seedConfiguration(session.id, { sizeId: "xl", colorId: "white", quantity: 5000 });
    const result = await registry.execute(
      "updateConfiguration",
      { productId: product.id, patch: { quantity: 10_000 }, expectedRevision: 1 },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.data as { status: string }).status).toBe("applied");
    const row = await getActiveConfiguration(session.id, product.id);
    expect(row?.configJson).toMatchObject({ sizeId: "xl", colorId: "white", printOptionId: "full-custom", quantity: 10_000 });
    expect(row?.version).toBe(2);
  });

  it("preserves artwork through AI patches (AI has no artwork field at all)", async () => {
    const { session, ctx } = await sessionCtx();
    const artwork = { fileName: "logo.png", fileType: "image/png", fileSizeBytes: 999 };
    await seedConfiguration(session.id, { artwork });
    await registry.execute("updateConfiguration", { productId: product.id, patch: { colorId: "white" } }, ctx);
    const row = await getActiveConfiguration(session.id, product.id);
    expect(row?.configJson.artwork).toEqual(artwork);
    // The patch schema structurally has no artwork input:
    const injected = await registry.execute(
      "updateConfiguration",
      { productId: product.id, patch: { colorId: "white", artwork: { fileName: "fake.png" } } },
      ctx,
    );
    expect(injected).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
  });

  it("rejects unsupported options with structured alternatives the agent can relay", async () => {
    const { session, ctx } = await sessionCtx();
    await seedConfiguration(session.id);
    const result = await registry.execute(
      "updateConfiguration",
      { productId: product.id, patch: { colorId: "purple" } },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { status: string; issues: Array<{ field: string; available: string[] }> };
      expect(data.status).toBe("rejected");
      expect(data.issues[0].field).toBe("colorId");
      expect(data.issues[0].available).toContain("black");
    }
    // Nothing was written.
    const row = await getActiveConfiguration(session.id, product.id);
    expect(row?.version).toBe(1);
    expect(row?.configJson.colorId).toBe(defaultConfiguration(product).colorId);
  });

  it("rejects stale revisions and returns the CURRENT configuration for reconciliation", async () => {
    const { session, ctx } = await sessionCtx();
    await seedConfiguration(session.id, { quantity: 5000 });
    // The customer manually changes quantity → revision 2.
    await seedConfiguration(session.id, { quantity: 7500 });
    const result = await registry.execute(
      "updateConfiguration",
      { productId: product.id, patch: { quantity: 10_000 }, expectedRevision: 1 },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { status: string; configuration: { quantity: number; revision: number } };
      expect(data.status).toBe("stale_revision");
      expect(data.configuration.quantity).toBe(7500);
      expect(data.configuration.revision).toBe(2);
    }
    const row = await getActiveConfiguration(session.id, product.id);
    expect(row?.configJson.quantity).toBe(7500); // untouched
  });

  it("rejects unknown products (hallucinated ids write nothing)", async () => {
    const { ctx } = await sessionCtx();
    const result = await registry.execute(
      "updateConfiguration",
      { productId: "p-invented", patch: { quantity: 5000 } },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.data as { status: string }).status).toBe("unknown_product");
  });

  it("cannot inject prices, margins, cart totals, or admin fields — no such inputs exist", async () => {
    const { ctx } = await sessionCtx();
    for (const patch of [
      { unitPriceCents: 1 },
      { totalCents: 1 },
      { price: 0.01 },
      { margin: -1 },
      { discountPct: 99 },
      { adminOverride: true },
    ]) {
      const result = await registry.execute("updateConfiguration", { productId: product.id, patch }, ctx);
      expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    }
  });

  it("bounds quantity at the schema edge (0, negative, over-cap all fail validation)", async () => {
    const { ctx } = await sessionCtx();
    for (const quantity of [0, -5, 1_000_001]) {
      const result = await registry.execute("updateConfiguration", { productId: product.id, patch: { quantity } }, ctx);
      expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    }
  });

  it("writes ai_configuration_updated on success and ai_configuration_rejected on invalid options", async () => {
    const { session, conversation, ctx } = await sessionCtx();
    await registry.execute("updateConfiguration", { productId: product.id, patch: { colorId: "white" } }, ctx);
    await registry.execute("updateConfiguration", { productId: product.id, patch: { colorId: "purple" } }, ctx);
    const db = await getDb();
    const rows = await db.select().from(events).where(eq(events.sessionId, session.id));
    const names = rows.map((r) => r.name);
    expect(names).toContain("ai_configuration_updated");
    expect(names).toContain("ai_configuration_rejected");
    const updated = rows.find((r) => r.name === "ai_configuration_updated");
    expect(updated?.propsJson).toMatchObject({ fields: "colorId", revision: 1 });
    expect(updated?.conversationId).toBe(conversation.id);
  });

  it("records CONFIGURATOR-rank need-profile evidence that cannot beat USER_STATED", async () => {
    const { session, ctx } = await sessionCtx();
    await applyNeedProfileUpdate(session.id, { quantity: 3000 }, "USER_STATED");
    await registry.execute(
      "updateConfiguration",
      { productId: product.id, patch: { colorId: "white", quantity: 5000 } },
      ctx,
    );
    const profile = await getNeedProfile(session.id);
    // Color was unset → CONFIGURATOR lands; quantity stays USER_STATED.
    expect(profile?.colorPreference).toBe("white");
    expect(profile?.fieldSourcesJson.colorPreference).toMatchObject({ source: "CONFIGURATOR" });
    expect(profile?.quantity).toBe(3000);
    expect(profile?.fieldSourcesJson.quantity).toMatchObject({ source: "USER_STATED" });
  });

  it("fails safely without a session context", async () => {
    const result = await registry.execute(
      "updateConfiguration",
      { productId: product.id, patch: { colorId: "white" } },
      createToolContext({ agentType: "sales" }),
    );
    expect(result).toMatchObject({ ok: false, error: { kind: "execution_failed" } });
  });
});

describe("suggestConfigurationUpdate — preview without commit", () => {
  it("prices the hypothetical configuration and writes NOTHING", async () => {
    const { session, ctx } = await sessionCtx();
    await seedConfiguration(session.id, { quantity: 5000 });
    const result = await registry.execute(
      "suggestConfigurationUpdate",
      { productId: product.id, patch: { quantity: 10_000 }, label: "Update to 10,000 bags" },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        status: string;
        label: string;
        patch: Record<string, unknown>;
        basedOnRevision: number;
        productPath: string;
        preview: { quantity: number; price: { totalCents: number } | null; revision: number };
      };
      expect(data.status).toBe("proposed");
      expect(data.label).toBe("Update to 10,000 bags");
      expect(data.patch).toEqual({ quantity: 10_000 });
      expect(data.basedOnRevision).toBe(1);
      expect(data.productPath).toBe(`/products/${product.slug}`);
      expect(data.preview.quantity).toBe(10_000);
      const engine = quoteConfiguration(product, { ...defaultConfiguration(product), quantity: 10_000 });
      expect(data.preview.price?.totalCents).toBe(engine!.totalCents);
    }
    // The ACTUAL configuration is untouched.
    const row = await getActiveConfiguration(session.id, product.id);
    expect(row?.configJson.quantity).toBe(5000);
    expect(row?.version).toBe(1);
  });

  it("rejects invalid patches without proposing", async () => {
    const { ctx } = await sessionCtx();
    const result = await registry.execute(
      "suggestConfigurationUpdate",
      { productId: product.id, patch: { colorId: "chartreuse" }, label: "Make it chartreuse" },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.data as { status: string }).status).toBe("rejected");
  });

  it("emits ai_configuration_proposed", async () => {
    const { session, ctx } = await sessionCtx();
    await registry.execute(
      "suggestConfigurationUpdate",
      { productId: product.id, patch: { quantity: 25_000 }, label: "Go to 25,000" },
      ctx,
    );
    const db = await getDb();
    const rows = await db.select().from(events).where(eq(events.sessionId, session.id));
    expect(rows.map((r) => r.name)).toContain("ai_configuration_proposed");
  });
});
