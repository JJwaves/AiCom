"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ReviewResponse = {
  ok: boolean;
  code?: string;
  reason?: string;
  currentStatus?: string;
  status?: string;
  guardrail?: { allowed: boolean; approvalRequired: boolean; violatedRules: string[]; missingConfiguration: string[] };
  revisionId?: string;
};

/**
 * Approve / Reject / Modify controls (spec §17, §27–§28).
 *
 * The client sends only its INTENT plus the `expectedStateVersion` it
 * rendered. It never sends reviewedBy, risk, status or approval fields —
 * those are server-derived or server-computed. A stale version returns 409
 * and the owner is told to reload rather than silently overwriting someone.
 */
export function ReviewControls({
  actionId,
  stateVersion,
  payloadJson,
  canReview,
}: {
  actionId: string;
  stateVersion: number;
  payloadJson: string;
  canReview: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(payloadJson);
  const [notes, setNotes] = useState("");

  const post = async (path: string, body: Record<string, unknown>, label: string) => {
    setBusy(label);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/ai-actions/${actionId}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ReviewResponse;
      if (res.status === 409) {
        setMessage(
          `This action changed since the page was loaded (now ${data.currentStatus ?? "updated"}). Reload before reviewing — nothing was overwritten.`,
        );
      } else if (!res.ok || !data.ok) {
        setMessage(
          data.code === "INVALID"
            ? `Rejected: ${data.reason ?? "the modified action failed validation."}`
            : `Failed (${data.code ?? res.status}).`,
        );
      } else {
        if (data.guardrail && !data.guardrail.allowed) {
          setMessage(
            `Saved as a new revision, but guardrails BLOCKED it: ${data.guardrail.violatedRules.join(", ") || "policy violation"}. It cannot be approved.`,
          );
        } else if (data.guardrail) {
          setMessage(
            `Saved as a new revision and re-evaluated${
              data.guardrail.missingConfiguration.length
                ? ` (still missing ${data.guardrail.missingConfiguration.length} configuration value(s))`
                : ""
            }. It needs its own approval.`,
          );
        } else {
          setMessage(`Recorded: ${data.status ?? "updated"}. Nothing was executed — no executor exists yet.`);
        }
        setEditing(false);
        router.refresh();
      }
    } catch {
      setMessage("Failed (network error).");
    } finally {
      setBusy(null);
    }
  };

  if (!canReview) {
    return <p className="text-sm text-ink-3">This action is closed — no further review is possible.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy !== null}
          onClick={() => post("review", { outcome: "approve", expectedStateVersion: stateVersion, notes: notes || undefined }, "approve")}
        >
          {busy === "approve" ? "…" : "Approve"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => post("review", { outcome: "reject", expectedStateVersion: stateVersion, notes: notes || undefined }, "reject")}
        >
          {busy === "reject" ? "…" : "Reject"}
        </button>
        <button type="button" className="btn" disabled={busy !== null} onClick={() => setEditing((v) => !v)}>
          {editing ? "Cancel modification" : "Modify"}
        </button>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="label-mono text-ink-3">Review note (optional)</span>
        <input
          className="input"
          value={notes}
          maxLength={4000}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Why you approved, rejected, or changed this"
        />
      </label>

      {editing ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="label-mono text-ink-3">Modified action payload (JSON)</span>
            <textarea
              className="input font-mono text-xs"
              rows={14}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
          </label>
          <p className="text-xs text-ink-3">
            Your version is validated and re-evaluated by the Guardrail Engine from scratch — it inherits no approval
            and can be blocked. The original proposal is preserved. Evidence references may be removed but never added.
          </p>
          <div>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy !== null}
              onClick={() => {
                let payload: unknown;
                try {
                  payload = JSON.parse(draft);
                } catch {
                  setMessage("That is not valid JSON.");
                  return;
                }
                void post("modify", { payload, expectedStateVersion: stateVersion, notes: notes || undefined }, "modify");
              }}
            >
              {busy === "modify" ? "…" : "Save as new revision"}
            </button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p role="status" className="text-sm text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
