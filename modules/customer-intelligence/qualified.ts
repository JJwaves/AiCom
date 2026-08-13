import type { PlatformEventName } from "@/lib/data/event-service";

/**
 * QUALIFIED CONVERSATION — the central deterministic denominator
 * (Session 08 spec §9). No LLM judgment is involved anywhere in this rule.
 *
 * A sales conversation is QUALIFIED when at least ONE of:
 *
 *  (a) its funnel outcome shows commercial engagement
 *      (quote_started | cart_added | checkout_started | purchased), or the
 *      conversation was escalated to a human (status or outcome) — a
 *      handoff exists because a real purchasing need did;
 *  (b) its session recorded ≥1 QUALIFYING_EVENT (below) — the customer
 *      engaged pricing, configuration, cart, checkout, quote, or the AI
 *      commerce funnel;
 *  (c) its session's need profile carries a quantity or product interest
 *      with provenance USER_STATED / CONFIGURATOR / ORDER_DATA — a real
 *      requirement was supplied, not merely inferred by the model
 *      (AI_INFERRED alone never qualifies a conversation).
 *
 * Merely opening the chat widget or small talk never qualifies.
 */
export const QUALIFYING_EVENT_NAMES = [
  "price_viewed",
  "add_to_cart",
  "checkout_started",
  "purchase_completed",
  "quote_started",
  "quote_submitted",
  "ai_product_recommended",
  "ai_configuration_updated",
  "ai_add_to_cart_requested",
  "ai_checkout_requested",
  "human_handoff_requested",
] as const satisfies readonly PlatformEventName[];

export const QUALIFYING_OUTCOMES = ["quote_started", "cart_added", "checkout_started", "purchased"] as const;

/** Provenance ranks that make a supplied requirement count (spec §7). */
export const QUALIFYING_NEED_SOURCES = ["USER_STATED", "CONFIGURATOR", "ORDER_DATA"] as const;

export type QualifiedInput = {
  conversation: { status: string; outcome: string | null };
  /** Did the conversation's session record ≥1 QUALIFYING_EVENT? */
  sessionHasQualifyingEvent: boolean;
  needProfile: {
    quantity: number | null;
    productInterest: string | null;
    fieldSourcesJson: Record<string, { source: string }>;
  } | null;
};

export function isQualifiedConversation(input: QualifiedInput): boolean {
  const { conversation, sessionHasQualifyingEvent, needProfile } = input;
  if (conversation.outcome && (QUALIFYING_OUTCOMES as readonly string[]).includes(conversation.outcome)) return true;
  if (conversation.status === "escalated" || conversation.outcome === "escalated") return true;
  if (sessionHasQualifyingEvent) return true;
  if (needProfile) {
    const sources = needProfile.fieldSourcesJson ?? {};
    const qualifies = (field: "quantity" | "productInterest", value: unknown) =>
      value !== null &&
      value !== undefined &&
      (QUALIFYING_NEED_SOURCES as readonly string[]).includes(sources[field]?.source ?? "");
    if (qualifies("quantity", needProfile.quantity) || qualifies("productInterest", needProfile.productInterest)) {
      return true;
    }
  }
  return false;
}
