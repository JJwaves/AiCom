import { BUSINESS } from "@/config/business";
import { siteUrl } from "@/config/site";
import { recordHandoffDelivery, type HumanHandoffRow } from "@/lib/data/handoff-service";
import { describeError, logInfo, logWarn } from "@/lib/observability/logger";

/**
 * Human-handoff DELIVERY (Production Launch Session 03 §20–§22).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A GENERIC WEBHOOK AND NOT SLACK / EMAIL / A HELPDESK
 * ═══════════════════════════════════════════════════════════════════════════
 * The owner's operational stack is not known yet, and every specific
 * integration embeds a vendor into the core: a Slack SDK, an email provider's
 * API, a helpdesk's auth model. A JSON POST reaches ALL of them through a
 * Slack workflow URL, a Zapier/Make hook, an email-automation endpoint or a
 * helpdesk intake — and is replaceable in one line of owner configuration
 * when the stack changes. This mirrors the choice already made for quote
 * intake (`QUOTE_WEBHOOK_URL`), which is why that variable is the documented
 * fallback here.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS SENT, AND WHAT IS NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * Sent: the handoff id, when it happened, why, a concise requirement
 * summary, the customer's open question, contact details THE CUSTOMER
 * VOLUNTEERED, and a deep link to the admin view.
 *
 * NOT sent (§21): the full transcript, system prompts, API secrets, internal
 * margins or costs, payment data, the raw need profile, session or customer
 * ids. A webhook target is often a third-party automation platform; the
 * payload is sized for "a human can act on this", not "everything we know".
 * The full context stays in BagDirect, one authenticated click away.
 */

export type HandoffDeliveryPayload = {
  type: "human_handoff";
  handoffId: string;
  createdAt: string;
  reason: string;
  requirementSummary: string;
  customerQuestion: string | null;
  contact: { name: string | null; email: string | null; phone: string | null };
  productId: string | null;
  /** Where the owner reads the whole conversation. Null when no domain is configured. */
  adminUrl: string | null;
  brand: string;
};

export type DeliveryOutcome =
  | { status: "delivered" }
  | { status: "not_configured" }
  | { status: "failed"; error: string };

const DELIVERY_TIMEOUT_MS = 8_000;

/** `HUMAN_HANDOFF_WEBHOOK_URL`, falling back to the quote hook the owner already has. */
export function handoffWebhookUrl(): string | null {
  for (const name of ["HUMAN_HANDOFF_WEBHOOK_URL", "QUOTE_WEBHOOK_URL"]) {
    const raw = process.env[name];
    if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  }
  return null;
}

export function handoffDeliveryConfigured(): boolean {
  return handoffWebhookUrl() !== null;
}

export function buildHandoffPayload(row: HumanHandoffRow): HandoffDeliveryPayload {
  const base = siteUrl();
  return {
    type: "human_handoff",
    handoffId: row.id,
    createdAt: row.createdAt.toISOString(),
    reason: row.reason,
    requirementSummary: row.requirementSummary,
    customerQuestion: row.customerQuestion,
    contact: { name: row.contactName, email: row.contactEmail, phone: row.contactPhone },
    productId: row.productId,
    adminUrl: base ? `${base}/admin/handoffs#${row.id}` : null,
    brand: BUSINESS.DISPLAY_NAME,
  };
}

/**
 * Attempt delivery and RECORD the outcome on the row.
 *
 * Never throws. A failure is a recorded state (`failed`, with the attempt
 * count and a safe error), not an exception that could roll back the
 * escalation the customer was just promised.
 */
export async function deliverHandoff(row: HumanHandoffRow): Promise<DeliveryOutcome> {
  const url = handoffWebhookUrl();
  if (!url) {
    // Deliberately its own status, not "failed": nothing is broken, the owner
    // simply has not configured a destination yet. The launch-readiness
    // surface reports it as a WARNING with the exact variable to set.
    logWarn({
      subsystem: "escalation",
      event: "handoff_delivery_not_configured",
      code: "HANDOFF_DELIVERY_NOT_CONFIGURED",
      handoffId: row.id,
      detail: "set HUMAN_HANDOFF_WEBHOOK_URL (or QUOTE_WEBHOOK_URL) so escalations reach a human",
    });
    await recordHandoffDelivery({ id: row.id, status: "not_configured", error: "no delivery destination configured" });
    return { status: "not_configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildHandoffPayload(row)),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`handoff webhook responded ${res.status}`);
    await recordHandoffDelivery({ id: row.id, status: "delivered" });
    logInfo({ subsystem: "escalation", event: "handoff_delivered", handoffId: row.id, reason: row.reason });
    return { status: "delivered" };
  } catch (err) {
    const error = describeError(err);
    logWarn({
      subsystem: "escalation",
      event: "handoff_delivery_failed",
      code: "HANDOFF_DELIVERY_FAILED",
      handoffId: row.id,
      error,
      detail: "the handoff is SAFE — it is stored and visible at /admin/handoffs",
    });
    await recordHandoffDelivery({ id: row.id, status: "failed", error });
    return { status: "failed", error };
  } finally {
    clearTimeout(timer);
  }
}
