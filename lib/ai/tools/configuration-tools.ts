import { z } from "zod";
import { getCatalogProductById } from "@/lib/commerce/catalog";
import {
  applyConfigurationPatchForSession,
  resolveCurrentConfiguration,
  sellPriceFor,
  type CurrentConfiguration,
} from "@/lib/configuration/server";
import { applyConfigurationPatch, describeConfiguration, MAX_QUANTITY } from "@/lib/configuration/validation";
import { recordServerEvent } from "@/lib/data/event-service";
import { requiresCustomQuote } from "@/modules/pricing";
import { aiLog } from "../log";
import type { ToolDefinition, ToolExecutionContext } from "./types";

/**
 * Shared-configuration tools (Session 06) — the AI's ONLY channel into the
 * product configuration, and it is the exact channel the UI uses:
 * lib/configuration validation + the revision-checked configuration service.
 * The model proposes patches; the application decides.
 *
 * Structural security properties (tested):
 * - No price/cost/margin input exists on any tool; prices in outputs come
 *   from the deterministic engine and the output schemas make returning
 *   cost/margin/floor data impossible.
 * - Patches are limited to the five catalog option fields. There is no
 *   artwork field (the AI can never fabricate an upload) and no
 *   customDimensions field (custom sizing goes through the quote flow).
 * - Unknown products and unsupported options come back as structured
 *   rejections with the legal alternatives — the agent relays, never invents.
 * - expectedRevision makes stale writes impossible: an update based on a
 *   configuration the customer has since changed is rejected with the
 *   current state instead of clobbering it.
 */

const customerPriceSchema = z.object({
  unitPriceCents: z.number().int(),
  totalCents: z.number().int(),
  currency: z.enum(["USD", "CAD"]),
  tier: z.object({ minQty: z.number().int(), unitPriceCents: z.number().int() }),
  savingsPct: z.number(),
  /** DEMO pricing must be presented as demo pricing. */
  pricingStatus: z.enum(["DEMO", "LIVE"]),
});

const configurationViewSchema = z.object({
  productId: z.string(),
  productTitle: z.string(),
  size: z.object({ id: z.string(), label: z.string() }),
  material: z.object({ id: z.string(), label: z.string() }),
  color: z.object({ id: z.string(), label: z.string(), custom: z.boolean() }),
  printOption: z.object({ id: z.string(), label: z.string(), requiresArtwork: z.boolean() }),
  quantity: z.number().int(),
  hasArtwork: z.boolean(),
  artworkFileName: z.string().optional(),
  /** Configuration revision — pass it to updateConfiguration as expectedRevision. */
  revision: z.number().int(),
  /** True when this configuration is priced through the custom-quote flow. */
  requiresCustomQuote: z.boolean(),
  price: customerPriceSchema.nullable(),
});

function toView(current: CurrentConfiguration): z.infer<typeof configurationViewSchema> {
  const d = current.description;
  return {
    productId: d.productId,
    productTitle: d.productTitle,
    size: d.size,
    material: d.material,
    color: d.color,
    printOption: d.printOption,
    quantity: d.quantity,
    hasArtwork: d.hasArtwork,
    ...(d.artworkFileName !== undefined ? { artworkFileName: d.artworkFileName } : {}),
    revision: current.revision,
    requiresCustomQuote: current.requiresCustomQuote,
    price: current.price,
  };
}

const patchIssueSchema = z.object({
  field: z.string(),
  requested: z.union([z.string(), z.number()]),
  reason: z.enum(["unsupported_option", "invalid_quantity"]),
  available: z.array(z.string()),
  message: z.string(),
});

/**
 * The five patchable fields — structurally nothing else. STRICT: unknown
 * keys (artwork, prices, margins, admin fields…) are a validation ERROR,
 * not silently stripped — an injection attempt must fail loudly so the
 * model sees the rejection instead of a fake success.
 */
const configPatchSchema = z
  .strictObject({
    sizeId: z.string().trim().min(1).max(100),
    materialId: z.string().trim().min(1).max(100),
    colorId: z.string().trim().min(1).max(100),
    printOptionId: z.enum(["none", "one-color", "two-color", "full-custom"]),
    quantity: z.number().int().positive().max(MAX_QUANTITY),
  })
  .partial();

async function emitConfigEvent(
  ctx: ToolExecutionContext,
  name: "ai_configuration_proposed" | "ai_configuration_updated" | "ai_configuration_rejected",
  productId: string,
  props: Record<string, string | number | boolean | null>,
): Promise<void> {
  if (!ctx.sessionId) return;
  try {
    await recordServerEvent({
      sessionId: ctx.sessionId,
      name,
      productId,
      conversationId: ctx.conversationId ?? null,
      props,
    });
  } catch (err) {
    aiLog("event_write_failed", { event: name, requestId: ctx.requestId, error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------
// getCurrentConfiguration
// ---------------------------------------------------------------------------

const getCurrentInput = z.object({
  /** Omit to read the configuration the customer touched most recently. */
  productId: z.string().trim().min(1).max(100).optional(),
});

const getCurrentOutput = z.union([
  z.object({ found: z.literal(true), configuration: configurationViewSchema }),
  z.object({ found: z.literal(false), message: z.string() }),
]);

export const getCurrentConfigurationTool: ToolDefinition<z.infer<typeof getCurrentInput>, z.infer<typeof getCurrentOutput>> = {
  name: "getCurrentConfiguration",
  description:
    "Read the customer's CURRENT product configuration (options, quantity, artwork status, revision, engine price). " +
    "Call this BEFORE answering configuration-sensitive questions or proposing changes — the customer may have " +
    "configured things manually and must never be asked to repeat them. Omit productId for their most recent " +
    "configuration; pass it for a specific product. found:false means nothing is configured yet.",
  permission: "READ",
  inputSchema: getCurrentInput,
  outputSchema: getCurrentOutput,
  async execute(input, ctx) {
    if (!ctx.sessionId) throw new Error("getCurrentConfiguration requires a session-scoped ToolExecutionContext");
    const current = await resolveCurrentConfiguration(ctx.sessionId, input.productId);
    if (current === null) {
      return { found: false as const, message: "This customer has not configured any product yet." };
    }
    if ("status" in current) {
      return { found: false as const, message: `no product with id "${input.productId}" exists` };
    }
    return { found: true as const, configuration: toView(current) };
  },
};

// ---------------------------------------------------------------------------
// updateConfiguration
// ---------------------------------------------------------------------------

const updateInput = z.object({
  productId: z.string().trim().min(1).max(100),
  /** Partial patch — ONLY the fields the customer asked to change. */
  patch: configPatchSchema,
  /**
   * The revision you last read (from getCurrentConfiguration or a previous
   * update). Protects against overwriting a newer manual change.
   */
  expectedRevision: z.number().int().nonnegative().optional(),
});

const updateOutput = z.union([
  z.object({
    status: z.literal("applied"),
    configuration: configurationViewSchema,
    changedFields: z.array(z.string()),
  }),
  z.object({
    status: z.literal("rejected"),
    issues: z.array(patchIssueSchema),
  }),
  z.object({
    status: z.literal("stale_revision"),
    message: z.string(),
    /** What the configuration ACTUALLY is now — reconcile against this. */
    configuration: configurationViewSchema,
  }),
  z.object({ status: z.literal("unknown_product"), message: z.string() }),
]);

export const updateConfigurationTool: ToolDefinition<z.infer<typeof updateInput>, z.infer<typeof updateOutput>> = {
  name: "updateConfiguration",
  description:
    "COMMIT a configuration change the customer asked for (e.g. \"make it black\", \"change to 10,000\"). Sends a partial " +
    "patch — include ONLY fields the customer explicitly wants changed; everything else is preserved. The application " +
    "validates against the catalog: unsupported options are rejected with the available alternatives (relay them, never " +
    "invent options). Pass expectedRevision from your last read; stale_revision means the customer changed the " +
    "configuration meanwhile — re-read and reconcile. For price comparisons WITHOUT committing, use calculatePrice. " +
    "The visible configurator updates immediately, so only call this for changes the customer actually requested.",
  permission: "CUSTOMER_WRITE",
  inputSchema: updateInput,
  outputSchema: updateOutput,
  async execute(input, ctx) {
    if (!ctx.sessionId) throw new Error("updateConfiguration requires a session-scoped ToolExecutionContext");
    if (Object.keys(input.patch).length === 0) {
      return {
        status: "rejected" as const,
        issues: [
          {
            field: "quantity",
            requested: "",
            reason: "invalid_quantity" as const,
            available: [],
            message: "Empty patch — include at least one field to change.",
          },
        ],
      };
    }
    const result = await applyConfigurationPatchForSession({
      sessionId: ctx.sessionId,
      productId: input.productId,
      patch: input.patch,
      expectedRevision: input.expectedRevision,
      source: "ai",
      customerId: ctx.customerId ?? null,
    });
    switch (result.status) {
      case "applied": {
        await emitConfigEvent(ctx, "ai_configuration_updated", input.productId, {
          fields: result.changedFields.join(","),
          revision: result.current.revision,
        });
        return { status: "applied" as const, configuration: toView(result.current), changedFields: result.changedFields };
      }
      case "invalid": {
        await emitConfigEvent(ctx, "ai_configuration_rejected", input.productId, {
          fields: result.issues.map((i) => i.field).join(","),
          reason: result.issues[0]?.reason ?? "unsupported_option",
        });
        return { status: "rejected" as const, issues: result.issues };
      }
      case "stale_revision":
        return {
          status: "stale_revision" as const,
          message:
            "The configuration changed since you last read it (the customer likely edited it manually). " +
            "Reconcile with the configuration returned here before retrying.",
          configuration: toView(result.current),
        };
      case "unknown_product":
        return {
          status: "unknown_product" as const,
          message: `no product with id "${input.productId}" exists — use productIds from searchProducts/getCurrentConfiguration`,
        };
    }
  },
};

// ---------------------------------------------------------------------------
// suggestConfigurationUpdate
// ---------------------------------------------------------------------------

const suggestInput = z.object({
  productId: z.string().trim().min(1).max(100),
  patch: configPatchSchema,
  /** Short button label the customer will see, e.g. "Update to 10,000 bags". */
  label: z.string().trim().min(1).max(60),
});

const suggestOutput = z.union([
  z.object({
    status: z.literal("proposed"),
    /** Echoed for the structured suggested-action chip the customer can tap. */
    label: z.string(),
    patch: configPatchSchema,
    /** Revision the suggestion is based on — the apply path re-validates against current state anyway. */
    basedOnRevision: z.number().int(),
    /** Storefront configurator path for applying away from the product page. */
    productPath: z.string(),
    /** Engine price of the HYPOTHETICAL configuration — nothing was committed. */
    preview: configurationViewSchema,
    changedFields: z.array(z.string()),
  }),
  z.object({ status: z.literal("rejected"), issues: z.array(patchIssueSchema) }),
  z.object({ status: z.literal("unknown_product"), message: z.string() }),
]);

export const suggestConfigurationUpdateTool: ToolDefinition<z.infer<typeof suggestInput>, z.infer<typeof suggestOutput>> = {
  name: "suggestConfigurationUpdate",
  description:
    "PROPOSE a configuration change WITHOUT committing it — the customer sees an apply button and decides. Use for " +
    "changes with meaningful cost impact (large quantity increases, material upgrades, added printing) after previewing " +
    "the price, or when suggesting improvements the customer didn't explicitly request. The patch is validated and " +
    "priced but the current configuration is NOT changed until the customer accepts. State the previewed price in your " +
    "reply and present the choice honestly.",
  permission: "READ",
  inputSchema: suggestInput,
  outputSchema: suggestOutput,
  async execute(input, ctx) {
    if (!ctx.sessionId) throw new Error("suggestConfigurationUpdate requires a session-scoped ToolExecutionContext");
    if (Object.keys(input.patch).length === 0) {
      return { status: "unknown_product" as const, message: "Empty patch — include at least one field to change." };
    }
    // Validate + price against the session's current configuration WITHOUT writing.
    const product = await getCatalogProductById(input.productId);
    if (!product) {
      return {
        status: "unknown_product" as const,
        message: `no product with id "${input.productId}" exists — use productIds from searchProducts/getCurrentConfiguration`,
      };
    }
    const current = await resolveCurrentConfiguration(ctx.sessionId, input.productId);
    if (current === null || "status" in current) {
      return { status: "unknown_product" as const, message: `no product with id "${input.productId}" exists` };
    }
    const result = applyConfigurationPatch(product, current.config, input.patch);
    if (!result.ok) return { status: "rejected" as const, issues: result.issues };

    await emitConfigEvent(ctx, "ai_configuration_proposed", input.productId, {
      fields: result.changedFields.join(","),
    });
    return {
      status: "proposed" as const,
      label: input.label,
      patch: input.patch,
      basedOnRevision: current.revision,
      productPath: `/products/${product.slug}`,
      preview: toView({
        description: describeConfiguration(product, result.config),
        config: result.config,
        revision: current.revision,
        source: current.source,
        requiresCustomQuote: requiresCustomQuote(product, result.config),
        price: sellPriceFor(product, result.config),
      }),
      changedFields: result.changedFields,
    };
  },
};
