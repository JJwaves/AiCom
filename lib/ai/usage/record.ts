import { recordAiUsage } from "@/lib/data/ai-usage-service";
import { aiLog } from "../log";
import { estimateCostMicros } from "./cost";

/**
 * AiUsage recording — every real provider request (success OR failure)
 * attempts a row through the Session-03 service. Persistence failures are
 * NON-FATAL (same doctrine as commerce persistence: telemetry must never
 * take down a customer-facing response) but always loudly logged so silent
 * spend-tracking gaps are observable.
 */

export type UsageRecordInput = {
  provider: string;
  model: string;
  requestType: "text" | "structured" | "tool_conversation";
  agentType?: string;
  sessionId?: string;
  conversationId?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  promptId?: string;
  promptVersion?: string;
};

export async function recordUsageNonFatal(input: UsageRecordInput): Promise<void> {
  const estimated = estimateCostMicros(input.model, input.inputTokens, input.outputTokens);
  try {
    await recordAiUsage({
      ...input,
      estimatedCostMicros: estimated ?? undefined,
    });
  } catch (err) {
    aiLog("usage_record_failed", {
      provider: input.provider,
      model: input.model,
      requestType: input.requestType,
      success: input.success,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
