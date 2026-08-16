import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ARTWORK_CONTENT_TYPES,
  ARTWORK_MAX_BYTES,
  artworkExtension,
  safeArtworkFileName,
  validateArtworkFile,
} from "@/lib/validation/artwork";
import { createPendingArtwork } from "@/lib/data/artwork-service";
import { newId } from "@/lib/data/id";
import { sessionFromRequest, setSessionCookies } from "@/lib/data/request-session";
import { createRateLimiter } from "@/lib/rate-limit";
import { ArtworkStorageConfigurationError, requireArtworkStorage } from "@/lib/storage/artwork-storage";

/**
 * Issue a signed, single-object upload URL (Production Launch Session 02 §23).
 *
 * THE SERVER DECIDES EVERYTHING THAT MATTERS:
 *   - the artwork id, and therefore the object key (§58 — the client cannot
 *     name, guess, overwrite or traverse to another object)
 *   - the stored Content-Type, derived from the extension and then SIGNED
 *   - the size ceiling and the accepted formats
 *
 * The browser receives one URL for one key that expires in minutes. It never
 * learns the bucket credentials, and the row it creates is `pending_upload`:
 * unusable by commerce until POST /api/artwork/[id]/complete independently
 * verifies the stored bytes.
 */

export const runtime = "nodejs";

const bodySchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    fileType: z.string().trim().max(120).default(""),
    fileSizeBytes: z.number().int().positive().max(ARTWORK_MAX_BYTES),
  })
  .strict();

const MAX_BODY_BYTES = 4 * 1024;

/**
 * Abuse control scoped to THIS endpoint only (§50): a signed URL is a
 * capability, so minting them must be bounded. General API rate limiting
 * remains a Launch Session 03 item.
 */
const sessionLimiter = createRateLimiter({ capacity: 10, refillPerMinute: 10 });
const ipLimiter = createRateLimiter({ capacity: 30, refillPerMinute: 30 });

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ ok: false, code: "BAD_REQUEST", error: "Expected application/json" }, { status: 415 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, code: "TOO_LARGE", error: "Request too large" }, { status: 413 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_REQUEST", error: "Malformed JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "INVALID", error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // Server-side re-validation. The browser already checked, and the browser
  // is not trusted (§24).
  const check = validateArtworkFile({
    name: parsed.data.fileName,
    type: parsed.data.fileType,
    size: parsed.data.fileSizeBytes,
  });
  if (!check.ok) {
    return NextResponse.json({ ok: false, code: "REJECTED", error: check.reason }, { status: 422 });
  }

  const sessionCtx = await sessionFromRequest(req);
  if (!sessionCtx) {
    return NextResponse.json(
      { ok: false, code: "UNAVAILABLE", error: "Uploads are temporarily unavailable. Try again in a moment." },
      { status: 503 },
    );
  }

  for (const [limiter, key] of [
    [sessionLimiter, `s:${sessionCtx.session.id}`],
    [ipLimiter, `i:${clientIp(req)}`],
  ] as const) {
    const verdict = limiter.take(key);
    if (!verdict.allowed) {
      return NextResponse.json(
        { ok: false, code: "RATE_LIMITED", error: "Too many uploads. Wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } },
      );
    }
  }

  let storage;
  try {
    storage = requireArtworkStorage();
  } catch (err) {
    // Missing storage NEVER pretends to succeed (§22).
    console.error("[artwork] upload requested with storage unconfigured", err);
    const configuration = err instanceof ArtworkStorageConfigurationError;
    return NextResponse.json(
      {
        ok: false,
        code: configuration ? "STORAGE_NOT_CONFIGURED" : "STORAGE_ERROR",
        error: "Logo uploads aren't available right now. Choose “No logo” to continue, or contact us to send artwork.",
      },
      { status: 503 },
    );
  }

  const artworkId = newId("art");
  const fileName = safeArtworkFileName(parsed.data.fileName);
  const storedContentType = ARTWORK_CONTENT_TYPES[artworkExtension(fileName)];
  // Key shape: server-chosen prefix + the artwork id, so two customers
  // uploading "logo.png" can never collide or overwrite each other.
  const key = `artwork/${artworkId}/${fileName}`;

  try {
    const [upload] = await Promise.all([
      storage.createUploadUrl({ key, contentType: storedContentType }),
      createPendingArtwork({
        id: artworkId,
        sessionId: sessionCtx.session.id,
        customerId: sessionCtx.session.customerId ?? undefined,
        fileName,
        fileType: storedContentType,
        sizeBytes: parsed.data.fileSizeBytes,
        storageKey: key,
        storageProvider: storage.provider,
      }),
    ]);

    const res = NextResponse.json({
      ok: true,
      artworkId,
      fileName,
      upload: { url: upload.url, method: upload.method, headers: upload.headers, expiresInSeconds: upload.expiresInSeconds },
    });
    setSessionCookies(res, sessionCtx.session);
    return res;
  } catch (err) {
    console.error("[artwork] failed to prepare upload", err);
    return NextResponse.json(
      { ok: false, code: "STORAGE_ERROR", error: "We couldn't start that upload. Try again in a moment." },
      { status: 502 },
    );
  }
}
