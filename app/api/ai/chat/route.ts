import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { isAiError, isAiRuntimeAvailable } from "@/lib/ai";
import { runSalesAgentTurn } from "@/lib/ai/agents/sales";
import { aiLog } from "@/lib/ai/log";
import { findActiveConversation, listMessages } from "@/lib/data/conversation-service";
import { parseCookies, sessionFromRequest, setSessionCookies } from "@/lib/data/request-session";
import { getSession, SESSION_COOKIE } from "@/lib/data/session-service";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitedResponse } from "@/lib/rate-limit/http";
import { AI_UNAVAILABLE_MESSAGE, MAX_MESSAGE_CHARS } from "./shared";

/**
 * Customer-facing Sales chat API (Session 05 spec §18–§19).
 *
 * Trust boundary: the client sends ONLY a message. Session identity comes
 * from the httpOnly bd_sid cookie (server-resolved); agent type, customer
 * id, permissions, conversation selection, and every price are server-side.
 * A client-supplied customerId/agentType/price has no field to travel in.
 *
 * Availability: both feature flags AND a usable runtime config are
 * required; anything else returns the customer-safe fallback copy with a
 * normalized code — provider internals never cross this boundary.
 *
 * Abuse protection (Session 03 §16): body-size cap, message-length cap, and
 * the centralized two-layer limiter — a per-instance token bucket plus a
 * durable shared counter, per session AND per keyed network identity
 * (lib/rate-limit). The NETWORK scope is enforced BEFORE a session is
 * resolved so a cookie-dropping script cannot mint a session row per
 * request. Underneath it all the AI budget guard remains the hard spend
 * backstop: request limiting bounds the RATE, the budget bounds the TOTAL.
 * One anonymous session cannot cause uncontrolled Anthropic spend.
 */

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16_000;

/**
 * Optional client cart snapshot (S07): the cart lives client-side, so the
 * browser reports its SHAPE (ids + quantities only — the schema is STRICT,
 * so client-sent prices are a loud 422, never data). The server re-prices
 * with the engine for the agent's view; /api/checkout re-quotes before any
 * order exists. Same trust level as the localStorage cart it mirrors.
 */
const cartSnapshotSchema = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        lineId: z.string().trim().min(1).max(64),
        productId: z.string().trim().min(1).max(100),
        sizeId: z.string().trim().min(1).max(100),
        materialId: z.string().trim().min(1).max(100),
        colorId: z.string().trim().min(1).max(100),
        printOptionId: z.enum(["none", "one-color", "two-color", "full-custom"]),
        quantity: z.number().int().positive().max(1_000_000),
        hasArtwork: z.boolean(),
      }),
    )
    .max(50),
});

const bodySchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  cart: cartSnapshotSchema.optional(),
});

function aiUnavailable(status = 503): NextResponse {
  return NextResponse.json({ ok: false, code: "AI_UNAVAILABLE", message: AI_UNAVAILABLE_MESSAGE }, { status });
}

function salesChatEnabled(): boolean {
  return isFlagEnabled("AI_RUNTIME") && isFlagEnabled("AI_SALES") && isAiRuntimeAvailable();
}

export async function POST(req: Request) {
  if (!salesChatEnabled()) return aiUnavailable();

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_REQUEST" }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, code: "TOO_LARGE" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_REQUEST" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "INVALID" }, { status: 422 });
  }

  const networkLimit = await enforceRateLimit({ route: "ai_chat", req, scopes: ["network"] });
  if (!networkLimit.allowed) return rateLimitedResponse(networkLimit);

  const ctx = await sessionFromRequest(req);
  if (!ctx) return aiUnavailable();

  const sessionLimit = await enforceRateLimit({
    route: "ai_chat",
    req,
    sessionId: ctx.session.id,
    scopes: ["session"],
  });
  if (!sessionLimit.allowed) return rateLimitedResponse(sessionLimit);

  try {
    const result = await runSalesAgentTurn({
      sessionId: ctx.session.id,
      customerId: ctx.session.customerId,
      message: parsed.data.message,
      cart: parsed.data.cart,
    });
    // Wire shape: the reply travels as `reply` (`message` is the error-copy
    // field on failure responses); everything else is the normalized result.
    const res = NextResponse.json({
      ok: true,
      conversationId: result.conversationId,
      reply: result.message,
      status: result.status,
      ...(result.recommendedProductId
        ? { recommendedProductId: result.recommendedProductId, recommendedProductPath: result.recommendedProductPath }
        : {}),
      // Server-validated configuration signals (S06): the client applies
      // THESE to the shared store — it never parses reply prose.
      ...(result.configurationUpdate ? { configurationUpdate: result.configurationUpdate } : {}),
      ...(result.suggestedActions ? { suggestedActions: result.suggestedActions } : {}),
      // S07 commerce signals: the client applies/renders THESE server-
      // validated payloads — cart lines and checkout handoffs never come
      // from model prose.
      ...(result.cartAdd ? { cartAdd: result.cartAdd } : {}),
      ...(result.checkoutAction ? { checkoutAction: result.checkoutAction } : {}),
      needsHuman: result.needsHuman,
      ...(result.handoffReason ? { handoffReason: result.handoffReason } : {}),
      conversationStatus: result.conversationStatus,
    });
    setSessionCookies(res, ctx.session);
    return res;
  } catch (err) {
    // Typed degradation: the customer gets one safe sentence; the code and
    // detail stay in server logs. Commerce is untouched either way.
    if (isAiError(err)) {
      aiLog("chat_turn_failed", { code: err.code, detail: err.detail, message: err.message });
      return aiUnavailable();
    }
    console.error("[ai] chat turn failed unexpectedly", err);
    return aiUnavailable();
  }
}

/**
 * Conversation history for the session's current sales conversation.
 * Returns ONLY user/assistant rows — system rows (internal prompts,
 * handoff records) and tool rows never reach the client (spec §10).
 * No session is minted on GET; an unknown browser just has no history.
 */
export async function GET(req: Request) {
  if (!salesChatEnabled()) return aiUnavailable();

  const sessionId = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (!sessionId) return NextResponse.json({ ok: true, conversation: null });

  try {
    const session = await getSession(sessionId);
    if (!session) return NextResponse.json({ ok: true, conversation: null });
    const conversation = await findActiveConversation(session.id, "sales");
    if (!conversation) return NextResponse.json({ ok: true, conversation: null });

    const rows = await listMessages(conversation.id);
    return NextResponse.json({
      ok: true,
      conversation: {
        id: conversation.id,
        status: conversation.status,
        messages: rows
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content, at: m.createdAt.toISOString() })),
      },
    });
  } catch (err) {
    console.error("[ai] chat history read failed", err);
    return aiUnavailable();
  }
}
