import { aiUsageTotalsSince } from "@/lib/data/ai-usage-service";
import type { AiConfig } from "../config";
import { AiError } from "../errors";
import { aiLog } from "../log";
import { isModelPriced } from "./cost";

/**
 * AI spend guard — prevents uncontrolled LLM spend. This is NOT the future
 * Guardrail Engine for business actions; it only gates provider calls
 * against AI_DAILY_BUDGET_USD / AI_MONTHLY_BUDGET_USD.
 *
 * Behavior matrix (documented in docs/AI_RUNTIME.md):
 *   no budget configured        → proceed (spend still recorded, not capped)
 *   under all configured caps   → proceed
 *   any cap reached             → AI_BUDGET_EXCEEDED (daily_exceeded/monthly_exceeded)
 *   budgets set, model unpriced → AI_CONFIGURATION_ERROR — a cap over spend
 *                                 we can't measure is unenforceable; fill
 *                                 config/ai-pricing.ts or unset the budgets
 *   totals query fails          → AI_BUDGET_EXCEEDED (check_failed) — an
 *                                 infrastructure failure must FAIL CLOSED,
 *                                 never open an unlimited-spend window
 *
 * Windows are UTC calendar day/month over AiUsage.estimatedCostMicros
 * (float8-safe aggregates from Session 03.5).
 */

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function assertWithinAiBudget(config: AiConfig, model: string, now: Date = new Date()): Promise<void> {
  const { dailyBudgetUsd, monthlyBudgetUsd } = config;
  if (dailyBudgetUsd === null && monthlyBudgetUsd === null) return;

  if (!isModelPriced(model)) {
    throw new AiError(
      "AI_CONFIGURATION_ERROR",
      `AI budget caps are configured but model "${model}" has no pricing in config/ai-pricing.ts — ` +
        "budgets cannot be enforced over unmeasurable spend (fill the pricing table or unset AI_*_BUDGET_USD)",
      { detail: "unpriced_model_under_budget" },
    );
  }

  let dailyMicros: number | null = null;
  let monthlyMicros: number | null = null;
  try {
    if (dailyBudgetUsd !== null) {
      dailyMicros = (await aiUsageTotalsSince(startOfUtcDay(now))).estimatedCostMicros;
    }
    if (monthlyBudgetUsd !== null) {
      monthlyMicros = (await aiUsageTotalsSince(startOfUtcMonth(now))).estimatedCostMicros;
    }
  } catch (err) {
    aiLog("budget_rejected", { reason: "check_failed", error: err instanceof Error ? err.message : String(err) });
    throw new AiError("AI_BUDGET_EXCEEDED", "AI budget check unavailable — failing closed (no unlimited-spend window)", {
      detail: "check_failed",
      cause: err,
    });
  }

  if (dailyBudgetUsd !== null && dailyMicros !== null && dailyMicros >= dailyBudgetUsd * 1_000_000) {
    aiLog("budget_rejected", { reason: "daily_exceeded", spentMicros: dailyMicros, capUsd: dailyBudgetUsd });
    throw new AiError("AI_BUDGET_EXCEEDED", `daily AI budget reached ($${dailyBudgetUsd})`, { detail: "daily_exceeded" });
  }
  if (monthlyBudgetUsd !== null && monthlyMicros !== null && monthlyMicros >= monthlyBudgetUsd * 1_000_000) {
    aiLog("budget_rejected", { reason: "monthly_exceeded", spentMicros: monthlyMicros, capUsd: monthlyBudgetUsd });
    throw new AiError("AI_BUDGET_EXCEEDED", `monthly AI budget reached ($${monthlyBudgetUsd})`, { detail: "monthly_exceeded" });
  }
}
