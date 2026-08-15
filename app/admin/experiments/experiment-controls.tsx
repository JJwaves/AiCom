"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ActionResponse = {
  ok: boolean;
  code?: string;
  reason?: string;
  currentStatus?: string;
  status?: string;
  alreadyRunning?: boolean;
  alreadyStopped?: boolean;
  resultState?: string;
  missingConfiguration?: string[];
  created?: number;
  skippedExisting?: number;
  skippedNoDesign?: number;
  skippedInvalid?: number;
  issues?: string[];
  proposals?: number;
  updated?: number;
  droppedInvalid?: number;
  dropReasons?: string[];
};

async function post(path: string, body: Record<string, unknown>): Promise<{ res: Response; data: ActionResponse }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({ ok: false }))) as ActionResponse;
  return { res, data };
}

/**
 * Launch / Stop / Archive for one experiment (spec §31, §33, §49).
 *
 * The client sends only its INTENT plus the `expectedStateVersion` it
 * rendered — never a status, an actor, or a traffic number. A stale version
 * returns 409 and the owner is told to reload; nothing is overwritten.
 */
export function ExperimentControls({
  experimentId,
  status,
  stateVersion,
}: {
  experimentId: string;
  status: string;
  stateVersion: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const run = async (label: string, path: string, body: Record<string, unknown>) => {
    setBusy(label);
    setMessage(null);
    try {
      const { res, data } = await post(`/api/admin/experiments/${experimentId}/${path}`, body);
      if (res.status === 409) {
        setMessage(
          data.code === "TARGET_BUSY"
            ? (data.reason ?? "Another experiment is already running on this target.")
            : `This experiment changed since the page was loaded (now ${data.currentStatus ?? "updated"}). Reload before acting — nothing was overwritten.`,
        );
      } else if (!res.ok || !data.ok) {
        const missing = data.missingConfiguration?.length
          ? ` Missing configuration: ${data.missingConfiguration.join(", ")}.`
          : "";
        setMessage(`Refused: ${data.reason ?? data.code ?? res.status}.${missing}`);
      } else if (data.alreadyRunning) {
        setMessage("Already running — nothing changed.");
      } else if (data.alreadyStopped) {
        setMessage("Already stopped — nothing changed.");
      } else {
        setMessage(
          data.resultState
            ? `Stopped. Result frozen as ${data.resultState}. No data was deleted.`
            : `Recorded: ${data.status ?? "updated"}.`,
        );
        router.refresh();
      }
    } catch {
      setMessage("Failed (network error).");
    } finally {
      setBusy(null);
    }
  };

  const canLaunch = status === "draft" || status === "approved";
  const canStop = status === "running";
  const canArchive = status === "stopped" || status === "decided" || status === "draft" || status === "approved";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {canLaunch && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy !== null}
            onClick={() => run("launch", "launch", { expectedStateVersion: stateVersion })}
          >
            {busy === "launch" ? "…" : "Launch on live traffic"}
          </button>
        )}
        {canStop && (
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() =>
              run("stop", "stop", { expectedStateVersion: stateVersion, reason: reason || undefined })
            }
          >
            {busy === "stop" ? "…" : "Stop"}
          </button>
        )}
        {canArchive && (
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => run("archive", "archive", { expectedStateVersion: stateVersion })}
          >
            {busy === "archive" ? "…" : "Archive"}
          </button>
        )}
      </div>

      {canStop && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="label-mono text-ink-3">Stop reason (optional)</span>
          <input
            className="input"
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why you are stopping this experiment"
          />
        </label>
      )}

      {message ? (
        <p role="status" className="text-sm text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** "Create drafts from approved proposals" — deterministic, no model call. */
export function MaterializeButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { res, data } = await post("/api/admin/experiments/materialize", {});
      if (!res.ok || !data.ok) {
        setMessage(`Failed (${data.code ?? res.status}).`);
      } else {
        const parts = [`${data.created ?? 0} draft experiment(s) created`];
        if (data.skippedExisting) parts.push(`${data.skippedExisting} already created`);
        if (data.skippedNoDesign) parts.push(`${data.skippedNoDesign} approved as a direction only (no design)`);
        if (data.skippedInvalid) parts.push(`${data.skippedInvalid} refused by validation`);
        setMessage([parts.join(" · "), ...(data.issues ?? []).slice(0, 3)].join(" — "));
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
      <button type="button" className="btn" onClick={run} disabled={busy}>
        {busy ? "Creating…" : "Create drafts from approved proposals"}
      </button>
      {message ? (
        <p role="status" className="text-sm text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Author a draft by hand. Same validation as an AI proposal — closed target
 * registry, strict variant schema, closed metric lists, capped allocation.
 * A draft enrols nobody; launching is still a separate explicit action.
 */
export function CreateExperimentForm({ example }: { example: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [design, setDesign] = useState(example);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(design);
    } catch {
      setMessage("That is not valid JSON.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { res, data } = await post("/api/admin/experiments/create", { name, hypothesis, design: parsed });
      if (!res.ok || !data.ok) {
        setMessage(`Refused: ${data.reason ?? data.code ?? res.status}`);
      } else {
        setMessage("Draft created. It enrols nobody until you launch it.");
        setOpen(false);
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
      <button type="button" className="btn" onClick={() => setOpen((v) => !v)}>
        {open ? "Cancel" : "Create a draft experiment"}
      </button>
      {open ? (
        <div className="surface flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="label-mono text-ink-3">Name</span>
            <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="label-mono text-ink-3">Hypothesis</span>
            <input
              className="input"
              value={hypothesis}
              maxLength={4000}
              onChange={(e) => setHypothesis(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="label-mono text-ink-3">Design (JSON)</span>
            <textarea
              className="input font-mono text-xs"
              rows={16}
              value={design}
              spellCheck={false}
              onChange={(e) => setDesign(e.target.value)}
            />
          </label>
          <p className="text-xs text-ink-3">
            The design is validated server-side against the target registry and the variant schema. Markup, scripts,
            unknown fields, unlisted metrics and over-cap traffic are refused.
          </p>
          <div>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={submit}>
              {busy ? "…" : "Create draft"}
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

/** Generate CRO proposals — the ONLY trigger for a CRO model call. */
export function GenerateCroReviewButton({ periodDays }: { periodDays: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { res, data } = await post("/api/admin/experiments/cro-review", { periodDays });
      if (res.status === 503) {
        setMessage(
          `The CRO agent is unavailable (${data.reason ?? "AI error"}). Running experiments, assignment and measurement are unaffected.`,
        );
      } else if (!res.ok || !data.ok) {
        setMessage(`Failed (${data.code ?? res.status}).`);
      } else {
        const parts = [`${data.created ?? 0} new proposal(s)`];
        if (data.updated) parts.push(`${data.updated} refreshed`);
        if (data.droppedInvalid) parts.push(`${data.droppedInvalid} dropped by validation`);
        parts.push("review them in the AI Action Center");
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
        {busy ? "Analyzing…" : "Ask the CRO agent for proposals"}
      </button>
      {message ? (
        <p role="status" className="text-sm text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
