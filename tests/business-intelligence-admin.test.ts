import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as ceoReviewPost } from "@/app/api/admin/business-intelligence/ceo-review/route";
import { createOrder } from "@/lib/data/order-service";
import { listCeoReports } from "@/lib/data/ceo-report-service";
import { buildBusinessIntelligenceReport, periodFromDays } from "@/modules/business-intelligence";
import { makeSession, resetDb } from "./db-helpers";
import { basicAuth } from "./ci-helpers";

/**
 * Session 09 — admin surface: fail-closed auth (S08 pattern reused, not a
 * second auth system), flag gating, strict body validation, and the
 * guarantee that deterministic BI works with NO AI configured while CEO
 * generation degrades honestly.
 */

const touched = new Set<string>();
function setEnv(key: string, value: string): void {
  touched.add(key);
  process.env[key] = value;
}
afterEach(() => {
  for (const key of touched) delete process.env[key];
  touched.clear();
});
beforeEach(async () => {
  await resetDb();
});

const enableAll = () => {
  setEnv("ADMIN_USER", "owner");
  setEnv("ADMIN_PASSWORD", "correct-horse-battery");
  setEnv("AI_BUSINESS_INTELLIGENCE_ENABLED", "true");
};

const reviewReq = (headers: Record<string, string> = {}, body = "{}") =>
  new Request("http://localhost/api/admin/business-intelligence/ceo-review", { method: "POST", headers, body });

describe("ceo-review route — auth and flag gates (fail closed)", () => {
  it("answers 404 while admin credentials are unconfigured (the surface does not exist)", async () => {
    setEnv("AI_BUSINESS_INTELLIGENCE_ENABLED", "true");
    const res = await ceoReviewPost(reviewReq({ authorization: basicAuth("owner", "pw") }));
    expect(res.status).toBe(404);
  });

  it("answers 401 on wrong credentials, 404 with the feature flag off", async () => {
    setEnv("ADMIN_USER", "owner");
    setEnv("ADMIN_PASSWORD", "pw");
    expect((await ceoReviewPost(reviewReq({ authorization: basicAuth("owner", "nope") }))).status).toBe(401);
    expect((await ceoReviewPost(reviewReq({ authorization: basicAuth("owner", "pw") }))).status).toBe(404);
  });

  it("validates its body strictly", async () => {
    enableAll();
    const auth = { authorization: basicAuth("owner", "correct-horse-battery") };
    expect((await ceoReviewPost(reviewReq(auth, "not json"))).status).toBe(400);
    expect((await ceoReviewPost(reviewReq(auth, JSON.stringify({ periodDays: 0 })))).status).toBe(422);
    expect((await ceoReviewPost(reviewReq(auth, JSON.stringify({ injected: true })))).status).toBe(422);
  });

  it("degrades honestly without an AI provider: 503 AI_UNAVAILABLE, nothing persisted", async () => {
    enableAll();
    const res = await ceoReviewPost(reviewReq({ authorization: basicAuth("owner", "correct-horse-battery") }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("AI_UNAVAILABLE");
    expect(await listCeoReports()).toHaveLength(0);
  });
});

describe("deterministic dashboard without AI (§32, §35)", () => {
  it("builds the full BI report with zero AI configuration and no persisted CEO review", async () => {
    await createOrder({
      sessionId: (await makeSession()).id,
      provider: "mock",
      currency: "USD",
      lines: [
        {
          productId: "p-custom-takeout",
          quantity: 1000,
          unitPriceCents: 54,
          totalCents: 54_000,
          title: "Bags",
          config: {
            productId: "p-custom-takeout",
            sizeId: "l",
            materialId: "standard",
            colorId: "black",
            printOptionId: "one-color",
            quantity: 1000,
            artwork: null,
          },
        },
      ],
    });

    const report = await buildBusinessIntelligenceReport(periodFromDays(30));
    expect(report.snapshot.commerce.revenue.revenueCents).toEqual({ status: "AVAILABLE", value: 54_000 });
    expect(report.snapshot.profitability.grossProfitCents.status).toBe("UNAVAILABLE");
    expect(report.ceoReport).toBeNull(); // "Generate your first CEO Review" state
    expect(report.ceoReportStale).toBe(false);
  });
});
