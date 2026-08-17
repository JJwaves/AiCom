import { BUSINESS, isDemoPricing } from "@/config/business";
import { isFlagEnabled } from "@/config/flags";
import { PRODUCTS } from "@/config/products";
import { validateMerchandiseMap } from "@/config/shopify";
import { siteDomainConfigured } from "@/config/site";
import { getModelPricing } from "@/config/ai-pricing";
import { getAiConfig } from "@/lib/ai/config";
import { describeCommerceReadiness, resolveShopifyWebhookSecret } from "@/lib/commerce/config";
import { analyticsDestinationsConfigured } from "@/lib/analytics/conversions";
import { handoffDeliveryConfigured } from "@/lib/escalation/delivery";
import { describeErrorTrackingReadiness } from "@/lib/observability/error-tracking";
import { durableRateLimitEnabled, hasStableNetworkKey } from "@/lib/rate-limit";
import { describeArtworkStorageReadiness } from "@/lib/storage/config";
import { findBusinessPlaceholders } from "./placeholders";
import type { ReadinessCheck } from "./types";

/**
 * The individual readiness checks (Production Launch Session 03 §45).
 *
 * Every one is a PURE function of configuration — no database, no network,
 * no AI — so the whole set can run inside a readiness probe without cost and
 * inside a test without fixtures. Database-dependent checks live in
 * `report.ts`, which is the only part that awaits anything.
 */

const isProduction = (): boolean => process.env.NODE_ENV === "production";
const envSet = (name: string): boolean => {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim().length > 0;
};

/* ------------------------------------------------------------------ */
/* COMMERCE                                                            */
/* ------------------------------------------------------------------ */

export function commerceChecks(): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const commerce = describeCommerceReadiness();

  if (commerce.mode === "misconfigured") {
    checks.push({
      id: "commerce.credentials",
      category: "COMMERCE",
      title: "Shopify checkout",
      state: "BLOCKED",
      summary: "Shopify is partially configured, so no checkout can be created and nothing can be sold.",
      action: `Set the missing variables (${commerce.missingEnv.join(", ") || "see the server log"}) and redeploy.`,
      mandatory: true,
      code: "COMMERCE_MISCONFIGURED",
    });
  } else if (commerce.mode === "mock") {
    checks.push({
      id: "commerce.credentials",
      category: "COMMERCE",
      title: "Shopify checkout",
      state: isProduction() ? "BLOCKED" : "WARNING",
      summary: isProduction()
        ? "Shopify is not configured. Nothing can be sold — checkout answers 503."
        : "Running on the mock commerce provider. Nothing is charged; this is correct for development only.",
      action: "Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_API_TOKEN (docs/SHOPIFY_PRODUCTION.md).",
      mandatory: true,
      code: "COMMERCE_NOT_CONFIGURED",
    });
  } else {
    checks.push({
      id: "commerce.credentials",
      category: "COMMERCE",
      title: "Shopify checkout",
      state: "READY",
      summary: "Shopify credentials are configured; checkout creates real draft orders.",
      action: null,
      mandatory: true,
      code: "COMMERCE_CONFIGURED",
    });
  }

  const webhookConfigured = resolveShopifyWebhookSecret() !== null;
  checks.push({
    id: "commerce.webhook_secret",
    category: "COMMERCE",
    title: "Payment confirmation webhook",
    state: webhookConfigured ? "READY" : commerce.mode === "shopify" ? "BLOCKED" : "WARNING",
    summary: webhookConfigured
      ? "The webhook signing secret is set, so paid orders can be verified and reconciled."
      : "No webhook signing secret. Every Shopify webhook is refused, so a customer could pay and the order would stay unpaid here forever.",
    action: webhookConfigured
      ? null
      : "Set SHOPIFY_WEBHOOK_SECRET and subscribe orders/create, orders/paid, orders/cancelled and refunds/create to /api/webhooks/shopify.",
    mandatory: true,
    code: "SHOPIFY_WEBHOOK_SECRET",
  });

  const map = validateMerchandiseMap();
  const unmapped = map.requiredCount - map.mappedCount;
  const errors = map.issues.filter((i) => i.severity === "error");
  checks.push({
    id: "commerce.merchandise_map",
    category: "COMMERCE",
    title: "Shopify product mapping",
    state: map.complete ? "READY" : "BLOCKED",
    summary: map.complete
      ? `All ${map.requiredCount} purchasable configurations are mapped to Shopify variants.`
      : errors.length > 0
        ? `${errors.length} Shopify variant mapping${errors.length === 1 ? " is" : "s are"} wrong, and ${unmapped} of ${map.requiredCount} are still unmapped. An unmapped configuration cannot be bought.`
        : `${unmapped} of ${map.requiredCount} Shopify variants are unmapped. Customers cannot buy those configurations.`,
    action: map.complete ? null : "Fill SHOPIFY_MERCHANDISE_MAP in config/shopify.ts with one variant id per configuration.",
    mandatory: true,
    code: "SHOPIFY_MERCHANDISE_MAP",
  });

  // Only a human can confirm that a real checkout charged the right amount,
  // shipped from the right place and charged the right tax.
  checks.push({
    id: "commerce.test_order",
    category: "COMMERCE",
    title: "Verified test order",
    state: "WARNING",
    summary:
      "Nobody has confirmed that a real checkout shows the expected shipping and tax and produces a paid BagDirect order. This cannot be checked from inside the application.",
    action:
      "Place one real (or Shopify test-mode) order and confirm: shipping appears, tax appears, the webhook arrives, the order becomes paid, and the artwork is attached. docs/PRODUCTION_OPERATIONS.md §Launch smoke test.",
    mandatory: true,
    code: "TEST_ORDER_UNVERIFIED",
    ownerVerified: true,
  });

  checks.push({
    id: "commerce.shipping_tax",
    category: "COMMERCE",
    title: "Shopify shipping and tax settings",
    state: "WARNING",
    summary:
      "Shipping profiles and tax settings live in Shopify, not here, so BagDirect cannot verify them. An unconfigured shipping profile silently blocks checkout completion.",
    action: "Confirm the US shipping profile covers the products, and that tax settings are configured, in the Shopify admin.",
    mandatory: true,
    code: "SHIPPING_TAX_UNVERIFIED",
    ownerVerified: true,
  });

  return checks;
}

/* ------------------------------------------------------------------ */
/* DATABASE                                                            */
/* ------------------------------------------------------------------ */

export function databaseChecks(): ReadinessCheck[] {
  const configured = envSet("DATABASE_URL");
  const url = process.env.DATABASE_URL ?? "";
  // Pooled/serverless-safe connection strings are recognisable by their
  // hostname or an explicit pgbouncer flag. Not a guarantee — a hint good
  // enough to stop the most common serverless outage.
  const looksPooled = /pooler|pgbouncer|-pooler\.|\bpgbouncer=true\b|connection_limit=/i.test(url);

  return [
    {
      id: "database.configured",
      category: "DATABASE",
      title: "Production database",
      state: configured ? "READY" : isProduction() ? "BLOCKED" : "WARNING",
      summary: configured
        ? "A Postgres connection string is configured."
        : isProduction()
          ? "No DATABASE_URL. The application refuses to start on the embedded database in production, so nothing works."
          : "Using the embedded development database. Data lives on this machine only.",
      action: configured ? null : "Set DATABASE_URL and run `npm run db:migrate` before serving traffic.",
      mandatory: true,
      code: "DATABASE_URL",
    },
    {
      id: "database.pooling",
      category: "DATABASE",
      title: "Serverless connection pooling",
      state: !configured ? "WARNING" : looksPooled ? "READY" : "WARNING",
      summary: looksPooled
        ? "The connection string looks like a pooled/serverless endpoint."
        : "The connection string does not look like a pooled endpoint. Serverless functions open a connection per instance and can exhaust a small Postgres under normal traffic.",
      action: looksPooled ? null : "Use your provider's pooled connection string (PgBouncer / Neon pooler / Supabase pooler). docs/PRODUCTION_OPERATIONS.md §Database.",
      mandatory: false,
      code: "DATABASE_POOLING",
    },
    {
      id: "database.backups",
      category: "DATABASE",
      title: "Backups and point-in-time recovery",
      state: "WARNING",
      summary:
        "Backups are a database-provider setting that BagDirect cannot query, so this can only be confirmed by a person. Nothing in the application backs up the database.",
      action: "Enable automated backups / PITR in your Postgres provider and note the retention window and a tested restore.",
      mandatory: true,
      code: "BACKUP_POLICY_UNVERIFIED",
      ownerVerified: true,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* PRODUCT                                                             */
/* ------------------------------------------------------------------ */

export function productChecks(): ReadinessCheck[] {
  const demoProducts = PRODUCTS.filter((p) => p.pricingStatus !== "LIVE");
  const missingImages = PRODUCTS.filter((p) => p.images.every((img) => !img.src));
  const demoNotice = isDemoPricing();

  return [
    {
      id: "product.pricing_live",
      category: "PRODUCT",
      title: "Real prices",
      state: demoProducts.length === 0 && !demoNotice ? "READY" : "BLOCKED",
      summary:
        demoProducts.length > 0
          ? `${demoProducts.length} of ${PRODUCTS.length} products still carry demo pricing. Selling at demo prices charges the customer a number nobody chose.`
          : demoNotice
            ? "Prices are marked LIVE but the storefront still shows the demo-pricing notice."
            : "All products carry live prices.",
      action:
        demoProducts.length > 0
          ? 'Set real tier prices in config/products.ts and change pricingStatus to "LIVE", then set NEXT_PUBLIC_DEMO_PRICING=false and redeploy.'
          : demoNotice
            ? "Set NEXT_PUBLIC_DEMO_PRICING=false and redeploy."
            : null,
      mandatory: true,
      code: "PRICING_STATUS",
    },
    {
      id: "product.moq",
      category: "PRODUCT",
      title: "Minimum order quantity",
      state: BUSINESS.MOQ_CONFIRMED ? "READY" : "BLOCKED",
      summary: BUSINESS.MOQ_CONFIRMED
        ? `The minimum order quantity (${BUSINESS.MOQ}) is confirmed.`
        : `The minimum order quantity is still the unconfirmed placeholder of ${BUSINESS.MOQ}. A wrong MOQ either turns away real orders or accepts ones the factory will not run.`,
      action: BUSINESS.MOQ_CONFIRMED ? null : "Confirm the real MOQ with the factory and set MOQ_CONFIRMED: true in config/business.ts.",
      mandatory: true,
      code: "MOQ_CONFIRMED",
    },
    {
      id: "product.images",
      category: "PRODUCT",
      title: "Product photography",
      state: missingImages.length === 0 ? "READY" : "WARNING",
      summary:
        missingImages.length === 0
          ? "Every product has at least one real image."
          : `${missingImages.length} of ${PRODUCTS.length} products have no real photography and render an illustration placeholder. It sells, but it looks like a prototype.`,
      action: missingImages.length === 0 ? null : "Add real product photography to config/products.ts.",
      mandatory: false,
      code: "PRODUCT_IMAGES",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* ARTWORK                                                             */
/* ------------------------------------------------------------------ */

export function artworkChecks(): ReadinessCheck[] {
  const storage = describeArtworkStorageReadiness();
  const printedProductsExist = PRODUCTS.some((p) => p.printOptions.some((o) => o.requiresArtwork));

  return [
    {
      id: "artwork.storage",
      category: "ARTWORK",
      title: "Artwork storage",
      state: storage.error ? "BLOCKED" : storage.configured ? "READY" : printedProductsExist ? "BLOCKED" : "WARNING",
      summary: storage.error
        ? "Object storage is partially configured, which the application refuses to run with."
        : storage.configured
          ? "Artwork uploads have a durable, private storage backend."
          : "No artwork storage is configured, so customers cannot upload a logo — every printed product is unbuyable.",
      action: storage.configured && !storage.error
        ? null
        : `Set ${storage.missingEnv.length > 0 ? storage.missingEnv.join(", ") : "the ARTWORK_S3_* variables"} against a PRIVATE bucket (docs/ARTWORK_STORAGE.md).`,
      mandatory: true,
      code: "ARTWORK_STORAGE",
    },
    {
      id: "artwork.durability",
      category: "ARTWORK",
      title: "Artwork durability",
      state: "WARNING",
      summary:
        "Object storage durability and any cross-region replication are provider settings BagDirect cannot query. For soft launch, durable object storage is enough; long-term replication is a deliberate later decision.",
      action: "Confirm versioning/retention on the bucket, and record the retention decision (docs/ARTWORK_STORAGE.md §Durability).",
      mandatory: false,
      code: "ARTWORK_DURABILITY",
      ownerVerified: true,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* AI — optional by definition. Never blocks commerce (§31).           */
/* ------------------------------------------------------------------ */

export function aiChecks(): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const runtimeOn = isFlagEnabled("AI_RUNTIME");
  const salesOn = isFlagEnabled("AI_SALES");

  let config: ReturnType<typeof getAiConfig> | null = null;
  let configError: string | null = null;
  try {
    config = getAiConfig();
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
  }

  if (configError) {
    checks.push({
      id: "ai.configuration",
      category: "AI",
      title: "AI configuration",
      state: "WARNING",
      summary: "The AI environment configuration is invalid, so the assistant will not run. Commerce is unaffected.",
      action: `Fix the AI environment variables: ${configError}`,
      mandatory: false,
      code: "AI_CONFIG_INVALID",
    });
    return checks;
  }

  const keyPresent = config?.apiKey !== null;
  checks.push({
    id: "ai.provider",
    category: "AI",
    title: "AI assistant",
    state: !runtimeOn || !salesOn ? "WARNING" : keyPresent ? "READY" : "WARNING",
    summary:
      !runtimeOn || !salesOn
        ? "The AI sales assistant is switched off. The storefront sells normally without it."
        : keyPresent
          ? "The AI assistant is enabled and a provider key is configured."
          : "The AI assistant is switched on but has no provider key, so it will show its unavailable message to every customer.",
    action:
      !runtimeOn || !salesOn
        ? "Optional: set AI_RUNTIME_ENABLED=true and AI_SALES_ENABLED=true after running `npm run ai:smoke`."
        : keyPresent
          ? null
          : "Set the provider API key, or switch AI_SALES_ENABLED off until you do.",
    mandatory: false,
    code: "AI_PROVIDER",
  });

  /*
   * THE SHARP EDGE THIS CHECK EXISTS FOR (§40).
   *
   * `assertWithinAiBudget` fails CLOSED when budgets are configured and the
   * active model has no price in config/ai-pricing.ts — a budget cannot be
   * enforced over spend nobody can measure. That is correct, and it used to
   * surface at the worst possible moment: the first customer to open the
   * chat got the unavailable message, and the owner found out from them.
   */
  const budgetsConfigured = (config?.dailyBudgetUsd ?? null) !== null || (config?.monthlyBudgetUsd ?? null) !== null;
  if (budgetsConfigured && config) {
    const unpriced = Object.values(config.models).filter((model) => {
      const pricing = getModelPricing(model);
      return !pricing || pricing.usdPerMTokIn === null || pricing.usdPerMTokOut === null;
    });
    if (unpriced.length > 0) {
      checks.push({
        id: "ai.budget_pricing",
        category: "AI",
        title: "AI budget configuration is invalid",
        state: "WARNING",
        summary:
          `AI spend limits are set, but ${unpriced.length === 1 ? "the model" : `${unpriced.length} models`} in use ` +
          `(${[...new Set(unpriced)].join(", ")}) have no token pricing, so the limit cannot be enforced. ` +
          "Every AI call will be refused — the first customer to open the chat would be the one who finds out.",
        action:
          "Fill config/ai-pricing.ts with the provider's current published rates, or unset AI_DAILY_BUDGET_USD and AI_MONTHLY_BUDGET_USD.",
        mandatory: false,
        code: "AI_BUDGET_CONFIG_INVALID",
      });
    }
  }

  if (runtimeOn && salesOn) {
    checks.push({
      id: "ai.smoke_test",
      category: "AI",
      title: "AI model smoke test",
      state: "WARNING",
      summary:
        "Whether the configured model ids actually answer can only be proven by calling the provider, which readiness deliberately never does.",
      action: "Run `npm run ai:smoke` with production credentials before enabling the assistant for customers.",
      mandatory: false,
      code: "AI_SMOKE_UNVERIFIED",
      ownerVerified: true,
    });
  }

  return checks;
}

/* ------------------------------------------------------------------ */
/* ANALYTICS — optional. Missing tracking never blocks a sale.         */
/* ------------------------------------------------------------------ */

export function analyticsChecks(): ReadinessCheck[] {
  const destinations = analyticsDestinationsConfigured();
  const gtm = envSet("NEXT_PUBLIC_GTM_ID");
  const adsId = envSet("NEXT_PUBLIC_GOOGLE_ADS_ID");
  const adsLabel = envSet("NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL");

  return [
    {
      id: "analytics.ga4",
      category: "ANALYTICS",
      title: "GA4 purchase tracking",
      state: destinations.ga4 || gtm ? "READY" : "WARNING",
      summary:
        destinations.ga4 || gtm
          ? gtm && !destinations.ga4
            ? "Google Tag Manager is configured. GA4 must be configured inside GTM to read the purchase event from the data layer."
            : "GA4 is configured and receives a purchase event from the confirmed paid order."
          : "GA4 is not configured. Orders are still recorded in full by BagDirect; only the Google Analytics copy is missing.",
      action: destinations.ga4 || gtm ? null : "Set NEXT_PUBLIC_GA4_ID (or NEXT_PUBLIC_GTM_ID) and redeploy — these are build-time values.",
      mandatory: false,
      code: "GA4_CONFIGURED",
    },
    {
      id: "analytics.google_ads",
      category: "ANALYTICS",
      title: "Google Ads conversion",
      state: destinations.googleAds ? "READY" : adsId || adsLabel ? "WARNING" : "WARNING",
      summary: destinations.googleAds
        ? "The Google Ads purchase conversion is configured and fires from the confirmed paid order."
        : adsId
          ? "A Google Ads id is set but the conversion label is missing, so no conversion can be sent — Ads would optimise blind."
          : "No Google Ads conversion is configured. Paid traffic cannot be optimised toward purchases until it is.",
      action: destinations.googleAds
        ? null
        : "Set NEXT_PUBLIC_GOOGLE_ADS_ID and NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL from the conversion action in Google Ads, then redeploy.",
      mandatory: false,
      code: "GOOGLE_ADS_CONVERSION",
    },
    {
      id: "analytics.meta",
      category: "ANALYTICS",
      title: "Meta Pixel",
      state: destinations.meta ? "READY" : "WARNING",
      summary: destinations.meta
        ? "The Meta Pixel is configured and sends a browser-side Purchase event. Server-side Conversions API is not implemented."
        : "No Meta Pixel is configured. This is expected if Meta is not part of the launch.",
      action: destinations.meta ? null : "Optional: set NEXT_PUBLIC_META_PIXEL_ID and redeploy.",
      mandatory: false,
      code: "META_PIXEL",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* ADMIN                                                               */
/* ------------------------------------------------------------------ */

export function adminChecks(): ReadinessCheck[] {
  const configured = envSet("ADMIN_USER") && envSet("ADMIN_PASSWORD");
  return [
    {
      id: "admin.credentials",
      category: "ADMIN",
      title: "Admin access",
      state: configured ? "READY" : "BLOCKED",
      summary: configured
        ? "Admin credentials are configured."
        : "No admin credentials. Every admin page returns 404, so escalations, reconciliation and this readiness page are all unreachable in production.",
      action: configured ? null : "Set ADMIN_USER and ADMIN_PASSWORD to a long random password.",
      mandatory: true,
      code: "ADMIN_CREDENTIALS",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* MONITORING                                                          */
/* ------------------------------------------------------------------ */

export function monitoringChecks(): ReadinessCheck[] {
  const tracking = describeErrorTrackingReadiness();
  const durable = durableRateLimitEnabled();
  const stableKey = hasStableNetworkKey();

  return [
    {
      id: "monitoring.error_tracking",
      category: "MONITORING",
      title: "Error tracking",
      state: tracking.error ? "BLOCKED" : tracking.configured ? "READY" : "WARNING",
      summary: tracking.error
        ? tracking.error
        : tracking.configured
          ? `Unexpected server errors are reported to: ${tracking.destinations.join(", ")}.`
          : "No error tracking destination is configured. Server errors reach the platform log only, and nothing will tell you when checkout starts failing.",
      action: tracking.configured && !tracking.error
        ? null
        : "Set SENTRY_DSN or ERROR_WEBHOOK_URL (docs/OBSERVABILITY.md).",
      mandatory: false,
      code: "ERROR_TRACKING",
    },
    {
      id: "monitoring.alerts",
      category: "MONITORING",
      title: "Production alerts",
      state: "WARNING",
      summary:
        "Nothing in this repository can guarantee a person reads an error. Alert rules live in the monitoring provider and platform, and BagDirect cannot see whether they exist.",
      action:
        "Configure alerts for: checkout error spikes, Shopify webhook failures, database failures, readiness unhealthy, AI provider failures or budget exhaustion, and artwork upload failures. docs/OBSERVABILITY.md §Alerts.",
      mandatory: false,
      code: "ALERTS_UNVERIFIED",
      ownerVerified: true,
    },
    {
      id: "monitoring.rate_limit_backend",
      category: "MONITORING",
      title: "Distributed rate limiting",
      state: durable ? "READY" : isProduction() ? "WARNING" : "READY",
      summary: durable
        ? "Rate limits are enforced against a shared database counter, so they mean the same thing across every instance."
        : "The durable rate-limit layer is disabled, so each server instance enforces limits independently and the effective limit multiplies by the instance count.",
      action: durable ? null : "Set RATE_LIMIT_DURABLE=true, and configure platform/WAF rate limiting as the outer layer.",
      mandatory: false,
      code: "RATE_LIMIT_DURABLE",
    },
    {
      id: "monitoring.rate_limit_key",
      category: "MONITORING",
      title: "Rate-limit identity key",
      state: stableKey ? "READY" : isProduction() ? "WARNING" : "READY",
      summary: stableKey
        ? "A stable keyed hash is configured, so network-scoped limits survive a redeploy and apply across instances."
        : "No RATE_LIMIT_IP_SALT, so each instance uses an ephemeral key. Network-scoped limits still apply, but only per instance and only until the next deploy.",
      action: stableKey ? null : "Set RATE_LIMIT_IP_SALT to a long random string (docs/OBSERVABILITY.md §Privacy).",
      mandatory: false,
      code: "RATE_LIMIT_IP_SALT",
    },
    {
      id: "monitoring.platform_waf",
      category: "MONITORING",
      title: "Platform / WAF rate limiting",
      state: "WARNING",
      summary:
        "Application-level limits still cost a function invocation per request. Only the platform edge can refuse traffic before that, and BagDirect cannot see whether a rule exists.",
      action: "Configure Vercel Firewall (or your CDN/WAF) rate-limit rules for /api/*. docs/OBSERVABILITY.md §Platform layer.",
      mandatory: false,
      code: "PLATFORM_RATE_LIMIT_UNVERIFIED",
      ownerVerified: true,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* OPERATIONS                                                          */
/* ------------------------------------------------------------------ */

export function operationsChecks(): ReadinessCheck[] {
  const handoffConfigured = handoffDeliveryConfigured();
  const quoteConfigured = envSet("QUOTE_WEBHOOK_URL");

  return [
    {
      id: "operations.handoff_delivery",
      category: "OPERATIONS",
      title: "Human escalation delivery",
      state: handoffConfigured ? "READY" : "WARNING",
      summary: handoffConfigured
        ? "AI escalations are delivered to your configured destination, and are stored at /admin/handoffs either way."
        : "AI escalations are stored at /admin/handoffs but nothing notifies you when one arrives, so a customer asking for a human waits until someone opens the page.",
      action: handoffConfigured ? null : "Set HUMAN_HANDOFF_WEBHOOK_URL (a Slack workflow, Zapier/Make hook, email automation or helpdesk intake URL).",
      mandatory: false,
      code: "HANDOFF_DELIVERY",
    },
    {
      id: "operations.quote_delivery",
      category: "OPERATIONS",
      title: "Quote request delivery",
      state: quoteConfigured ? "READY" : "WARNING",
      summary: quoteConfigured
        ? "Custom quote requests are delivered to your configured destination."
        : "Custom quote requests are stored and logged, but not delivered anywhere. A B2B enquiry would sit unread.",
      action: quoteConfigured ? null : "Set QUOTE_WEBHOOK_URL.",
      mandatory: false,
      code: "QUOTE_DELIVERY",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* BUSINESS_CONFIG                                                     */
/* ------------------------------------------------------------------ */

export function businessConfigChecks(): ReadinessCheck[] {
  const domain = siteDomainConfigured();
  const placeholders = findBusinessPlaceholders();
  const customerFacing = placeholders.filter((p) => p.customerFacing);

  return [
    {
      id: "business.domain",
      category: "BUSINESS_CONFIG",
      title: "Site domain",
      state: domain ? "READY" : "BLOCKED",
      summary: domain
        ? "The canonical domain is configured; metadata, sitemap and admin links all point at it."
        : "No site domain is configured. Canonical URLs, the sitemap and structured data would point at a placeholder domain, so search engines would index the wrong host — and crawling is refused entirely until it is set.",
      action: domain ? null : "Set NEXT_PUBLIC_SITE_DOMAIN to your live domain and redeploy (it is inlined at build time).",
      mandatory: true,
      code: "SITE_DOMAIN",
    },
    {
      id: "business.placeholders",
      category: "BUSINESS_CONFIG",
      title: "Business details",
      state: customerFacing.length > 0 ? "BLOCKED" : placeholders.length > 0 ? "WARNING" : "READY",
      summary:
        placeholders.length === 0
          ? "No placeholder business values remain."
          : customerFacing.length > 0
            ? `${customerFacing.length} customer-facing value${customerFacing.length === 1 ? " is" : "s are"} still a placeholder (${customerFacing.map((p) => p.label).join(", ")}). Customers would see "[TO BE PROVIDED]" on the live site.`
            : `${placeholders.length} internal value${placeholders.length === 1 ? " is" : "s are"} still a placeholder (${placeholders.map((p) => p.label).join(", ")}).`,
      action: placeholders.length === 0 ? null : `Fill in: ${placeholders.map((p) => p.path).join(", ")}.`,
      mandatory: true,
      code: "BUSINESS_PLACEHOLDERS",
    },
    {
      id: "business.policies",
      category: "BUSINESS_CONFIG",
      title: "Policy pages",
      state: "WARNING",
      summary:
        "Terms, privacy, returns and shipping policy content is legal copy that this codebase deliberately does not write, and cannot verify.",
      action: "Have the policy pages reviewed and finalised before taking real orders.",
      mandatory: false,
      code: "POLICIES_UNVERIFIED",
      ownerVerified: true,
    },
  ];
}
