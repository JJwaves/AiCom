import { SHOPIFY_API_VERSION, SUPPORTED_SHOPIFY_API_VERSIONS } from "@/config/shopify";

/**
 * Commerce provider configuration + THE production safety guard
 * (Production Launch Session 02 §3).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 * Before this session, `getCommerce()` returned the MOCK provider whenever
 * Shopify env vars were absent — in every environment, silently. A production
 * deploy that lost its Shopify configuration would have kept "selling":
 * minting MOCK-* order ids, writing Order rows, firing the authoritative
 * `purchase_completed` event and marking sessions converted, while charging
 * nobody and shipping nothing. Fake revenue is worse than no revenue, because
 * every downstream system — BI, POAS, CEO reports, ad attribution — would
 * treat it as real.
 *
 * The rule now, mirroring db/client.ts's DATABASE_URL guard exactly:
 *
 *   development / test  → mock is allowed, and only when NOTHING is configured
 *   production          → real Shopify or a HARD FAILURE. Never mock.
 *   any environment     → PARTIAL configuration is a hard failure everywhere
 *
 * Partial configuration fails in development too, deliberately: half-set
 * credentials always mean "I intended Shopify", and silently degrading to
 * mock is the exact bug class this guard exists to delete.
 *
 * Errors here are actionable and NEVER echo a secret's value — only which
 * variable is missing.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/commerce/config is server-only — never import it from client components");
}

/** Thrown when commerce configuration is missing or invalid. Never caught to fall back to mock. */
export class CommerceConfigurationError extends Error {
  readonly code = "COMMERCE_NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "CommerceConfigurationError";
  }
}

/** Credentials the Shopify provider needs to create a real, paid checkout. */
export type ShopifyCredentials = {
  /** myshopify domain, e.g. "bagdirect.myshopify.com". */
  storeDomain: string;
  /** Admin API access token (shpat_…). SERVER-ONLY — never NEXT_PUBLIC, never logged. */
  adminAccessToken: string;
  apiVersion: string;
};

const REQUIRED_SHOPIFY_ENV = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_API_TOKEN"] as const;

function readEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Domain sanity — a URL, a path or a trailing slash here means a broken Admin API call later. */
const STORE_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

function resolveApiVersion(): string {
  const pinned = readEnv("SHOPIFY_API_VERSION");
  if (!pinned) return SHOPIFY_API_VERSION;
  if (!(SUPPORTED_SHOPIFY_API_VERSIONS as readonly string[]).includes(pinned)) {
    throw new CommerceConfigurationError(
      `[commerce] SHOPIFY_API_VERSION="${pinned}" is not a version this codebase has been verified against ` +
        `(supported: ${SUPPORTED_SHOPIFY_API_VERSIONS.join(", ")}). ` +
        "Refusing to call an unverified Shopify API version. " +
        "Fix: unset the variable to use the default, or follow the upgrade procedure in docs/SHOPIFY_PRODUCTION.md §API version.",
    );
  }
  return pinned;
}

export type CommerceConfiguration =
  | { mode: "shopify"; shopify: ShopifyCredentials }
  | { mode: "mock"; reason: "not_configured" };

/**
 * THE provider decision. Every commerce entry point routes through here.
 *
 * @throws CommerceConfigurationError in production with missing/partial
 *   Shopify configuration, and in ANY environment with partial configuration.
 */
export function resolveCommerceConfiguration(): CommerceConfiguration {
  const present = REQUIRED_SHOPIFY_ENV.filter((name) => readEnv(name) !== null);
  const missing = REQUIRED_SHOPIFY_ENV.filter((name) => readEnv(name) === null);

  // ---- Fully configured: Shopify, in every environment. --------------
  if (missing.length === 0) {
    const storeDomain = readEnv("SHOPIFY_STORE_DOMAIN") as string;
    if (!STORE_DOMAIN.test(storeDomain)) {
      throw new CommerceConfigurationError(
        `[commerce] SHOPIFY_STORE_DOMAIN is not a valid myshopify domain. ` +
          'Expected the form "your-store.myshopify.com" — no https://, no path, no trailing slash. ' +
          "Refusing to start a checkout against an unverifiable store.",
      );
    }
    return {
      mode: "shopify",
      shopify: {
        storeDomain,
        adminAccessToken: readEnv("SHOPIFY_ADMIN_API_TOKEN") as string,
        apiVersion: resolveApiVersion(),
      },
    };
  }

  // ---- Partial: never guess, in any environment. ---------------------
  if (present.length > 0) {
    throw new CommerceConfigurationError(
      `[commerce] Shopify is PARTIALLY configured: ${present.join(", ")} set, ${missing.join(", ")} missing. ` +
        "Refusing to fall back to the mock provider: half-configured credentials always mean Shopify was intended, " +
        "and silently serving mock commerce would mint fake orders instead of taking payment. " +
        `Fix: set ${missing.join(" and ")}, or unset ${present.join(" and ")} to run mock commerce in development.`,
    );
  }

  // ---- Nothing configured. ------------------------------------------
  if (isProduction()) {
    throw new CommerceConfigurationError(
      "[commerce] No Shopify configuration found while NODE_ENV=production. " +
        "Refusing to fall back to the mock commerce provider: mock checkout charges nobody, ships nothing, " +
        "and would write MOCK-* orders, purchase_completed events and conversion marks that every downstream " +
        "system (business intelligence, profitability, POAS, ad attribution) would treat as real revenue. " +
        `Fix: set ${REQUIRED_SHOPIFY_ENV.join(" and ")} (server-only secrets) and complete the Shopify ` +
        "merchandise mapping in config/shopify.ts BEFORE serving traffic. " +
        "The mock provider remains available for development and tests only.",
    );
  }

  return { mode: "mock", reason: "not_configured" };
}

/**
 * Why commerce is not usable, when it is not. `mode: "misconfigured"` alone
 * cannot be reported to an owner, because it collapses three different
 * problems with three different fixes (PL Session 04):
 *
 *   not_configured  production with NOTHING set — set both variables
 *   partial         one of the two set — set the other, or unset the one
 *   invalid         both set, but a value is unusable (store domain shape,
 *                   unsupported API version) — correct the value
 *
 * Reported separately so a diagnostic surface can name the ACTUAL problem
 * instead of guessing "partially configured" for all three.
 */
export type CommerceReadinessReason = "configured" | "not_configured" | "partial" | "invalid";

/**
 * Non-throwing readiness view for admin/diagnostic surfaces. Reports WHICH
 * variables are missing — never their values.
 */
export function describeCommerceReadiness(): {
  mode: "shopify" | "mock" | "misconfigured";
  reason: CommerceReadinessReason;
  nodeEnv: string;
  missingEnv: string[];
  error: string | null;
} {
  const missingEnv = REQUIRED_SHOPIFY_ENV.filter((name) => readEnv(name) === null);
  const nodeEnv = process.env.NODE_ENV ?? "development";
  try {
    const config = resolveCommerceConfiguration();
    return {
      mode: config.mode,
      reason: config.mode === "shopify" ? "configured" : "not_configured",
      nodeEnv,
      missingEnv,
      error: null,
    };
  } catch (err) {
    // Which of the three failures happened is decided by the SAME env reading
    // that resolveCommerceConfiguration() used, not by parsing its message.
    const reason: CommerceReadinessReason =
      missingEnv.length === REQUIRED_SHOPIFY_ENV.length
        ? "not_configured"
        : missingEnv.length > 0
          ? "partial"
          : "invalid";
    return {
      mode: "misconfigured",
      reason,
      nodeEnv,
      missingEnv,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Webhook secret, resolved separately from checkout credentials: a store can
 * be taking orders before its webhook endpoint is registered, and the webhook
 * route must fail closed on its own terms rather than borrow checkout's.
 */
export function resolveShopifyWebhookSecret(): string | null {
  return readEnv("SHOPIFY_WEBHOOK_SECRET");
}
