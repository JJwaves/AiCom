/**
 * Normalized Google Ads error model (Session 13 spec §42).
 *
 * The provider's raw error bodies never leave this module. Everything above
 * it — sync runs, the admin surface, the snapshot, the agent context — sees
 * a CLOSED code plus a message that is safe to display.
 *
 * Safety rule, enforced by `redact()`: no access token, refresh token,
 * client secret, developer token or Authorization header value may appear in
 * a normalized message, in a persisted sync row, or in a log line. A Google
 * `requestId` IS preserved, because it is the one identifier that makes a
 * support ticket answerable and it carries no credential.
 */

export const GOOGLE_ADS_ERROR_CODES = [
  /** OAuth refresh failed — refresh token invalid, revoked, or expired. */
  "AUTHENTICATION_FAILED",
  /** Authenticated, but this identity may not read this customer. */
  "AUTHORIZATION_FAILED",
  /** Developer token missing, unapproved, or not valid for this account. */
  "DEVELOPER_TOKEN_ERROR",
  /** Daily/operational quota exhausted. */
  "QUOTA_EXCEEDED",
  /** Short-term rate limit — retryable later, not now. */
  "RATE_LIMITED",
  /** The configured customer id does not exist or is not reachable. */
  "INVALID_CUSTOMER",
  /** The configured API version is not supported by this adapter or by Google. */
  "API_VERSION_UNSUPPORTED",
  /** The query was rejected, or the response could not be mapped. */
  "REPORTING_ERROR",
  /** Transport failure: DNS, TLS, timeout, connection reset. */
  "NETWORK_ERROR",
  /** Credentials are absent. NOT an error state — see below. */
  "NOT_CONFIGURED",
] as const;

export type GoogleAdsErrorCode = (typeof GOOGLE_ADS_ERROR_CODES)[number];

/**
 * `NOT_CONFIGURED` is deliberately in the same enum but means something
 * different everywhere it is handled: the owner has not connected Google Ads
 * yet. It is never rendered as a failure, and it is NEVER interpreted as
 * "$0 spend" (spec §6, §18).
 */
export class GoogleAdsError extends Error {
  readonly code: GoogleAdsErrorCode;
  /** Google's request id, when the response carried one. Credential-free. */
  readonly requestId: string | null;
  /** HTTP status, when the failure came from a response. */
  readonly httpStatus: number | null;
  /** True when a later retry could plausibly succeed. */
  readonly retryable: boolean;

  constructor(
    code: GoogleAdsErrorCode,
    message: string,
    opts: { requestId?: string | null; httpStatus?: number | null; retryable?: boolean } = {},
  ) {
    super(redact(message));
    this.name = "GoogleAdsError";
    this.code = code;
    this.requestId = opts.requestId ?? null;
    this.httpStatus = opts.httpStatus ?? null;
    this.retryable = opts.retryable ?? (code === "RATE_LIMITED" || code === "NETWORK_ERROR");
  }
}

export function isGoogleAdsError(err: unknown): err is GoogleAdsError {
  return err instanceof GoogleAdsError;
}

/**
 * Strip anything credential-shaped from a message before it is stored,
 * logged, or shown. Defense in depth: the call sites already avoid
 * interpolating secrets, and this makes a future mistake non-catastrophic.
 */
export function redact(message: string): string {
  return message
    .replace(/Bearer\s+[\w.\-]+/gi, "Bearer [redacted]")
    .replace(/ya29\.[\w.\-]+/g, "[redacted-access-token]")
    .replace(/1\/\/[\w.\-]+/g, "[redacted-refresh-token]")
    .replace(/"(access_token|refresh_token|client_secret|developer[-_]?token)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
    .replace(/(developer-token|login-customer-id)\s*:\s*[\w-]+/gi, "$1: [redacted]")
    .slice(0, 600);
}

/** Owner-language explanation of each code, for the admin surface. */
export const GOOGLE_ADS_ERROR_EXPLANATION: Record<GoogleAdsErrorCode, string> = {
  AUTHENTICATION_FAILED:
    "Google rejected the stored refresh token. Re-issue it for the same Google account and update GOOGLE_ADS_REFRESH_TOKEN.",
  AUTHORIZATION_FAILED:
    "The connected Google account is authenticated but not allowed to read this Google Ads account. Check that the account has at least read access to the configured customer id.",
  DEVELOPER_TOKEN_ERROR:
    "The developer token was rejected. A token in test-account mode cannot read a production account, and an unapproved token cannot read anything.",
  QUOTA_EXCEEDED: "The Google Ads API daily quota for this developer token is exhausted. Nothing was fetched.",
  RATE_LIMITED: "Google is rate-limiting this account right now. The previous data is unchanged; try again later.",
  INVALID_CUSTOMER:
    "The configured Google Ads customer id is not reachable from this login. If it sits under a manager account, GOOGLE_ADS_LOGIN_CUSTOMER_ID must be that manager's id.",
  API_VERSION_UNSUPPORTED:
    "The configured Google Ads API version is not one this integration supports. See docs/GOOGLE_ADS_INTELLIGENCE.md for the upgrade procedure — the integration deliberately does not fall back to an older version.",
  REPORTING_ERROR: "Google accepted the request but the report could not be read. No data was changed.",
  NETWORK_ERROR: "Google Ads could not be reached. Existing data and its timestamp are unchanged.",
  NOT_CONFIGURED:
    "Google Ads is not connected. This is not zero spend — it means the platform has no visibility into advertising at all.",
};
