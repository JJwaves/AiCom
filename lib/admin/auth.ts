/**
 * Admin authentication (Session 08 — the first admin surface).
 *
 * Decision (docs/ARCHITECTURE.md decision log): HTTP Basic auth from env
 * (`ADMIN_USER` + `ADMIN_PASSWORD`), enforced in proxy.ts for the browser
 * challenge AND re-checked inside every /admin page and /api/admin route
 * (defense in depth; route handlers stay directly testable). FAIL CLOSED:
 * when the env vars are unset the admin surface answers 404 — it simply
 * does not exist, in dev, prod, and tests alike.
 *
 * This file must stay edge-safe (proxy runs on the edge runtime): no
 * node: imports, no DB, no lib/data. Credential comparison is
 * constant-time over the combined credential string.
 */

export type AdminAuthResult = "authorized" | "unauthorized" | "not_configured";

/** Constant-time string equality (length differences still return false). */
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function checkAdminAuth(
  authorizationHeader: string | null,
  env: Record<string, string | undefined> = process.env,
): AdminAuthResult {
  const user = env.ADMIN_USER;
  const password = env.ADMIN_PASSWORD;
  if (!user || !password) return "not_configured";
  if (!authorizationHeader || !authorizationHeader.startsWith("Basic ")) return "unauthorized";
  let decoded: string;
  try {
    decoded = atob(authorizationHeader.slice("Basic ".length).trim());
  } catch {
    return "unauthorized";
  }
  return timingSafeEqual(decoded, `${user}:${password}`) ? "authorized" : "unauthorized";
}
