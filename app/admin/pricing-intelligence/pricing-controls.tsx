"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Generate / Refresh Pricing Review" (spec §38).
 *
 * The ONLY trigger for a Pricing Agent model call. The deterministic
 * dashboard above it renders without this button ever being pressed, and a
 * provider failure is reported honestly here while everything else keeps
 * working.
 */

type ReviewResponse = {
  ok: boolean;
  code?: string;
  reason?: string;
  recommendations?: number;
  created?: number;
  updated?: number;
  droppedInvalid?: number;
  droppedReferences?: number;
  skippedReviewed?: number;
  dropReasons?: string[];
};

export function GeneratePricingReviewButton({ periodDays }: { periodDays: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/pricing-intelligence/pricing-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ periodDays }),
      });
      const data = (await res.json().catch(() => ({ ok: false }))) as ReviewResponse;
      if (res.status === 503) {
        setMessage(
          `The pricing agent is unavailable (${data.reason ?? "AI error"}). Every number on this page is unaffected — they are computed without AI.`,
        );
      } else if (!res.ok || !data.ok) {
        setMessage(`Failed (${data.code ?? res.status}).`);
      } else {
        const parts = [`${data.created ?? 0} new review item(s)`];
        if (data.updated) parts.push(`${data.updated} refreshed`);
        if (data.skippedReviewed) parts.push(`${data.skippedReviewed} already decided by you`);
        if (data.droppedInvalid) parts.push(`${data.droppedInvalid} dropped by validation`);
        if (data.droppedReferences) parts.push(`${data.droppedReferences} invented reference(s) removed`);
        parts.push("approve or dismiss them in the AI Action Center");
        setMessage([parts.join(" · "), ...(data.dropReasons ?? []).slice(0, 2)].join(" — "));
        router.refresh();
      }
    } catch {
      setMessage("Failed (network error).");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button type="button" className="btn btn--primary" onClick={run} disabled={busy}>
        {busy ? "Analyzing…" : "Generate pricing review"}
      </button>
      {message ? (
        <p role="status" className="text-sm text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
