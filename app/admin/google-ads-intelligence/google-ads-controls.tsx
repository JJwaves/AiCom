"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The three explicit admin actions (Session 13 spec §11, §47, §54).
 *
 * Every Google Ads API call and every AI token this session can spend starts
 * with one of these buttons. Nothing here runs on page load, on a timer, or
 * as a side effect of anything else — and none of them can change anything
 * inside Google Ads.
 */

type Json = Record<string, unknown>;

async function post(url: string, body: Json): Promise<{ status: number; data: Json }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Json;
  return { status: res.status, data };
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

export function GoogleAdsControls({ periodDays, agentEnabled }: { periodDays: number; agentEnabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"test" | "sync" | "review" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const testConnection = async () => {
    setBusy("test");
    setMessage(null);
    try {
      const { status, data } = await post("/api/admin/google-ads/test-connection", {});
      if (status === 404) setMessage("The Google Ads surface is disabled (GOOGLE_ADS_INTELLIGENCE_ENABLED).");
      else if (data.ok === true) {
        setMessage(
          `Connected to ${str(data.descriptiveName) ?? "account"} ${str(data.customerId)} — reporting in ${str(data.currencyCode)}, ${str(data.timeZone)} time, API ${str(data.apiVersion)}.` +
            (data.isTestAccount === true ? " This is a TEST account: it serves no real ads, so any figures are structural." : ""),
        );
      } else if (str(data.code) === "NOT_CONFIGURED") {
        const missing = Array.isArray(data.missing) ? (data.missing as string[]) : [];
        setMessage(
          `Not connected. Missing server configuration: ${missing.join(", ") || "(see .env.example)"}. This is not zero spend — the platform simply cannot see your advertising.`,
        );
      } else {
        setMessage(`${str(data.code) ?? "Failed"} — ${str(data.explanation) ?? str(data.message) ?? "see server logs"}`);
      }
      router.refresh();
    } catch {
      setMessage("Failed (network error).");
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    setMessage(null);
    try {
      const { status, data } = await post("/api/admin/google-ads/sync", {});
      if (status === 404) setMessage("The Google Ads surface is disabled (GOOGLE_ADS_INTELLIGENCE_ENABLED).");
      else if (data.ok === true) {
        const parts = [
          `${str(data.startDate)} → ${str(data.endDate)}`,
          `${num(data.rowsFetched)} rows fetched`,
          `${num(data.rowsInserted)} new day(s)`,
          `${num(data.rowsUpdated)} day(s) restated by Google`,
        ];
        if (data.truncated === true) parts.push("INCOMPLETE — the row cap was reached, so this window understates spend");
        setMessage(parts.join(" · "));
      } else if (str(data.code) === "NOT_CONNECTED") {
        setMessage(str(data.reason) ?? "Google Ads is not connected.");
      } else {
        setMessage(
          `Sync failed: ${str(data.code)} — ${str(data.explanation) ?? str(data.message) ?? "see server logs"}. Previously synced data is unchanged.`,
        );
      }
      router.refresh();
    } catch {
      setMessage("Failed (network error).");
    } finally {
      setBusy(null);
    }
  };

  const review = async () => {
    setBusy("review");
    setMessage(null);
    try {
      const { status, data } = await post("/api/admin/google-ads/ads-review", { periodDays });
      if (status === 503) {
        setMessage(
          `The Google Ads agent is unavailable (${str(data.reason) ?? "AI error"}). Every number on this page is unaffected — they are computed without AI.`,
        );
      } else if (data.ok !== true) {
        setMessage(`Failed (${str(data.code) ?? status}).`);
      } else {
        const parts = [`${num(data.created)} new review item(s)`];
        if (num(data.updated)) parts.push(`${num(data.updated)} refreshed`);
        if (num(data.skippedReviewed)) parts.push(`${num(data.skippedReviewed)} already decided by you`);
        if (num(data.droppedInvalid)) parts.push(`${num(data.droppedInvalid)} dropped by validation`);
        if (num(data.droppedReferences)) parts.push(`${num(data.droppedReferences)} invented reference(s) removed`);
        parts.push("approve or dismiss them in the AI Action Center");
        setMessage(parts.join(" · "));
        router.refresh();
      }
    } catch {
      setMessage("Failed (network error).");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={testConnection} disabled={busy !== null}>
          {busy === "test" ? "Testing…" : "Test connection"}
        </button>
        <button type="button" className="btn btn--primary" onClick={sync} disabled={busy !== null}>
          {busy === "sync" ? "Syncing…" : "Sync Google Ads"}
        </button>
        {agentEnabled ? (
          <button type="button" className="btn" onClick={review} disabled={busy !== null}>
            {busy === "review" ? "Analyzing…" : "Generate Google Ads review"}
          </button>
        ) : null}
      </div>
      <p className="text-xs text-ink-3">
        These buttons only READ from Google Ads. Nothing in this platform can change a budget, pause a campaign, change
        a bid, or upload a conversion.
      </p>
      {message ? (
        <p role="status" className="text-sm text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
