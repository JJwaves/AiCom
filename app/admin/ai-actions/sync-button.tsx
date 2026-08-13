"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SyncResult = {
  ok: boolean;
  code?: string;
  created?: number;
  blocked?: number;
  skippedExisting?: number;
  skippedUnmappable?: number;
};

/**
 * "Refresh proposed actions" — turns persisted CEO recommendations into
 * guardrail-evaluated proposed actions. NO model call happens: this reads
 * existing decision rows and runs the deterministic engine.
 */
export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/ai-actions/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = (await res.json()) as SyncResult;
      if (!res.ok || !data.ok) {
        setMessage(`Refresh failed (${data.code ?? res.status}).`);
      } else {
        const parts = [`${data.created ?? 0} new proposed action(s)`];
        if (data.blocked) parts.push(`${data.blocked} blocked by guardrails`);
        if (data.skippedExisting) parts.push(`${data.skippedExisting} already listed`);
        if (data.skippedUnmappable) parts.push(`${data.skippedUnmappable} informational only`);
        setMessage(parts.join(" · "));
        router.refresh();
      }
    } catch {
      setMessage("Refresh failed (network error).");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button type="button" className="btn btn--primary" onClick={run} disabled={busy}>
        {busy ? "Refreshing…" : "Refresh proposed actions"}
      </button>
      {message ? (
        <p role="status" className="text-sm text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
