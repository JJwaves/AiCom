"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RunResult = {
  ok: boolean;
  code?: string;
  classification?: { status: string; processed: number; failed: number; remaining: number; abortReason?: string };
  insights?: { created: number; updated: number; resurrected: number; skipped: number };
  opportunities?: { created: number; updated: number; skipped: number };
};

/**
 * The explicit "Process new conversations" action (spec §17) — the ONLY
 * trigger for AI classification. Browser Basic-auth credentials ride along
 * on the same-origin fetch.
 */
export function ProcessButton({ periodDays }: { periodDays: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/customer-intelligence/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ periodDays }),
      });
      const data = (await res.json()) as RunResult;
      if (!res.ok || !data.ok) {
        setResult(`Processing failed (${data.code ?? res.status}).`);
      } else {
        const c = data.classification;
        const classificationText =
          c?.status === "unavailable"
            ? `AI classification unavailable (${c.abortReason ?? "disabled"}) — deterministic metrics were still refreshed.`
            : `Classified ${c?.processed ?? 0} conversations (${c?.failed ?? 0} failed, ${c?.remaining ?? 0} remaining${
                c?.status === "aborted" ? `, stopped early: ${c?.abortReason}` : ""
              }).`;
        setResult(
          `${classificationText} Insights: ${data.insights?.created ?? 0} new, ${data.insights?.updated ?? 0} updated. ` +
            `Opportunities: ${data.opportunities?.created ?? 0} new, ${data.opportunities?.updated ?? 0} updated.`,
        );
        router.refresh();
      }
    } catch {
      setResult("Processing failed (network error).");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button type="button" className="btn btn--primary" onClick={run} disabled={busy}>
        {busy ? "Processing…" : "Process new conversations"}
      </button>
      {result ? (
        <p role="status" className="text-sm text-ink-2">
          {result}
        </p>
      ) : null}
    </div>
  );
}
