import { NextResponse } from "next/server";
import { getArtworkForSession, markArtworkStatus, markArtworkUploaded } from "@/lib/data/artwork-service";
import { sessionFromRequest, setSessionCookies } from "@/lib/data/request-session";
import { getArtworkStorage } from "@/lib/storage/artwork-storage";
import { ARTWORK_MAGIC_PREFIX_BYTES, ARTWORK_MAX_BYTES, verifyArtworkContent } from "@/lib/validation/artwork";

/**
 * Confirm an upload — the point at which artwork becomes REAL
 * (Production Launch Session 02 §23, §24).
 *
 * The browser telling us "I uploaded it" proves nothing, so this route asks
 * the storage backend directly:
 *   1. does the object exist?
 *   2. is it within the size limit, and non-empty?
 *   3. do its FIRST BYTES match the format its extension claims?
 *
 * Only then does the row become `uploaded` and usable by cart and checkout.
 * A file that fails verification is deleted from storage and its row marked
 * `rejected` — an unusable object never lingers as if it were artwork.
 */

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const req = _req;
  const { id } = await ctx.params;

  const sessionCtx = await sessionFromRequest(req);
  if (!sessionCtx) {
    return NextResponse.json({ ok: false, code: "UNAVAILABLE", error: "Try again in a moment." }, { status: 503 });
  }

  // Session-scoped: one browser cannot confirm (or discover) another's artwork.
  const artwork = await getArtworkForSession(id, sessionCtx.session.id);
  if (!artwork || !artwork.storageKey) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND", error: "Unknown upload." }, { status: 404 });
  }

  // Idempotent: a retried confirmation returns the same reference.
  if (artwork.status !== "pending_upload") {
    const res = NextResponse.json({
      ok: true,
      artwork: {
        artworkId: artwork.id,
        fileName: artwork.fileName,
        fileType: artwork.fileType,
        fileSizeBytes: artwork.sizeBytes,
      },
    });
    setSessionCookies(res, sessionCtx.session);
    return res;
  }

  const storage = getArtworkStorage();
  if (!storage) {
    return NextResponse.json(
      { ok: false, code: "STORAGE_NOT_CONFIGURED", error: "Logo uploads aren't available right now." },
      { status: 503 },
    );
  }

  try {
    const stored = await storage.head(artwork.storageKey);
    if (!stored) {
      return NextResponse.json(
        { ok: false, code: "NOT_UPLOADED", error: "We didn't receive that file. Try uploading it again." },
        { status: 409 },
      );
    }
    if (stored.contentLength === 0 || stored.contentLength > ARTWORK_MAX_BYTES) {
      await reject(storage, artwork.storageKey, artwork.id);
      return NextResponse.json(
        {
          ok: false,
          code: "REJECTED",
          error:
            stored.contentLength === 0
              ? "That file arrived empty — try exporting it again."
              : "File is over 25 MB. Compress it or email it to us after ordering.",
        },
        { status: 422 },
      );
    }

    const prefix = await storage.readPrefix(artwork.storageKey, ARTWORK_MAGIC_PREFIX_BYTES);
    const contentCheck = prefix
      ? verifyArtworkContent({ fileName: artwork.fileName, prefix })
      : ({ ok: false, reason: "We couldn't read that file. Try uploading it again." } as const);
    if (!contentCheck.ok) {
      await reject(storage, artwork.storageKey, artwork.id);
      return NextResponse.json({ ok: false, code: "REJECTED", error: contentCheck.reason }, { status: 422 });
    }

    const updated = await markArtworkUploaded({
      id: artwork.id,
      sizeBytes: stored.contentLength,
      fileType: artwork.fileType,
    });

    const res = NextResponse.json({
      ok: true,
      artwork: {
        artworkId: artwork.id,
        fileName: artwork.fileName,
        fileType: artwork.fileType,
        fileSizeBytes: updated?.sizeBytes ?? stored.contentLength,
      },
    });
    setSessionCookies(res, sessionCtx.session);
    return res;
  } catch (err) {
    console.error(`[artwork] verification failed for ${artwork.id}`, err);
    return NextResponse.json(
      { ok: false, code: "STORAGE_ERROR", error: "We couldn't confirm that upload. Try again in a moment." },
      { status: 502 },
    );
  }
}

async function reject(
  storage: { delete(key: string): Promise<void> },
  key: string,
  artworkId: string,
): Promise<void> {
  await storage.delete(key).catch((err) => console.error(`[artwork] failed to delete rejected object ${key}`, err));
  await markArtworkStatus(artworkId, "rejected").catch((err) =>
    console.error(`[artwork] failed to mark ${artworkId} rejected`, err),
  );
}
