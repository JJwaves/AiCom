/**
 * Controlled taxonomies for customer intelligence (Session 08).
 *
 * These enums are the ONLY vocabularies classification may emit — the
 * classifier's structured output is zod-validated against them and any
 * value outside the list is a validation failure, never a new category.
 * Unknown themes map to OTHER and become candidates for future taxonomy
 * review; the model cannot invent categories.
 *
 * QUESTION vs OBJECTION is a hard distinction (tested):
 * - "What is your MOQ?"            → MOQ question, NOT an objection.
 * - "500 is too many, I need 200." → MOQ_TOO_HIGH objection.
 * - "How much does shipping cost?" → SHIPPING question.
 * - "Shipping is too expensive."   → SHIPPING_COST objection.
 * A question asks for information; an objection expresses that something
 * about our offer blocks or discourages the purchase.
 */

/** What customers ask about. */
export const QUESTION_THEMES = [
  /** Shipping cost, methods, destinations ("Do you ship to Canada?", "How much is shipping?"). */
  "SHIPPING",
  /** Production + delivery time ("How long does shipping/production take?", "When would I get them?"). */
  "DELIVERY_TIME",
  /** Minimum order quantity ("What is your MOQ?", "What's the minimum I can order?"). */
  "MOQ",
  /** Pricing ("How much per bag?", "Is there a bulk discount?"). */
  "PRICE",
  /** Bag dimensions/size options ("What sizes do you have?", "How big is the large?"). */
  "SIZE",
  /** What fits inside ("Can this hold three takeout containers?"). */
  "CAPACITY",
  /** Logo/printing ("Can you print both sides?", "How many colors can you print?"). */
  "PRINTING",
  /** Color options ("Do you have navy?", "What colors are available?"). */
  "COLOR",
  /** Material/fabric/weight ("What material are they?", "Are they waterproof?"). */
  "MATERIAL",
  /** Artwork files/proofs ("What file format do you need?", "Will I see a proof?"). */
  "ARTWORK",
  /** Custom products/dimensions beyond the configurator ("Can you make a custom size?"). */
  "CUSTOM_PRODUCT",
  /** Repeat orders ("Can I reorder the same bags later?"). */
  "REORDER",
  /** Whether we sell a product at all ("Do you sell insulated bags?"). */
  "PRODUCT_AVAILABILITY",
  /** Anything not covered above — candidates for future taxonomy review. */
  "OTHER",
] as const;

export type QuestionTheme = (typeof QUESTION_THEMES)[number];

/** What blocks or discourages the purchase — distinct from questions. */
export const OBJECTION_TYPES = [
  "PRICE_TOO_HIGH",
  "MOQ_TOO_HIGH",
  "SHIPPING_COST",
  "DELIVERY_TOO_LONG",
  "PRODUCT_NOT_AVAILABLE",
  "SIZE_NOT_AVAILABLE",
  "COLOR_NOT_AVAILABLE",
  "MATERIAL_NOT_AVAILABLE",
  "PRINTING_NOT_AVAILABLE",
  "CUSTOMIZATION_LIMITATION",
  "NEEDS_MORE_INFORMATION",
  "OTHER",
] as const;

export type ObjectionType = (typeof OBJECTION_TYPES)[number];

/** Dimensions a customer request can name; support is decided against the catalog, never by the model. */
export const REQUEST_KINDS = ["product", "size", "color", "material", "printing", "capacity", "other"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/**
 * Deterministic catalog verdicts for a customer request:
 * - supported          — the standard catalog covers it.
 * - custom_quote_path  — not a standard option, but an existing custom-quote
 *                        route covers it (custom color, custom dimensions,
 *                        below-MOQ). A demand signal, NOT a product gap.
 * - unsupported        — nothing in the catalog or its quote paths covers it.
 *                        Only these feed PRODUCT_GAP intelligence.
 */
export const SUPPORT_VERDICTS = ["supported", "custom_quote_path", "unsupported"] as const;
export type SupportVerdict = (typeof SUPPORT_VERDICTS)[number];

/** Insight types persisted by Session 08 generation (customer_insights.insightType). */
export const INSIGHT_TYPES = [
  "CUSTOMER_QUESTION",
  "OBJECTION_PATTERN",
  "DEMAND_PATTERN",
  "PRODUCT_GAP",
  "MOQ_SIGNAL",
  "SHIPPING_SIGNAL",
  "PRICING_SIGNAL",
  "SEGMENT_PATTERN",
  "CONVERSION_PATTERN",
] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];

/** Opportunity types persisted by Session 08 generation (product_opportunities.opportunityType). */
export const OPPORTUNITY_TYPES = ["lower_moq", "unsupported_product"] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

/**
 * Reporting outcome groups, funnel-ranked. Derived deterministically from
 * conversation status/outcome + session events — never from the model.
 * Escalated conversations keep their escalated outcome (S05–S07 semantics:
 * a handoff outranks later funnel stamps), so human_handoff is reported as
 * its own lane. "abandoned" is deliberately absent — no inactivity rule
 * exists yet, so nothing is labeled abandoned (deferred).
 */
export const OUTCOME_GROUPS = [
  "purchased",
  "checkout_started",
  "cart_added",
  "quote_started",
  "human_handoff",
  "product_recommended",
  "engaged_no_purchase",
  "conversation_only",
] as const;
export type OutcomeGroup = (typeof OUTCOME_GROUPS)[number];

/** Current classification pipeline version — bump on any taxonomy/prompt/validation semantics change. */
export const CLASSIFIER_VERSION = "1.0.0";
