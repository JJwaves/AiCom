import { afterEach, describe, expect, it } from "vitest";
import { FEATURE_FLAGS, flagEnvVar, isFlagEnabled } from "@/config/flags";
import { AiError, createProvider, getAiConfig, isAiRuntimeAvailable, selectModel } from "@/lib/ai";
import { getPrompt, listPrompts, renderPrompt } from "@/lib/ai/prompts/registry";

/** Env hygiene: tests/setup.ts wipes AI_* at worker start; each test cleans what it sets. */
const touched = new Set<string>();
function setEnv(key: string, value: string): void {
  touched.add(key);
  process.env[key] = value;
}
afterEach(() => {
  for (const key of touched) delete process.env[key];
  touched.clear();
});

describe("feature flags", () => {
  it("default every flag to OFF", () => {
    for (const flag of FEATURE_FLAGS) expect(isFlagEnabled(flag)).toBe(false);
  });

  it("enable only on exactly 'true' or '1'", () => {
    setEnv(flagEnvVar("AI_RUNTIME"), "true");
    expect(isFlagEnabled("AI_RUNTIME")).toBe(true);
    setEnv(flagEnvVar("AI_RUNTIME"), "1");
    expect(isFlagEnabled("AI_RUNTIME")).toBe(true);
    for (const junk of ["false", "TRUE", "yes", "on", ""]) {
      setEnv(flagEnvVar("AI_RUNTIME"), junk);
      expect(isFlagEnabled("AI_RUNTIME")).toBe(false);
    }
  });
});

describe("AI env configuration", () => {
  it("parses defaults with an empty env", () => {
    const config = getAiConfig({});
    expect(config.provider).toBe("anthropic");
    expect(config.apiKey).toBeNull();
    expect(config.models).toEqual({
      LOW_COST: "claude-haiku-4-5",
      STANDARD: "claude-sonnet-5",
      REASONING: "claude-opus-5",
    });
    expect(config.dailyBudgetUsd).toBeNull();
    expect(config.monthlyBudgetUsd).toBeNull();
    expect(config.requestTimeoutMs).toBe(30_000);
    expect(config.limits).toEqual({
      maxToolCallsPerTurn: 8,
      maxModelCallsPerTurn: 5,
      maxTurnDurationMs: 120_000,
      structuredRetryLimit: 1,
    });
  });

  it("honors overrides and reads only the selected provider's key", () => {
    const config = getAiConfig({
      AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-test",
      OPENAI_API_KEY: "sk-other",
      AI_MODEL_LOW_COST: "my-cheap-model",
      AI_DAILY_BUDGET_USD: "12.5",
      AI_MONTHLY_BUDGET_USD: "300",
      AI_MAX_TOOL_CALLS_PER_TURN: "3",
    });
    expect(config.apiKey).toBe("sk-test");
    expect(config.models.LOW_COST).toBe("my-cheap-model");
    expect(config.dailyBudgetUsd).toBe(12.5);
    expect(config.monthlyBudgetUsd).toBe(300);
    expect(config.limits.maxToolCallsPerTurn).toBe(3);
  });

  it("rejects malformed budgets with a typed configuration error", () => {
    for (const bad of ["-5", "0", "not-a-number"]) {
      expect(() => getAiConfig({ AI_DAILY_BUDGET_USD: bad })).toThrowError(AiError);
      try {
        getAiConfig({ AI_DAILY_BUDGET_USD: bad });
      } catch (err) {
        expect((err as AiError).code).toBe("AI_CONFIGURATION_ERROR");
      }
    }
  });

  it("routes workloads to configured models", () => {
    const config = getAiConfig({ AI_MODEL_REASONING: "big-brain-model" });
    expect(selectModel(config, "LOW_COST")).toBe("claude-haiku-4-5");
    expect(selectModel(config, "STANDARD")).toBe("claude-sonnet-5");
    expect(selectModel(config, "REASONING")).toBe("big-brain-model");
  });
});

describe("provider factory", () => {
  it("requires an API key for anthropic", () => {
    try {
      createProvider(getAiConfig({}));
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as AiError).code).toBe("AI_CONFIGURATION_ERROR");
      expect((err as AiError).message).toContain("ANTHROPIC_API_KEY");
    }
  });

  it("builds the anthropic provider when configured", () => {
    const provider = createProvider(getAiConfig({ ANTHROPIC_API_KEY: "sk-test" }));
    expect(provider.name).toBe("anthropic");
  });

  it("fails loudly for interface-supported but unimplemented providers", () => {
    for (const name of ["openai", "gemini"] as const) {
      try {
        createProvider(getAiConfig({ AI_PROVIDER: name }));
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as AiError).code).toBe("AI_CONFIGURATION_ERROR");
        expect((err as AiError).message).toContain("not implemented");
      }
    }
  });
});

describe("isAiRuntimeAvailable (graceful degradation probe)", () => {
  it("is false without the flag, false without a key, true with both — and never throws", () => {
    expect(isAiRuntimeAvailable({})).toBe(false);
    setEnv("AI_RUNTIME_ENABLED", "true");
    expect(isAiRuntimeAvailable({})).toBe(false);
    expect(isAiRuntimeAvailable({ ANTHROPIC_API_KEY: "sk-test" })).toBe(true);
    expect(isAiRuntimeAvailable({ AI_DAILY_BUDGET_USD: "garbage" })).toBe(false);
  });
});

describe("prompt registry", () => {
  it("resolves versioned prompts and lists them", () => {
    const def = getPrompt("runtime_smoke_test");
    expect(def.version).toBe("1.0.0");
    expect(listPrompts().map((p) => p.id)).toContain("structured_output_retry");
  });

  it("renders strictly: every placeholder filled, every var used", () => {
    const def = getPrompt("runtime_smoke_test");
    expect(renderPrompt(def, { tag: "vitest" })).toContain("Context tag: vitest.");
    expect(() => renderPrompt(def, {})).toThrowError(/missing variable "tag"/);
    expect(() => renderPrompt(def, { tag: "x", extra: "y" })).toThrowError(/does not use variable "extra"/);
  });
});
