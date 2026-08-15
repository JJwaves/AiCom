import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Touch } from "@/lib/attribution/attribution";
import type { ArtworkRef, ProductConfiguration } from "@/types/commerce";

/**
 * BagDirect data foundation — Postgres schema (Session 03).
 *
 * Conventions (see docs/DATABASE_SCHEMA.md):
 * - ids are app-generated prefixed hex ids (`sess_…`, `conv_…`) — lib/data/id.ts
 * - money is integer cents; AI cost is integer micro-dollars (fractions of a
 *   cent are real at per-call granularity)
 * - timestamps are timestamptz, written in UTC
 * - enum-like columns are TEXT validated by zod at the service boundary
 *   (lib/data/*) — keeps migrations additive when statuses grow
 * - JSON snapshots reuse the existing domain types from types/commerce.ts /
 *   lib/attribution — the DB stores the same shapes the app already speaks
 * - Shopify stays the commerce system of record for finalized orders; rows
 *   here link to it via provider ids and never duplicate its admin data
 *
 * Privacy: FKs are set up so deleting a session or customer either cascades
 * (behavioral data) or detaches (commerce records) — see lib/data/privacy.ts.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

/* ------------------------------------------------------------------ */
/* Identity & commerce spine                                           */
/* ------------------------------------------------------------------ */

export const businesses = pgTable("businesses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  businessType: text("business_type"),
  industry: text("industry"),
  website: text("website"),
  city: text("city"),
  stateProvince: text("state_province"),
  country: text("country"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey(),
    /** Link to the Shopify customer once one exists — never duplicated data. */
    shopifyCustomerId: text("shopify_customer_id").unique(),
    email: text("email").unique(),
    phone: text("phone"),
    name: text("name"),
    businessId: text("business_id").references(() => businesses.id, { onDelete: "set null" }),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("customers_business_idx").on(t.businessId)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** Server-minted, carried in the `bd_sid` httpOnly cookie. */
    id: text("id").primaryKey(),
    /** Browser-durable id (`bd_aid` cookie) so future logins can merge sessions. */
    anonymousId: text("anonymous_id").notNull(),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    businessId: text("business_id").references(() => businesses.id, { onDelete: "set null" }),
    userAgent: text("user_agent"),
    /** Attribution snapshots — same Touch shape as lib/attribution. First touch is immutable once set. */
    firstTouchJson: jsonb("first_touch_json").$type<Touch>(),
    lastTouchJson: jsonb("last_touch_json").$type<Touch>(),
    startedAt: ts("started_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    convertedAt: ts("converted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_anonymous_idx").on(t.anonymousId), index("sessions_customer_idx").on(t.customerId)],
);

/** One live configuration per session × product, versioned in place. Orders/quotes embed their own immutable copies. */
export const productConfigurations = pgTable(
  "product_configurations",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    /** Increments on every upsert of this session×product row. */
    version: integer("version").notNull().default(1),
    configJson: jsonb("config_json").$type<ProductConfiguration>().notNull(),
    /** Sell-side price snapshot only (unit/total/currency) — NEVER cost or margin data. */
    priceSnapshotJson: jsonb("price_snapshot_json").$type<{
      unitPriceCents: number;
      totalCents: number;
      currency: string;
    }>(),
    /** Who wrote the latest version: configurator | checkout | quote | ai. */
    source: text("source").notNull().default("configurator"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("product_configurations_session_product_uq").on(t.sessionId, t.productId)],
);

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    businessId: text("business_id").references(() => businesses.id, { onDelete: "set null" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    /** Commerce system of record: mock | shopify. */
    provider: text("provider").notNull(),
    /** Shopify order id (or mock order id). The provider owns the order truth. */
    providerOrderId: text("provider_order_id"),
    /** Shopify checkout/cart reference for pre-order linking (null for mock). */
    providerCheckoutRef: text("provider_checkout_ref"),
    currency: text("currency").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    status: text("status").notNull().default("created"),
    aiAssisted: boolean("ai_assisted").notNull().default(false),
    attributionJson: jsonb("attribution_json").$type<Record<string, string>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("orders_session_idx").on(t.sessionId),
    index("orders_customer_idx").on(t.customerId),
    index("orders_provider_order_idx").on(t.provider, t.providerOrderId),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    title: text("title").notNull(),
    optionSummary: text("option_summary"),
    /** Immutable ProductConfiguration snapshot — reproducible even if config files change later. */
    configJson: jsonb("config_json").$type<ProductConfiguration>().notNull(),
    artworkJson: jsonb("artwork_json").$type<ArtworkRef>(),
    createdAt: createdAt(),
  },
  (t) => [index("order_lines_order_idx").on(t.orderId)],
);

export const quotes = pgTable(
  "quotes",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    businessId: text("business_id").references(() => businesses.id, { onDelete: "set null" }),
    configurationId: text("configuration_id").references(() => productConfigurations.id, { onDelete: "set null" }),
    /** draft | submitted | priced | customer_review | accepted | rejected | expired | manual_review */
    status: text("status").notNull().default("submitted"),
    /** The validated quote request (contact + requirement fields). Redacted on customer deletion. */
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
    /** Sell-side price snapshot for future AI draft quotes — never cost/margin data. */
    priceSnapshotJson: jsonb("price_snapshot_json").$type<{
      unitPriceCents: number;
      totalCents: number;
      currency: string;
    }>(),
    shippingEstimateJson: jsonb("shipping_estimate_json").$type<Record<string, unknown>>(),
    expiresAt: ts("expires_at"),
    /** Shopify draft order id once AI/admin quoting creates one. */
    providerDraftOrderId: text("provider_draft_order_id"),
    /** customer | ai | admin */
    createdBy: text("created_by").notNull().default("customer"),
    attributionJson: jsonb("attribution_json").$type<Record<string, string>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("quotes_session_idx").on(t.sessionId), index("quotes_customer_idx").on(t.customerId)],
);

export const artworks = pgTable(
  "artworks",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    orderId: text("order_id").references(() => orders.id, { onDelete: "set null" }),
    quoteId: text("quote_id").references(() => quotes.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Object-storage location once binary storage exists (launch task) — metadata only today. */
    storageUrl: text("storage_url"),
    notes: text("notes"),
    /** uploaded | review_required | proof_created | proof_sent | approved | revision_requested | production_ready */
    status: text("status").notNull().default("uploaded"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("artworks_quote_idx").on(t.quoteId), index("artworks_order_idx").on(t.orderId)],
);

/* ------------------------------------------------------------------ */
/* First-party events                                                  */
/* ------------------------------------------------------------------ */

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** Platform taxonomy name (product_viewed, …) — validated in lib/data/event-service.ts. */
    name: text("name").notNull(),
    page: text("page"),
    productId: text("product_id"),
    configurationId: text("configuration_id").references(() => productConfigurations.id, { onDelete: "set null" }),
    orderId: text("order_id").references(() => orders.id, { onDelete: "set null" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    experimentId: text("experiment_id").references(() => experiments.id, { onDelete: "set null" }),
    /** Bounded scalar props — size/shape enforced at the service boundary. No PII by policy. */
    propsJson: jsonb("props_json").$type<Record<string, string | number | boolean | null>>().notNull(),
    /** Client-generated id — dedups beacon retries. Server events mint their own. */
    clientEventId: text("client_event_id").notNull().unique(),
    /** When it happened on the client; receivedAt is the server clock. */
    occurredAt: ts("occurred_at").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [index("events_session_idx").on(t.sessionId, t.occurredAt), index("events_name_idx").on(t.name, t.occurredAt)],
);

/* ------------------------------------------------------------------ */
/* Conversations & need profiles                                       */
/* ------------------------------------------------------------------ */

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    agentType: text("agent_type").notNull().default("sales"),
    productId: text("product_id"),
    configurationId: text("configuration_id").references(() => productConfigurations.id, { onDelete: "set null" }),
    /** active | ended | escalated */
    status: text("status").notNull().default("active"),
    /** abandoned | quote_started | checkout_started | purchased | escalated */
    outcome: text("outcome"),
    /** Structured extraction summary (spec §15) — derived, never a substitute for raw messages. */
    summaryJson: jsonb("summary_json").$type<Record<string, unknown>>(),
    startedAt: ts("started_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("conversations_session_idx").on(t.sessionId)],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** user | assistant | tool | system. System/internal rows must never reach customer-facing APIs. */
    role: text("role").notNull(),
    /** Raw transcript content — preserved verbatim; extraction lives on the need profile. */
    content: text("content").notNull(),
    structuredJson: jsonb("structured_json").$type<Record<string, unknown>>(),
    toolName: text("tool_name"),
    toolCallId: text("tool_call_id"),
    toolResultJson: jsonb("tool_result_json").$type<Record<string, unknown>>(),
    model: text("model"),
    /** Configuration snapshot at this turn (chat ↔ configurator sync audits). */
    configSnapshotJson: jsonb("config_snapshot_json").$type<ProductConfiguration>(),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const customerNeedProfiles = pgTable(
  "customer_need_profiles",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    businessId: text("business_id").references(() => businesses.id, { onDelete: "set null" }),
    /* Everything below is OPTIONAL — enriched progressively; unknown stays unknown. */
    businessName: text("business_name"),
    businessType: text("business_type"),
    industry: text("industry"),
    location: text("location"),
    estimatedDailyOrders: integer("estimated_daily_orders"),
    estimatedMonthlyUsage: integer("estimated_monthly_usage"),
    productInterest: text("product_interest"),
    /** Free text, e.g. "fits 3 takeout containers". */
    desiredCapacity: text("desired_capacity"),
    desiredWidth: doublePrecision("desired_width"),
    desiredHeight: doublePrecision("desired_height"),
    desiredGusset: doublePrecision("desired_gusset"),
    materialPreference: text("material_preference"),
    gsmPreference: integer("gsm_preference"),
    colorPreference: text("color_preference"),
    handlePreference: text("handle_preference"),
    printingRequirement: text("printing_requirement"),
    printingColors: integer("printing_colors"),
    printingSides: integer("printing_sides"),
    logoAvailable: boolean("logo_available"),
    quantity: integer("quantity"),
    budgetCents: integer("budget_cents"),
    targetUnitPriceCents: integer("target_unit_price_cents"),
    shippingPostalCode: text("shipping_postal_code"),
    desiredDeliveryDate: text("desired_delivery_date"),
    priceSensitivity: text("price_sensitivity"),
    purchaseIntent: text("purchase_intent"),
    painPointsJson: jsonb("pain_points_json").$type<string[]>(),
    objectionsJson: jsonb("objections_json").$type<string[]>(),
    questionsAskedJson: jsonb("questions_asked_json").$type<string[]>(),
    conversationSummary: text("conversation_summary"),
    /**
     * Per-field provenance: { field: { source, confidence?, updatedAt } }.
     * Source ranks (USER_STATED > ORDER_DATA > CONFIGURATOR > SYSTEM_DERIVED >
     * AI_INFERRED) gate overwrites — see lib/data/customer-need-service.ts.
     */
    fieldSourcesJson: jsonb("field_sources_json")
      .$type<Record<string, { source: string; confidence?: number; updatedAt: string }>>()
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("customer_need_profiles_session_uq").on(t.sessionId)],
);

/**
 * Customer-intelligence classification (Session 08) — one row per
 * conversation, holding the CONTROLLED-taxonomy labels the LOW_COST
 * classifier assigned to individual customer messages. Counts and
 * percentages are NEVER stored here — aggregation is deterministic and
 * runs over these rows at read time (modules/customer-intelligence).
 *
 * Idempotency: (classifierVersion, sourceUpdatedAt) records what was
 * processed; a conversation is reprocessed only when the classifier
 * version changes or new customer messages arrive. Privacy: cascades
 * away with its conversation (and therefore with the session/customer).
 */
export const conversationClassifications = pgTable(
  "conversation_classifications",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** classified | failed — failed rows are retried on the next processing run. */
    status: text("status").notNull().default("classified"),
    /** Version of the classification pipeline (taxonomy + prompt + validation). */
    classifierVersion: text("classifier_version").notNull(),
    promptId: text("prompt_id"),
    promptVersion: text("prompt_version"),
    model: text("model"),
    errorCode: text("error_code"),
    /** [{ theme, messageId }] — theme from the controlled question taxonomy; messageId verified to exist. */
    questionsJson: jsonb("questions_json").$type<{ theme: string; messageId: string }[]>().notNull(),
    /** [{ type, messageId }] — objection taxonomy; questions and objections are distinct by design. */
    objectionsJson: jsonb("objections_json").$type<{ type: string; messageId: string }[]>().notNull(),
    /** [{ kind, normalized, messageId, support }] — support decided DETERMINISTICALLY against the catalog, never by the model. */
    unsupportedRequestsJson: jsonb("unsupported_requests_json")
      .$type<{ kind: string; normalized: string; messageId: string; support: string }[]>()
      .notNull(),
    /** Customer (user-role) messages covered by this classification. */
    userMessageCount: integer("user_message_count").notNull().default(0),
    /** createdAt of the latest customer message covered — reprocess when newer messages exist. */
    sourceUpdatedAt: ts("source_updated_at").notNull(),
    processedAt: ts("processed_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("conversation_classifications_conversation_uq").on(t.conversationId)],
);

/* ------------------------------------------------------------------ */
/* AI operations (prepared this session; no agents run yet)            */
/* ------------------------------------------------------------------ */

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    agentType: text("agent_type"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    requestType: text("request_type").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /** Micro-dollars (1e-6 USD) — per-call costs are fractions of a cent. */
    estimatedCostMicros: integer("estimated_cost_micros"),
    latencyMs: integer("latency_ms"),
    success: boolean("success").notNull(),
    errorCode: text("error_code"),
    /** Versioned prompt that produced this call (S04) — traces output → prompt+model. */
    promptId: text("prompt_id"),
    promptVersion: text("prompt_version"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_created_idx").on(t.createdAt), index("ai_usage_conversation_idx").on(t.conversationId)],
);

export const agentDecisions = pgTable(
  "agent_decisions",
  {
    id: text("id").primaryKey(),
    agentType: text("agent_type").notNull(),
    decisionType: text("decision_type").notNull(),
    observation: text("observation").notNull(),
    reasoningSummary: text("reasoning_summary").notNull(),
    supportingDataJson: jsonb("supporting_data_json").$type<Record<string, unknown>>(),
    /** 0–1 */
    confidence: doublePrecision("confidence"),
    /** low | medium | high */
    riskLevel: text("risk_level").notNull(),
    /** Typed AgentAction (lib/data/agent-service.ts) — what the agent proposes to do. */
    proposedActionJson: jsonb("proposed_action_json").$type<Record<string, unknown>>().notNull(),
    approvalRequired: boolean("approval_required").notNull().default(true),
    /** none | pending | approved | rejected | modified */
    approvalStatus: text("approval_status").notNull().default("none"),
    /** none | scheduled | executed | rolled_back | failed */
    executionStatus: text("execution_status").notNull().default("none"),
    resultJson: jsonb("result_json").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    executedAt: ts("executed_at"),
  },
  (t) => [index("agent_decisions_agent_idx").on(t.agentType, t.createdAt)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    decisionId: text("decision_id")
      .notNull()
      .references(() => agentDecisions.id, { onDelete: "cascade" }),
    /** pending | approved | rejected | modified */
    status: text("status").notNull().default("pending"),
    requestedAt: ts("requested_at").notNull().defaultNow(),
    reviewedAt: ts("reviewed_at"),
    reviewedBy: text("reviewed_by"),
    reviewNotes: text("review_notes"),
    beforeJson: jsonb("before_json").$type<Record<string, unknown>>(),
    afterJson: jsonb("after_json").$type<Record<string, unknown>>(),
    /**
     * Session 10: the proposed action this verdict was rendered on. The
     * approval row stays the DECISION-level record (S03/S09 semantics
     * unchanged — CEO dedup still freezes human-reviewed decisions); this
     * column says WHICH action revision the human actually looked at.
     */
    actionId: text("action_id"),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_decision_idx").on(t.decisionId), index("approvals_action_idx").on(t.actionId)],
);

export const agentConfigs = pgTable("agent_configs", {
  agentType: text("agent_type").primaryKey(),
  /**
   * OBSERVE | RECOMMEND | GUARDED_AUTO | AUTONOMOUS — absent row reads as
   * OBSERVE (fail-safe). Session 10: the guardrail engine additionally
   * CLAMPS whatever is stored here to the per-agent ceiling in
   * config/guardrails.ts, so a wrong row can never grant execution.
   */
  autonomyMode: text("autonomy_mode").notNull().default("OBSERVE"),
  limitsJson: jsonb("limits_json").$type<Record<string, unknown>>(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Guardrails + AI Action Center (Session 10 — migration 0004)         */
/* ------------------------------------------------------------------ */

/**
 * A structured PROPOSED business action — the thing a human approves or
 * rejects. Distinct from AgentDecision (the AI's reasoning) and from
 * Approval (the human verdict record on the decision): collapsing them into
 * one status field is exactly what spec §13 forbids.
 *
 * Immutability: a payload is never edited in place. An admin modification
 * marks the original SUPERSEDED and inserts a new revision linked by
 * `originActionId` — history stays auditable (spec §29).
 */
export const agentActions = pgTable(
  "agent_actions",
  {
    id: text("id").primaryKey(),
    /** CEO_AGENT | PRICING_AGENT | CRO_AGENT | GOOGLE_ADS_AGENT | META_ADS_AGENT | HUMAN_ADMIN */
    sourceAgent: text("source_agent").notNull(),
    /** The AgentDecision this proposal came from, when it came from one. */
    sourceDecisionId: text("source_decision_id").references(() => agentDecisions.id, { onDelete: "set null" }),
    /** Closed taxonomy — modules/guardrails/actions.ts. Unknown types are rejected. */
    actionType: text("action_type").notNull(),
    title: text("title").notNull(),
    /** Schema-validated payload for this action type. Never a free-form blob. */
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
    /** Stable generation identity carried over from the source decision. */
    identityKey: text("identity_key"),
    /** Payload revision: 1 for the original, +1 per human modification. */
    revision: integer("revision").notNull().default(1),
    /** Original proposal in a modification chain (null on the original). */
    originActionId: text("origin_action_id"),
    /** Set on the original when a modification replaces it. */
    supersededByActionId: text("superseded_by_action_id"),
    /** PROPOSED | GUARDRAIL_BLOCKED | PENDING_APPROVAL | APPROVED | REJECTED | SUPERSEDED */
    status: text("status").notNull().default("PROPOSED"),
    /**
     * NOT_APPLICABLE | NOT_SUPPORTED | READY | EXECUTING | EXECUTED |
     * FAILED | ROLLED_BACK — deliberately SEPARATE from approval:
     * "approved" never implies "happened" (spec §16).
     */
    executionStatus: text("execution_status").notNull().default("NOT_SUPPORTED"),
    /** LOW | MEDIUM | HIGH | CRITICAL — POLICY-derived, never model-derived. */
    riskLevel: text("risk_level").notNull(),
    /** What the model claimed the risk was. Metadata for comparison only. */
    modelSuggestedRisk: text("model_suggested_risk"),
    approvalRequired: boolean("approval_required").notNull().default(true),
    /** Most recent guardrail_evaluations row for this action. */
    latestEvaluationId: text("latest_evaluation_id"),
    /** Server-derived admin identity — never accepted from a client payload. */
    reviewedBy: text("reviewed_by"),
    reviewedAt: ts("reviewed_at"),
    reviewNotes: text("review_notes"),
    /** Who/what created this row ("system:ceo_sync", "admin:<user>"). */
    createdBy: text("created_by").notNull(),
    /** Optimistic-concurrency token: every state transition increments it. */
    stateVersion: integer("state_version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("agent_actions_status_idx").on(t.status, t.createdAt),
    index("agent_actions_source_idx").on(t.sourceAgent, t.createdAt),
    /** One ORIGINAL action per decision — the DB-level idempotency guarantee. */
    uniqueIndex("agent_actions_root_decision_idx")
      .on(t.sourceDecisionId)
      .where(sql`origin_action_id is null and source_decision_id is not null`),
  ],
);

/**
 * Append-only guardrail verdict log (spec §12, §38). Every evaluation —
 * including blocked ones — is stored with the policy version and the exact
 * limits consulted, so "why was this allowed on that date?" is answerable
 * years later. Contains no secrets and no customer PII.
 */
export const guardrailEvaluations = pgTable(
  "guardrail_evaluations",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id")
      .notNull()
      .references(() => agentActions.id, { onDelete: "cascade" }),
    /** The action revision this verdict was produced for. */
    actionRevision: integer("action_revision").notNull().default(1),
    policyVersion: text("policy_version").notNull(),
    sourceAgent: text("source_agent").notNull(),
    actionType: text("action_type").notNull(),
    /** The mode actually applied, after clamping to the policy ceiling. */
    autonomyMode: text("autonomy_mode").notNull(),
    allowed: boolean("allowed").notNull(),
    executionEligible: boolean("execution_eligible").notNull(),
    approvalRequired: boolean("approval_required").notNull(),
    riskLevel: text("risk_level").notNull(),
    violatedRulesJson: jsonb("violated_rules_json").$type<Record<string, unknown>[]>().notNull(),
    missingConfigurationJson: jsonb("missing_configuration_json").$type<string[]>().notNull(),
    reason: text("reason").notNull(),
    executionSupport: text("execution_support").notNull(),
    /** The configured limits as they were at evaluation time. */
    limitsSnapshotJson: jsonb("limits_snapshot_json").$type<Record<string, number | null>>().notNull(),
    evaluatedAt: ts("evaluated_at").notNull().defaultNow(),
  },
  (t) => [index("guardrail_evaluations_action_idx").on(t.actionId, t.evaluatedAt)],
);

/**
 * Append-only action history (spec §29, §38–§39): proposed / blocked /
 * approved / rejected / modified, each with the SERVER-DERIVED actor.
 *
 * These are first-party ADMIN events and deliberately do NOT go into the
 * `events` table: that taxonomy is the customer journey (every row requires
 * a session) and its rows feed third-party analytics copies. Business-action
 * details stay first-party only.
 */
export const agentActionEvents = pgTable(
  "agent_action_events",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id")
      .notNull()
      .references(() => agentActions.id, { onDelete: "cascade" }),
    /** ai_action_proposed | ai_action_guardrail_blocked | ai_action_approved | ai_action_rejected | ai_action_modified */
    type: text("type").notNull(),
    /** "system:ceo_sync" or "admin:<username>" — derived server-side, never from the client. */
    actor: text("actor").notNull(),
    detailJson: jsonb("detail_json").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("agent_action_events_action_idx").on(t.actionId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Intelligence outputs (capability only — nothing generates these yet)*/
/* ------------------------------------------------------------------ */

export const customerInsights = pgTable(
  "customer_insights",
  {
    id: text("id").primaryKey(),
    insightType: text("insight_type").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    valueJson: jsonb("value_json").$type<Record<string, unknown>>(),
    evidenceCount: integer("evidence_count").notNull().default(0),
    /** Every insight must trace to real rows: [{ table, id }, …] — enforced at the service boundary. */
    sourceRefsJson: jsonb("source_refs_json").$type<{ table: string; id: string }[]>().notNull(),
    confidence: doublePrecision("confidence"),
    periodStart: ts("period_start"),
    periodEnd: ts("period_end"),
    /** candidate | validated | archived */
    status: text("status").notNull().default("candidate"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("customer_insights_type_idx").on(t.insightType, t.createdAt)],
);

export const productOpportunities = pgTable("product_opportunities", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  /** S08: lower_moq | unsupported_product — controlled at the service boundary. */
  opportunityType: text("opportunity_type"),
  /** S08: structured metrics + stable identityKey (generation dedup) — deterministic values only. */
  valueJson: jsonb("value_json").$type<Record<string, unknown>>(),
  evidenceCount: integer("evidence_count").notNull().default(0),
  sourceRefsJson: jsonb("source_refs_json").$type<{ table: string; id: string }[]>(),
  /** Free-text scale estimate; never a manufactured number. */
  estimatedDemand: text("estimated_demand"),
  /** proposed | under_review | validated | rejected | archived */
  status: text("status").notNull().default("proposed"),
  humanValidationRequired: boolean("human_validation_required").notNull().default(true),
  periodStart: ts("period_start"),
  periodEnd: ts("period_end"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * CEO business-review reports (Session 09) — one row per explicit
 * generation run. Deliberately a dedicated table rather than an
 * AgentDecision: a review is a versioned DOCUMENT (period + prompt +
 * model + the exact metric snapshot the model saw), while each
 * recommendation inside it is persisted as its own AgentDecision row
 * (linked via decisionIdsJson). Decision in docs/ARCHITECTURE.md.
 *
 * The snapshot is stored verbatim so a report remains auditable and
 * visible even when the provider is down or budgets are exhausted —
 * regeneration is always an explicit admin action, never scheduled.
 */
export const ceoReports = pgTable(
  "ceo_reports",
  {
    id: text("id").primaryKey(),
    periodStart: ts("period_start").notNull(),
    periodEnd: ts("period_end").notNull(),
    /** Whole days covered — the admin page selects reports by this. */
    periodDays: integer("period_days").notNull(),
    promptId: text("prompt_id"),
    promptVersion: text("prompt_version"),
    model: text("model"),
    provider: text("provider"),
    /** The BusinessHealthSnapshot the model received (deterministic, PII-free). */
    snapshotJson: jsonb("snapshot_json").$type<Record<string, unknown>>().notNull(),
    /** Server-validated CEO structured output (evidence/metric refs already filtered). */
    reviewJson: jsonb("review_json").$type<Record<string, unknown>>().notNull(),
    /** AgentDecision ids persisted from this review's recommendations. */
    decisionIdsJson: jsonb("decision_ids_json").$type<string[]>().notNull(),
    generatedAt: ts("generated_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("ceo_reports_period_idx").on(t.periodDays, t.generatedAt)],
);

/* ------------------------------------------------------------------ */
/* Experiments (Session 03 schema, Session 11 runtime)                  */
/* ------------------------------------------------------------------ */

/**
 * Experiment records (S03 table, EXTENDED additively in S11 migration 0005).
 *
 * The S03 columns are kept and reused rather than replaced — the table has
 * never had a runtime, so no data migration exists. Two S03 semantics are
 * pinned down (they were unspecified before):
 *  - `controlJson` is the launch-time CONTROL SNAPSHOT (what the normal UI
 *    showed), not page content to render. The control arm renders the
 *    application's own UI with no override at all (spec §8).
 *  - `trafficSplitJson` stores WHOLE PERCENTS keyed by arm and must total
 *    100 (spec §10).
 */
export const experiments = pgTable(
  "experiments",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    hypothesis: text("hypothesis").notNull(),
    /** draft | approved | running | stopped | decided | archived */
    status: text("status").notNull().default("draft"),
    primaryMetric: text("primary_metric").notNull(),
    guardrailMetricsJson: jsonb("guardrail_metrics_json").$type<string[]>(),
    /** Launch-time snapshot of the control experience (spec §42). */
    controlJson: jsonb("control_json").$type<Record<string, unknown>>(),
    /** { [variantKey]: validated variant config } — typed values, never markup. */
    variantsJson: jsonb("variants_json").$type<Record<string, unknown>>(),
    /** { control: 50, variant_b: 50 } — whole percents totalling 100. */
    trafficSplitJson: jsonb("traffic_split_json").$type<Record<string, number>>(),
    /** Human-readable audience label (S03); the structured rules are audienceJson. */
    audience: text("audience"),
    minimumSampleSize: integer("minimum_sample_size"),
    startAt: ts("start_at"),
    endAt: ts("end_at"),
    /** Frozen final readout, written once when the experiment is stopped/decided. */
    resultJson: jsonb("result_json").$type<Record<string, unknown>>(),
    winner: text("winner"),

    /* ---- Session 11 additions ---- */
    /** Closed experiment taxonomy (modules/experiments/types.ts). */
    experimentType: text("experiment_type"),
    /** Closed target registry key (modules/experiments/targets.ts). */
    targetKey: text("target_key"),
    /** The single non-control arm's key (MVP: control + one variant). */
    variantKey: text("variant_key"),
    /** Target contract version at launch — historical reports stay interpretable. */
    targetVersion: text("target_version"),
    /** Structured eligibility rules (modules/experiments/eligibility.ts). */
    audienceJson: jsonb("audience_json").$type<Record<string, unknown>>(),
    secondaryMetricsJson: jsonb("secondary_metrics_json").$type<string[]>(),
    /** Per-experiment assignment salt — keeps arms independent across experiments. */
    assignmentSalt: text("assignment_salt"),
    /** Guardrail policy version + evaluated verdict at launch (spec §42). */
    policyVersion: text("policy_version"),
    policySnapshotJson: jsonb("policy_snapshot_json").$type<Record<string, unknown>>(),
    /** Provenance: the CRO recommendation / approved action this came from. */
    sourceDecisionId: text("source_decision_id").references(() => agentDecisions.id, { onDelete: "set null" }),
    sourceActionId: text("source_action_id").references(() => agentActions.id, { onDelete: "set null" }),
    createdBy: text("created_by"),
    launchedBy: text("launched_by"),
    launchedAt: ts("launched_at"),
    stoppedBy: text("stopped_by"),
    stoppedAt: ts("stopped_at"),
    stopReason: text("stop_reason"),
    archivedAt: ts("archived_at"),
    /** Optimistic-concurrency token — every lifecycle transition increments it. */
    stateVersion: integer("state_version").notNull().default(1),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("experiments_status_idx").on(t.status, t.createdAt),
    /** ONE running experiment per target (spec §45) — enforced by the database. */
    uniqueIndex("experiments_running_target_idx")
      .on(t.targetKey)
      .where(sql`status = 'running' and target_key is not null`),
    /** One draft per approved action — launch/materialize idempotency. */
    uniqueIndex("experiments_source_action_idx")
      .on(t.sourceActionId)
      .where(sql`source_action_id is not null`),
  ],
);

/**
 * Sticky per-session assignment (S03 table, S11 adds exposure).
 *
 * ASSIGNMENT ≠ EXPOSURE (spec §12): a row here means "this session belongs
 * to this arm"; `exposedAt` is stamped the first time the session actually
 * RENDERED the experiment surface. Unique exposed sessions are counted from
 * `exposedAt is not null`, assignments from the row count — separately, and
 * without a write per page view.
 */
export const experimentAssignments = pgTable(
  "experiment_assignments",
  {
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    variant: text("variant").notNull(),
    assignedAt: ts("assigned_at").notNull().defaultNow(),
    /** First time this session saw the surface. Null = assigned, never exposed. */
    exposedAt: ts("exposed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.experimentId, t.sessionId] }),
    index("experiment_assignments_variant_idx").on(t.experimentId, t.variant),
  ],
);

/**
 * Append-only experiment audit trail (Session 11 spec §43, §49).
 *
 * Like `agent_action_events`, these are first-party ADMIN events and
 * deliberately do NOT go into the customer `events` taxonomy (which requires
 * a session and feeds third-party copies). Actors are server-derived.
 */
export const experimentEvents = pgTable(
  "experiment_events",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    /** created | approved | launched | stopped | decided | archived */
    type: text("type").notNull(),
    /** "admin:<username>" or "system:<process>" — never client-supplied. */
    actor: text("actor").notNull(),
    detailJson: jsonb("detail_json").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("experiment_events_experiment_idx").on(t.experimentId, t.createdAt)],
);
