/**
 * OPTIONAL live AI smoke test — `npm run ai:smoke` (Session 05 spec §2, §35).
 *
 * Deliberately OUTSIDE the automated test suite: `npm test` and the build
 * never run this and never touch the network. It exists so an operator with
 * real credentials can verify, before enabling AI_SALES for customers:
 *
 *   1. the configured AI_MODEL_LOW_COST / STANDARD / REASONING ids are VALID
 *      model identifiers on the configured Anthropic account (model names
 *      age — never assume yesterday's ids still resolve), and
 *   2. one real LOW_COST round-trip works end-to-end through AiRuntime
 *      (flags → config → router → budget guard → provider → usage row).
 *
 * No credentials configured ⇒ prints how to configure and exits 0 (clean
 * skip). Never logs the key. Exit 1 only on a real failure.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

// Minimal .env/.env.local loader (no dependency): existing env always wins.
for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(path.join(process.cwd(), file), "utf8");
    for (const line of raw.split("\n")) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match || line.trim().startsWith("#")) continue;
      const [, key, value] = match;
      if (process.env[key] === undefined) {
        process.env[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // file absent — fine
  }
}

async function main(): Promise<number> {
  const { getAiConfig } = await import("@/lib/ai/config");
  const { AiRuntime } = await import("@/lib/ai/runtime");
  const { isFlagEnabled } = await import("@/config/flags");

  const config = getAiConfig();

  if (config.provider !== "anthropic") {
    console.log(`[ai:smoke] AI_PROVIDER=${config.provider} — only the anthropic provider is implemented; skipping.`);
    return 0;
  }
  if (!config.apiKey) {
    console.log(
      "[ai:smoke] No ANTHROPIC_API_KEY configured — skipping live smoke test cleanly.\n" +
        "           To run it: set ANTHROPIC_API_KEY (and AI_RUNTIME_ENABLED=true) in .env.local.",
    );
    return 0;
  }
  if (!isFlagEnabled("AI_RUNTIME")) {
    console.log("[ai:smoke] AI_RUNTIME_ENABLED is not true — skipping (set it in .env.local to smoke-test).");
    return 0;
  }

  // --- 1 · Verify the configured model ids actually exist on this account.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: config.apiKey, timeout: config.requestTimeoutMs });
  const entries = Object.entries(config.models) as [string, string][];
  const invalid: string[] = [];
  for (const [workload, model] of entries) {
    try {
      const info = await client.models.retrieve(model);
      console.log(`[ai:smoke] ${workload.padEnd(9)} ${model} ✓ (${info.display_name})`);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        invalid.push(`${workload}=${model}`);
        console.error(`[ai:smoke] ${workload.padEnd(9)} ${model} ✗ NOT a valid model id on this account`);
      } else {
        console.error(`[ai:smoke] ${workload.padEnd(9)} ${model} ✗ verification failed (status ${status ?? "?"})`);
        return 1;
      }
    }
  }
  if (invalid.length > 0) {
    try {
      const models = await client.models.list({ limit: 50 });
      console.error(
        `[ai:smoke] Fix .env (AI_MODEL_*): invalid ids [${invalid.join(", ")}]. ` +
          `Models available on this account include:\n  ${models.data.map((m) => m.id).join("\n  ")}`,
      );
    } catch {
      console.error(`[ai:smoke] Invalid model ids: ${invalid.join(", ")} (and the model list could not be fetched).`);
    }
    return 1;
  }

  // --- 2 · One real LOW_COST round-trip through the full runtime pipeline.
  const runtime = new AiRuntime();
  const started = Date.now();
  const result = await runtime.generateText({
    workload: "LOW_COST",
    prompt: { id: "runtime_smoke_test", vars: { tag: "ai:smoke" } },
    messages: [{ role: "user", content: "Reply with one short sentence confirming you can hear me." }],
    agentType: "smoke_test",
    maxOutputTokens: 2000,
  });
  console.log(
    `[ai:smoke] live call ✓ model=${result.model} finish=${result.finish} ` +
      `tokens=${result.usage.inputTokens ?? "?"}in/${result.usage.outputTokens ?? "?"}out ` +
      `latency=${Date.now() - started}ms\n[ai:smoke] reply: ${result.text.slice(0, 200)}`,
  );
  console.log("[ai:smoke] AiUsage row recorded (check ai_usage; estimatedCost is null until config/ai-pricing.ts is filled).");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // Never print the key — AiError messages don't carry it.
    console.error("[ai:smoke] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
