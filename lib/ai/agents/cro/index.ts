/**
 * CRO Agent (Session 11) — RECOMMEND only.
 *
 * OBSERVE deterministic conversion data → HYPOTHESISE → PROPOSE a fully
 * specified experiment (or flag a business review) → human approval in the
 * AI Action Center → explicit human launch. It never launches, measures,
 * or declares a winner. docs/CRO_AGENT.md is authoritative.
 */

export { generateCroReview, isCroAgentEnabled, croProposalIdentityKey, type CroReviewRunResult } from "./agent";
export {
  croProposalSchema,
  croReviewSchema,
  CRO_CONFIDENCE_LEVELS,
  CRO_PROPOSAL_KINDS,
  CRO_RISK_LEVELS,
  type CroProposal,
  type CroProposalKind,
  type CroReview,
} from "./schema";
export { buildCroContext, type CroContext } from "./context";
