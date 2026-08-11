import { NextResponse } from "next/server";
import { z } from "zod";
import { isFlagEnabled } from "@/config/flags";
import { isAiError, isAiRuntimeAvailable } from "@/lib/ai";
import { runSalesAgentTurn } from "@/lib/ai/agents/sales";
import { aiLog } from "@/lib/ai/log";
import { findActiveConversation, listMessages } from "@/lib/data/conversation-service";
import { parseCookies, sessionFromRequest, setSessionCookies } from "@/lib/data/request-session";
import { getSession, SESSION_COOKIE } from "@/lib/data/session-service";
import {
  AI_UNAVAILABLE_MESSAGE,
  MAX_MESSAGE_CHARS,
  RATE_LIMITED_MESSAGE,
  chatIpLimiter,
  chatSessionLimiter,
  clientIpKey,
} from "./shared";

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
 * Abuse protection: body-size cap, message-length cap, and two in-memory
 * token buckets (per-session + per-IP). Per-instance only — the deployment
 * edge owns robust distributed limiting (docs/AI_SALES_AGENT.md); the AI
 * budget guard stays the spend backstop.
 */

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16_000;

const bodySchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
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

  const ip = chatIpLimiter.take(`ip:${clientIpKey(req)}`);
  if (!ip.allowed) {
    return NextResponse.json(
      { ok: false, code: "RATE_LIMITED", message: RATE_LIMITED_MESSAGE, retryAfterSeconds: ip.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(ip.retryAfterSeconds) } },
    );
  }

  const ctx = await sessionFromRequest(req);
  if (!ctx) return aiUnavailable();

  const perSession = chatSessionLimiter.take(`session:${ctx.session.id}`);
  if (!perSession.allowed) {
    return NextResponse.json(
      { ok: false, code: "RATE_LIMITED", message: RATE_LIMITED_MESSAGE, retryAfterSeconds: perSession.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(perSession.retryAfterSeconds) } },
    );
  }

  try {
    const result = await runSalesAgentTurn({
      sessionId: ctx.session.id,
      customerId: ctx.session.customerId,
      message: parsed.data.message,
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
