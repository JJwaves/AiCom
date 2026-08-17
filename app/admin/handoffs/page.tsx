import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { checkAdminAuth } from "@/lib/admin/auth";
import { handoffCounts, listHandoffs, type HumanHandoffRow } from "@/lib/data/handoff-service";
import { handoffDeliveryConfigured } from "@/lib/escalation/delivery";
import { HandoffActions } from "./handoff-controls";

/**
 * /admin/handoffs — where escalations become visible (Production Launch
 * Session 03 §23).
 *
 * Before this session an AI escalation was a `system` message row inside a
 * conversation: persisted, and invisible. A customer could be told "I've
 * passed this to a colleague" and no colleague would ever learn of it.
 *
 * This page is deliberately NOT a CRM. No assignment, no threads, no
 * statuses beyond the two facts an owner needs at a glance: was the
 * notification delivered, and has a human dealt with it.
 *
 * Same auth as every other admin surface (Basic via proxy.ts + this
 * re-check). No feature flag: an escalation queue that disappears when a
 * flag is off would recreate the exact problem this page fixes.
 */

export const metadata: Metadata = { title: "Human handoffs — Admin", robots: { index: false, follow: false } };

const REASON_LABEL: Record<string, string> = {
  unsupported_request: "Unsupported request",
  large_order: "Large order",
  distributor_inquiry: "Distributor inquiry",
  urgent_delivery: "Urgent delivery",
  complaint: "Complaint",
  refund_request: "Refund request",
  legal_question: "Legal question",
  unknown_capability: "Unknown capability",
  customer_requested_human: "Customer asked for a person",
  other: "Other",
};

const DELIVERY_LABEL: Record<string, { text: string; tone: string }> = {
  pending: { text: "Delivery pending", tone: "text-ink-3" },
  delivered: { text: "Delivered", tone: "text-ok" },
  failed: { text: "Delivery failed — stored here", tone: "text-warn" },
  not_configured: { text: "No delivery destination configured", tone: "text-warn" },
};

function contactLine(row: HumanHandoffRow): string {
  const parts = [row.contactName, row.contactEmail, row.contactPhone].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "No contact details were volunteered";
}

export default async function HandoffsPage() {
  const h = await headers();
  if (checkAdminAuth(h.get("authorization")) !== "authorized") notFound();

  const [rows, counts] = await Promise.all([listHandoffs({ limit: 100 }), handoffCounts()]);
  const deliveryConfigured = handoffDeliveryConfigured();

  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl" style={{ fontWeight: 600 }}>
        Human handoffs
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-2">
        Conversations the AI assistant escalated to a person. Every one of these is stored here whether or not the
        notification reached you — a delivery failure never loses a customer&apos;s request.
      </p>

      {!deliveryConfigured && (
        <p className="mt-4 rounded-[6px] bg-warn-soft px-4 py-3 text-sm text-warn" role="status">
          <strong>No delivery destination is configured.</strong> Escalations are recorded here, but nothing notifies
          you when one arrives. Set <code>HUMAN_HANDOFF_WEBHOOK_URL</code> (a Slack workflow, a Zapier/Make hook, an
          email automation, or a helpdesk intake URL) and redeploy.
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Unhandled" value={counts.unhandled} />
        <Card label="Delivered" value={counts.delivered} />
        <Card label="Delivery failed" value={counts.failed} />
        <Card label="Total" value={counts.total} />
      </div>

      {rows.length === 0 ? (
        <p className="mt-10 text-ink-3">No escalations yet.</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {rows.map((row) => {
            const delivery = DELIVERY_LABEL[row.deliveryStatus] ?? DELIVERY_LABEL.pending;
            return (
              <li key={row.id} id={row.id} className="surface p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-base text-ink" style={{ fontWeight: 600 }}>
                    {REASON_LABEL[row.reason] ?? row.reason}
                  </h2>
                  <p className={`label-mono text-xs ${delivery.tone}`}>
                    {delivery.text}
                    {row.deliveryAttempts > 0 ? ` · ${row.deliveryAttempts} attempt(s)` : ""}
                  </p>
                </div>
                <p className="mt-2 text-sm text-ink-2">{row.requirementSummary}</p>
                {row.customerQuestion ? (
                  <p className="mt-2 text-sm text-ink-2">
                    <span className="label-mono text-ink-3">Their question: </span>
                    {row.customerQuestion}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-ink-3">{contactLine(row)}</p>
                <p className="mt-1 text-xs text-ink-3">
                  {new Date(row.createdAt).toLocaleString()}
                  {row.productId ? ` · ${row.productId}` : ""}
                  {row.handledAt ? ` · handled ${new Date(row.handledAt).toLocaleString()}` : ""}
                </p>
                {row.lastError ? <p className="mt-1 text-xs text-warn">Last delivery error: {row.lastError}</p> : null}
                <HandoffActions id={row.id} handled={row.handledAt !== null} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface p-4">
      <p className="label-mono text-ink-3">{label}</p>
      <p className="mt-1 font-mono text-2xl text-ink">{value}</p>
    </div>
  );
}
