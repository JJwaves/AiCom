/**
 * AI Sales Agent (Session 05) — public surface.
 *
 * Server-only, like all of lib/ai. The API route calls runSalesAgentTurn;
 * tests script it with FakeAiProvider (directly via opts.provider, or via
 * the __setSalesTestProvider hook when driving the route).
 */

export { runSalesAgentTurn, __setSalesTestProvider } from "./agent";
export type {
  CartAddSignal,
  CheckoutActionSignal,
  SalesAgentResult,
  SalesTurnInput,
  SuggestedAction,
  SuggestedCartAction,
  SuggestedConfigurationAction,
} from "./agent";
export {
  EXTRACTION_FIELDS,
  extractionCandidateSchema,
  needExtractionSchema,
  runNeedExtraction,
  validateExtraction,
} from "./extraction";
export type { ExtractionCandidate, ExtractionOutcome, NeedExtraction, ValidatedExtraction } from "./extraction";
export { buildSalesContext } from "./context";
export { maybeSummarizeConversation, SUMMARY_EVERY_MESSAGES } from "./summarize";
