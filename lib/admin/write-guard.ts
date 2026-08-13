import { adminIdentity, checkAdminAuth } from "./auth";

/**
 * Admin mutation guard (Session 10 spec §26).
 *
 * HTTP Basic credentials are sent by the browser AUTOMATICALLY on any
 * request to the origin — including one triggered by an attacker's page. So
 * for state-changing admin routes, authentication alone is not enough: a
 * cross-site form/fetch would carry valid credentials.
 *
 * Every admin write therefore has to pass all of:
 *   1. POST (never GET — no state change behind a link or an <img>)
 *   2. authenticated admin (unconfigured ⇒ 404, wrong ⇒ 401)
 *   3. same-origin Origin/Referer (a cross-site page cannot forge these,
 *      and a simple form post cannot omit them)
 *   4. `content-type: application/json` (blocks HTML form posts entirely,
 *      which cannot set this content type)
 * The route then applies its own strict zod schema on the body.
 *
 * This is a deliberate, testable set of controls — not a claim of full
 * security compliance. Basic auth over HTTPS with one shared operator
 * credential remains the documented posture (LAUNCH_CHECKLIST).
 */

export type WriteGuardResult =
  | { ok: true; admin: string }
  | { ok: false; status: 404 | 401 | 403 | 415; code: string };

const MAX_BODY_BYTES = 16_000;

export function guardAdminWrite(req: Request): WriteGuardResult {
  if (req.method !== "POST") return { ok: false, status: 403, code: "METHOD_NOT_ALLOWED" };

  const auth = checkAdminAuth(req.headers.get("authorization"));
  if (auth === "not_configured") return { ok: false, status: 404, code: "NOT_FOUND" };
  if (auth === "unauthorized") return { ok: false, status: 401, code: "UNAUTHORIZED" };

  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return { ok: false, status: 415, code: "UNSUPPORTED_MEDIA_TYPE" };

  if (!isSameOrigin(req)) return { ok: false, status: 403, code: "CROSS_ORIGIN_BLOCKED" };

  const admin = adminIdentity(req.headers.get("authorization"));
  if (!admin) return { ok: false, status: 401, code: "UNAUTHORIZED" };
  return { ok: true, admin };
}

/**
 * Origin must be present AND match the request's own host. An absent Origin
 * on a state-changing request is treated as hostile: modern browsers always
 * send it for fetch/XHR and for cross-site form posts.
 */
export function isSameOrigin(req: Request): boolean {
  const target = safeOrigin(req.url);
  if (!target) return false;
  const origin = req.headers.get("origin");
  if (origin) return safeOrigin(origin) === target;
  const referer = req.headers.get("referer");
  if (referer) return safeOrigin(referer) === target;
  return false;
}

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Read a bounded JSON body. Oversize ⇒ 413, unparseable ⇒ 400. */
export async function readJsonBody(
  req: Request,
  maxBytes = MAX_BODY_BYTES,
): Promise<{ ok: true; body: unknown } | { ok: false; status: 413 | 400; code: string }> {
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, status: 400, code: "BAD_REQUEST" };
  }
  if (raw.length > maxBytes) return { ok: false, status: 413, code: "TOO_LARGE" };
  if (raw.trim().length === 0) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400, code: "BAD_REQUEST" };
  }
}
