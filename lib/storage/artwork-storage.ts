import { resolveArtworkStorageConfig, ArtworkStorageConfigurationError, type S3StorageConfig } from "./config";
import { presignS3Url } from "./s3";

/**
 * Artwork object storage (Production Launch Session 02 §21–§26).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE BROWSER UPLOADS DIRECTLY
 * ─────────────────────────────────────────────────────────────────────────
 * Artwork is up to 25 MB. Routing it through a Next.js route handler would
 * hit serverless request-body limits (4.5 MB on Vercel) and burn function
 * time proportional to file size. The server instead validates the REQUEST,
 * chooses the object key, and issues a short-lived signed PUT; the bytes go
 * browser → storage.
 *
 * The server keeps authority over everything that matters:
 *   - the object KEY is server-derived (§58: never client-authoritative)
 *   - the Content-Type is SIGNED, so the browser cannot store a file as
 *     something else without invalidating the URL
 *   - the upload is not TRUSTED until the server independently verifies the
 *     stored object's size and leading bytes (see verifyStoredArtwork)
 *   - objects are PRIVATE; reads happen only through short-lived signed URLs
 *     minted server-side, so artwork is never publicly enumerable (§26)
 */

if (typeof window !== "undefined") {
  throw new Error("lib/storage/artwork-storage is server-only — never import it from client components");
}

export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 10 * 60;

export type SignedUpload = {
  url: string;
  method: "PUT";
  /** Headers the browser MUST send verbatim — they are part of the signature. */
  headers: Record<string, string>;
  expiresInSeconds: number;
};

export type StoredObject = { contentLength: number; contentType: string | null };

/**
 * The storage port. Tests inject a fake; nothing in the test suite ever
 * reaches the network (§56).
 */
export interface ArtworkStorage {
  readonly provider: string;
  createUploadUrl(input: { key: string; contentType: string }): Promise<SignedUpload>;
  /** Object metadata, or null when the object does not exist. */
  head(key: string): Promise<StoredObject | null>;
  /** First `length` bytes — used for server-side magic-number verification. */
  readPrefix(key: string, length: number): Promise<Uint8Array | null>;
  createDownloadUrl(input: { key: string; fileName?: string }): Promise<string>;
  delete(key: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Live S3-compatible implementation                                   */
/* ------------------------------------------------------------------ */

export function createS3ArtworkStorage(config: S3StorageConfig): ArtworkStorage {
  return {
    provider: "s3",

    async createUploadUrl({ key, contentType }): Promise<SignedUpload> {
      const url = presignS3Url(config, {
        method: "PUT",
        key,
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
        // Signing content-type pins what the object is stored as.
        signedHeaders: { "content-type": contentType },
      });
      return { url, method: "PUT", headers: { "Content-Type": contentType }, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
    },

    async head(key): Promise<StoredObject | null> {
      const url = presignS3Url(config, { method: "HEAD", key, expiresInSeconds: 60 });
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`[artwork-storage] HEAD failed with ${res.status}`);
      const length = Number(res.headers.get("content-length") ?? "");
      return {
        contentLength: Number.isFinite(length) ? length : 0,
        contentType: res.headers.get("content-type"),
      };
    },

    async readPrefix(key, length): Promise<Uint8Array | null> {
      const url = presignS3Url(config, { method: "GET", key, expiresInSeconds: 60 });
      const res = await fetch(url, { method: "GET", headers: { Range: `bytes=0-${length - 1}` }, cache: "no-store" });
      if (res.status === 404) return null;
      if (!res.ok && res.status !== 206) throw new Error(`[artwork-storage] ranged GET failed with ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async createDownloadUrl({ key, fileName }): Promise<string> {
      return presignS3Url(config, {
        method: "GET",
        key,
        expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
        query: fileName
          ? { "response-content-disposition": `attachment; filename="${fileName.replace(/["\\]/g, "")}"` }
          : undefined,
      });
    },

    async delete(key): Promise<void> {
      const url = presignS3Url(config, { method: "DELETE", key, expiresInSeconds: 60 });
      const res = await fetch(url, { method: "DELETE", cache: "no-store" });
      if (!res.ok && res.status !== 204 && res.status !== 404) {
        throw new Error(`[artwork-storage] DELETE failed with ${res.status}`);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Resolution — injectable, fail-closed                                */
/* ------------------------------------------------------------------ */

let override: ArtworkStorage | null = null;

/** Test seam. Production code never calls this. */
export function setArtworkStorageForTests(storage: ArtworkStorage | null): void {
  override = storage;
}

/**
 * The configured storage, or null when artwork upload is not configured.
 * Callers that REQUIRE storage must use `requireArtworkStorage()` — a null
 * here is never allowed to become "pretend the upload worked" (§22).
 */
export function getArtworkStorage(): ArtworkStorage | null {
  if (override) return override;
  const config = resolveArtworkStorageConfig();
  return config ? createS3ArtworkStorage(config) : null;
}

export function requireArtworkStorage(): ArtworkStorage {
  const storage = getArtworkStorage();
  if (storage) return storage;
  throw new ArtworkStorageConfigurationError(
    "[artwork-storage] Artwork upload was requested but no object storage is configured. " +
      "Refusing to accept a file that would go nowhere: a printed product needs artwork that survives the browser tab. " +
      "Fix: set ARTWORK_S3_ENDPOINT, ARTWORK_S3_REGION, ARTWORK_S3_BUCKET, ARTWORK_S3_ACCESS_KEY_ID and " +
      "ARTWORK_S3_SECRET_ACCESS_KEY — see docs/ARTWORK_STORAGE.md.",
  );
}

export { ArtworkStorageConfigurationError };
