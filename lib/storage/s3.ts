import { createHash, createHmac } from "node:crypto";
import type { S3StorageConfig } from "./config";

/**
 * Minimal AWS Signature Version 4 for S3-compatible object storage.
 *
 * Query-string presigning only (plus signed HEAD/GET/DELETE that the server
 * performs itself). No SDK, no dependency: SigV4 is a well-specified
 * HMAC chain, and pulling in an AWS SDK to build four URLs would add tens of
 * megabytes to the deploy for no capability we need.
 *
 * Reference: AWS "Signing AWS requests with Signature Version 4",
 * query-parameter (presigned URL) variant.
 */

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

const sha256Hex = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const hmac = (key: Uint8Array | string, value: string): Buffer => createHmac("sha256", key).update(value).digest();

/** RFC 3986 encoding. S3 requires `/` preserved in the canonical URI but escaped elsewhere. */
function uriEncode(value: string, preserveSlash: boolean): string {
  let out = "";
  for (const char of value) {
    if (/[A-Za-z0-9\-._~]/.test(char)) out += char;
    else if (char === "/" && preserveSlash) out += "/";
    else {
      for (const byte of Buffer.from(char, "utf8")) out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

function amzDate(now: Date): { full: string; short: string } {
  const full = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { full, short: full.slice(0, 8) };
}

function signingKey(config: S3StorageConfig, dateStamp: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), SERVICE), "aws4_request");
}

/** Host + canonical path for the object, honouring virtual-host vs path style. */
function addressing(config: S3StorageConfig, key: string): { host: string; canonicalUri: string; origin: string } {
  const endpointHost = config.endpoint.replace(/^https:\/\//, "");
  const encodedKey = uriEncode(key, true);
  if (config.forcePathStyle) {
    return {
      host: endpointHost,
      canonicalUri: `/${uriEncode(config.bucket, false)}/${encodedKey}`,
      origin: config.endpoint,
    };
  }
  const host = `${config.bucket}.${endpointHost}`;
  return { host, canonicalUri: `/${encodedKey}`, origin: `https://${host}` };
}

export type PresignOptions = {
  method: "PUT" | "GET" | "HEAD" | "DELETE";
  key: string;
  expiresInSeconds: number;
  /** Additional headers to SIGN. The caller must then send them verbatim. */
  signedHeaders?: Record<string, string>;
  /** Response-header overrides (GET only), e.g. content-disposition. */
  query?: Record<string, string>;
  now?: Date;
};

/**
 * Build a presigned URL.
 *
 * `signedHeaders` become part of the signature: a browser that changes one
 * (say, to claim a different Content-Type) invalidates the URL. That is how
 * the SERVER — not the browser — decides what content type an object is
 * stored with.
 */
export function presignS3Url(config: S3StorageConfig, options: PresignOptions): string {
  const now = options.now ?? new Date();
  const { full, short } = amzDate(now);
  const { host, canonicalUri, origin } = addressing(config, options.key);

  const headers: Record<string, string> = { host, ...(options.signedHeaders ?? {}) };
  const headerNames = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const canonicalHeaders = headerNames
    .map((name) => {
      const original = Object.keys(headers).find((h) => h.toLowerCase() === name) as string;
      return `${name}:${String(headers[original]).trim().replace(/\s+/g, " ")}\n`;
    })
    .join("");
  const signedHeaderList = headerNames.join(";");

  const credential = `${config.accessKeyId}/${short}/${config.region}/${SERVICE}/aws4_request`;
  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": credential,
    "X-Amz-Date": full,
    "X-Amz-Expires": String(options.expiresInSeconds),
    "X-Amz-SignedHeaders": signedHeaderList,
    ...(options.query ?? {}),
  };

  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${uriEncode(k, false)}=${uriEncode(queryParams[k], false)}`)
    .join("&");

  const canonicalRequest = [
    options.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderList,
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const stringToSign = [
    ALGORITHM,
    full,
    `${short}/${config.region}/${SERVICE}/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = hmac(signingKey(config, short), stringToSign).toString("hex");
  return `${origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
