/**
 * Artwork upload allowances (Production Launch Session 03 §19).
 *
 * These bound how much object storage ONE anonymous session can create in
 * the owner's bucket. They are deliberately generous, because the failure
 * mode of a tight limit is worse than the failure mode of a loose one: a
 * blocked customer is a lost order, while an over-uploading one costs
 * fractions of a cent per file.
 *
 * The number is sized from real B2B behaviour: a multi-line order with a
 * logo per line, plus re-exports at different resolutions, plus a few failed
 * attempts. Twenty-five files in a rolling day is several times that.
 *
 * OWNER-CONFIGURABLE without a code change, because the right value depends
 * on the actual customer mix, which nobody knows before launch:
 *   ARTWORK_MAX_UPLOADS_PER_SESSION   integer > 0
 *   ARTWORK_UPLOAD_WINDOW_HOURS       rolling window, hours
 */

const DEFAULT_MAX_UPLOADS_PER_SESSION = 25;
const DEFAULT_WINDOW_HOURS = 24;

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function artworkUploadAllowance(): { maxPerSession: number; windowHours: number } {
  return {
    maxPerSession: readPositiveInt("ARTWORK_MAX_UPLOADS_PER_SESSION", DEFAULT_MAX_UPLOADS_PER_SESSION),
    windowHours: readPositiveInt("ARTWORK_UPLOAD_WINDOW_HOURS", DEFAULT_WINDOW_HOURS),
  };
}
