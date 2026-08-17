import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as liveRoute } from "@/app/api/health/live/route";
import { GET as readyRoute } from "@/app/api/health/ready/route";
import {
  adminChecks,
  aiChecks,
  analyticsChecks,
  artworkChecks,
  buildReadinessReport,
  businessConfigChecks,
  commerceChecks,
  databaseChecks,
  findBusinessPlaceholders,
  monitoringChecks,
  productChecks,
} from "@/modules/launch-readiness";
import type { ReadinessCheck } from "@/modules/launch-readiness";
import { resetDb } from "./db-helpers";

/**
 * Production Launch Session 03 §29–§33, §45, §64, §65 — health and launch
 * readiness.
 *
 * Two properties carry the whole feature:
 *   1. Readiness distinguishes MANDATORY commerce from OPTIONAL AI and
 *      intelligence. An LLM outage is not an outage.
 *   2. No response, at any verbosity, contains a secret.
 *
 * Every "credential" below is a fabricated test string, never a real one.
 */

const FAKE_STORAGE_KEY_ID = `FAKEKEYID${"X".repeat(11)}`;
const FAKE_STORAGE_SECRET = "fake-storage-secret-value";
const FAKE_SHOPIFY_TOKEN = "shpat_fake_token_value";
const FAKE_ADMIN_PASSWORD = "fake-admin-password-value";
const FAKE_DB_PASSWORD = "fake-db-password";

const MANAGED_ENV = [
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_ADMIN_API_TOKEN",
  "SHOPIFY_WEBHOOK_SECRET",
  "ARTWORK_S3_ENDPOINT",
  "ARTWORK_S3_REGION",
  "ARTWORK_S3_BUCKET",
  "ARTWORK_S3_ACCESS_KEY_ID",
  "ARTWORK_S3_SECRET_ACCESS_KEY",
  "ADMIN_USER",
  "ADMIN_PASSWORD",
  "NEXT_PUBLIC_SITE_DOMAIN",
  "SENTRY_DSN",
  "ERROR_WEBHOOK_URL",
  "HUMAN_HANDOFF_WEBHOOK_URL",
  "QUOTE_WEBHOOK_URL",
  "DATABASE_URL",
];

const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  await resetDb();
  for (const key of MANAGED_ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureCommerce(): void {
  process.env.SHOPIFY_STORE_DOMAIN = "bagdirect-test.myshopify.com";
  process.env.SHOPIFY_ADMIN_API_TOKEN = FAKE_SHOPIFY_TOKEN;
  process.env.SHOPIFY_WEBHOOK_SECRET = "whsec_fake_value";
  process.env.ARTWORK_S3_ENDPOINT = "https://s3.us-east-1.amazonaws.com";
  process.env.ARTWORK_S3_REGION = "us-east-1";
  process.env.ARTWORK_S3_BUCKET = "bagdirect-artwork";
  process.env.ARTWORK_S3_ACCESS_KEY_ID = FAKE_STORAGE_KEY_ID;
  process.env.ARTWORK_S3_SECRET_ACCESS_KEY = FAKE_STORAGE_SECRET;
  process.env.ADMIN_USER = "owner";
  process.env.ADMIN_PASSWORD = FAKE_ADMIN_PASSWORD;
  process.env.NEXT_PUBLIC_SITE_DOMAIN = "bagdirect.example";
}

const byId = (checks: ReadinessCheck[], id: string): ReadinessCheck => checks.find((c) => c.id === id)!;

/* ------------------------------------------------------------------ */

describe("liveness is cheap and says nothing (§30, §64)", () => {
  it("answers 200 with only a status", async () => {
    const res = await liveRoute();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("readiness semantics (§31, §64)", () => {
  it("is NOT ready with commerce unconfigured", async () => {
    const res = await readyRoute(new Request("http://localhost/api/health/ready"));
    const data = await res.json();
    expect(data.status).toBe("not_ready");
    expect(res.status).toBe(503);
    expect(data.blockers.length).toBeGreaterThan(0);
  });

  it("does NOT block on AI, Google Ads, CRO, pricing or customer intelligence being absent", async () => {
    const report = await buildReadinessReport({ probeDatabase: false });
    const optional = report.checks.filter((c) => ["AI", "ANALYTICS"].includes(c.category));
    expect(optional.length).toBeGreaterThan(0);
    for (const check of optional) {
      expect(check.mandatory).toBe(false);
      // The mandatory rule guarantees an optional check can never be BLOCKED.
      expect(check.state).not.toBe("BLOCKED");
    }
    expect(report.blockers.every((b) => !b.toLowerCase().includes("google ads"))).toBe(true);
  });

  it("blocks on the things that would actually break an order", async () => {
    const report = await buildReadinessReport({ probeDatabase: false });
    const blockedIds = report.checks.filter((c) => c.state === "BLOCKED").map((c) => c.id);
    expect(blockedIds).toContain("commerce.merchandise_map");
    expect(blockedIds).toContain("artwork.storage");
    expect(blockedIds).toContain("product.pricing_live");
    expect(blockedIds).toContain("product.moq");
    expect(blockedIds).toContain("admin.credentials");
    expect(blockedIds).toContain("business.domain");
  });

  it("makes no external API call — a readiness poll cannot burn a vendor quota (§32)", async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("readiness must not call out");
    }) as unknown as typeof fetch;
    configureCommerce();
    try {
      await readyRoute(new Request("http://localhost/api/health/ready?verbose=1"));
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(called).toBe(false);
  });
});

describe("no response contains a secret (§33, §64)", () => {
  it("verbose readiness never echoes a credential value", async () => {
    configureCommerce();
    process.env.DATABASE_URL = `postgres://user:${FAKE_DB_PASSWORD}@db.example:5432/bagdirect`;
    process.env.SENTRY_DSN = "https://fakepublickey@o1.ingest.example/42";

    const res = await readyRoute(new Request("http://localhost/api/health/ready?verbose=1"));
    const raw = JSON.stringify(await res.json());

    for (const secret of [
      FAKE_SHOPIFY_TOKEN,
      "whsec_fake_value",
      FAKE_STORAGE_SECRET,
      FAKE_STORAGE_KEY_ID,
      FAKE_ADMIN_PASSWORD,
      FAKE_DB_PASSWORD,
      "fakepublickey",
      "postgres://",
    ]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("names WHICH variable is missing, never a value", () => {
    expect(byId(artworkChecks(), "artwork.storage").action).toContain("ARTWORK_S3_");
  });
});

describe("owner-friendly messages come first (§47, §65)", () => {
  it("leads with plain language and keeps the code secondary", () => {
    const map = byId(commerceChecks(), "commerce.merchandise_map");
    expect(map.summary).toMatch(/unmapped/i);
    expect(map.summary).not.toContain("SHOPIFY_MERCHANDISE_MAP");
    expect(map.code).toBe("SHOPIFY_MERCHANDISE_MAP");
  });

  it("every check that is not ready tells the owner what to do", async () => {
    const report = await buildReadinessReport({ probeDatabase: false });
    for (const check of report.checks) {
      if (check.state !== "READY") expect(check.action, `${check.id} has no action`).toBeTruthy();
    }
  });
});

describe("owner placeholders are surfaced (§43, §65)", () => {
  it("finds the [TO BE PROVIDED] markers still in business configuration", () => {
    const found = findBusinessPlaceholders();
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((f) => f.customerFacing)).toBe(true);
  });

  it("blocks launch on a customer-facing placeholder", () => {
    const check = byId(businessConfigChecks(), "business.placeholders");
    expect(check.state).toBe("BLOCKED");
    expect(check.summary).toContain("[TO BE PROVIDED]");
  });

  it("blocks launch on an unconfigured domain, and clears once it is set", () => {
    expect(byId(businessConfigChecks(), "business.domain").state).toBe("BLOCKED");
    process.env.NEXT_PUBLIC_SITE_DOMAIN = "bagdirect.example";
    expect(byId(businessConfigChecks(), "business.domain").state).toBe("READY");
  });

  it("treats the literal placeholder domain as unconfigured", () => {
    process.env.NEXT_PUBLIC_SITE_DOMAIN = "example.com";
    expect(byId(businessConfigChecks(), "business.domain").state).toBe("BLOCKED");
  });
});

describe("product readiness reports, and never changes, the data (§44, §65)", () => {
  it("reports demo pricing, unconfirmed MOQ and missing images", () => {
    const checks = productChecks();
    expect(byId(checks, "product.pricing_live").state).toBe("BLOCKED");
    expect(byId(checks, "product.moq").state).toBe("BLOCKED");
    expect(byId(checks, "product.images").mandatory).toBe(false);
  });
});

describe("the AI budget/pricing conflict is surfaced BEFORE a customer finds it (§40, §65)", () => {
  const aiEnv = ["AI_RUNTIME_ENABLED", "AI_SALES_ENABLED", "AI_DAILY_BUDGET_USD", "ANTHROPIC_API_KEY"];
  afterEach(() => {
    for (const key of aiEnv) delete process.env[key];
  });

  it("warns loudly when budgets are set but the models are unpriced", () => {
    process.env.AI_RUNTIME_ENABLED = "true";
    process.env.AI_SALES_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "fake-provider-key";
    process.env.AI_DAILY_BUDGET_USD = "25";

    const check = aiChecks().find((c) => c.id === "ai.budget_pricing");
    expect(check).toBeTruthy();
    expect(check!.code).toBe("AI_BUDGET_CONFIG_INVALID");
    expect(check!.summary).toMatch(/refused|cannot be enforced/i);
    // Still OPTIONAL: a broken AI budget must not stop the shop selling.
    expect(check!.mandatory).toBe(false);
  });

  it("says nothing about pricing when no budget is configured", () => {
    process.env.AI_RUNTIME_ENABLED = "true";
    process.env.AI_SALES_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "fake-provider-key";
    expect(aiChecks().find((c) => c.id === "ai.budget_pricing")).toBeUndefined();
  });
});

describe("owner-verification items never self-resolve (§56)", () => {
  it("shipping/tax, the test order, backups and alerts stay WARNING with configuration alone", async () => {
    configureCommerce();
    const report = await buildReadinessReport({ probeDatabase: false });
    for (const id of [
      "commerce.shipping_tax",
      "commerce.test_order",
      "database.backups",
      "monitoring.alerts",
      "monitoring.platform_waf",
    ]) {
      const check = report.checks.find((c) => c.id === id)!;
      expect(check.state, id).toBe("WARNING");
      expect(check.ownerVerified, id).toBe(true);
    }
  });
});

describe("monitoring and database readiness", () => {
  it("reports error tracking as unconfigured, then configured", () => {
    expect(byId(monitoringChecks(), "monitoring.error_tracking").state).toBe("WARNING");
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example/errors";
    expect(byId(monitoringChecks(), "monitoring.error_tracking").state).toBe("READY");
    delete process.env.ERROR_WEBHOOK_URL;
  });

  it("rejects a malformed Sentry DSN loudly instead of pretending it works", () => {
    process.env.SENTRY_DSN = "not-a-dsn";
    expect(byId(monitoringChecks(), "monitoring.error_tracking").state).toBe("BLOCKED");
    delete process.env.SENTRY_DSN;
  });

  it("flags a non-pooled connection string as a serverless risk", () => {
    process.env.DATABASE_URL = `postgres://user:${FAKE_DB_PASSWORD}@db.example:5432/bagdirect`;
    expect(byId(databaseChecks(), "database.pooling").state).toBe("WARNING");
    process.env.DATABASE_URL = `postgres://user:${FAKE_DB_PASSWORD}@db-pooler.example:5432/bagdirect?pgbouncer=true`;
    expect(byId(databaseChecks(), "database.pooling").state).toBe("READY");
  });

  it("admin credentials block, because without them nothing operational is reachable", () => {
    expect(byId(adminChecks(), "admin.credentials").state).toBe("BLOCKED");
    process.env.ADMIN_USER = "owner";
    process.env.ADMIN_PASSWORD = FAKE_ADMIN_PASSWORD;
    expect(byId(adminChecks(), "admin.credentials").state).toBe("READY");
  });
});

describe("analytics readiness is reported, never enforced (§11)", () => {
  it("reports GA4, Google Ads and Meta as optional", () => {
    for (const check of analyticsChecks()) expect(check.mandatory).toBe(false);
  });
});

describe("a fully-configured fixture closes every check this session owns (§65)", () => {
  it("leaves only real owner data outstanding", async () => {
    configureCommerce();
    const report = await buildReadinessReport({ probeDatabase: false });
    const blockedIds = report.checks.filter((c) => c.state === "BLOCKED").map((c) => c.id);
    for (const id of [
      "commerce.credentials",
      "commerce.webhook_secret",
      "artwork.storage",
      "admin.credentials",
      "business.domain",
    ]) {
      expect(blockedIds, id).not.toContain(id);
    }
  });
});
