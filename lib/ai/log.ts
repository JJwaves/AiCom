import { createHash } from "node:crypto";

/**
 * Structured server-side AI observability — one JSON line per event with an
 * `[ai]` prefix, greppable and machine-parseable.
 *
 * NEVER log: API keys, prompt/message bodies, tool arguments (PII), or cost
 * config. Tool inputs are referenced by sha256 hash only (audit correlation
 * without content). Events: provider_request, provider_error, budget_rejected,
 * tool_call, invalid_structured_output, usage_record_failed.
 */

type AiLogFields = Record<string, string | number | boolean | null | undefined>;

export function aiLog(event: string, fields: AiLogFields = {}): void {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) clean[k] = v;
  }
  const line = JSON.stringify({ event, ...clean, at: new Date().toISOString() });
  if (event.includes("error") || event.includes("failed") || event.includes("rejected")) {
    console.error(`[ai] ${line}`);
  } else {
    console.log(`[ai] ${line}`);
  }
}

/** Short stable content hash for audit logs — never the content itself. */
export function auditHash(value: unknown): string {
  try {
    return createHash("sha256").update(JSON.stringify(value) ?? "undefined").digest("hex").slice(0, 16);
  } catch {
    return "unhashable";
  }
}
