import { NextResponse, type NextRequest } from "next/server";
import { checkAdminAuth } from "@/lib/admin/auth";

/**
 * Admin gate (Session 08). Runs ONLY on /admin and /api/admin paths — the
 * storefront and every commerce/AI route are untouched by design.
 *
 * Fail-closed: without ADMIN_USER + ADMIN_PASSWORD configured, admin paths
 * are a plain 404 (the surface does not exist). With credentials
 * configured, the browser gets the standard Basic challenge. Pages and
 * API routes ALSO re-check auth themselves — this proxy is the challenge
 * surface, not the only lock (Next.js guidance: proxy is an optimistic
 * check, not the authorization system).
 */
export function proxy(req: NextRequest) {
  const result = checkAdminAuth(req.headers.get("authorization"));
  if (result === "authorized") return NextResponse.next();
  if (result === "not_configured") return new NextResponse("Not found", { status: 404 });
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="BagDirect Admin", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
