import { formatMoney, formatQty } from "@/lib/format";
import { resolveEvidenceRefs, type EvidenceItem } from "@/lib/data/intelligence-service";

/**
 * Evidence drill-down renderer (Session 08 spec §30, §32) — answers "why is
 * the system saying this?" with minimal context: bounded message excerpts,
 * dates, outcomes, business type, quantities. Never prompts, keys,
 * margins, or contact PII. Rows deleted by privacy tooling resolve to a
 * missing count — deleted evidence is reported as gone, not reconstructed.
 */

const dateTime = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16);

function EvidenceRow({ item }: { item: EvidenceItem }) {
  switch (item.table) {
    case "messages":
      return (
        <div>
          <p className="label-mono text-ink-3">Customer message · {dateTime(item.createdAt)}</p>
          <p className="mt-1 text-sm text-ink-2">“{item.excerpt}”</p>
        </div>
      );
    case "conversations":
      return (
        <div>
          <p className="label-mono text-ink-3">Conversation · {dateTime(item.startedAt)}</p>
          <p className="mt-1 text-sm text-ink-2">
            Status: {item.status}
            {item.outcome ? ` · outcome: ${item.outcome}` : " · no outcome recorded"}
          </p>
        </div>
      );
    case "customer_need_profiles":
      return (
        <div>
          <p className="label-mono text-ink-3">Need profile · updated {dateTime(item.updatedAt)}</p>
          <p className="mt-1 text-sm text-ink-2">
            {item.businessType ? `Business: ${item.businessType} · ` : ""}
            {item.quantity !== null ? `Quantity: ${formatQty(item.quantity)} · ` : ""}
            {item.productInterest ? `Interest: ${item.productInterest}` : ""}
          </p>
        </div>
      );
    case "orders":
      return (
        <div>
          <p className="label-mono text-ink-3">Order · {dateTime(item.createdAt)}</p>
          <p className="mt-1 text-sm text-ink-2">
            {formatMoney(item.totalCents, item.currency as "USD" | "CAD")}
            {item.aiAssisted ? " · AI-assisted" : ""}
          </p>
        </div>
      );
    case "quotes":
      return (
        <div>
          <p className="label-mono text-ink-3">Quote · {dateTime(item.createdAt)}</p>
          <p className="mt-1 text-sm text-ink-2">Status: {item.status}</p>
        </div>
      );
    case "product_configurations":
      return (
        <div>
          <p className="label-mono text-ink-3">Configuration · updated {dateTime(item.updatedAt)}</p>
          <p className="mt-1 text-sm text-ink-2">
            Product: {item.productId}
            {item.quantity !== null ? ` · quantity ${formatQty(item.quantity)}` : ""}
          </p>
        </div>
      );
  }
}

export async function EvidenceList({ refs }: { refs: { table: string; id: string }[] }) {
  const resolved = await resolveEvidenceRefs(refs);
  return (
    <div className="mt-4 space-y-2">
      {resolved.items.length === 0 ? (
        <p className="text-sm text-ink-3">No evidence rows remain available.</p>
      ) : (
        resolved.items.map((item) => (
          <div key={`${item.table}:${item.id}`} className="surface p-3">
            <EvidenceRow item={item} />
          </div>
        ))
      )}
      {resolved.missing > 0 ? (
        <p className="text-xs text-ink-3">
          {formatQty(resolved.missing)} evidence reference{resolved.missing === 1 ? "" : "s"} no longer available
          (deleted data stays deleted).
        </p>
      ) : null}
    </div>
  );
}
