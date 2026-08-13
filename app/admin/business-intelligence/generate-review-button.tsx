"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RunResult = {
  ok: boolean;
  code?: string;
  reason?: string;
  recommendations?: number;
  created?: number;
  updated?: number;
  droppedInvalid?: number;
  skippedReviewed?: number;
};

/**
 * The explicit "Generate / Refresh CEO Review" action (spec §32) — the
 * ONLY trigger for the CEO agent. Deterministic metrics never wait on it;
 * a failure leaves the last persisted review visible.
 */
export function GenerateReviewButton({ periodDays, hasReport }: { periodDays: number; hasReport: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/business-intelligence/ceo-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ periodDays }),
      });
      const data = (await res.json()) as RunResult;
      if (!res.ok || !data.ok) {
        setResult(
          data.code === "AI_UNAVAILABLE"
            ? `CEO review unavailable (${data.reason ?? "AI disabled"}). Deterministic metrics above are unaffected.`
            : `CEO review generation failed (${data.reason ?? data.code ?? res.status}). The previous review (if any) remains valid; deterministic metrics are unaffected.`,
        );
      } else {
        setResult(
          `Review generated: ${data.recommendations ?? 0} recommendations (${data.created ?? 0} new, ${data.updated ?? 0} refreshed${
            data.droppedInvalid ? `, ${data.droppedInvalid} dropped for invalid references` : ""
          }${data.skippedReviewed ? `, ${data.skippedReviewed} already human-reviewed` : ""}).`,
        );
        router.refresh();
      }
    } catch {
      setResult("CEO review generation failed (network error). Deterministic metrics are unaffected.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button type="button" className="btn btn--primary" onClick={run} disabled={busy}>
        {busy ? "Generating…" : hasReport ? "Refresh CEO Review" : "Generate your first CEO Review"}
      </button>
      {result ? (
        <p role="status" className="text-sm text-ink-2">
          {result}
        </p>
      ) : null}
    </div>
  );
}
