"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Human status controls for insights/opportunities (spec §22, §36).
 * These buttons ARE the human validation path — generation code can never
 * set validated/rejected. No autonomous action follows a status change.
 */
export function StatusButtons({
  kind,
  id,
  current,
  statuses,
}: {
  kind: "insights" | "opportunities";
  id: string;
  current: string;
  statuses: readonly string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = async (status: string) => {
    setBusy(status);
    setError(null);
    try {
      const res = await fetch(`/api/admin/customer-intelligence/${kind}/${id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setError(`Update failed (${res.status}).`);
      } else {
        router.refresh();
      }
    } catch {
      setError("Update failed (network error).");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {statuses.map((status) => (
        <button
          key={status}
          type="button"
          className="chip text-xs"
          data-selected={status === current ? "true" : undefined}
          disabled={busy !== null || status === current}
          onClick={() => set(status)}
        >
          {busy === status ? "…" : status.replace("_", " ")}
        </button>
      ))}
      {error ? (
        <span role="status" className="text-xs text-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
