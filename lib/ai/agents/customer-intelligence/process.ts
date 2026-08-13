import { CUSTOMER_INTELLIGENCE } from "@/config/customer-intelligence";
import { isFlagEnabled } from "@/config/flags";
import { listCatalogProducts } from "@/lib/commerce/catalog";
import {
  listConversationsNeedingClassification,
  listUserMessages,
  upsertConversationClassification,
} from "@/lib/data/intelligence-service";
import { checkRequestSupport } from "@/modules/customer-intelligence/catalog-support";
import { CLASSIFIER_VERSION } from "@/modules/customer-intelligence/taxonomy";
import { getAiConfig } from "../../config";
import { AiError, isAiError } from "../../errors";
import { aiLog } from "../../log";
import { getPrompt } from "../../prompts/registry";
import { selectModel } from "../../router";
import { AiRuntime, isAiRuntimeAvailable } from "../../runtime";
import { classifyConversation } from "./classifier";

/**
 * Explicit customer-intelligence processing (Session 08 spec §16–§17).
 *
 * Triggered by an admin action — there is NO background worker and NO
 * per-page-load reprocessing. The run drains a bounded batch of
 * conversations that were never classified, were classified by an older
 * pipeline, failed last time, or grew new customer messages. Everything
 * already classified is skipped (idempotent by design).
 *
 * Failure policy (spec §33–§34):
 * - budget / provider / rate-limit / timeout errors ABORT the batch and
 *   leave the remaining conversations untouched (they stay pending — a
 *   budget stop is not a classification failure);
 * - an invalid model response for ONE conversation marks that conversation
 *   `failed` (with the error code) and the batch continues;
 * - flags off / no key / config errors return `unavailable` without
 *   touching any row. Deterministic metrics never depend on this running.
 */

export type ProcessRunResult = {
  status: "completed" | "aborted" | "unavailable";
  processed: number;
  failed: number;
  /** Conversations still needing classification after this run. */
  remaining: number;
  abortReason?: string;
  classifierVersion: string;
};

export function isCustomerIntelligenceAiEnabled(): boolean {
  return isFlagEnabled("AI_RUNTIME") && isFlagEnabled("AI_CUSTOMER_INTELLIGENCE") && isAiRuntimeAvailable();
}

/** Errors that stop the whole batch — retrying the next conversation would hit the same wall. */
const BATCH_ABORT_CODES = new Set(["AI_BUDGET_EXCEEDED", "AI_PROVIDER_UNAVAILABLE", "AI_RATE_LIMITED", "AI_TIMEOUT"]);

export async function processCustomerIntelligence(opts: { runtime?: AiRuntime; batchLimit?: number } = {}): Promise<ProcessRunResult> {
  const classifierVersion = CLASSIFIER_VERSION;
  const base: Omit<ProcessRunResult, "status"> = { processed: 0, failed: 0, remaining: 0, classifierVersion };

  if (!isFlagEnabled("AI_CUSTOMER_INTELLIGENCE") || (!opts.runtime && !isCustomerIntelligenceAiEnabled())) {
    return { ...base, status: "unavailable", abortReason: "AI_DISABLED" };
  }

  let runtime: AiRuntime;
  try {
    runtime = opts.runtime ?? new AiRuntime();
  } catch (err) {
    return { ...base, status: "unavailable", abortReason: isAiError(err) ? err.code : "AI_CONFIGURATION_ERROR" };
  }

  const limit = Math.max(1, Math.min(opts.batchLimit ?? CUSTOMER_INTELLIGENCE.CLASSIFICATION_BATCH_LIMIT, 200));
  const candidates = await listConversationsNeedingClassification(classifierVersion, limit);
  const products = await listCatalogProducts();
  const prompt = getPrompt("ai_customer_intelligence_classifier");
  let model: string | null = null;
  try {
    model = selectModel(getAiConfig(), "LOW_COST");
  } catch {
    model = null;
  }

  let processed = 0;
  let failed = 0;
  let abortReason: string | undefined;

  aiLog("customer_intelligence_run_started", { candidates: candidates.length, classifierVersion });

  for (const candidate of candidates) {
    const conversationId = candidate.conversation.id;
    const userMessages = await listUserMessages(conversationId);
    if (userMessages.length === 0) continue;
    try {
      const result = await classifyConversation(runtime, {
        conversationId,
        sessionId: candidate.conversation.sessionId,
        userMessages,
      });
      // Catalog support is decided HERE, deterministically — the model's
      // opinion about availability never reaches storage.
      const requests = result.requests.map((r) => ({
        kind: r.kind,
        normalized: r.normalized,
        messageId: r.messageId,
        support: checkRequestSupport(products, r).verdict,
      }));
      await upsertConversationClassification({
        conversationId,
        status: "classified",
        classifierVersion,
        promptId: prompt.id,
        promptVersion: prompt.version,
        model: model ?? undefined,
        questions: result.questions,
        objections: result.objections,
        unsupportedRequests: requests,
        userMessageCount: result.userMessageCount,
        sourceUpdatedAt: result.sourceUpdatedAt,
      });
      processed += 1;
    } catch (err) {
      const code = isAiError(err) ? err.code : "UNKNOWN";
      if (BATCH_ABORT_CODES.has(code)) {
        // Leave this conversation (and the rest) pending — the condition is
        // environmental, not a property of the conversation.
        abortReason = code;
        break;
      }
      if (code === "AI_DISABLED" || code === "AI_CONFIGURATION_ERROR") {
        abortReason = code;
        break;
      }
      // Conversation-specific failure (e.g. AI_INVALID_RESPONSE after
      // retries): record it so the run is auditable; retried next run.
      failed += 1;
      await upsertConversationClassification({
        conversationId,
        status: "failed",
        classifierVersion,
        promptId: prompt.id,
        promptVersion: prompt.version,
        model: model ?? undefined,
        errorCode: code.slice(0, 100),
        questions: [],
        objections: [],
        unsupportedRequests: [],
        userMessageCount: userMessages.length,
        sourceUpdatedAt: candidate.latestUserMessageAt,
      });
      if (!(err instanceof AiError)) {
        aiLog("customer_intelligence_classification_failed", { conversationId, code });
      }
    }
  }

  const remaining = (await listConversationsNeedingClassification(classifierVersion, 1000)).length;
  const status: ProcessRunResult["status"] = abortReason ? "aborted" : "completed";
  aiLog("customer_intelligence_run_finished", {
    status,
    processed,
    failed,
    remaining,
    abortReason: abortReason ?? null,
    classifierVersion,
  });
  return { status, processed, failed, remaining, abortReason, classifierVersion };
}
