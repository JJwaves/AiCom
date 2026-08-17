"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Handoff row actions (Production Launch Session 03 §23).
 *
 * Two buttons, no CRM: retry the outbound notification, or record that a
 * human dealt with it. Both are POSTs through the admin write guard.
 */

async function post(url: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; status?: string; error?: string };
  } catch {
    return { ok: false };
  }
}

export function HandoffActions({ id, handled }: { id: string; handled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"retry" | "handled" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const retry = async () => {
    setBusy("retry");
    setMessage(null);
    const data = await post(`/api/admin/handoffs/${encodeURIComponent(id)}/retry`);
    setMessage(
      data.ok
        ? "Delivered."
        : data.status === "not_configured"
          ? "No delivery destination is configured — set HUMAN_HANDOFF_WEBHOOK_URL. The handoff itself is safe."
          : `Delivery failed again${data.error ? `: ${data.error}` : ""}. The handoff is still stored here.`,
    );
    setBusy(null);
    router.refresh();
  };

  const markHandled = async () => {
    setBusy("handled");
    setMessage(null);
    const data = await post(`/api/admin/handoffs/${encodeURIComponent(id)}/handled`);
    if (!data.ok) setMessage("Couldn't record that.");
    setBusy(null);
    router.refresh();
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn--secondary text-sm" onClick={retry} disabled={busy !== null}>
          {busy === "retry" ? "Retrying…" : "Retry delivery"}
        </button>
        {!handled && (
          <button type="button" className="btn btn--ghost text-sm" onClick={markHandled} disabled={busy !== null}>
            {busy === "handled" ? "Saving…" : "Mark handled"}
          </button>
        )}
      </div>
      {message ? (
        <p className="mt-2 text-sm text-ink-2" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
