import { z } from "zod";
import {
  getConversation,
  appendMessage,
  markConversationEscalated,
} from "@/lib/data/conversation-service";
import { getNeedProfile } from "@/lib/data/customer-need-service";
import { recordServerEvent } from "@/lib/data/event-service";
import { aiLog } from "../log";
import type { ToolDefinition } from "./types";

/**
 * requestHumanHelp — the Sales Agent's escalation path (Session 05 spec §16).
 *
 * Effect (all through lib/data services):
 * 1. Builds a structured handoff object: reason, requirement summary, the
 *    customer's open question, voluntarily-supplied contact info, the
 *    session/conversation/product references, and a snapshot of the
 *    CustomerNeedProfile — the human never asks the customer to repeat the
 *    conversation.
 * 2. Persists it as a `system` message row (structuredJson) on the
 *    conversation — system rows never reach customer-facing APIs.
 * 3. Marks the conversation escalated (status+outcome; NOT ended — the
 *    customer can keep chatting while a human follows up).
 * 4. Emits the `human_handoff_requested` first-party event and a loud
 *    server log. Delivery to a real inbox/CRM is deliberately deferred:
 *    the escalation destination is owner configuration
 *    (BUSINESS_CONFIG_TODO) — until then the record is queryable in the DB.
 *
 * Identity comes from the server-minted ToolExecutionContext; the model
 * cannot escalate someone else's conversation.
 */

export const ESCALATION_REASONS = [
  "unsupported_request",
  "large_order",
  "distributor_inquiry",
  "urgent_delivery",
  "complaint",
  "refund_request",
  "legal_question",
  "unknown_capability",
  "customer_requested_human",
  "other",
] as const;

const escalationInput = z.object({
  reason: z.enum(ESCALATION_REASONS),
  /** What the customer needs, in enough detail that they never repeat themselves. */
  requirementSummary: z.string().trim().min(1).max(1500),
  /** The customer's open question, if one is pending. */
  customerQuestion: z.string().trim().min(1).max(500).optional(),
  /** Contact details ONLY if the customer volunteered them in this conversation. */
  contactName: z.string().trim().min(1).max(120).optional(),
  contactEmail: z.email().max(254).optional(),
  contactPhone: z.string().trim().min(1).max(40).optional(),
});

const escalationOutput = z.object({
  escalated: z.literal(true),
  /** Reference the customer can mention to the human team. */
  reference: z.string(),
});

export type HumanHandoff = {
  kind: "human_handoff";
  reason: (typeof ESCALATION_REASONS)[number];
  requirementSummary: string;
  customerQuestion?: string;
  contact?: { name?: string; email?: string; phone?: string };
  sessionId: string;
  conversationId: string;
  productId?: string;
  /** Non-empty CustomerNeedProfile fields at escalation time. */
  needProfile: Record<string, unknown>;
  createdAt: string;
};

/** Need-profile columns worth carrying into a handoff (non-null only). */
const HANDOFF_PROFILE_FIELDS = [
  "businessName",
  "businessType",
  "industry",
  "location",
  "quantity",
  "desiredCapacity",
  "materialPreference",
  "colorPreference",
  "handlePreference",
  "printingRequirement",
  "printingColors",
  "printingSides",
  "logoAvailable",
  "budgetCents",
  "targetUnitPriceCents",
  "shippingPostalCode",
  "desiredDeliveryDate",
  "estimatedDailyOrders",
  "estimatedMonthlyUsage",
  "productInterest",
] as const;

export const requestHumanHelpTool: ToolDefinition<z.infer<typeof escalationInput>, z.infer<typeof escalationOutput>> = {
  name: "requestHumanHelp",
  description:
    "Escalate this conversation to a human teammate. Use it for anything you cannot safely handle: unsupported " +
    "dimensions/materials/printing, uncertain factory capabilities, very large or enterprise orders, distributor " +
    "inquiries, urgent delivery commitments, complaints, refund requests, legal questions, or when the customer asks " +
    "for a person. Summarize the requirement first so the customer never repeats themselves. Include contact details " +
    "only if the customer volunteered them.",
  permission: "CUSTOMER_WRITE",
  inputSchema: escalationInput,
  outputSchema: escalationOutput,
  async execute(input, ctx) {
    if (!ctx.sessionId || !ctx.conversationId) {
      throw new Error("requestHumanHelp requires a session- and conversation-scoped ToolExecutionContext");
    }
    const conversation = await getConversation(ctx.conversationId);
    if (!conversation || conversation.sessionId !== ctx.sessionId) {
      throw new Error("requestHumanHelp context does not match a conversation of this session");
    }

    const profile = await getNeedProfile(ctx.sessionId);
    const needProfile: Record<string, unknown> = {};
    if (profile) {
      for (const field of HANDOFF_PROFILE_FIELDS) {
        const value = profile[field];
        if (value !== null && value !== undefined) needProfile[field] = value;
      }
    }

    const contact: HumanHandoff["contact"] = {};
    if (input.contactName) contact.name = input.contactName;
    if (input.contactEmail) contact.email = input.contactEmail;
    if (input.contactPhone) contact.phone = input.contactPhone;

    const handoff: HumanHandoff = {
      kind: "human_handoff",
      reason: input.reason,
      requirementSummary: input.requirementSummary,
      ...(input.customerQuestion ? { customerQuestion: input.customerQuestion } : {}),
      ...(Object.keys(contact).length > 0 ? { contact } : {}),
      sessionId: ctx.sessionId,
      conversationId: ctx.conversationId,
      ...(conversation.productId ? { productId: conversation.productId } : {}),
      needProfile,
      createdAt: new Date().toISOString(),
    };

    // The handoff record + status change are the tool's real effect — if they
    // fail, the model must see execution_failed rather than believe help is
    // on the way.
    await appendMessage({
      conversationId: ctx.conversationId,
      role: "system",
      content: `[handoff] ${input.reason}`,
      structured: handoff,
    });
    await markConversationEscalated(ctx.conversationId);

    try {
      await recordServerEvent({
        sessionId: ctx.sessionId,
        name: "human_handoff_requested",
        conversationId: ctx.conversationId,
        props: { reason: input.reason },
      });
    } catch (err) {
      aiLog("event_write_failed", {
        event: "human_handoff_requested",
        requestId: ctx.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    aiLog("escalation_requested", {
      reason: input.reason,
      sessionId: ctx.sessionId,
      conversationId: ctx.conversationId,
      requestId: ctx.requestId,
    });

    return { escalated: true as const, reference: ctx.conversationId };
  },
};
