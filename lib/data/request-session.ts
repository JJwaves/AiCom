import type { NextResponse } from "next/server";
import { ANONYMOUS_COOKIE, SESSION_COOKIE, ensureSession, type SessionRow } from "./session-service";

/**
 * Session plumbing for API routes. Reads bd_sid/bd_aid from the raw request
 * (no next/headers — handlers stay directly testable), ensures the DB row,
 * and re-sets rolling cookies on the response.
 */

const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365; // 1 year, rolling

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name) out[name] = part.slice(idx + 1).trim();
  }
  return out;
}

/** Ensure a session for this request. Returns null instead of throwing — callers treat persistence as non-fatal. */
export async function sessionFromRequest(req: Request): Promise<{ session: SessionRow; created: boolean } | null> {
  try {
    const cookies = parseCookies(req.headers.get("cookie"));
    return await ensureSession({
      sessionId: cookies[SESSION_COOKIE] ?? null,
      anonymousId: cookies[ANONYMOUS_COOKIE] ?? null,
      userAgent: req.headers.get("user-agent"),
    });
  } catch (err) {
    console.error("[data] session resolution failed (continuing without session)", err);
    return null;
  }
}

/** Refresh both identity cookies on a response (rolling expiry). */
export function setSessionCookies(res: NextResponse, session: SessionRow): void {
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_S,
  };
  res.cookies.set(SESSION_COOKIE, session.id, opts);
  res.cookies.set(ANONYMOUS_COOKIE, session.anonymousId, opts);
}
