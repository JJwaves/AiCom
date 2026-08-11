import { z } from "zod";
import { applyNeedProfileUpdate, needProfileUpdateSchema } from "@/lib/data/customer-need-service";
import type { ToolDefinition } from "./types";

/**
 * saveCustomerNeed — the single CUSTOMER_WRITE tool of Session 04.
 *
 * Safety properties:
 * - Writes ONLY through the Session-03 CustomerNeedProfile service.
 * - Provenance is hard-coded AI_INFERRED: applyNeedProfileUpdate's rank gate
 *   makes it structurally impossible for AI inference to overwrite
 *   USER_STATED / ORDER_DATA / CONFIGURATOR / SYSTEM_DERIVED facts. (S04 has
 *   no safe channel to preserve a "customer said this verbatim" distinction;
 *   until one exists, everything AI writes is AI_INFERRED.)
 * - The session identity comes from ToolExecutionContext (server-minted) —
 *   the model cannot name a session to write to.
 * - Unknown stays unknown: omit fields you are not confident about; never
 *   guess numbers from vague statements ("about 5000" is NOT quantity:5000).
 * - This tool NEVER writes USER_STATED. The only path that can is the
 *   server-side evidence-validated extractor
 *   (lib/ai/agents/sales/extraction.ts), which verifies the quoted evidence
 *   against the customer's actual message before granting that rank.
 *
 * CONCURRENCY: resolved in Session 05 — applyNeedProfileUpdate now runs in
 * a transaction holding SELECT … FOR UPDATE on the profile row, so this
 * tool, the async extractor, and checkout/quote writers serialize safely
 * (tests/need-profile-concurrency.test.ts).
 */

const saveNeedInput = z.object({
  update: needProfileUpdateSchema,
  /** Extraction confidence 0–1 for the whole update; stored per applied field. */
  confidence: z.number().min(0).max(1).optional(),
});

const saveNeedOutput = z.object({
  saved: z.boolean(),
  /** Fields actually written (provenance gate may drop others silently). */
  appliedFields: z.array(z.string()),
  /** Requested fields the provenance gate skipped (a stronger source already set them). */
  skippedFields: z.array(z.string()),
});

export const saveCustomerNeedTool: ToolDefinition<z.infer<typeof saveNeedInput>, z.infer<typeof saveNeedOutput>> = {
  name: "saveCustomerNeed",
  description:
    "Persist structured facts inferred about the customer's needs (business type, quantities, size/material/print " +
    "preferences, pain points…). Include ONLY fields the customer clearly conveyed — unknown stays unknown; never parse " +
    "vague statements into numbers. Arrays replace the stored list wholesale. Writes are provenance-ranked AI_INFERRED " +
    "and can never overwrite what the customer explicitly stated or did.",
  permission: "CUSTOMER_WRITE",
  inputSchema: saveNeedInput,
  outputSchema: saveNeedOutput,
  async execute(input, ctx) {
    if (!ctx.sessionId) {
      // Server-side misuse (sales tools always run with a session) — surfaced as execution_failed.
      throw new Error("saveCustomerNeed requires a session-scoped ToolExecutionContext");
    }
    const requested = Object.keys(input.update);
    if (requested.length === 0) {
      return { saved: false, appliedFields: [], skippedFields: [] };
    }
    const { appliedFields } = await applyNeedProfileUpdate(ctx.sessionId, input.update, "AI_INFERRED", {
      confidence: input.confidence,
      customerId: ctx.customerId ?? null,
    });
    return {
      saved: appliedFields.length > 0,
      appliedFields,
      skippedFields: requested.filter((f) => !appliedFields.includes(f)),
    };
  },
};
