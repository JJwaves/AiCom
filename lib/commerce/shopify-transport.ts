import type { ShopifyCredentials } from "./config";

/**
 * Shopify GraphQL Admin API transport (Production Launch Session 02).
 *
 * ONE place builds a Shopify URL, ONE place attaches the Admin token, ONE
 * place decides timeout/retry policy. Everything above this file works in
 * typed GraphQL documents and never touches `fetch`, so the credential can
 * never leak into a log line, an error message, a prompt or the client
 * bundle by accident.
 *
 * RETRY POLICY (§43): reads and other idempotent operations get bounded
 * retries on transport failures, 429 and 5xx. MUTATIONS ARE NEVER RETRIED —
 * a retried `draftOrderCreate` whose first attempt actually succeeded
 * creates two draft orders, i.e. two invoices for one cart. A mutation that
 * fails fails, and the customer sees a safe "try again" instead.
 */

export type ShopifyTransport = <T>(request: {
  query: string;
  variables?: Record<string, unknown>;
  /** Mutations are never retried. Default: treated as a mutation (safe). */
  idempotent?: boolean;
  operation: string;
}) => Promise<T>;

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    readonly operation: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS_IDEMPOTENT = 3;
const RETRY_BASE_DELAY_MS = 250;

type GraphqlEnvelope<T> = {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Build the live transport. The token exists only inside this closure. */
export function createShopifyTransport(credentials: ShopifyCredentials): ShopifyTransport {
  const endpoint = `https://${credentials.storeDomain}/admin/api/${credentials.apiVersion}/graphql.json`;

  return async function transport<T>({
    query,
    variables = {},
    idempotent = false,
    operation,
  }: {
    query: string;
    variables?: Record<string, unknown>;
    idempotent?: boolean;
    operation: string;
  }): Promise<T> {
    const maxAttempts = idempotent ? MAX_ATTEMPTS_IDEMPOTENT : 1;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": credentials.adminAccessToken,
          },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal,
          cache: "no-store",
        });

        if (!res.ok) {
          const retryable = res.status === 429 || res.status >= 500;
          const err = new ShopifyApiError(`Shopify ${operation} responded ${res.status}`, operation, res.status);
          if (retryable && attempt < maxAttempts) {
            lastError = err;
            await sleep(RETRY_BASE_DELAY_MS * attempt);
            continue;
          }
          throw err;
        }

        const envelope = (await res.json()) as GraphqlEnvelope<T>;
        if (envelope.errors?.length) {
          // GraphQL-level errors are contract errors (bad field, bad id,
          // missing scope). Retrying cannot fix them.
          throw new ShopifyApiError(
            `Shopify ${operation} returned errors: ${envelope.errors.map((e) => e.message).join("; ")}`,
            operation,
          );
        }
        if (!envelope.data) throw new ShopifyApiError(`Shopify ${operation} returned no data`, operation);
        return envelope.data;
      } catch (err) {
        const wrapped =
          err instanceof ShopifyApiError
            ? err
            : new ShopifyApiError(
                err instanceof Error && err.name === "AbortError"
                  ? `Shopify ${operation} timed out after ${REQUEST_TIMEOUT_MS}ms`
                  : `Shopify ${operation} transport failure`,
                operation,
              );
        // A contract error (GraphQL errors / no data) is never retried.
        const transportFailure = !(err instanceof ShopifyApiError) || wrapped.status !== undefined;
        if (transportFailure && attempt < maxAttempts) {
          lastError = wrapped;
          await sleep(RETRY_BASE_DELAY_MS * attempt);
          continue;
        }
        throw wrapped;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new ShopifyApiError(`Shopify ${operation} failed`, operation);
  };
}
