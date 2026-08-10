/**
 * Prefixed opaque ids (`sess_…`, `conv_…`, `evt_…`) — 32 hex chars of
 * crypto-grade randomness (122 bits, unbiased) from the platform UUID
 * generator. Works in Node and the browser (clientEventId generation).
 */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}
