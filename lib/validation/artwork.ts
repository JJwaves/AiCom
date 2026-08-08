/**
 * Artwork upload validation. Client-side gate; the server endpoint
 * re-validates (never trust the browser).
 */

export const ARTWORK_ACCEPT = ".png,.jpg,.jpeg,.pdf,.svg,.ai,.eps";

export const ARTWORK_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "application/pdf",
  "image/svg+xml",
  "application/postscript", // .ai / .eps commonly report this
  "application/illustrator",
]);

const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "pdf", "svg", "ai", "eps"]);

export type ArtworkValidation = { ok: true } | { ok: false; reason: string };

export function validateArtworkFile(file: { name: string; type: string; size: number }): ArtworkValidation {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.has(ext)) {
    return { ok: false, reason: "Use PNG, JPG, PDF, SVG, AI or EPS files." };
  }
  // Some browsers report empty MIME for .ai/.eps — extension check covers those.
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    return { ok: false, reason: `File type "${file.type}" isn't supported. Use PNG, JPG, PDF, SVG, AI or EPS.` };
  }
  if (file.size > ARTWORK_MAX_BYTES) {
    return { ok: false, reason: "File is over 25 MB. Compress it or email it to us after ordering." };
  }
  if (file.size === 0) {
    return { ok: false, reason: "That file looks empty — try exporting it again." };
  }
  return { ok: true };
}
