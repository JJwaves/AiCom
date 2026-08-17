import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSalesToolRegistry } from "@/lib/ai/tools";
import { executorRegistry } from "@/modules/guardrails";
import { RATE_LIMIT_ROUTES, policyFor } from "@/lib/rate-limit";

/**
 * Production Launch Session 03 §66 — structural boundaries.
 *
 * SHAPE, not behaviour. Each assertion exists because the alternative
 * failure is expensive and silent: an ad platform that can spend, an AI that
 * can pay, a purchase event fired from an unpaid checkout, an analytics
 * failure that mutates an order. Crossing any of these lines requires
 * deleting a test.
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

/** Comments are stripped: a doc block SAYING "no mutation here" is not a violation. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const readAll = (dirs: string[]) =>
  dirs
    .flatMap((d) => walk(path.join(repo, d)))
    .map((file) => ({ file: path.relative(repo, file), source: stripComments(readFileSync(file, "utf8")) }));

const read = (rel: string) => stripComments(readFileSync(path.join(repo, rel), "utf8"));

const GOOGLE_ADS_FILES = readAll(["lib/google-ads"]);
const SHOPIFY_READ_FILES = readAll(["lib/commerce"]).filter((f) => f.file.includes("shopify-orders"));
const ALL_SOURCE = readAll(["app", "components", "lib", "modules", "config", "db"]);

/* ------------------------------------------------------------------ */
/* Google Ads stays READ-ONLY (§7, §66)                                */
/* ------------------------------------------------------------------ */

describe("the Google Ads integration remains structurally read-only", () => {
  it("defines no mutate operation of any kind", () => {
    for (const { file, source } of GOOGLE_ADS_FILES) {
      expect(source, file).not.toMatch(/mutateCampaign|campaignBudgets:mutate|:mutate\b/);
      expect(source, file).not.toMatch(/\bmutation\b/i);
    }
  });

  it("gained NO conversion-upload capability from purchase tracking", () => {
    for (const { file, source } of GOOGLE_ADS_FILES) {
      expect(source, file).not.toMatch(/uploadClickConversions|uploadConversionAdjustments|conversionUploadService/i);
      expect(source, file).not.toMatch(/customerId.*:uploadCallConversions/i);
    }
  });

  it("issues only GAQL SELECT queries", () => {
    const queries = read("lib/google-ads/queries.ts");
    const statements = queries.match(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP)\b/gi) ?? [];
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.every((s) => s.toUpperCase() === "SELECT")).toBe(true);
  });

  it("the Google Ads conversion signal lives in the BROWSER analytics layer, not the reporting provider", () => {
    // The conversion is a consent-gated gtag send from the confirmed paid
    // page. It must never have been implemented by giving the read-only
    // reporting integration a write path.
    const conversions = read("lib/analytics/conversions.ts");
    expect(conversions).toMatch(/send_to/);
    for (const { file, source } of GOOGLE_ADS_FILES) {
      expect(source, file).not.toMatch(/send_to|gtag|conversion_label/i);
    }
  });
});

/* ------------------------------------------------------------------ */
/* The Shopify reconciliation reader cannot write (§25, §66)           */
/* ------------------------------------------------------------------ */

describe("the reconciliation reader is read-only against Shopify", () => {
  it("declares a query and no mutation", () => {
    expect(SHOPIFY_READ_FILES.length).toBe(1);
    const [{ source }] = SHOPIFY_READ_FILES;
    expect(source).toMatch(/query BagDirectRecentOrders/);
    expect(source).not.toMatch(/\bmutation\s+\w/);
    expect(source).not.toMatch(/orderUpdate|orderClose|orderCancel|refundCreate|draftOrderCreate/);
  });

  it("repairs go through the SAME reconciliation service the webhook uses — no second implementation", () => {
    const reconciliation = read("lib/commerce/reconciliation.ts");
    expect(reconciliation).toMatch(/reconcileOrderSnapshot/);
    // It must not reach past the reconciliation service into the order
    // primitives directly, which is how a second, divergent implementation
    // would begin.
    expect(reconciliation).not.toMatch(/markOrderPaid|recordServerEvent|markConverted/);
  });
});

/* ------------------------------------------------------------------ */
/* No business action executor was introduced (§66)                    */
/* ------------------------------------------------------------------ */

describe("no executor, and no new AI authority", () => {
  it("the guardrail executor registry is still EMPTY", () => {
    expect(executorRegistry.list()).toEqual([]);
  });

  it("the sales agent gained no payment, price, refund or ad capability", () => {
    const names = createSalesToolRegistry().names();
    for (const forbidden of [
      "modifyPrice",
      "issueRefund",
      "capturePayment",
      "markOrderPaid",
      "changeAdBudget",
      "createAdCampaign",
      "uploadConversion",
      "reconcileOrders",
      "deliverHandoff",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("nothing outside the reconciliation service and the webhook can mark an order paid", () => {
    const allowed = new Set([
      "lib/data/order-service.ts",
      "lib/commerce/order-reconciliation.ts",
    ]);
    for (const { file, source } of ALL_SOURCE) {
      if (allowed.has(file)) continue;
      expect(source, file).not.toMatch(/markOrderPaid\s*\(/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Purchase truth (§3, §59, §66)                                       */
/* ------------------------------------------------------------------ */

describe("a purchase can only come from a paid order", () => {
  it("the confirmation page no longer trusts a query parameter or stored order", () => {
    const page = read("app/order-status/page.tsx");
    expect(page).not.toMatch(/placed\s*===?\s*["']1["']/);
    expect(page).not.toMatch(/sessionStorage/);
    expect(page).toMatch(/fetchOrderConfirmation/);
  });

  it("no surface writes an order payload into browser storage for the confirmation page", () => {
    for (const { file, source } of ALL_SOURCE) {
      expect(source, file).not.toMatch(/sessionStorage\.setItem\(\s*`order:/);
      expect(source, file).not.toMatch(/persistMockOrderPayload/);
    }
  });

  it("the purchase analytics event is fired from exactly ONE module", () => {
    // The event TYPE is declared in track.ts; what matters is who CALLS it.
    const firing = ALL_SOURCE.filter(({ source }) => /track\(\{\s*name:\s*"purchase"/.test(source));
    expect(firing.map((f) => f.file)).toEqual(["lib/analytics/purchase.ts"]);
  });

  it("that module refuses to fire without a server-confirmed paid flag", () => {
    const purchase = read("lib/analytics/purchase.ts");
    expect(purchase).toMatch(/if \(!order\.paid\) return \{ fired: false \}/);
  });

  it("checkout creation returns no purchase signal to the browser", () => {
    const checkout = read("app/api/checkout/route.ts");
    expect(checkout).not.toMatch(/purchase["']?\s*[:,]/);
    // The pre-payment path must never emit the authoritative event.
    const pendingBody = checkout.slice(checkout.indexOf("async function persistPendingShopifyOrder"));
    expect(pendingBody).not.toMatch(/purchase_completed|markConverted/);
  });
});

/* ------------------------------------------------------------------ */
/* Analytics can never mutate commerce (§10, §66)                      */
/* ------------------------------------------------------------------ */

describe("analytics delivery is one-way", () => {
  it("the conversion layer imports no order, checkout or database module", () => {
    const conversions = read("lib/analytics/conversions.ts");
    expect(conversions).not.toMatch(/@\/lib\/data|@\/db|@\/lib\/commerce/);
  });

  it("the client purchase module can only READ an order confirmation", () => {
    const purchase = read("lib/analytics/purchase.ts");
    const fetches = purchase.match(/fetch\([^)]*\)/g) ?? [];
    expect(fetches.length).toBe(1);
    expect(fetches[0]).toContain("/api/orders/confirmation");
    expect(purchase).not.toMatch(/method:\s*["']POST["']/);
  });

  it("the confirmation endpoint is read-only", () => {
    const route = read("app/api/orders/confirmation/route.ts");
    expect(route).toMatch(/export async function GET/);
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
    // And it must not mint a session: a GET that writes is a write amplifier.
    expect(route).not.toMatch(/sessionFromRequest|setSessionCookies/);
  });
});

/* ------------------------------------------------------------------ */
/* Rate limiting covers what it claims to (§15, §66)                   */
/* ------------------------------------------------------------------ */

describe("every abuse-prone route is actually wired to the limiter", () => {
  const ROUTE_FILES: Record<string, string> = {
    events: "app/api/events/route.ts",
    configuration: "app/api/configuration/route.ts",
    cart_line: "app/api/cart/line/route.ts",
    quote: "app/api/quote/route.ts",
    checkout: "app/api/checkout/route.ts",
    artwork_upload: "app/api/artwork/upload/route.ts",
    artwork_complete: "app/api/artwork/[id]/complete/route.ts",
    ai_chat: "app/api/ai/chat/route.ts",
  };

  for (const [route, file] of Object.entries(ROUTE_FILES)) {
    it(`${route} enforces its policy`, () => {
      const source = read(file);
      expect(source).toMatch(/enforceRateLimit/);
      expect(source).toContain(`"${route}"`);
    });
  }

  it("the NETWORK scope is checked before a session is minted on public write routes", () => {
    for (const file of ["app/api/events/route.ts", "app/api/checkout/route.ts", "app/api/ai/chat/route.ts"]) {
      const source = read(file);
      const networkAt = source.indexOf('scopes: ["network"]');
      const sessionAt = source.indexOf("sessionFromRequest(req)");
      expect(networkAt, file).toBeGreaterThan(-1);
      expect(networkAt, file).toBeLessThan(sessionAt);
    }
  });

  it("no route invents its own token bucket outside the central architecture", () => {
    for (const { file, source } of ALL_SOURCE) {
      if (file.startsWith("lib/rate-limit/")) continue;
      expect(source, file).not.toMatch(/createRateLimiter\(/);
    }
  });

  it("every declared route is covered by a policy", () => {
    for (const route of RATE_LIMIT_ROUTES) expect(policyFor(route)).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* Privacy (§13, §66)                                                  */
/* ------------------------------------------------------------------ */

describe("raw network identity is never persisted", () => {
  it("only the identity module reads a forwarded-for header", () => {
    const readers = ALL_SOURCE.filter(({ source }) => /x-forwarded-for/i.test(source)).map((f) => f.file);
    expect(readers).toEqual(["lib/rate-limit/identity.ts"]);
  });

  it("the durable store receives a hashed key, never an address", () => {
    const identity = read("lib/rate-limit/identity.ts");
    expect(identity).toMatch(/createHmac\("sha256"/);
    // The durable store never sees a request at all — only an opaque key.
    const store = read("lib/rate-limit/store.ts");
    expect(store).not.toMatch(/x-forwarded-for|req\.headers|networkKey/i);
  });
});
