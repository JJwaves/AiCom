import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ARTWORK_CONTENT_TYPES,
  ARTWORK_MAX_BYTES,
  artworkExtension,
  safeArtworkFileName,
  validateArtworkFile,
} from "@/lib/validation/artwork";
import { artworkUploadAllowance } from "@/config/artwork";
import { countArtworkForSession, createPendingArtwork } from "@/lib/data/artwork-service";
import { newId } from "@/lib/data/id";
import { sessionFromRequest, setSessionCookies } from "@/lib/data/request-session";
import { captureException } from "@/lib/observability/error-tracking";
import { correlationIdFrom } from "@/lib/observability/correlation";
import { logWarn } from "@/lib/observability/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitedResponse } from "@/lib/rate-limit/http";
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
 *
 * Production Launch Session 03 adds two PRE-upload protections (§18, §19),
 * because everything Session 02 built was a check performed AFTER the caller
 * had already consumed storage:
 *   - the signature now covers CONTENT-LENGTH as well as key and content
 *     type, so a URL issued for a 40 KB logo cannot upload 25 MB;
 *   - a per-session ALLOWANCE bounds how many objects one anonymous session
 *     can create at all (config/artwork.ts), which rate limiting alone does
 *     not: a limiter bounds the RATE, not the TOTAL.
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

export async function POST(req: Request) {
  const correlationId = correlationIdFrom(req);

  const networkLimit = await enforceRateLimit({ route: "artwork_upload", req, scopes: ["network"] });
  if (!networkLimit.allowed) return rateLimitedResponse(networkLimit);

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

  const sessionLimit = await enforceRateLimit({
    route: "artwork_upload",
    req,
    sessionId: sessionCtx.session.id,
    scopes: ["session"],
  });
  if (!sessionLimit.allowed) return rateLimitedResponse(sessionLimit);

  // Total allowance, not rate: a patient script kept under every per-minute
  // limit could still create unbounded objects over a day.
  const allowance = artworkUploadAllowance();
  const since = new Date(Date.now() - allowance.windowHours * 60 * 60 * 1000);
  const used = await countArtworkForSession(sessionCtx.session.id, since).catch((err) => {
    // A counting failure must not silently disable the allowance, and must
    // not block a paying customer either. It is logged and treated as
    // "unknown", with the rate limiter and the storage bucket's own policy
    // still in force.
    logWarn({
      subsystem: "artwork",
      event: "upload_allowance_check_failed",
      correlationId,
      code: "ALLOWANCE_CHECK_FAILED",
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  });
  if (used >= allowance.maxPerSession) {
    logWarn({
      subsystem: "artwork",
      event: "upload_allowance_exhausted",
      correlationId,
      code: "UPLOAD_ALLOWANCE_EXCEEDED",
      used,
      maxPerSession: allowance.maxPerSession,
      windowHours: allowance.windowHours,
    });
    return NextResponse.json(
      {
        ok: false,
        code: "UPLOAD_LIMIT_REACHED",
        error:
          "You've uploaded a lot of files from this browser today. Contact us and we'll take the rest of your artwork by email.",
      },
      { status: 429 },
    );
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
      storage.createUploadUrl({ key, contentType: storedContentType, contentLength: parsed.data.fileSizeBytes }),
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
    captureException(err, {
      subsystem: "artwork",
      event: "upload_preparation_failed",
      correlationId,
      code: "STORAGE_ERROR",
    });
    return NextResponse.json(
      { ok: false, code: "STORAGE_ERROR", error: "We couldn't start that upload. Try again in a moment." },
      { status: 502 },
    );
  }
}
