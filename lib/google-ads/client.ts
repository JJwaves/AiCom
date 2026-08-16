import { GOOGLE_ADS, GOOGLE_ADS_API_HOST } from "@/config/google-ads";
import { getAccessToken, type GoogleAdsCredentials } from "./auth";
import { GoogleAdsError, type GoogleAdsErrorCode } from "./errors";
import { MAX_PAGE_SIZE } from "./queries";

/**
 * Google Ads transport (Session 13 spec §3, §42, §43).
 *
 * THE READ-ONLY INVARIANT LIVES HERE, and it is structural, not a promise:
 *
 *  - `endpointFor()` is the ONLY URL builder, and it appends the LITERAL
 *    string `/googleAds:search`. The method is not a parameter, so no
 *    caller — present or future — can address `:mutate`, `:mutateCampaigns`,
 *    `campaignBudgets:mutate`, `:uploadClickConversions`, or any other
 *    mutating endpoint. Those URLs cannot be CONSTRUCTED by this module.
 *  - There is no exported `request(method, path, body)`. The single exported
 *    function takes a customer id and a GAQL query and returns rows.
 *  - `search` is a POST because the Google Ads API defines it that way (the
 *    query travels in the body). POST here is a read: GAQL has no mutation
 *    verb, and the endpoint's contract is "run this SELECT".
 *
 * Everything else is failure isolation (spec §5 of the prompt file): every
 * error becomes a normalized `GoogleAdsError`, and no caller of this module
 * sits anywhere near a commerce path.
 */

/** Build the ONE endpoint this integration can call. `:search`, literally. */
function endpointFor(credentials: GoogleAdsCredentials, customerId: string): string {
  return `${GOOGLE_ADS_API_HOST}/${credentials.apiVersion}/customers/${customerId}/googleAds:search`;
}

/** Google Ads search response, only the fields we consume. */
type SearchResponse = {
  results?: unknown[];
  nextPageToken?: string;
  fieldMask?: string;
};

export type SearchOptions = {
  /** Rows per page. Bounded by the API's own maximum. */
  pageSize?: number;
  /** Total rows to accept before reporting truncation. */
  maxRows?: number;
  /** Injectable for tests — no test ever supplies the real one. */
  fetchImpl?: typeof fetch;
};

export type SearchResult = {
  rows: unknown[];
  truncated: boolean;
  pagesFetched: number;
  /** Google's request id from the last page, when present. Credential-free. */
  requestId: string | null;
};

/**
 * Run one GAQL SELECT against one customer, following pagination.
 *
 * Returns RAW result objects. Mapping them into internal types is
 * `reporting-provider.ts`'s job — keeping the transport free of business
 * meaning is what lets the provider be faked wholesale in tests.
 */
export async function searchGoogleAds(
  credentials: GoogleAdsCredentials,
  customerId: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRows = Math.min(options.maxRows ?? GOOGLE_ADS.MAX_REPORT_ROWS, GOOGLE_ADS.MAX_REPORT_ROWS);
  const pageSize = Math.min(options.pageSize ?? 1_000, MAX_PAGE_SIZE);

  // Defense in depth. `queries.ts` is the only builder, but a query that
  // somehow arrived here without a leading SELECT is refused rather than
  // sent — GAQL has no mutation verb, and this keeps it that way.
  if (!/^\s*SELECT\b/i.test(query)) {
    throw new GoogleAdsError("REPORTING_ERROR", "Only SELECT queries can be issued by this integration.");
  }

  const accessToken = await getAccessToken(credentials, fetchImpl);
  const url = endpointFor(credentials, customerId);
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "developer-token": credentials.developerToken,
    "content-type": "application/json",
  };
  if (credentials.loginCustomerId) headers["login-customer-id"] = credentials.loginCustomerId;

  const rows: unknown[] = [];
  let pageToken: string | undefined;
  let pagesFetched = 0;
  let truncated = false;
  let requestId: string | null = null;

  do {
    if (pagesFetched >= GOOGLE_ADS.MAX_REPORT_PAGES) {
      truncated = true;
      break;
    }

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, pageSize, ...(pageToken ? { pageToken } : {}) }),
        signal: AbortSignal.timeout(GOOGLE_ADS.REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new GoogleAdsError(
        "NETWORK_ERROR",
        `Google Ads could not be reached (${err instanceof Error ? err.name : "unknown"}).`,
        { retryable: true },
      );
    }

    requestId = res.headers.get("request-id") ?? requestId;
    if (!res.ok) throw await normalizeHttpFailure(res, requestId);

    let payload: SearchResponse;
    try {
      payload = (await res.json()) as SearchResponse;
    } catch {
      throw new GoogleAdsError("REPORTING_ERROR", "The Google Ads report response could not be parsed.", {
        requestId,
      });
    }

    pagesFetched += 1;
    for (const row of payload.results ?? []) {
      if (rows.length >= maxRows) {
        truncated = true;
        break;
      }
      rows.push(row);
    }
    if (truncated) break;
    pageToken = payload.nextPageToken;
  } while (pageToken);

  return { rows, truncated, pagesFetched, requestId };
}

/**
 * Map an HTTP failure to a normalized code (spec §42).
 *
 * The body IS read — Google's `error.details[].errors[].errorCode` is the
 * only way to tell a developer-token problem from a permission problem —
 * but only the CODE is kept. Message text and any echoed request fields are
 * discarded, and `GoogleAdsError` redacts what is left.
 */
async function normalizeHttpFailure(res: Response, requestId: string | null): Promise<GoogleAdsError> {
  let bodyText = "";
  try {
    bodyText = (await res.text()).slice(0, 4_000);
  } catch {
    /* a body we cannot read simply narrows the diagnosis */
  }

  const code = classify(res.status, bodyText);
  return new GoogleAdsError(code, `Google Ads returned HTTP ${res.status} (${code}).`, {
    requestId,
    httpStatus: res.status,
    retryable: code === "RATE_LIMITED" || code === "NETWORK_ERROR",
  });
}

function classify(status: number, body: string): GoogleAdsErrorCode {
  const hay = body.toLowerCase();
  if (hay.includes("developer_token") || hay.includes("developertoken")) return "DEVELOPER_TOKEN_ERROR";
  if (hay.includes("customer_not_found") || hay.includes("customernotenabled") || hay.includes("invalid_customer_id")) {
    return "INVALID_CUSTOMER";
  }
  if (hay.includes("quota") && !hay.includes("rate")) return "QUOTA_EXCEEDED";
  if (hay.includes("unsupported_version") || hay.includes("invalid_version")) return "API_VERSION_UNSUPPORTED";

  switch (status) {
    case 400:
      return "REPORTING_ERROR";
    case 401:
      return "AUTHENTICATION_FAILED";
    case 403:
      return hay.includes("quota") ? "QUOTA_EXCEEDED" : "AUTHORIZATION_FAILED";
    case 404:
      // A wrong API version and a wrong customer both 404; the body tells
      // them apart, and when it does not we say version, because that is the
      // one the operator can check without Google's help.
      return hay.includes("customer") ? "INVALID_CUSTOMER" : "API_VERSION_UNSUPPORTED";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "NETWORK_ERROR" : "REPORTING_ERROR";
  }
}
