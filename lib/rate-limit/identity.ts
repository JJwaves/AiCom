import { createHmac, randomBytes } from "node:crypto";

/**
 * Caller identity for rate limiting (Production Launch Session 03 §13).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TWO SCOPES, NEITHER SUFFICIENT ALONE
 * ─────────────────────────────────────────────────────────────────────────
 * SESSION  — the httpOnly first-party session cookie. Precise, and it is what
 *            makes a limit felt by one abusive visitor rather than by a whole
 *            office behind one NAT. But the client controls whether it keeps
 *            a cookie: dropping it produces a fresh session every request.
 * NETWORK  — the caller's network identity, derived from the platform's
 *            forwarded-for header. Coarse (NAT, mobile carriers, corporate
 *            egress all share one), but a cookie-dropping script cannot
 *            escape it.
 *
 * So a policy sets BOTH, and the tightest verdict wins. A client-supplied
 * identifier is never the only thing a limit rests on.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PRIVACY: RAW IPs ARE NEVER PERSISTED
 * ─────────────────────────────────────────────────────────────────────────
 * An IP address is personal data in the jurisdictions BagDirect sells into.
 * Rate limiting does not need to KNOW the address — only to tell two callers
 * apart — so the address is reduced to a keyed HMAC-SHA256 the moment it is
 * read, and only that digest travels into a counter key, a log line or the
 * durable store. The raw value is never written anywhere.
 *
 * The key comes from RATE_LIMIT_IP_SALT when set. When it is NOT set, an
 * EPHEMERAL random key is generated per process, with two deliberate
 * consequences stated plainly rather than hidden:
 *   - digests are not comparable across instances or across a redeploy, so
 *     the NETWORK scope of the durable limiter degrades to per-instance;
 *   - and nothing persisted can be correlated back to a person even in
 *     principle, because the key that produced it no longer exists.
 * Production should set RATE_LIMIT_IP_SALT (a long random string, rotated
 * like any other secret). docs/OBSERVABILITY.md documents both modes.
 */

let ephemeralKey: Buffer | null = null;

function hashKey(): Buffer {
  const configured = process.env.RATE_LIMIT_IP_SALT;
  if (typeof configured === "string" && configured.trim().length > 0) return Buffer.from(configured.trim(), "utf8");
  if (!ephemeralKey) ephemeralKey = randomBytes(32);
  return ephemeralKey;
}

/** True when the salt is configured, i.e. digests survive a redeploy. Readiness surfaces this. */
export function hasStableNetworkKey(): boolean {
  const configured = process.env.RATE_LIMIT_IP_SALT;
  return typeof configured === "string" && configured.trim().length > 0;
}

/** Test seam — a new process would get a new ephemeral key anyway. */
export function __resetEphemeralNetworkKeyForTests(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__resetEphemeralNetworkKeyForTests is a test hook and cannot be used in production");
  }
  ephemeralKey = null;
}

/**
 * The raw network identity, as reported by the platform.
 *
 * `x-forwarded-for` is client-spoofable in general; on Vercel (and any proxy
 * that rewrites it) the FIRST hop is the one the platform observed, which is
 * why only that hop is read and why the value is bounded before use. A
 * spoofed value can only ever split an attacker's own bucket into more
 * buckets — it cannot borrow another caller's allowance, because the digest
 * space is opaque.
 */
function rawNetworkIdentity(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first && first.length > 0 && first.length <= 64) return first;
  const real = req.headers.get("x-real-ip")?.trim();
  if (real && real.length > 0 && real.length <= 64) return real;
  // Single-host development, or a platform that forwards nothing. One shared
  // bucket is correct here: there is only one caller path to distinguish.
  return "local";
}

/** The ONLY network identifier the rest of the system ever sees. */
export function networkKey(req: { headers: { get(name: string): string | null } }): string {
  return createHmac("sha256", hashKey()).update(rawNetworkIdentity(req)).digest("hex").slice(0, 32);
}
