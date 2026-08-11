import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_MODEL_PRICING } from "@/config/ai-pricing";
import { getAiConfig } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import { assertWithinAiBudget, startOfUtcDay, startOfUtcMonth } from "@/lib/ai/usage/budget-guard";
import { recordAiUsage } from "@/lib/data/ai-usage-service";
import { resetDb } from "./db-helpers";

/**
 * Budget guard: real DB aggregates, plus a switchable totals failure to
 * prove the fail-closed path (infrastructure failure ≠ unlimited spend).
 */
const totalsOutage = vi.hoisted(() => ({ active: false }));
vi.mock("@/lib/data/ai-usage-service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/data/ai-usage-service")>();
  return {
    ...mod,
    aiUsageTotalsSince: async (since: Date) => {
      if (totalsOutage.active) throw new Error("simulated database outage");
      return mod.aiUsageTotalsSince(since);
    },
  };
});

const PRICED = "test-priced-model";

async function spend(estimatedCostMicros: number): Promise<void> {
  await recordAiUsage({
    provider: "anthropic",
    model: PRICED,
    requestType: "text",
    inputTokens: 10,
    outputTokens: 10,
    estimatedCostMicros,
    success: true,
  });
}

async function codeOf(promise: Promise<unknown>): Promise<{ code: string; detail?: string } | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(AiError);
    const e = err as AiError;
    return { code: e.code, detail: e.detail };
  }
}

describe("AI spend guard", () => {
  beforeEach(async () => {
    await resetDb();
    totalsOutage.active = false;
    AI_MODEL_PRICING[PRICED] = { usdPerMTokIn: 1, usdPerMTokOut: 5 };
    return () => {
      delete AI_MODEL_PRICING[PRICED];
    };
  });

  it("computes UTC windows", () => {
    const now = new Date("2026-08-10T15:30:00Z");
    expect(startOfUtcDay(now).toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(startOfUtcMonth(now).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("no budget configured → proceeds, even for unpriced models (documented default)", async () => {
    await expect(assertWithinAiBudget(getAiConfig({}), "claude-sonnet-5")).resolves.toBeUndefined();
  });

  it("budgets over an unpriced model fail closed as configuration error", async () => {
    const config = getAiConfig({ AI_DAILY_BUDGET_USD: "5" });
    const failure = await codeOf(assertWithinAiBudget(config, "claude-sonnet-5"));
    expect(failure).toEqual({ code: "AI_CONFIGURATION_ERROR", detail: "unpriced_model_under_budget" });
  });

  it("under the daily cap → proceeds; at/over the cap → AI_BUDGET_EXCEEDED", async () => {
    const config = getAiConfig({ AI_DAILY_BUDGET_USD: "1" }); // $1 = 1,000,000 micros
    await spend(400_000);
    await expect(assertWithinAiBudget(config, PRICED)).resolves.toBeUndefined();
    await spend(600_000); // total exactly $1
    const failure = await codeOf(assertWithinAiBudget(config, PRICED));
    expect(failure).toEqual({ code: "AI_BUDGET_EXCEEDED", detail: "daily_exceeded" });
  });

  it("enforces the monthly cap independently of the daily cap", async () => {
    const config = getAiConfig({ AI_MONTHLY_BUDGET_USD: "2" });
    await spend(2_500_000);
    const failure = await codeOf(assertWithinAiBudget(config, PRICED));
    expect(failure).toEqual({ code: "AI_BUDGET_EXCEEDED", detail: "monthly_exceeded" });
  });

  it("survives very large usage totals (float8 aggregates through the guard)", async () => {
    const config = getAiConfig({ AI_MONTHLY_BUDGET_USD: "10000" }); // $10,000
    for (let i = 0; i < 3; i++) await spend(2_000_000_000); // $6,000 total — past int4 sum range
    await expect(assertWithinAiBudget(config, PRICED)).resolves.toBeUndefined();
    for (let i = 0; i < 3; i++) await spend(2_000_000_000); // $12,000 total
    const failure = await codeOf(assertWithinAiBudget(config, PRICED));
    expect(failure).toEqual({ code: "AI_BUDGET_EXCEEDED", detail: "monthly_exceeded" });
  });

  it("fails CLOSED when the totals query itself fails", async () => {
    const config = getAiConfig({ AI_DAILY_BUDGET_USD: "100" });
    totalsOutage.active = true;
    const failure = await codeOf(assertWithinAiBudget(config, PRICED));
    expect(failure).toEqual({ code: "AI_BUDGET_EXCEEDED", detail: "check_failed" });
  });
});
