import {
  DEFAULT_GOOGLE_ADS_API_VERSION,
  GOOGLE_ADS,
  GOOGLE_OAUTH_TOKEN_URL,
  SUPPORTED_API_VERSIONS,
  type GoogleAdsApiVersion,
} from "@/config/google-ads";
import { GoogleAdsError } from "./errors";
import { normalizeCustomerId } from "./types";

/**
 * Google Ads credentials and OAuth (Session 13 spec §5, §6, §49).
 *
 * SERVER ONLY. Every variable read here is a plain (non-`NEXT_PUBLIC_`) env
 * var, so the client bundle can never contain one. Credential VALUES never
 * appear in a return type, a log line, an error message, a persisted row, or
 * an AI prompt — the only thing that escapes this module is a bearer token
 * held in memory for the length of one request, plus the redacted metadata
 * in `GoogleAdsCredentialStatus`.
 *
 * Missing credentials are NOT an error (spec §6). `resolveCredentials()`
 * returns a NOT_CONFIGURED status; the storefront, AI Sales, checkout and
 * every other intelligence layer keep working, and the Google Ads surface
 * says so honestly instead of reporting $0 spend.
 */

export type GoogleAdsCredentials = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Digits-only customer id being reported on. */
  customerId: string;
  /** Manager (MCC) id sent as `login-customer-id`, when configured. */
  loginCustomerId: string | null;
  apiVersion: GoogleAdsApiVersion;
};

/**
 * What the rest of the system is allowed to know about the credentials.
 * Deliberately carries no secret material: `customerId` is an account
 * identifier the owner already sees in the Google Ads UI, and the flags are
 * booleans.
 */
export type GoogleAdsCredentialStatus =
  | {
      configured: true;
      customerId: string;
      loginCustomerId: string | null;
      apiVersion: GoogleAdsApiVersion;
    }
  | {
      configured: false;
      /** Which env vars are missing, BY NAME — never their values. */
      missing: string[];
      /** Set when the vars are present but a value is unusable. */
      invalid: string[];
    };

const REQUIRED_ENV = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
] as const;

/**
 * Resolve the configured API version.
 *
 * Fails LOUDLY on an unsupported value (spec §49). The alternative —
 * silently using the default — would mean a deploy that thinks it pinned
 * v24 is actually running v25 queries, which is precisely the class of
 * mistake a version pin exists to prevent.
 */
export function resolveApiVersion(env: NodeJS.ProcessEnv = process.env): GoogleAdsApiVersion {
  const raw = env.GOOGLE_ADS_API_VERSION?.trim();
  if (!raw) return DEFAULT_GOOGLE_ADS_API_VERSION as GoogleAdsApiVersion;
  if ((SUPPORTED_API_VERSIONS as readonly string[]).includes(raw)) return raw as GoogleAdsApiVersion;
  throw new GoogleAdsError(
    "API_VERSION_UNSUPPORTED",
    `GOOGLE_ADS_API_VERSION="${raw}" is not supported by this integration. Supported: ${SUPPORTED_API_VERSIONS.join(", ")}.`,
  );
}

/**
 * Read credentials from the environment.
 *
 * Returns `null` when the integration is simply not connected — the caller
 * turns that into NOT_CONNECTED, never into zero.
 */
export function resolveCredentials(env: NodeJS.ProcessEnv = process.env): GoogleAdsCredentials | null {
  const missing = REQUIRED_ENV.filter((key) => !env[key] || env[key]!.trim().length === 0);
  if (missing.length > 0) return null;

  const customerId = normalizeCustomerId(env.GOOGLE_ADS_CUSTOMER_ID!.trim());
  if (customerId.length === 0) return null;

  const rawLogin = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim();
  const loginCustomerId = rawLogin ? normalizeCustomerId(rawLogin) : null;

  return {
    developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN!.trim(),
    clientId: env.GOOGLE_ADS_CLIENT_ID!.trim(),
    clientSecret: env.GOOGLE_ADS_CLIENT_SECRET!.trim(),
    refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN!.trim(),
    customerId,
    loginCustomerId: loginCustomerId && loginCustomerId.length > 0 ? loginCustomerId : null,
    apiVersion: resolveApiVersion(env),
  };
}

/** Credential status safe to render, persist and reason about. */
export function credentialStatus(env: NodeJS.ProcessEnv = process.env): GoogleAdsCredentialStatus {
  const missing = REQUIRED_ENV.filter((key) => !env[key] || env[key]!.trim().length === 0);
  if (missing.length > 0) return { configured: false, missing: [...missing], invalid: [] };

  const invalid: string[] = [];
  if (normalizeCustomerId(env.GOOGLE_ADS_CUSTOMER_ID!).length === 0) invalid.push("GOOGLE_ADS_CUSTOMER_ID");
  let apiVersion: GoogleAdsApiVersion;
  try {
    apiVersion = resolveApiVersion(env);
  } catch {
    return { configured: false, missing: [], invalid: [...invalid, "GOOGLE_ADS_API_VERSION"] };
  }
  if (invalid.length > 0) return { configured: false, missing: [], invalid };

  const creds = resolveCredentials(env);
  if (!creds) return { configured: false, missing: [], invalid: ["GOOGLE_ADS_CUSTOMER_ID"] };
  return {
    configured: true,
    customerId: creds.customerId,
    loginCustomerId: creds.loginCustomerId,
    apiVersion,
  };
}

/* ------------------------------------------------------------------ */
/* Access tokens                                                       */
/* ------------------------------------------------------------------ */

type CachedToken = { token: string; expiresAtMs: number };

/**
 * In-process access-token cache, keyed by refresh token.
 *
 * Access tokens live ~1 hour; re-exchanging on every report request would
 * be a needless round trip and a needless credential use. Per-instance like
 * `lib/rate-limit.ts` — with multiple instances each simply refreshes its
 * own, which costs an extra token exchange and nothing else.
 *
 * The map is module-private: there is no exported reader, so no other code
 * path can pull a live token out of it.
 */
const tokenCache = new Map<string, CachedToken>();

/** Refresh 60s early so a token cannot expire mid-flight. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Exchange the refresh token for an access token (OAuth 2.0 refresh grant).
 *
 * The `client_secret` and `refresh_token` are sent in the POST body to
 * Google's token endpoint over TLS and appear nowhere else. On failure the
 * response body is NOT surfaced — `AUTHENTICATION_FAILED` plus a fixed
 * explanation is all that escapes, because Google's error bodies echo
 * request parameters.
 */
export async function getAccessToken(
  credentials: GoogleAdsCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const cached = tokenCache.get(credentials.refreshToken);
  if (cached && cached.expiresAtMs > Date.now() + EXPIRY_SKEW_MS) return cached.token;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
  });

  let res: Response;
  try {
    res = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(GOOGLE_ADS.REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new GoogleAdsError(
      "NETWORK_ERROR",
      `Could not reach the Google OAuth token endpoint: ${err instanceof Error ? err.name : "unknown"}.`,
      { retryable: true },
    );
  }

  if (!res.ok) {
    // Deliberately does not include the response body: Google's OAuth errors
    // echo client_id and sometimes the grant, and this message is persisted.
    throw new GoogleAdsError(
      "AUTHENTICATION_FAILED",
      `Google rejected the OAuth refresh token (HTTP ${res.status}).`,
      { httpStatus: res.status },
    );
  }

  let payload: { access_token?: unknown; expires_in?: unknown };
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    throw new GoogleAdsError("AUTHENTICATION_FAILED", "The OAuth token response could not be parsed.");
  }

  const token = typeof payload.access_token === "string" ? payload.access_token : null;
  if (!token) throw new GoogleAdsError("AUTHENTICATION_FAILED", "The OAuth token response contained no access token.");

  const expiresInSec = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : 3600;
  tokenCache.set(credentials.refreshToken, { token, expiresAtMs: Date.now() + expiresInSec * 1000 });
  return token;
}

/** Drop cached tokens. Used by tests and after an authentication failure. */
export function clearAccessTokenCache(): void {
  tokenCache.clear();
}
