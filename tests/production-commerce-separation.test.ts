import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUARDED_AUTO_ALLOWED_ACTION_TYPES, GUARDRAIL_LIMITS } from "@/config/guardrails";
import { SHOPIFY_MERCHANDISE_MAP } from "@/config/shopify";
import { createSalesToolRegistry } from "@/lib/ai/tools";
import { PRODUCTS } from "@/config/products";
import { EXPERIMENT_TARGET_KEYS, getExperimentTarget } from "@/modules/experiments";
import { executorRegistry } from "@/modules/guardrails";

/**
 * Production Launch Session 02 §58 — structural boundaries.
 *
 * These assert SHAPE, not behaviour. Each one exists because the alternative
 * failure is expensive and silent: fake revenue, an AI that can pay, a
 * browser that can name an object key, a secret in a client bundle, a
 * database write before a signature check. Crossing any of these lines
 * requires deleting a test.
 */

const repo = process.cwd();

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

/** Comments are stripped: a doc block SAYING "no mock here" is not a violation. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const readAll = (dirs: string[]) =>
  dirs
    .flatMap((d) => walk(path.join(repo, d)))
    .map((file) => ({ file: path.relative(repo, file), source: stripComments(readFileSync(file, "utf8")) }));

const COMMERCE_FILES = readAll(["lib/commerce"]);
const APP_FILES = readAll(["app"]);
const CLIENT_COMPONENTS = readAll(["components"]);
const ALL_SOURCE = readAll(["app", "components", "lib", "modules", "config", "db"]);

const read = (rel: string) => stripComments(readFileSync(path.join(repo, rel), "utf8"));

/* ------------------------------------------------------------------ */
/* §58 — production commerce has no mock fallback                      */
/* ------------------------------------------------------------------ */

describe("production commerce has no mock fallback", () => {
  it("getCommerce resolves through the guard and never catches its error", () => {
    const source = read("lib/commerce/index.ts");
    expect(source).toContain("resolveCommerceConfiguration()");
    expect(source).not.toMatch(/try\s*\{/);
    expect(source).not.toMatch(/catch/);
  });

  it("the ONLY place mockProvider is selected is behind the resolved mode", () => {
    const selectors = COMMERCE_FILES.filter(
      ({ file, source }) => file !== "lib/commerce/mock.ts" && /mockProvider/.test(source),
    );
    expect(selectors.map((s) => s.file)).toEqual(["lib/commerce/index.ts"]);
  });

  it("the catalog facade has no provider fallback at all (§8)", () => {
    // The Session 01 "Shopify failed → serve demo products" hazard.
    const catalog = read("lib/commerce/catalog.ts");
    expect(catalog).not.toContain("mockProvider");
    expect(catalog).not.toMatch(/catch/);
    expect(catalog).not.toContain("getCommerce");
  });

  it("catalog reads stay the ONE path — nothing outside lib/commerce imports config/products", () => {
    const offenders = readAll(["app", "components", "lib"]).filter(
      ({ file, source }) =>
        !file.startsWith("lib/commerce/") && /from\s+["']@\/config\/products["']/.test(source),
    );
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("no route or component imports the mock provider directly", () => {
    for (const { file, source } of [...APP_FILES, ...CLIENT_COMPONENTS]) {
      expect(source, `${file} must not import the mock provider`).not.toMatch(/from\s+["']@\/lib\/commerce\/mock/);
    }
  });

  it("the mock provider itself refuses to run in production", () => {
    const source = read("lib/commerce/mock.ts");
    expect(source).toMatch(/NODE_ENV\s*===\s*"production"/);
    expect(source).toMatch(/throw new Error/);
  });

  it("MOCK- order ids are minted in exactly one place", () => {
    const minters = ALL_SOURCE.filter(({ source }) => /`MOCK-\$\{/.test(source));
    expect(minters.map((m) => m.file)).toEqual(["lib/commerce/mock.ts"]);
  });
});

/* ------------------------------------------------------------------ */
/* §64.7 — no REPLACE_ME survives                                      */
/* ------------------------------------------------------------------ */

describe("the Shopify stub is gone", () => {
  it("no executable source contains a REPLACE_ME merchandise id", () => {
    for (const { file, source } of ALL_SOURCE) {
      expect(source, `${file} still contains a placeholder id`).not.toContain("REPLACE_ME");
    }
  });

  it("no Shopify variant GID is hard-coded outside the mapping table (§5)", () => {
    for (const { file, source } of ALL_SOURCE) {
      if (file === "config/shopify.ts") continue;
      expect(source, `${file} hard-codes a Shopify variant id`).not.toMatch(/gid:\/\/shopify\/ProductVariant\/\d+/);
    }
  });

  it("the mapping table itself ships EMPTY — the owner supplies real ids (§6)", () => {
    expect(Object.keys(SHOPIFY_MERCHANDISE_MAP)).toHaveLength(0);
  });

  it("the Shopify API version is centralized, never scattered", () => {
    const offenders = ALL_SOURCE.filter(
      ({ file, source }) => file !== "config/shopify.ts" && /["']20\d\d-(01|04|07|10)["']/.test(source),
    );
    expect(offenders.map((o) => o.file)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* §58 — secrets are server-only                                       */
/* ------------------------------------------------------------------ */

describe("Shopify and storage secrets never reach the browser", () => {
  it("no NEXT_PUBLIC Shopify or storage variable exists anywhere", () => {
    for (const { file, source } of ALL_SOURCE) {
      expect(source, `${file} exposes Shopify config publicly`).not.toMatch(/NEXT_PUBLIC_SHOPIFY/);
      expect(source, `${file} exposes storage config publicly`).not.toMatch(/NEXT_PUBLIC_ARTWORK/);
    }
  });

  it("no client component reads a Shopify or storage secret", () => {
    for (const { file, source } of CLIENT_COMPONENTS) {
      expect(source, `${file} reads a server secret`).not.toMatch(
        /SHOPIFY_ADMIN_API_TOKEN|SHOPIFY_WEBHOOK_SECRET|ARTWORK_S3_SECRET_ACCESS_KEY/,
      );
    }
  });

  it("the server-only modules assert they are server-only", () => {
    for (const rel of [
      "lib/commerce/config.ts",
      "lib/commerce/shopify.ts",
      "lib/storage/config.ts",
      "lib/storage/artwork-storage.ts",
    ]) {
      expect(read(rel), `${rel} must guard against client import`).toMatch(/typeof window !== "undefined"/);
    }
  });

  it("the Admin token is attached in exactly ONE place", () => {
    const attachers = ALL_SOURCE.filter(({ source }) => /X-Shopify-Access-Token/.test(source));
    expect(attachers.map((a) => a.file)).toEqual(["lib/commerce/shopify-transport.ts"]);
  });
});

/* ------------------------------------------------------------------ */
/* §58 — signature verification precedes any write                     */
/* ------------------------------------------------------------------ */

describe("webhook signature verification happens before any database write", () => {
  const routeFull = read("app/api/webhooks/shopify/route.ts");
  /** Import statements name these symbols too — compare CALL SITES only. */
  const route = routeFull.slice(routeFull.indexOf("export async function POST"));

  it("reads the RAW body — never req.json()", () => {
    expect(route).toContain("await req.text()");
    expect(route).not.toContain("req.json()");
  });

  it("verifies BEFORE it parses", () => {
    expect(route.indexOf("verifyShopifyWebhook")).toBeLessThan(route.indexOf("JSON.parse"));
  });

  it("verifies BEFORE it claims or reconciles anything", () => {
    const verifyAt = route.indexOf("verifyShopifyWebhook");
    for (const writer of ["claimWebhookEvent", "reconcileOrderCreated", "reconcileOrderPaid", "reconcileRefundCreated"]) {
      expect(route.indexOf(writer), `${writer} must come after verification`).toBeGreaterThan(verifyAt);
    }
  });

  it("does not import a database client directly — writes go through services", () => {
    expect(route).not.toMatch(/from\s+["']@\/db\//);
  });

  it("the verifier logs nothing and cannot leak the secret", () => {
    const verifier = read("lib/commerce/webhook-verify.ts");
    expect(verifier).not.toMatch(/console\./);
    expect(verifier).toContain("timingSafeEqual");
  });
});

/* ------------------------------------------------------------------ */
/* §58 — AI has no payment authority                                   */
/* ------------------------------------------------------------------ */

describe("AI has no payment, checkout-url or order authority", () => {
  const registry = createSalesToolRegistry();
  const toolNames = registry.names();

  it("has no tool that could pay, refund, or mark an order paid", () => {
    for (const forbidden of [
      "markOrderPaid",
      "capturePayment",
      "createCheckout",
      "createDraftOrder",
      "issueRefund",
      "applyDiscount",
      "uploadArtwork",
      "setVariant",
    ]) {
      expect(toolNames).not.toContain(forbidden);
    }
  });

  it("no AI file imports the Shopify provider, the transport or the reconciliation layer", () => {
    for (const { file, source } of readAll(["lib/ai"])) {
      expect(source, `${file} must not reach Shopify`).not.toMatch(
        /@\/lib\/commerce\/(shopify|shopify-transport|order-reconciliation|webhook-verify)/,
      );
    }
  });

  it("no AI file imports the storage layer", () => {
    for (const { file, source } of readAll(["lib/ai"])) {
      expect(source, `${file} must not reach object storage`).not.toMatch(/@\/lib\/storage/);
    }
  });

  it("checkout URLs originate only from the provider", () => {
    // The client checkout helper accepts a URL from /api/checkout and nowhere
    // else; nothing constructs a Shopify checkout URL by hand.
    const offenders = ALL_SOURCE.filter(
      ({ file, source }) =>
        file !== "lib/commerce/shopify.ts" && /myshopify\.com\/(invoices|checkouts)/.test(source),
    );
    expect(offenders.map((o) => o.file)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* §58 — storage keys are not client-authoritative                     */
/* ------------------------------------------------------------------ */

describe("object storage keys are server-derived", () => {
  it("the upload route builds the key from a server-minted artwork id", () => {
    const route = read("app/api/artwork/upload/route.ts");
    expect(route).toContain("const artworkId = newId(");
    expect(route).toMatch(/const key = `artwork\/\$\{artworkId\}/);
  });

  it("the upload request schema is STRICT, so a client-supplied key is a 422", () => {
    const route = read("app/api/artwork/upload/route.ts");
    expect(route).toContain(".strict()");
    expect(route).not.toMatch(/storageKey:\s*z\./);
  });

  it("no client component builds an object key or calls storage", () => {
    for (const { file, source } of CLIENT_COMPONENTS) {
      expect(source, `${file} must not touch storage`).not.toMatch(/@\/lib\/storage/);
    }
  });

  it("blob: object URLs are never created for artwork any more (§21)", () => {
    for (const { file, source } of [...CLIENT_COMPONENTS, ...APP_FILES]) {
      expect(source, `${file} still creates a browser object URL`).not.toContain("createObjectURL");
    }
  });

  it("the checkout boundary strips any legacy url from an artwork ref", () => {
    const schema = read("lib/validation/checkout.ts");
    expect(schema).toMatch(/\.transform\(\(\{ url, \.\.\.ref \}\) => ref\)/);
    // And the persisted order-line shape has no url field at all.
    expect(read("lib/data/order-service.ts")).not.toMatch(/url: z\.string\(\)\.max\(2048\)/);
  });
});

/* ------------------------------------------------------------------ */
/* §58 — pricing authority is unchanged                                */
/* ------------------------------------------------------------------ */

describe("the deterministic pricing engine remains the price authority", () => {
  it("the Shopify provider never computes a price — it restates the engine's", () => {
    const source = read("lib/commerce/shopify.ts");
    expect(source).not.toMatch(/pricingTiers|calculatePrice|@\/modules\/pricing/);
    expect(source).toContain("priceOverride");
  });

  it("the checkout route still re-prices with the engine and still answers 409 REPRICED", () => {
    const route = read("app/api/checkout/route.ts");
    expect(route).toContain('from "@/modules/pricing"');
    expect(route).toContain('code: "REPRICED"');
    expect(route).toContain("status: 409");
  });

  it("no Shopify price can enter BagDirect — the provider reads prices only to VERIFY", () => {
    const source = read("lib/commerce/shopify.ts");
    // decimalStringToCents exists solely for verification; assert it is never
    // used to build a cart line or an order.
    expect(source).not.toMatch(/unitPriceCents:\s*decimalStringToCents/);
    expect(source).toContain("verifyDraftOrderPricing");
  });

  it("storefront tier prices are exactly Product #1's confirmed launch prices", () => {
    const hero = PRODUCTS.find((p) => p.id === "p-custom-takeout");
    expect(hero?.pricingTiers).toEqual([
      { minQty: 5000, unitPriceCents: 19 },
      { minQty: 10000, unitPriceCents: 15 },
    ]);
    // Extra Large is the same table plus a flat per-unit size delta.
    expect(hero?.sizes.map((s) => [s.id, s.priceDeltaCents])).toEqual([
      ["l", 0],
      ["xl", 4],
    ]);
  });

  it("cost configuration NEVER gates a sale — the S13.5 boundary is unmoved", () => {
    // The checkout route may LOG margin telemetry (it does, since S13.5) but
    // must never consult the price floor or cost readiness to decide whether
    // a customer may buy.
    const files = [
      ...COMMERCE_FILES,
      { file: "app/api/checkout/route.ts", source: read("app/api/checkout/route.ts") },
    ];
    for (const { file, source } of files) {
      expect(source, `${file} must not gate commerce on cost configuration`).not.toMatch(
        /evaluatePriceFloor|assessCostReadiness|isCostModelConfigured/,
      );
    }
  });

  it("the new Shopify and artwork layers never read the cost model at all", () => {
    const newFiles = [
      ...COMMERCE_FILES.filter((f) => /shopify|order-reconciliation|webhook/.test(f.file)),
      ...readAll(["lib/storage"]),
    ];
    for (const { file, source } of newFiles) {
      expect(source, `${file} must not import the cost model`).not.toMatch(/@\/config\/costs|@\/modules\/pricing/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* §58 — nothing else moved                                            */
/* ------------------------------------------------------------------ */

describe("no authority was added anywhere else", () => {
  it("the guardrail executor registry is still EMPTY", () => {
    expect(executorRegistry.list()).toEqual([]);
  });

  it("guarded auto-execution is still allowed for nothing", () => {
    expect(GUARDED_AUTO_ALLOWED_ACTION_TYPES).toHaveLength(0);
  });

  it("every guardrail limit is still null — this session chose no business number", () => {
    for (const [key, value] of Object.entries(GUARDRAIL_LIMITS)) {
      if (typeof value === "number" || value === null) {
        expect(value, `${key} must remain unset`).toBeNull();
      }
    }
  });

  it("Google Ads remains read-only — no mutate endpoint was introduced", () => {
    for (const { file, source } of readAll(["lib/google-ads"])) {
      expect(source, `${file} must stay read-only`).not.toMatch(/:mutate/);
    }
  });

  it("no commerce file imports an AI module", () => {
    for (const { file, source } of COMMERCE_FILES) {
      expect(source, `${file} must not import lib/ai`).not.toMatch(/from\s+["']@\/lib\/ai/);
    }
  });

  it("no experiment target renders on a commerce route or names a commerce surface", () => {
    // targets.ts legitimately MENTIONS artwork — in its protectedFields list,
    // i.e. as something an experiment may never change. The invariant is
    // about target KEYS and ROUTES.
    for (const key of EXPERIMENT_TARGET_KEYS) {
      expect(key, `${key} must not be a commerce surface`).not.toMatch(/checkout|cart|payment|artwork|price/i);
      const target = getExperimentTarget(key);
      for (const route of target?.routes ?? []) {
        expect(route, `${key} must not render on a commerce route`).not.toMatch(/checkout|cart|order/i);
      }
    }
  });

  it("every product-page target still protects PRICE from experiments", () => {
    for (const key of EXPERIMENT_TARGET_KEYS.filter((k) => k.startsWith("product."))) {
      expect(getExperimentTarget(key)?.protectedFields, `${key} stopped protecting price`).toContain("price");
    }
  });
});
