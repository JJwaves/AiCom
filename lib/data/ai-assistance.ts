import { findLatestConversation } from "./conversation-service";
import { sessionHasAnyEvent, type PlatformEventName } from "./event-service";

/**
 * AI-assisted commerce attribution (Session 07).
 *
 * "Materially AI-assisted" is defined CONSERVATIVELY and deterministically:
 * the session must have a sales conversation AND at least one recorded AI
 * commerce/configuration action — a recommendation the customer received, a
 * committed configuration change, an AI-path add-to-cart, or an AI checkout
 * handoff. A loaded chat widget, or even a chat that never touched commerce,
 * is NOT material assistance (MASTER_PROMPT/AI attribution rules: no vanity
 * attribution).
 *
 * The detailed breakdown (which of these happened, when) stays derivable
 * from the first-party events joined on conversationId — deliberately not
 * duplicated onto the order row.
 */

/** Events that count as material AI assistance for an order. */
export const MATERIAL_AI_ASSISTANCE_EVENTS: readonly PlatformEventName[] = [
  "ai_product_recommended",
  "ai_configuration_updated",
  "ai_add_to_cart_requested",
  "ai_checkout_requested",
] as const;

export type AiAssistance = {
  /** True only under the conservative material-assistance definition above. */
  aiAssisted: boolean;
  /** Latest sales conversation (any status) — linked for intelligence even when assistance wasn't material. */
  conversationId: string | null;
};

export async function getAiAssistanceForSession(sessionId: string): Promise<AiAssistance> {
  const conversation = await findLatestConversation(sessionId, "sales");
  if (!conversation) return { aiAssisted: false, conversationId: null };
  const material = await sessionHasAnyEvent(sessionId, MATERIAL_AI_ASSISTANCE_EVENTS);
  return { aiAssisted: material, conversationId: conversation.id };
}
