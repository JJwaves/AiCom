import { z } from "zod";
import { AiError } from "../errors";

/**
 * Structured-output handling — AI-generated JSON is UNTRUSTED input.
 *
 *   LLM output → extract JSON text → JSON.parse → zod validation → caller
 *
 * Nothing reaches a service or the database without passing the caller's
 * zod schema; the retry policy (lib/ai/runtime.ts) is conservative and
 * bounded by AI_STRUCTURED_RETRY_LIMIT — never an uncontrolled loop.
 */

export type StructuredParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "unparsable_json" | "schema_mismatch"; issues: string };

/** Tolerates markdown fences / surrounding prose; the JSON payload itself must be exact. */
export function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced) return fenced[1].trim();
  const start = trimmed.search(/[[{]/);
  if (start > 0) {
    const openChar = trimmed[start];
    const closeChar = openChar === "{" ? "}" : "]";
    const end = trimmed.lastIndexOf(closeChar);
    if (end > start) return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

export function parseStructured<T>(raw: string, schema: z.ZodType<T>): StructuredParseResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(raw));
  } catch (err) {
    return { ok: false, reason: "unparsable_json", issues: err instanceof Error ? err.message : String(err) };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, reason: "schema_mismatch", issues };
  }
  return { ok: true, value: result.data };
}

/** Terminal failure after retries — one typed error for callers. */
export function invalidResponseError(reason: string, issues: string): AiError {
  return new AiError("AI_INVALID_RESPONSE", `structured output invalid (${reason}): ${issues}`, { detail: reason });
}

/**
 * Provider-facing JSON Schema from a zod schema, sanitized to the subset
 * structured-output APIs accept: numeric/string/array size constraints are
 * stripped (they 400 on Anthropic's json_schema format), objects get
 * additionalProperties:false, and only supported string formats survive.
 * The FULL zod schema still validates the response client-side, so stripped
 * constraints remain enforced — just by us instead of the provider.
 */
const UNSUPPORTED_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "propertyNames",
] as const;

const SUPPORTED_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

function sanitizeNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeNode);
  if (node === null || typeof node !== "object") return node;
  const obj = { ...(node as Record<string, unknown>) };
  for (const key of UNSUPPORTED_KEYWORDS) delete obj[key];
  if (typeof obj.format === "string" && !SUPPORTED_FORMATS.has(obj.format)) delete obj.format;
  if (obj.type === "object" || obj.properties !== undefined) obj.additionalProperties = false;
  for (const [key, value] of Object.entries(obj)) {
    if (key === "enum" || key === "const" || key === "required") continue;
    if (typeof value === "object" && value !== null) obj[key] = sanitizeNode(value);
  }
  return obj;
}

export function toProviderJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  delete (json as Record<string, unknown>).$schema;
  return sanitizeNode(json) as Record<string, unknown>;
}
