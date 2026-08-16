import { validateArtworkFile } from "@/lib/validation/artwork";
import type { ArtworkRef } from "@/types/commerce";

/**
 * Browser upload flow (Production Launch Session 02 §23).
 *
 *   1. ask the server for a signed upload  → it validates and chooses the key
 *   2. PUT the bytes straight to storage   → never through our server
 *   3. ask the server to confirm           → it verifies the stored object
 *
 * Only step 3's response becomes an ArtworkRef. Nothing here mints a
 * reference the server has not verified, and no `blob:` URL is produced,
 * stored, or handed to the cart: an object URL dies with the tab, and a
 * printed order needs artwork that outlives the browser.
 */

export type ArtworkUploadResult =
  | { ok: true; artwork: ArtworkRef }
  | { ok: false; reason: string };

type UploadTicket = {
  ok: true;
  artworkId: string;
  fileName: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresInSeconds: number };
};

const GENERIC_FAILURE = "We couldn't upload that file. Check your connection and try again.";

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return typeof data.error === "string" && data.error.length > 0 ? data.error : GENERIC_FAILURE;
  } catch {
    return GENERIC_FAILURE;
  }
}

export async function uploadArtwork(file: File): Promise<ArtworkUploadResult> {
  // Client-side gate for fast feedback. The server re-validates everything.
  const local = validateArtworkFile(file);
  if (!local.ok) return { ok: false, reason: local.reason };

  let ticket: UploadTicket;
  try {
    const res = await fetch("/api/artwork/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSizeBytes: file.size }),
    });
    if (!res.ok) return { ok: false, reason: await readError(res) };
    ticket = (await res.json()) as UploadTicket;
  } catch {
    return { ok: false, reason: GENERIC_FAILURE };
  }

  try {
    const put = await fetch(ticket.upload.url, {
      method: ticket.upload.method,
      // Sent verbatim — these headers are part of the signature.
      headers: ticket.upload.headers,
      body: file,
    });
    if (!put.ok) return { ok: false, reason: GENERIC_FAILURE };
  } catch {
    return { ok: false, reason: GENERIC_FAILURE };
  }

  try {
    const res = await fetch(`/api/artwork/${encodeURIComponent(ticket.artworkId)}/complete`, { method: "POST" });
    if (!res.ok) return { ok: false, reason: await readError(res) };
    const data = (await res.json()) as {
      ok: true;
      artwork: { artworkId: string; fileName: string; fileType: string; fileSizeBytes: number };
    };
    return { ok: true, artwork: data.artwork };
  } catch {
    return { ok: false, reason: GENERIC_FAILURE };
  }
}
