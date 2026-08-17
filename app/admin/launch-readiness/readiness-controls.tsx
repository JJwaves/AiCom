"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Reconcile Shopify orders" (Production Launch Session 03 §24).
 *
 * The manual recovery path for payments whose webhook never arrived. Safe to
 * press at any time: the sweep is a read against Shopify and an idempotent
 * repair against BagDirect, so pressing it twice repairs nothing the second
 * time. A run that repairs zero orders is the healthy result.
 */

type ReconcileResponse = {
  ok: boolean;
  code?: string;
  reason?: string;
  message?: string;
  status?: string;
  ordersInspected?: number;
  repairsPerformed?: number;
  alreadyConsistent?: number;
  unmatched?: number;
  failures?: number;
  truncated?: boolean;
};

export function ReconcileButton({ lookbackHours = 72 }: { lookbackHours?: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/commerce/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lookbackHours }),
      });
      const data = (await res.json().catch(() => ({ ok: false }))) as ReconcileResponse;

      if (data.code === "NOT_CONFIGURED") {
        setMessage(data.reason ?? "Shopify is not configured, so there is nothing to reconcile.");
      } else if (!data.ok) {
        setMessage(`Couldn't reconcile (${data.code ?? res.status}). ${data.message ?? ""} No order was changed.`);
      } else {
        const repaired = data.repairsPerformed ?? 0;
        setMessage(
          `Inspected ${data.ordersInspected ?? 0} Shopify order(s) from the last ${lookbackHours}h. ` +
            (repaired === 0
              ? "Everything already matched — no repairs were needed."
              : `Repaired ${repaired}.`) +
            (data.unmatched ? ` ${data.unmatched} were placed outside BagDirect checkout and were left alone.` : "") +
            (data.failures ? ` ${data.failures} failed and were logged.` : "") +
            (data.truncated ? " The window was larger than one sweep can cover — run it again for a shorter window." : ""),
        );
      }
    } catch {
      setMessage("Couldn't reach the reconciliation endpoint.");
    }
    setBusy(false);
    router.refresh();
  };

  return (
    <div>
      <button type="button" className="btn btn--secondary text-sm" onClick={run} disabled={busy}>
        {busy ? "Reconciling…" : `Reconcile Shopify orders (last ${lookbackHours}h)`}
      </button>
      {message ? (
        <p className="mt-2 text-sm text-ink-2" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
