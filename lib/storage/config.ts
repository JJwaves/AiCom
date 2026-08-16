/**
 * Artwork object-storage configuration (Production Launch Session 02 §22).
 *
 * ONE backend: S3-compatible. That single choice covers AWS S3, Cloudflare
 * R2, Backblaze B2, DigitalOcean Spaces and MinIO without a provider
 * abstraction, an SDK, or a dependency — the signing is ~80 lines of
 * `node:crypto` in ./s3.ts. Building a generic storage abstraction for one
 * backend would be exactly the over-engineering CLAUDE.md forbids.
 *
 * Every value is server-only. There is no NEXT_PUBLIC storage variable: the
 * browser never learns the bucket, the endpoint or a key. It receives one
 * short-lived signed URL for one server-chosen object key.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/storage/config is server-only — never import it from client components");
}

export class ArtworkStorageConfigurationError extends Error {
  readonly code = "ARTWORK_STORAGE_NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "ArtworkStorageConfigurationError";
  }
}

export type S3StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style addressing (MinIO, some R2 setups). Default: virtual-host style. */
  forcePathStyle: boolean;
};

const REQUIRED = [
  "ARTWORK_S3_ENDPOINT",
  "ARTWORK_S3_REGION",
  "ARTWORK_S3_BUCKET",
  "ARTWORK_S3_ACCESS_KEY_ID",
  "ARTWORK_S3_SECRET_ACCESS_KEY",
] as const;

function readEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve storage configuration, or null when NOTHING is configured.
 *
 * PARTIAL configuration throws in every environment, for the same reason
 * partial Shopify configuration does: half-set credentials always mean the
 * backend was intended, and a silent "no storage" would let the UI keep
 * pretending an upload succeeded (§22).
 */
export function resolveArtworkStorageConfig(): S3StorageConfig | null {
  const present = REQUIRED.filter((name) => readEnv(name) !== null);
  const missing = REQUIRED.filter((name) => readEnv(name) === null);

  if (present.length === 0) return null;
  if (missing.length > 0) {
    throw new ArtworkStorageConfigurationError(
      `[artwork-storage] Object storage is PARTIALLY configured: ${present.join(", ")} set, ${missing.join(", ")} missing. ` +
        "Refusing to run with an unusable storage backend — an artwork upload that appears to succeed but stores nothing " +
        "means a paid order the factory cannot print. " +
        `Fix: set ${missing.join(" and ")}, or unset every ARTWORK_S3_* variable to disable artwork upload entirely.`,
    );
  }

  const endpoint = readEnv("ARTWORK_S3_ENDPOINT") as string;
  if (!/^https:\/\/[^/\s]+\/?$/.test(endpoint)) {
    throw new ArtworkStorageConfigurationError(
      "[artwork-storage] ARTWORK_S3_ENDPOINT must be an https origin with no path, " +
        'e.g. "https://<account>.r2.cloudflarestorage.com" or "https://s3.us-east-1.amazonaws.com".',
    );
  }

  return {
    endpoint: endpoint.replace(/\/$/, ""),
    region: readEnv("ARTWORK_S3_REGION") as string,
    bucket: readEnv("ARTWORK_S3_BUCKET") as string,
    accessKeyId: readEnv("ARTWORK_S3_ACCESS_KEY_ID") as string,
    secretAccessKey: readEnv("ARTWORK_S3_SECRET_ACCESS_KEY") as string,
    forcePathStyle: readEnv("ARTWORK_S3_FORCE_PATH_STYLE") === "true",
  };
}

/** Non-throwing readiness view for diagnostics. Reports WHICH variables are missing — never values. */
export function describeArtworkStorageReadiness(): {
  configured: boolean;
  provider: "s3" | null;
  missingEnv: string[];
  error: string | null;
} {
  const missingEnv = REQUIRED.filter((name) => readEnv(name) === null);
  try {
    const config = resolveArtworkStorageConfig();
    return { configured: config !== null, provider: config ? "s3" : null, missingEnv, error: null };
  } catch (err) {
    return {
      configured: false,
      provider: null,
      missingEnv,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
