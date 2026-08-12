import { isFlagEnabled } from "@/config/flags";
import type { ProductConfiguration } from "@/types/commerce";
import {
  appendMessage,
  findActiveConversation,
  listMessages,
  startConversation,
  type ConversationRow,
} from "@/lib/data/conversation-service";
import { recordServerEvent } from "@/lib/data/event-service";
import { getNeedProfile } from "@/lib/data/customer-need-service";
import { getAiConfig } from "../../config";
import { AiError } from "../../errors";
import { aiLog } from "../../log";
import type { AIProvider, AiChatMessage } from "../../providers/types";
import { selectModel } from "../../router";
import { AiRuntime, type ToolConversationStatus } from "../../runtime";
import { createSalesToolRegistry, createToolContext } from "../../tools";
import type { CartSnapshot, ToolCallResult } from "../../tools/types";
import { buildSalesContext } from "./context";
import { runNeedExtraction } from "./extraction";
import { maybeSummarizeConversation } from "./summarize";

/**
 * AI Sales Agent ("AI Packaging Expert") — Session 05.
 *
 * Provider-independent orchestration above the Session 04 runtime:
 *
 *   customer message (untrusted)
 *     → conversation resolve/persist (lib/data)
 *     → versioned ai_sales_agent prompt + server-assembled context
 *     → AiRuntime.runToolConversation (STANDARD workload, loop limits)
 *     → sales tool registry (permission-scoped; server-minted context)
 *     → transcript + tool rows persisted
 *     → evidence-validated need extraction (LOW_COST, non-fatal)
 *     → threshold summarization (LOW_COST, non-fatal)
 *     → normalized SalesAgentResult
 *
 * No Anthropic-specific logic here — the agent sees only the AIProvider
 * abstraction and runs against FakeAiProvider in tests. Authority remains
 * structural: the agent can only do what its 8 registry tools allow.
 */

export type SalesTurnInput = {
  /** Server-resolved session id (bd_sid) — NEVER client-supplied. */
  sessionId: string;
  customerId?: string | null;
  /** The customer's message, already length/shape-validated by the caller. */
  message: string;
  /**
   * Route-validated snapshot of the customer's client-side cart (S07).
   * Untrusted client state, price-free by schema — the engine re-prices it
   * for the agent's view and /api/checkout re-quotes it before any order.
   */
  cart?: CartSnapshot;
};

/** Server-validated configuration state attached to a chat response (S06). */
export type ConfigurationUpdateSignal = {
  productId: string;
  productTitle: string;
  config: ProductConfiguration;
  revision: number;
  changedFields: string[];
  /** Human-readable "field → value" pairs for the confirmation chip. */
  changeSummary: { field: string; value: string }[];
  price: { unitPriceCents: number; totalCents: number; currency: string; pricingStatus: "DEMO" | "LIVE" } | null;
  requiresCustomQuote: boolean;
};

/** A proposed (NOT committed) change the customer can apply with one tap (S06). */
export type SuggestedConfigurationAction = {
  type: "APPLY_CONFIGURATION_PATCH";
  productId: string;
  /** Configurator page for applying from outside the product page. */
  productPath: string;
  label: string;
  patch: Record<string, string | number>;
  basedOnRevision: number;
  preview: { totalCents: number; unitPriceCents: number; currency: string; pricingStatus: "DEMO" | "LIVE" } | null;
};

/** An offered (NOT executed) add-to-cart the customer can accept with one tap (S07). */
export type SuggestedCartAction = {
  type: "ADD_TO_CART";
  productId: string;
  label: string;
  /** Revision + price the offer is based on — the tap re-validates server-side. */
  basedOnRevision: number;
  price: { unitPriceCents: number; totalCents: number; currency: string; pricingStatus: "DEMO" | "LIVE" };
  summary: string;
};

export type SuggestedAction = SuggestedConfigurationAction | SuggestedCartAction;

/**
 * A cart line the server validated and priced from the AUTHORITATIVE shared
 * configuration (S07). The client adds EXACTLY this line through the same
 * useCart().addLine the manual configurator uses — never model text.
 */
export type CartAddSignal = {
  productId: string;
  productTitle: string;
  line: {
    config: ProductConfiguration;
    unitPriceCents: number;
    totalCents: number;
    title: string;
    optionSummary: string;
  };
  revision: number;
  currency: string;
  pricingStatus: "DEMO" | "LIVE";
};

/** A validated checkout handoff offer (S07) — the CUSTOMER confirms it; the client then runs the standard /api/checkout flow. */
export type CheckoutActionSignal = {
  type: "CONTINUE_TO_CHECKOUT";
  lineCount: number;
  subtotalCents: number;
  currency: string;
  pricingStatus: "DEMO" | "LIVE";
};

/** Normalized response (spec §17) — the frontend never parses model prose for actions. */
export type SalesAgentResult = {
  conversationId: string;
  /** Customer-visible reply text. */
  message: string;
  status: ToolConversationStatus;
  recommendedProductId?: string;
  /** Storefront path for the recommendation (from the validated tool output). */
  recommendedProductPath?: string;
  /** Committed configuration change this turn (server-validated; the UI applies THIS, never model text). */
  configurationUpdate?: ConfigurationUpdateSignal;
  /** Proposed-but-uncommitted actions for structured chips (config patches + add-to-cart offers). */
  suggestedActions?: SuggestedAction[];
  /** Server-validated cart line the client adds this turn (explicit customer intent — S07). */
  cartAdd?: CartAddSignal;
  /** Validated checkout handoff offer — rendered as a customer-confirmed action (S07). */
  checkoutAction?: CheckoutActionSignal;
  needsHuman: boolean;
  handoffReason?: string;
  conversationStatus: "active" | "escalated";
};

/** Customer-safe copy when a turn ends on a loop limit without final text. */
const INCOMPLETE_REPLY =
  "I couldn't finish working through that one — could you rephrase or break it into a smaller question? " +
  "You can also configure and order your bags directly on any product page.";

/**
 * Test-only provider override so API-route tests can script the model
 * without a network. Refused outside test runs; runSalesAgentTurn also
 * accepts an explicit provider for direct unit tests.
 */
let testProvider: AIProvider | null = null;
export function __setSalesTestProvider(provider: AIProvider | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__setSalesTestProvider is a test hook and cannot be used in production");
  }
  testProvider = provider;
}

/** Recent raw transcript turns replayed to the model (system/tool rows excluded). */
const HISTORY_MESSAGES = 12;

function toChatHistory(rows: { role: string; content: string }[]): AiChatMessage[] {
  return rows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-HISTORY_MESSAGES)
    .map((m) =>
      m.role === "user" ? { role: "user" as const, content: m.content } : { role: "assistant" as const, content: m.content },
    );
}

type RecommendData = { ok: boolean; productId?: string; configuratorPath?: string };
type HandoffData = { escalated?: boolean };

/** Shapes of the validated S07 cart/checkout tool outputs we lift into the result. */
type AddToCartData = {
  status: string;
  productId?: string;
  productTitle?: string;
  line?: CartAddSignal["line"];
  revision?: number;
  price?: { unitPriceCents: number; totalCents: number; currency: string; pricingStatus: "DEMO" | "LIVE" };
};
type SuggestAddData = {
  status: string;
  label?: string;
  productId?: string;
  basedOnRevision?: number;
  price?: { unitPriceCents: number; totalCents: number; currency: string; pricingStatus: "DEMO" | "LIVE" };
  summary?: string;
};
type StartCheckoutData = {
  status: string;
  lineCount?: number;
  subtotalCents?: number;
  currency?: string;
  pricingStatus?: "DEMO" | "LIVE";
};

/** Shape of the validated updateConfiguration/suggestConfigurationUpdate tool outputs we lift into the result. */
type ConfigViewData = {
  productId: string;
  productTitle: string;
  size: { id: string; label: string };
  material: { id: string; label: string };
  color: { id: string; label: string };
  printOption: { id: string; label: string };
  quantity: number;
  hasArtwork: boolean;
  artworkFileName?: string;
  revision: number;
  requiresCustomQuote: boolean;
  price: { unitPriceCents: number; totalCents: number; currency: string; pricingStatus: "DEMO" | "LIVE" } | null;
};
type UpdateConfigData = { status: string; configuration?: ConfigViewData; changedFields?: string[] };
type SuggestConfigData = {
  status: string;
  label?: string;
  patch?: Record<string, string | number>;
  basedOnRevision?: number;
  productPath?: string;
  preview?: ConfigViewData;
};

const FIELD_LABELS: Record<string, (v: ConfigViewData) => { field: string; value: string }> = {
  sizeId: (v) => ({ field: "Size", value: v.size.label }),
  materialId: (v) => ({ field: "Material", value: v.material.label }),
  colorId: (v) => ({ field: "Color", value: v.color.label }),
  printOptionId: (v) => ({ field: "Printing", value: v.printOption.label }),
  quantity: (v) => ({ field: "Quantity", value: v.quantity.toLocaleString("en-US") }),
};

function toConfigSignal(view: ConfigViewData, config: ProductConfiguration, changedFields: string[]): ConfigurationUpdateSignal {
  return {
    productId: view.productId,
    productTitle: view.productTitle,
    config,
    revision: view.revision,
    changedFields,
    changeSummary: changedFields.flatMap((f) => (FIELD_LABELS[f] ? [FIELD_LABELS[f](view)] : [])),
    price: view.price,
    requiresCustomQuote: view.requiresCustomQuote,
  };
}

/** Rebuild the ProductConfiguration from the customer-visible view (ids are all present). */
function viewToConfig(view: ConfigViewData): ProductConfiguration {
  return {
    productId: view.productId,
    sizeId: view.size.id,
    materialId: view.material.id,
    colorId: view.color.id,
    printOptionId: view.printOption.id as ProductConfiguration["printOptionId"],
    quantity: view.quantity,
    // Artwork metadata stays server-side; the client store preserves its local artwork.
    artwork: null,
  };
}

function deriveSignals(executed: ToolCallResult[]): {
  recommendedProductId?: string;
  recommendedProductPath?: string;
  configurationUpdate?: ConfigurationUpdateSignal;
  suggestedActions?: SuggestedAction[];
  cartAdd?: CartAddSignal;
  checkoutAction?: CheckoutActionSignal;
  needsHuman: boolean;
  handoffReason?: string;
} {
  let recommendedProductId: string | undefined;
  let recommendedProductPath: string | undefined;
  let configurationUpdate: ConfigurationUpdateSignal | undefined;
  const suggestedActions: SuggestedAction[] = [];
  let cartAdd: CartAddSignal | undefined;
  let checkoutAction: CheckoutActionSignal | undefined;
  let needsHuman = false;
  for (const call of executed) {
    if (!call.ok) continue;
    if (call.toolName === "recommendProduct") {
      const data = call.data as RecommendData;
      if (data.ok && data.productId) {
        recommendedProductId = data.productId;
        recommendedProductPath = data.configuratorPath;
      }
    }
    if (call.toolName === "updateConfiguration") {
      const data = call.data as UpdateConfigData;
      if (data.status === "applied" && data.configuration) {
        // Last successful update wins (multiple updates in one turn end at one state).
        configurationUpdate = toConfigSignal(data.configuration, viewToConfig(data.configuration), data.changedFields ?? []);
      }
    }
    if (call.toolName === "suggestConfigurationUpdate") {
      const data = call.data as SuggestConfigData;
      if (data.status === "proposed" && data.label && data.patch && data.preview) {
        suggestedActions.push({
          type: "APPLY_CONFIGURATION_PATCH",
          productId: data.preview.productId,
          productPath: data.productPath ?? "/products",
          label: data.label,
          patch: data.patch,
          basedOnRevision: data.basedOnRevision ?? 0,
          preview: data.preview.price,
        });
      }
    }
    if (call.toolName === "addConfiguredProductToCart") {
      const data = call.data as AddToCartData;
      if (data.status === "added" && data.productId && data.productTitle && data.line && data.price) {
        // Last successful add wins for the confirmation chip; each add is its own line client-side.
        cartAdd = {
          productId: data.productId,
          productTitle: data.productTitle,
          line: data.line,
          revision: data.revision ?? 0,
          currency: data.price.currency,
          pricingStatus: data.price.pricingStatus,
        };
      }
    }
    if (call.toolName === "suggestAddToCart") {
      const data = call.data as SuggestAddData;
      if (data.status === "proposed" && data.label && data.productId && data.price) {
        suggestedActions.push({
          type: "ADD_TO_CART",
          productId: data.productId,
          label: data.label,
          basedOnRevision: data.basedOnRevision ?? 0,
          price: data.price,
          summary: data.summary ?? "",
        });
      }
    }
    if (call.toolName === "startCheckout") {
      const data = call.data as StartCheckoutData;
      if (data.status === "ready" && data.subtotalCents !== undefined && data.currency) {
        checkoutAction = {
          type: "CONTINUE_TO_CHECKOUT",
          lineCount: data.lineCount ?? 0,
          subtotalCents: data.subtotalCents,
          currency: data.currency,
          pricingStatus: data.pricingStatus ?? "DEMO",
        };
      }
    }
    if (call.toolName === "requestHumanHelp" && (call.data as HandoffData).escalated) {
      needsHuman = true;
    }
  }
  return {
    recommendedProductId,
    recommendedProductPath,
    configurationUpdate,
    ...(suggestedActions.length > 0 ? { suggestedActions } : {}),
    ...(cartAdd ? { cartAdd } : {}),
    ...(checkoutAction ? { checkoutAction } : {}),
    needsHuman,
  };
}

export async function runSalesAgentTurn(
  input: SalesTurnInput,
  opts: { provider?: AIProvider } = {},
): Promise<SalesAgentResult> {
  if (!isFlagEnabled("AI_RUNTIME") || !isFlagEnabled("AI_SALES")) {
    throw new AiError("AI_DISABLED", "AI sales is disabled (AI_RUNTIME_ENABLED and AI_SALES_ENABLED must both be true)");
  }
  const message = input.message.trim();
  if (message === "") throw new AiError("AI_CONFIGURATION_ERROR", "empty message reached runSalesAgentTurn");

  const provider = opts.provider ?? testProvider ?? undefined;
  const runtime = new AiRuntime(provider ? { provider } : {});
  const registry = createSalesToolRegistry();

  // --- Conversation lifecycle -------------------------------------------
  let conversation: ConversationRow | null = await findActiveConversation(input.sessionId, "sales");
  if (!conversation) {
    conversation = await startConversation({
      sessionId: input.sessionId,
      customerId: input.customerId ?? undefined,
      agentType: "sales",
    });
    try {
      await recordServerEvent({
        sessionId: input.sessionId,
        name: "ai_chat_started",
        conversationId: conversation.id,
        props: { agentType: "sales" },
      });
    } catch (err) {
      aiLog("event_write_failed", { event: "ai_chat_started", error: err instanceof Error ? err.message : String(err) });
    }
  }

  await appendMessage({ conversationId: conversation.id, role: "user", content: message });

  // --- Context + history -------------------------------------------------
  const [profile, transcript] = await Promise.all([
    getNeedProfile(input.sessionId),
    listMessages(conversation.id),
  ]);
  const context = await buildSalesContext({
    profile,
    conversation,
    sessionId: input.sessionId,
    cartSnapshot: input.cart,
  });
  const history = toChatHistory(transcript);

  // --- The model turn ----------------------------------------------------
  const toolCtx = createToolContext({
    agentType: "sales",
    sessionId: input.sessionId,
    customerId: input.customerId ?? undefined,
    conversationId: conversation.id,
    cartSnapshot: input.cart,
  });
  const turn = await runtime.runToolConversation({
    workload: "STANDARD",
    prompt: { id: "ai_sales_agent", vars: { context } },
    messages: history,
    registry,
    context: toolCtx,
    agentType: "sales",
    sessionId: input.sessionId,
    conversationId: conversation.id,
  });

  // The handoff reason lives in the persisted handoff record (the tool's
  // source of truth), not in the tool's compact output — read it back.
  const signals: ReturnType<typeof deriveSignals> & { handoffReason?: string } = deriveSignals(turn.executedToolCalls);
  if (signals.needsHuman) {
    const rows = await listMessages(conversation.id);
    const handoffRow = [...rows].reverse().find((m) => m.role === "system" && m.structuredJson?.kind === "human_handoff");
    if (handoffRow && typeof handoffRow.structuredJson?.reason === "string") {
      signals.handoffReason = handoffRow.structuredJson.reason;
    }
  }

  const replyText = turn.text.trim() !== "" ? turn.text : INCOMPLETE_REPLY;

  // --- Persist the assistant side of the turn ---------------------------
  const model = selectModel(getAiConfig(), "STANDARD");
  for (const call of turn.executedToolCalls) {
    await appendMessage({
      conversationId: conversation.id,
      role: "tool",
      content: `${call.toolName}: ${call.ok ? "ok" : call.error.kind}`,
      toolName: call.toolName,
      toolResult: call.ok ? { ok: true, data: call.data } : { ok: false, error: call.error },
    });
  }
  await appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: replyText,
    model,
    structured: {
      status: turn.status,
      modelCalls: turn.modelCalls,
      toolCalls: turn.executedToolCalls.map((c) => `${c.toolName}:${c.ok ? "ok" : c.error.kind}`),
      promptId: "ai_sales_agent",
      ...(signals.recommendedProductId ? { recommendedProductId: signals.recommendedProductId } : {}),
      ...(signals.configurationUpdate
        ? { configurationRevision: signals.configurationUpdate.revision, configurationFields: signals.configurationUpdate.changedFields }
        : {}),
      ...(signals.cartAdd ? { cartAdded: true, cartAddTotalCents: signals.cartAdd.line.totalCents } : {}),
      ...(signals.checkoutAction ? { checkoutProposed: true } : {}),
      ...(signals.needsHuman ? { needsHuman: true } : {}),
    },
    // Per-turn configuration snapshot (S03 groundwork column): what the
    // shared configuration was when this reply was produced.
    ...(signals.configurationUpdate ? { configSnapshot: signals.configurationUpdate.config } : {}),
  });

  try {
    await recordServerEvent({
      sessionId: input.sessionId,
      name: "ai_message_sent",
      conversationId: conversation.id,
      props: {
        status: turn.status,
        toolCalls: turn.executedToolCalls.length,
        recommended: signals.recommendedProductId !== undefined,
        escalated: signals.needsHuman,
      },
    });
  } catch (err) {
    aiLog("event_write_failed", { event: "ai_message_sent", error: err instanceof Error ? err.message : String(err) });
  }

  // --- Derived intelligence (non-fatal — the reply already exists) -------
  try {
    await runNeedExtraction({
      runtime,
      sessionId: input.sessionId,
      conversationId: conversation.id,
      customerId: input.customerId ?? null,
      userMessage: message,
    });
  } catch (err) {
    aiLog("extraction_failed", {
      conversationId: conversation.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    await maybeSummarizeConversation({ runtime, conversation, sessionId: input.sessionId });
  } catch (err) {
    aiLog("summary_failed", {
      conversationId: conversation.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    conversationId: conversation.id,
    message: replyText,
    status: turn.status,
    ...(signals.recommendedProductId
      ? { recommendedProductId: signals.recommendedProductId, recommendedProductPath: signals.recommendedProductPath }
      : {}),
    ...(signals.configurationUpdate ? { configurationUpdate: signals.configurationUpdate } : {}),
    ...(signals.suggestedActions ? { suggestedActions: signals.suggestedActions } : {}),
    ...(signals.cartAdd ? { cartAdd: signals.cartAdd } : {}),
    ...(signals.checkoutAction ? { checkoutAction: signals.checkoutAction } : {}),
    needsHuman: signals.needsHuman,
    ...(signals.handoffReason ? { handoffReason: signals.handoffReason } : {}),
    conversationStatus: signals.needsHuman || conversation.status === "escalated" ? "escalated" : "active",
  };
}
