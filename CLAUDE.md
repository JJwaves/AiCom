@AGENTS.md

# CLAUDE.md — Project Memory

Persistent context for every development session. Read this first, then the
documents relevant to your phase. Do not depend on prior conversation
context existing.

**Long-term vision & specification: [docs/MASTER_PROMPT.md](docs/MASTER_PROMPT.md)**
— the owner's authoritative product/architecture spec (upgrade prompt §1–46
+ multi-session prompt pack). Execution is phase-by-phase per
`docs/AI_PLATFORM_ROADMAP.md`; each phase re-reads its relevant spec
sections. It is a vision document, not a single-session to-do list.

**All architecture docs live in `docs/`** (audit, architecture, database
schema, AI agents, guardrails, roadmap, master prompt). Development
sessions are driven by the prompt files in `prompts/` — read
`prompts/00-INDEX.md`.

## Product

AI-native factory-direct B2B commerce platform.
- Initial market: United States and Canada.
- Initial customers: restaurants and coffee shops.
- Initial product: custom non-woven takeout bags.
- Primary conversion: online purchase. Secondary: custom quote request.

## Core architecture rule

**The LLM provides intelligence. The application provides authority.**

AI may: understand, recommend, explain, summarize, analyze, communicate,
propose. Deterministic software controls: pricing, minimum margin,
payments, authentication, permissions, manufacturing rules, ad spending
limits, refund authorization, agent autonomy, approvals.

## Development rules

- Do not rewrite working code unnecessarily.
- Do not invent factory capabilities, prices, costs, or customer insights.
- Do not expose secrets (server tokens never in client code or prompts).
- Store structured data whenever practical; first-party data is
  authoritative, third-party tags get copies.
- Use feature flags for new AI systems; commerce must work with all flags off.
- Financially meaningful agent actions must pass the Guardrail Engine.
- Preserve first-party attribution (immutable first touch).
- Optimize contribution profit, not vanity metrics.
- Build incrementally; modular monolith; no over-engineering before real
  customer validation.
- Money is integer cents everywhere; format at the presentation edge.
- Run `npm test` + `npm run typecheck` + `npm run build` before finishing a
  session; update this file and the relevant architecture docs.

## Current project stage

**Session 10 "Central Guardrail Engine + AI Action Center" COMPLETE
(2026-08-12) — the system-wide safety and approval layer every future AI
action passes through. `modules/guardrails` is the ONE authority: a CLOSED
proposed-action taxonomy (20 types, strict per-type zod payloads — unknown
type, unknown key, or smuggled `riskLevel`/`approvalStatus` all fail
closed), a PURE `evaluateAgentAction()` (no lib/ai, no db/, no clock, no
randomness ⇒ reproducible from input + `GUARDRAIL_POLICY_VERSION`),
autonomy modes CLAMPED to per-agent policy ceilings (every business agent
= RECOMMEND, so a tampered `agent_configs` row grants nothing),
deterministic risk LOW/MEDIUM/HIGH/CRITICAL (a model's claim is metadata
only), HARD vs SOFT rules (HARD blocks either the PROPOSAL or EXECUTION
forever; no bypass semantic exists), and missing configuration reported by
exact config path — never as PASS or 0. Persistence: `agent_actions`
(status ⟂ executionStatus), append-only `guardrail_evaluations` (policy
version + limits snapshot) and `agent_action_events` (migration 0004).
`/admin/ai-actions` behind the S08 auth + `AI_ACTION_CENTER`: approve /
reject / modify with server-derived `reviewedBy`, `stateVersion` +
row-lock concurrency (double-click and stale reviewer ⇒ 409), immutable
proposals (modification = SUPERSEDED original + re-evaluated revision),
server-resolved evidence, and same-origin + JSON-only CSRF protection on
the first admin mutation routes. **The executor registry is EMPTY:
approving records the owner's decision and mutates no price, ad, product,
or payment.** 512 tests. Next milestone: Session 11 "Experiment Engine +
CRO Agent".**

**Session 09 "Business Intelligence + CEO Recommendation Agent" COMPLETE
(2026-08-12) — the business-level intelligence layer: DETERMINISTIC
metrics (`modules/business-intelligence`, no lib/ai import) with an
explicit AVAILABLE/PARTIAL/UNAVAILABLE availability model — revenue/
orders/AOV/units, funnel + denominator-honest rates, AI sales + AI cost
(unpriced calls never $0), profitability (gross + contribution BEFORE
paid media — UNAVAILABLE while config/costs.ts is null: "Unavailable —
configure manufacturing costs", never zero, never estimated), segments,
first-party attribution (no CAC/ROAS — no ad spend exists), explicit
trend states (NEW_ACTIVITY/LOW_BASELINE, never +∞%) → ONE
BusinessHealthSnapshot → CEO agent (RECOMMEND permanently: NO tools, one
REASONING structured-output call, metric/evidence references
server-validated against the exact context sent, fabricated refs
dropped) → pending AgentDecision rows (identity-stable dedup, human
verdicts frozen) + append-only `ceo_reports` (period/prompt/model/
snapshot versioning) → `/admin/business-intelligence` behind the S08
auth + `AI_BUSINESS_INTELLIGENCE` flag: deterministic dashboard works
with AI off/down; CEO review generates ONLY from the explicit admin
button. MEASURE→SYNTHESIZE→EXPLAIN→RECOMMEND, never execute. Next
milestone: Session 10 "Guardrails + AI Action Center" — DONE, see above.**

## Current architecture (2026-08-12, post-Session 10)

Working B2B storefront, verified end-to-end (see
docs/CURRENT_SYSTEM_AUDIT.md + its Session-02 resolution note):
- Next.js 16.3 App Router · React 19 · TS · Tailwind v4 · zod · vitest (451 tests)
  · Drizzle ORM + Postgres (PGlite embedded dev/test, node-postgres prod).
- **Database (Session 03; +1 table Session 08; +1 Session 09):**
  `db/schema.ts` (22 tables: sessions, events, customers, businesses,
  orders+lines, quotes, artworks, configurations, conversations+messages,
  conversation_classifications (S08), ceo_reports (S09), need profiles,
  ai_usage, agent_decisions, approvals, agent_configs, insights,
  opportunities, experiments, assignments) + additive SQL migrations in
  `db/migrations/` (0000–0003).
  `DATABASE_URL` unset ⇒ embedded PGlite at `.data/pglite` self-migrates
  (zero-setup dev; tests use `memory://`); set ⇒ real Postgres, migrations
  applied explicitly via `npm run db:migrate`. **`NODE_ENV=production`
  without `DATABASE_URL` fails loudly at first DB use (S03.5)** — the
  embedded fallback is dev/test-only, never a silent production store.
  ALL access goes through
  zod-validated services in `lib/data/*` — future AI tools call these,
  never SQL. Client state unchanged as cache: `config/*.ts`, localStorage
  (cart `bd_cart_v1`, attribution `bd_attribution_v1`, consent
  `bd_consent_v1`), sessionStorage (mock-order confirmation payload).
- **Server session identity:** httpOnly cookies `bd_sid` (session) +
  `bd_aid` (durable anonymous id), minted by persisting API routes,
  rolling 1y, no login required. Attribution snapshots live on the session
  row — first touch immutable, last touch campaign-only updates (same
  `mergeAttribution` code as the client, now server-side).
- **First-party events:** `track()` keeps its GA4 dataLayer output
  byte-identical and dual-writes through the explicit GA4→platform mapping
  table (`lib/analytics/first-party.ts`) → beacon-batched `/api/events` →
  taxonomy-validated rows (dedup by clientEventId). `purchase` is
  deliberately server-authoritative (`purchase_completed` written at order
  creation). Kill switch: `NEXT_PUBLIC_FIRST_PARTY_EVENTS=false`.
- **CustomerNeedProfile with provenance:** one per session, every field
  optional, per-field `{source, confidence?, updatedAt}`; rank
  USER_STATED > ORDER_DATA > CONFIGURATOR > SYSTEM_DERIVED > AI_INFERRED
  gates overwrites (tested). Live writers: quote form (USER_STATED), mock
  checkout (ORDER_DATA). Unknown stays unknown — vague quantities are not
  parsed into numbers.
- **AI-ops data (live):** AiUsage (+ totals for budget caps; S04 added
  prompt_id/prompt_version columns, migration 0001), AgentDecision with
  typed AgentAction schema, Approval auto-created pending, AgentConfig
  (missing row ⇒ OBSERVE fail-safe), CustomerInsight (sourceRefs ≥ 1
  enforced), ProductOpportunity (humanValidationRequired always true),
  Experiment + sticky assignments.
- **AI runtime `lib/ai` (Session 04 — foundation, no agents, no UI, OFF by
  default):** server-only module (docs/AI_RUNTIME.md is authoritative).
  Provider abstraction with the Anthropic adapter implemented on the
  official SDK (openai/gemini interface-ready, selecting them fails loudly);
  `AiRuntime` facade = flags → env config → workload router
  (LOW_COST/STANDARD/REASONING → haiku-4-5/sonnet-5/opus-5, env-overridable)
  → budget guard → provider call (timeout, normalized AiError codes) →
  AiUsage row (non-fatal, loudly logged). Versioned prompt registry (infra
  prompts only; usage rows trace prompt+model). Structured output =
  provider-constrained JSON + OUR zod validation, bounded 1-retry.
  Budget guard fails CLOSED (caps+unpriced model ⇒ config error; totals
  outage ⇒ AI_BUDGET_EXCEEDED check_failed). Typed tool registry:
  permission tiers READ/CUSTOMER_WRITE/COMMERCE/FINANCIAL_RESTRICTED/
  ADMIN_RESTRICTED, server-minted ToolExecutionContext, zod in+out
  validation, sha256-hashed audit logs, loop limits (tool calls/model
  calls/duration end turns with a status). Sales toolset (8 after S05):
  searchProducts, getProductDetails, calculatePrice + getQuantityPricing
  (engine delegation — output schemas structurally exclude cost/margin/
  floor), getShippingEstimate (honest), saveCustomerNeed (AI_INFERRED
  provenance, session from context), recommendProduct (catalog-validated,
  S05), requestHumanHelp (structured escalation, S05). `config/flags.ts`
  all-default-OFF; `config/ai-pricing.ts` null placeholders (budgets
  unenforceable until filled — documented). FakeAiProvider ships for
  tests; no credentials or network in tests/build.
- **AI Sales Agent "AI Packaging Expert" (Session 05 — OFF by default;
  docs/AI_SALES_AGENT.md is authoritative):** `lib/ai/agents/sales/`
  orchestrates: active-conversation resolve (active OR escalated resumes;
  ended never) → raw transcript persistence → provenance-labeled context
  (profile + rolling summary, ≤2.4k chars) → versioned `ai_sales_agent`
  v1.0.0 prompt → runToolConversation (STANDARD) → tool+assistant rows →
  LOW_COST evidence-validated extraction → LOW_COST summary every 6
  messages (derived view on conversations.summaryJson) → normalized
  SalesAgentResult (reply + recommendedProductId/Path + needsHuman +
  handoffReason + conversationStatus; frontend never parses prose).
  USER_STATED is EARNED: only the server extractor grants it, requiring
  model-quoted evidence verbatim in the customer's actual message +
  value-evidence consistency (numbers must match a complete number;
  hedged "about 5,000" demotes to AI_INFERRED; fabricated quotes DROPPED;
  priceSensitivity/purchaseIntent always AI_INFERRED). Escalation =
  structured handoff (reason enum, requirement summary, voluntary contact,
  profile snapshot) persisted as a system message row + conversation
  escalated (NOT ended) + human_handoff_requested event; delivery
  destination is owner config (recorded, not yet sent anywhere).
  `/api/ai/chat`: POST {message} only (identity = bd_sid cookie; body
  ≤16KB, message ≤2000 chars), per-session (6/min) + per-IP (20/min)
  in-memory token buckets (`lib/rate-limit.ts`; per-instance — edge
  limiting is a LAUNCH_CHECKLIST item), every AI failure → 503 fixed
  customer-safe copy (codes only in server logs); GET history returns
  user/assistant rows only (system/tool rows never leak). UI:
  `components/ai/PackagingExpertLauncher` (server gate: both flags + key
  or renders NOTHING) → `PackagingExpertChat` (floating widget, history,
  quick prompts, loading/error/retry, escalation banner, recommendation
  chip, a11y log/labels/Escape, mobile width). Events: ai_chat_started,
  ai_message_sent (props only, never transcript), ai_product_recommended,
  human_handoff_requested. Optional `npm run ai:smoke` verifies configured
  model ids against the live account + one real LOW_COST call
  (credential-gated; never in tests/build).
- **Shared configuration state (Session 06 —
  docs/AI_CONFIGURATOR_INTEGRATION.md is authoritative):**
  `lib/configuration/` = pure catalog validation + patch semantics
  (validation.ts: 5 patchable fields — artwork/customDimensions
  structurally excluded), pure reducer (store.ts: revision, dirtyFields
  field-merge, lastChange), React provider (context.tsx: mount restore,
  700ms debounced sync, flushSync before add-to-cart), sync bus
  (chat↔configurator across React trees + configurator presence), ONE
  server application path (server.ts) over the S03 row
  (`product_configurations.version` = revision;
  `updateConfigurationChecked` = SELECT…FOR UPDATE + expectedRevision).
  `/api/configuration`: POST full-config sync (last-write-wins) or patch
  apply (revalidated; 409 STALE_REVISION), GET session restore; strict
  zod (unknown patch keys = loud 422, never stripped). Three new sales
  tools (8→11): getCurrentConfiguration (READ, customer-visible view),
  updateConfiguration (CUSTOMER_WRITE, partial patch, structured
  rejections with alternatives, revision-checked), suggestConfigurationUpdate
  (READ, validates+prices, writes nothing → apply chip).
  SalesAgentResult now carries configurationUpdate (server-validated
  config the UI applies — never model text) + suggestedActions; sales
  context injects the live configuration each turn; assistant messages
  stamp configSnapshotJson; prompt v1.1.0 adds COMMIT-vs-PREVIEW +
  confirmation policy + no-artwork-fabrication rules. Both manual sync
  and AI commits write CONFIGURATOR-rank need evidence
  (needUpdateFromConfiguration mirrors checkout's ORDER_DATA mapping);
  USER_STATED still only via the S05 evidence extractor. Events:
  ai_configuration_proposed/updated/rejected (+ conversations.outcome now
  stamps quote_started/checkout_started/purchased from their routes).
  UI: configurator restores on reload, AI changes highlight ~6s
  ("Updated by Packaging Expert") + aria-live announcements; chat shows
  "✓ Configurator updated" chips + tappable suggestion chips; mobile
  launcher/panel lift above the sticky Add-to-Cart bar when a
  configurator is mounted.
- **AI Sales × Cart/Checkout (Session 07 —
  docs/AI_COMMERCE_INTEGRATION.md is authoritative):** the cart stays
  client-side (`bd_cart_v1`) and `/api/checkout` stays the only order
  authority — S07 adds a validated channel INTO them.
  `lib/commerce/cart-line.ts` = ONE server path turning the authoritative
  shared configuration (at `expectedRevision`) into an engine-priced cart
  line; `expectedTotalCents` is /api/checkout-style drift detection ONLY
  (`repriced` requires fresh customer confirmation; `stale_configuration`
  returns current state; artwork/custom-quote rules match the manual
  button). Four sales tools (11→15; sales = READ+CUSTOMER_WRITE+COMMERCE):
  addConfiguredProductToCart (COMMERCE, explicit-intent commit),
  suggestAddToCart (READ → "Add to cart" chip; taps re-validate via
  `/api/cart/line`), getCartSummary (READ over the server-minted client
  cart snapshot), startCheckout (COMMERCE, EMPTY strict input → validated
  "Continue to checkout" action the CUSTOMER taps). Chat POST carries a
  STRICT price-free cart snapshot (client prices = 422); context injects
  the engine-priced cart view; SalesAgentResult/wire gain cartAdd +
  checkoutAction + ADD_TO_CART suggested actions. The client applies
  validated lines via the SAME `useCart().addLine` as manual and checks
  out via the NEW shared `lib/cart/checkout-client.ts` (cart page
  refactored onto it) — REPRICED shows "Confirm & continue at $X" and is
  never auto-accepted. Orders: `aiAssisted` + `conversationId` stamped at
  creation via `lib/data/ai-assistance.ts` (conservative: a sales
  conversation AND ≥1 material ai_* commerce event; widget-loaded ≠
  assisted); purchase_completed carries an aiAssisted prop. Outcomes:
  `cart_added` added with funnel ranking (purchased > checkout_started >
  cart_added/quote_started — never downgrades). Events: +3 taxonomy names
  (ai_add_to_cart_proposed/requested, ai_checkout_requested); generic
  add_to_cart/checkout_started gain optional addedVia/trigger "ai_chat"
  props. Prompt v1.2.0 (explicit-intent list + non-examples, reprice
  confirmation, dual "add and checkout" intent, shipping/tax =
  "calculated at checkout"). Security structural + red-team-tested: no
  price/discount/config/url tool inputs (STRICT schemas), no
  markOrderPaid/applyDiscount/capturePayment/createCheckout tools,
  checkout URLs only from the provider via `/api/checkout`, purchase
  events only at order creation.
- **Customer Intelligence (Session 08 — docs/CUSTOMER_INTELLIGENCE.md is
  authoritative):** `modules/customer-intelligence` = the DETERMINISTIC
  authority (closed question/objection/request taxonomies, catalog-support
  verdicts supported|custom_quote_path|unsupported from the REAL catalog,
  the qualified-conversation rule, conversation-deduplicated aggregation,
  three-lane demand requested[stated vs inferred split]/configured/
  purchased, funnel/segment/attribution/association metrics, threshold-
  gated identity-stable insight+opportunity generation) — it has NO lib/ai
  import. `lib/ai/agents/customer-intelligence/` = LOW_COST labeling only
  (`ai_customer_intelligence_classifier` v1.0.0, agentType
  customer_intelligence, closed enums, messageIds verified against the
  transcript sent, one idempotent row per conversation in
  `conversation_classifications` [migration 0002] keyed by
  classifierVersion+sourceUpdatedAt) + explicit batch processing (cap 25;
  budget/provider failures leave rows PENDING, invalid output marks ONE
  row failed and continues, flags-off touches nothing). All DB access via
  `lib/data/intelligence-service.ts` (::float8 aggregates). Insights:
  types CUSTOMER_QUESTION/OBJECTION_PATTERN/DEMAND_PATTERN/PRODUCT_GAP/
  MOQ_SIGNAL/SHIPPING_SIGNAL/PRICING_SIGNAL/SEGMENT_PATTERN/
  CONVERSION_PATTERN; valueJson.identityKey = TYPE:dimension:periodDays
  (one row ever — candidate/validated update in place, dismissed/archived
  resurrect only on GROWN evidence); statuses +dismissed (S08).
  Opportunities: lower_moq + unsupported_product, created `proposed` only,
  validated/rejected are human-frozen, humanValidationRequired always
  true. Admin: `/admin/customer-intelligence` (+ per-insight/opportunity
  evidence drill-downs with bounded excerpts, missing-evidence honesty) +
  `/api/admin/customer-intelligence/*` (process, status routes) behind
  HTTP Basic (`ADMIN_USER`/`ADMIN_PASSWORD` via `proxy.ts` + per-route
  re-checks; unset ⇒ 404 fail-closed) + the flag; /admin
  robots-disallowed. Thresholds in `config/customer-intelligence.ts`
  (documented: insight ≥3 evidence, % ≥5 denominator, trend ≥5 base,
  segment ≥5/cell, association ≥10pp). Qualified conversation (the
  denominator, deterministic): funnel outcome OR escalation OR a
  qualifying session event (price_viewed/add_to_cart/checkout_started/
  purchase_completed/quote_*/ai_product_recommended/
  ai_configuration_updated/ai_add_to_cart_requested/ai_checkout_requested/
  human_handoff_requested) OR quantity/productInterest at USER_STATED/
  CONFIGURATOR/ORDER_DATA provenance — AI_INFERRED alone never qualifies.
- **Business Intelligence + CEO Agent (Session 09 —
  docs/BUSINESS_INTELLIGENCE.md is authoritative):**
  `modules/business-intelligence` = the DETERMINISTIC business-metrics
  authority (NO lib/ai import): typed Metric availability
  AVAILABLE/PARTIAL/UNAVAILABLE (unavailable carries reason+missingInputs,
  NEVER value 0), revenue from orders.totalCents (multi-line never double
  counted; cancelled/refunded excluded+reported; per-currency exact,
  headlines single-currency only — no invented FX), funnel (distinct
  sessions/stage, purchases from the orders table, rates with documented
  denominators), AI sales (S07 conservative aiAssisted) + AI cost
  (unpriced calls counted → PARTIAL/UNAVAILABLE, never $0; by
  provider/model/agent), profitability reconstructed per order from the
  S02 cost model (gross = revenue − product COGS; contribution BEFORE
  paid media = − all variable costs, payment fee per ORDER; per-product =
  gross only; all-null config/costs.ts ⇒ "Unavailable — configure
  manufacturing costs" listing missing inputs), segments (businessType),
  first-party attribution (first/last touch, landing pages, no click ids,
  NO CAC/ROAS), trends (TREND/NEW_ACTIVITY/LOW_BASELINE/NO_ACTIVITY —
  previous-zero never +∞%), deterministic data-quality warnings → ONE
  BusinessHealthSnapshot (JSON-serializable, PII-free). CEO agent
  `lib/ai/agents/ceo` (RECOMMEND permanently): NO tools — one REASONING
  `generateStructuredObject` over the snapshot context (prompt
  `ai_ceo_business_review` v1.0.0); controlled enums (confidence+risk
  LOW/MEDIUM/HIGH, 9 action categories granting zero authority); server
  validates every supportingMetricRef/evidenceRef against the exact
  context sent (fabricated refs filtered, ref-less recommendations
  dropped+logged); persists pending AgentDecisions (approvalRequired
  always true, executionStatus stays none; identityKey =
  category+refs+periodDays dedup — pending rows update in place via
  `updateDecisionRecommendation`, human-reviewed rows frozen) + one
  append-only `ceo_reports` row (period, prompt+version, model, provider,
  exact snapshot, validated review, decision ids; migration 0003).
  Failure = failure: budget/provider errors persist NOTHING; the last
  good report stays visible. Admin: `/admin/business-intelligence`
  (period 1/7/30/90+custom; overview/funnel/AI/profitability/signals/
  trends/products/segments/attribution/CEO review/data quality;
  owner-friendly copy) + POST
  `/api/admin/business-intelligence/ceo-review` (the ONLY generation
  trigger) behind S08 HTTP Basic (same credentials, no second auth
  system) + `AI_BUSINESS_INTELLIGENCE` flag, fail-closed 404.
  Deterministic dashboard requires zero AI configuration. Config:
  `config/business-intelligence.ts` thresholds; services
  `lib/data/business-intelligence-service.ts` (::float8 aggregates) +
  `lib/data/ceo-report-service.ts`.
- **Guardrail Engine + AI Action Center (Session 10 — docs/GUARDRAILS.md +
  docs/AI_ACTION_CENTER.md are authoritative):** `modules/guardrails` is
  THE central safety layer, with NO `lib/ai` and NO `db/` import.
  actions.ts = the CLOSED taxonomy: 11 review-only types (`*_REVIEW` +
  CRO_EXPERIMENT_PROPOSAL — approving means "yes, investigate"), 9
  representable-but-unexecutable types (PRICE_CHANGE/PRICE_EXPERIMENT/
  MOQ_CHANGE/AD_BUDGET_CHANGE/AD_PAUSE/AD_RESUME/AD_CREATIVE_TEST/
  CRO_EXPERIMENT_LAUNCH/AI_COST_CHANGE) and 2 never-automated CRITICAL
  types (REFUND, MANUFACTURING_CHANGE); every type has a STRICT zod
  payload schema (unknown keys are errors, so no authorization field can
  be smuggled) plus source permissions — CEO_AGENT may propose review
  types only, so "lower all prices 90%" is `source_not_permitted_for_
  action_type`. evaluate.ts = the pure `evaluateAgentAction({source,
  actionType, payload, autonomyMode, modelSuggestedRiskLevel?,
  priceContext?})` → `{allowed, executionEligible, approvalRequired,
  riskLevel, violatedRules[{id,severity HARD|SOFT,blocks PROPOSAL|
  EXECUTION}], missingConfiguration[], reason, executionSupport,
  executionState, limitsSnapshot, policyVersion}`: unknown agent/type,
  malformed payload, unknown mode, OBSERVE, and evaluator exceptions all
  DENY; autonomy is clamped `min(stored, AGENT_AUTONOMY_POLICY ceiling)`;
  HIGH/CRITICAL always need a human (`MAX_UNATTENDED_RISK_LEVEL=MEDIUM`);
  price-affecting types reuse `evaluatePriceFloor` + `COST_MODEL.
  marginPolicy` (NOT duplicated) and fail closed while costs are null.
  executors.ts = an EMPTY registry (no dummy executors; the future
  contract is documented). decision-mapping.ts maps the 9 CEO categories
  → review types (informational recommendations create nothing).
  `config/guardrails.ts` = policy version + 10 `null` `[TO BE PROVIDED]`
  limits + autonomy defaults/ceilings + an EMPTY guarded-auto allow-list.
  Persistence `lib/data/agent-action-service.ts` over migration 0004:
  `agent_actions` (status PROPOSED/GUARDRAIL_BLOCKED/PENDING_APPROVAL/
  APPROVED/REJECTED/SUPERSEDED ⟂ executionStatus NOT_APPLICABLE/
  NOT_SUPPORTED/READY/…; revision + originActionId lineage; stateVersion
  concurrency; partial unique index = one root action per decision),
  append-only `guardrail_evaluations` (policy version + limits snapshot)
  and `agent_action_events` (proposed/blocked/approved/rejected/modified,
  server-derived actor — deliberately NOT the customer `events` taxonomy,
  which requires a session and feeds third-party copies). Blocked
  proposals are STORED and shown, never swallowed. Admin:
  `/admin/ai-actions` (+ `/[id]` detail: observation, recommendation,
  server-resolved evidence with unresolved refs named as unavailable,
  structured payload, full evaluation with rules/limits, history,
  revisions) behind the S08 HTTP Basic + `AI_ACTION_CENTER`, fail-closed
  404; POST `/api/admin/ai-actions/{sync,[id]/review,[id]/modify}` — the
  first admin MUTATION routes, guarded by `lib/admin/write-guard.ts`
  (POST + auth + same-origin + `application/json` + bounded body + strict
  zod). `reviewedBy` is server-derived (`adminIdentity()`); a client
  sending reviewedBy/riskLevel/approvalStatus gets 422. Modification
  preserves the original (SUPERSEDED) and RE-EVALUATES a new revision (no
  inherited verdict; evidence refs may narrow, never grow). Sync is
  deterministic — it reads pending CEO decisions, no model call.
- `lib/commerce` — provider abstraction; `mock` active, `shopify`
  Storefront skeleton env-gated (variant mapping TODO, needs real store).
  **All catalog reads go through `lib/commerce/catalog.ts`** (provider-
  backed; loud mock fallback while the Shopify mapping is incomplete —
  checkout never falls back). Client components receive catalog data as
  props from server components, never by importing `config/products`.
- `modules/pricing` — **the sole pricing authority**: `engine.ts` (tier
  kernel, unchanged Session-01 math), `cost-model.ts` (manufacturing/
  material/printing/setup/packaging/shipping/payment-fee costs, gross +
  contribution profit/margins, `minimumAllowedPriceCents`,
  `evaluatePriceFloor` fail-closed guardrail), `calculatePrice()` facade.
  Costs live in `config/costs.ts` — **every value is a `null`
  `[TO BE PROVIDED]` placeholder**; margins report "unavailable" and price
  floors fail closed until the owner provides real economics. Cost/margin
  figures are server-only — never sent to the browser.
- `/api/checkout` — **server-side re-quote**: validates every cart line
  against the live catalog (ids, artwork requirement, custom-quote
  routing), re-prices with the engine, answers 409 REPRICED on any drift
  (client cart self-corrects and asks the user to confirm again), 422 on
  invalid lines, then calls `createCheckout` on the active provider. Mock
  orders: the route returns the server-priced payload; the client persists
  it for the confirmation page.
- `lib/analytics/track.ts` — typed dataLayer events, consent-gated,
  purchase dedup. `lib/attribution` — first/last touch. Both client-side.
- `/api/quote` — validated quote intake → `QUOTE_WEBHOOK_URL` or log.
- Design system: Hallmark Cobalt theme (OKLCH tokens in `app/globals.css`).
- Docs: README, BUSINESS_CONFIG_TODO, LAUNCH_CHECKLIST, plus the AI-platform
  set (below). Placeholder brand "BagDirect"; demo pricing visibly flagged
  via `NEXT_PUBLIC_DEMO_PRICING`.

## Completed in Session 01 (2026-08-08, two passes)

First pass — the doc set:

- Full repository audit → `docs/CURRENT_SYSTEM_AUDIT.md` (implemented /
  partial / missing / risks / KEEP-REFACTOR-ADD-DEFER classification).
- Architecture direction → `docs/ARCHITECTURE.md` (current + target +
  invariants + decision log).
- Data design → `docs/DATABASE_SCHEMA.md` (current no-DB state + full
  planned schema: commerce spine, events, conversations,
  CustomerNeedProfile, AgentDecision/Approval/AgentConfig, AiUsage,
  experiments).
- AI design → `docs/AI_AGENT_ARCHITECTURE.md` (provider layer, model
  router, typed tool rules, sales toolset, injection posture, escalation).
- Safety design → `docs/GUARDRAILS.md` (evaluateAgentAction, autonomy
  modes, hard limits, never-automated list, feature flags).
- Rollout → `docs/AI_PLATFORM_ROADMAP.md` (Stages A–J ↔ session map).
- `BUSINESS_CONFIG_TODO.md` extended with cost-model + AI/guardrail config.

Second pass (same day) — verification + structure:

- Independent full-source re-verification of every audit claim (all held);
  three new code-level findings added to the audit: catalog reads
  bypassing the commerce provider (8 files), configurator state living in
  component-local `useState` (no shared store yet), stale mock-fallback
  comment in `lib/commerce/shopify.ts`.
- Doc set relocated from repo root into `docs/` (git mv, history kept);
  all cross-references updated; README points at the AI-platform docs.
- `docs/AI_AGENT_ARCHITECTURE.md` extended with a full per-agent
  specification (responsibility / inputs / outputs / tools / prohibited /
  autonomy / data access / guardrails / audit) for all 7 planned agents.
- `docs/AI_PLATFORM_ROADMAP.md` gained the owner-spec stage-number
  mapping (0–17 ↔ A–J); CustomerNeedProfile gained `desiredCapacity`.
- `prompts/` created: 00-INDEX + 13 session prompts (02–13 pending),
  each referencing CLAUDE.md + docs instead of duplicating specs.
- No application code changed in either pass (audit-only by design);
  baseline re-confirmed green before and after (39 tests / typecheck /
  lint / build).

## Completed in Session 02 (2026-08-08) — Commerce Stabilization + Pricing

1. **`modules/pricing` boundary** — `lib/pricing/engine.ts` moved (git mv,
   math byte-identical) to `modules/pricing/engine.ts`; new
   `cost-model.ts` (cost breakdown, margins, `minimumAllowedPriceCents`,
   `evaluatePriceFloor`) + `calculatePrice()` facade in `index.ts`. All
   engine imports now go through `@/modules/pricing`.
2. **Cost model config** — `config/costs.ts`: per-product manufacturing /
   size / material / printing+setup / packaging / shipping-basis / other
   costs, payment fee (bps + fixed), margin policy (min gross, min + target
   contribution). ALL values `null` placeholders — nothing invented.
   Unconfigured ⇒ margins "unavailable" + price floor fails closed
   (verified by tests).
3. **Server-authoritative checkout** — new `/api/checkout`
   (`lib/validation/checkout.ts` schema): re-validates + re-prices every
   line server-side; 409 REPRICED on drift (cart self-corrects, user
   re-confirms), 422 on invalid/custom-quote/missing-artwork lines, 400 on
   malformed JSON; margin telemetry logged server-side only. Cart client
   (`app/cart/cart-client.tsx`, server shell `app/cart/page.tsx`) now
   checks out through the route; the mock provider no longer writes
   sessionStorage (the client persists the server-priced payload).
4. **Catalog reads unified** — new `lib/commerce/catalog.ts`
   (list/get/getById/hero) used by home, products list/detail, cart shell,
   sitemap, request-quote page, LandingTemplate; `PricingDemo` and
   `QuoteClient` take props from server components. Only the mock provider
   and test fixtures import `config/products` now. The stale Shopify
   "falls back to mock" comment became a real, loudly-logged read fallback
   (checkout deliberately has none).
5. **Tests 39 → 59** — `tests/cost-model.test.ts` (fixture math, fail-
   closed, floor boundary at floor−1, shipping bases, partial-config
   detection), `tests/checkout-route.test.ts` (200 server-priced order,
   409 tamper, 422 artwork/MOQ/custom/unknown-ids, 400 malformed). All
   green + typecheck + lint + production build.
6. **Browser-verified on the production build**: configure → cart →
   tampered localStorage price ($10) → checkout → 409 + cart self-corrects
   to $540.00 → checkout → order confirmation renders the SERVER-priced
   order; network shows 409→200; server log shows the fail-closed margin
   telemetry.

## Completed in Session 03 (2026-08-09) — AI Data Foundation

1. **Database + ORM** — Drizzle + Postgres dialect: PGlite embedded for
   dev/test (self-migrating, `.data/pglite` / `memory://`), node-postgres
   for prod (`DATABASE_URL`, explicit `npm run db:migrate`). One schema,
   one migration set (`0000_data_foundation.sql`, 20 tables). New scripts:
   `db:generate` / `db:migrate` / `db:seed` (seed = DEMO-labeled, refuses
   external DBs). `serverExternalPackages` for pglite/pg in next.config.
2. **`lib/data` service boundary** — 13 modules (session, request-session,
   event, customer, customer-need, configuration, conversation, order,
   quote, ai-usage, agent, insight, experiment, privacy), every input
   zod-validated, ids via `newId()` prefixed hex. `db/client.ts` throws if
   imported client-side.
3. **Server sessions + attribution** — `/api/events`, `/api/checkout`,
   `/api/quote` mint/refresh `bd_sid`/`bd_aid` httpOnly cookies; unknown or
   malformed client ids are never trusted; `session_started` emitted once
   per session; server-side merge preserves immutable first touch
   (unit-tested).
4. **Event dual-write** — GA4 dataLayer untouched; explicit mapping table
   (view_item→product_viewed, select_size→configurator_updated{option:size},
   begin_checkout→checkout_started, request_custom_quote/quote_form_started
   →quote_started{trigger}, purchase→null=server-side, view_cart/select_item
   /add_shipping_info/add_payment_info→dataLayer-only) in
   `lib/analytics/first-party.ts`; beacon/keepalive batched, exception-safe,
   never blocks UX; `/api/events` validates taxonomy + bounded scalar props,
   dedups on clientEventId, 413s oversized bodies.
5. **Commerce persistence** — mock checkout success now writes Order +
   OrderLine config snapshots + authoritative `purchase_completed` +
   `convertedAt` + checkout-sourced configuration row + ORDER_DATA need
   profile; quote submission writes Quote + Customer/Business upserts +
   Artwork metadata + USER_STATED need profile; ALL wrapped non-fatal —
   commerce never fails on a data-layer error (loud logs instead).
   Shopify redirects persist nothing (order rows arrive with webhooks,
   future session).
6. **Tests 59 → 102** (all green + typecheck + lint + prod build): need-
   profile provenance precedence, first-touch immutability, event
   validation/dedup, events route (cookies, attribution stripping, 400/413/
   422), conversation transcript round-trip + cascade delete, configuration
   versioning, checkout order persistence (+ nothing-persisted-on-409),
   quote persistence (+ "about 5000" never parsed), AiUsage totals,
   AgentDecision/Approval atomicity, insight sourceRefs enforcement,
   sticky experiment assignment, GA4 mapping table.
7. **Browser-verified on `next dev`**: full configure→cart→checkout→
   confirmation flow unchanged (order MOCK-MSMSG34E, $2,100 server-priced);
   database captured the entire funnel (25 events incl. server
   purchase_completed linked to the order row), the order + line snapshot,
   the checkout configuration, and the ORDER_DATA-enriched profile.

## Completed in Session 03.5 (2026-08-09) — Data Foundation Hardening

Fixes for the Session 03 independent audit (rated MOSTLY CLEAN). No
architecture changes, no new AI features — hardening only.

1. **Production database safety** — `db/client.ts` now REFUSES the
   embedded-PGlite fallback when `NODE_ENV=production` and `DATABASE_URL`
   is missing/empty: actionable error (names the env var + `npm run
   db:migrate`), no credentials in the message, failure not cached (env
   fix + retry works). Dev/test embedded behavior unchanged. Build-safe:
   only dynamic API routes touch the DB, so `next build` never trips it.
2. **AI usage aggregate overflow** — `aiUsageTotalsSince()` result casts
   changed `::int` → `::float8` (sum of int4 columns accumulates as
   bigint; the old int4 cast threw "integer out of range" past 2^31−1 ≈
   $2,147 of cost micros in a window). float8 parses as a JS number on
   both drivers and is integer-exact to 2^53. Interface unchanged; int4
   row columns unchanged (per-call values can't overflow them).
3. **Privacy deletion hardened** (`lib/data/privacy.ts`) — semantics now:
   session delete = one browser trail dies (cascade), commerce records
   survive detached and UNredacted; customer delete = the person dies —
   identity row + their sessions (same cascade) + cross-session need
   profiles/conversations linked by customerId — and surviving commerce
   records are redacted: quote payload PII **now including
   `artworkFileName`**, artwork `fileName` → "[deleted]" + `storageUrl`/
   `notes` nulled (fileType/sizeBytes/status kept). Businesses are
   companies, not people — never deleted. All in one transaction.
4. **Launch checklist** — new "Database (first-party data)" section: prod
   `DATABASE_URL` ⛔, `npm run db:migrate` before traffic ⛔, verify
   no-PGlite-fallback ⛔, migration pipeline documented, seed kept away
   from prod, backups.
5. **Tests 102 → 116** — `tests/db-client.test.ts` (production refusal,
   empty-URL, no cached failure, lazy real-PG init, no credential leak,
   dev/test fallback), ai-ops large-aggregate + empty-window totals,
   `tests/privacy.test.ts` (6 cases driving the real quote route: session
   cascade vs. commerce survival, customer redaction incl. filenames,
   cross-session cleanup, second-customer isolation, unknown-id no-op).

## Completed in Session 04 (2026-08-10) — AI Provider Infrastructure + Tool Architecture

Runtime foundation only — no agents, no customer-facing AI, no autonomous
actions. Everything OFF until `AI_RUNTIME_ENABLED=true` + a provider key.
**Security boundaries (structural, tested):** AI cannot override or set any
price (pricing tools delegate to the engine; outputs exclude cost/margin/
floor fields), cannot access admin secrets (server env unreachable from
tools; keys never in prompts or logs), cannot modify ads, issue refunds, or
change manufacturing rules (no such tools exist; FINANCIAL_RESTRICTED /
ADMIN_RESTRICTED tiers are granted to no agent and rejected from
customer-facing registries), and cannot invent authorization (contexts are
server-minted).

1. **Provider layer** — `lib/ai/providers`: minimal `AIProvider` interface
   (generateText / generateStructured / generateToolStep — single-shot;
   the loop is provider-agnostic in runtime.ts), Anthropic adapter on
   `@anthropic-ai/sdk` (new dependency) with injectable fetch, SDK-level
   timeout + conservative retries, vendor errors normalized to AiError
   (RATE_LIMITED/PROVIDER_UNAVAILABLE/TIMEOUT/CONFIGURATION/…), refusal
   stop-reason handled. Vendor blocks round-trip opaquely. IMPLEMENTED:
   anthropic · INTERFACE-READY, DEFERRED: openai, gemini (typed loud error).
2. **Config & flags** — `lib/ai/config.ts` (server-only, throws in browser;
   zod-parsed env: provider, keys, per-workload models, budgets, timeout,
   loop limits); `config/flags.ts` (AI_RUNTIME, AI_SALES, … all default
   OFF, `<FLAG>_ENABLED=true|1` to enable); `.env.example` documented.
3. **Router** — `selectModel(config, workload)`: deterministic env-config
   mapping, defaults haiku-4-5 / sonnet-5 / opus-5.
4. **Prompts** — versioned registry (id + semver + purpose + strict {{var}}
   templates); AiUsage rows carry prompt_id/prompt_version (schema +
   migration `0001_ai_usage_prompt.sql`, additive).
5. **Usage + budget** — every provider call (success AND failure) records
   through `recordAiUsage` non-fatally with loud logging; cost from
   `config/ai-pricing.ts` (null placeholders, maintenance documented, no
   invented prices); `assertWithinAiBudget` before every call: no caps ⇒
   proceed; over ⇒ AI_BUDGET_EXCEEDED; caps+unpriced model ⇒ config error
   (fail closed); totals outage ⇒ check_failed (fail closed).
6. **Structured outputs** — sanitizer produces provider JSON Schema, full
   zod re-validation on our side is the authority; bounded retry (default
   1) with a corrective registry prompt; refusals never retry.
7. **Tool architecture** — `ToolDefinition` (zod in+out, permission,
   server execute), `ToolRegistry` pipeline (exists → permitted → validate
   → execute → validate → audit-log with input hash, never content),
   server-minted `ToolExecutionContext` (LLM can't invent authorization),
   `AGENT_TOOL_PERMISSIONS` map (sales = READ+CUSTOMER_WRITE; ads = none),
   loop limits config-driven. Six sales tools (see architecture bullet);
   `createSalesToolRegistry()` refuses restricted tools structurally.
8. **Runtime facade** — `AiRuntime.generateText / generateStructuredObject
   / runToolConversation` + `isAiRuntimeAvailable()` no-throw probe.
9. **Tests 116 → 198** (all green; zero credentials, zero network):
   config/flags/factory/router/prompts, mocked-fetch Anthropic adapter
   (+ every error class + timeout), structured parsing/sanitizer/cost,
   budget guard (real DB, int4-overflow totals, fail-closed outage),
   registry mechanics + all six tools (engine-delegation equality,
   cost-field exclusion, provenance gate, no-session failure), end-to-end
   FakeAiProvider runs (exit criteria: whitelisted tool end-to-end with
   usage rows; injection red-team: modifyPrice/issueRefund →
   unknown_tool/permission_denied with zero side effects; all three loop
   limits; budget wiring).
10. **Docs** — new docs/AI_RUNTIME.md; AI_AGENT_ARCHITECTURE +
    ARCHITECTURE + BUSINESS_CONFIG_TODO + .env.example updated.

## Completed in Session 05 (2026-08-10) — AI Sales Agent Core

The first customer-facing AI capability, built on the S04 runtime. OFF by
default; commerce verified unaffected with every flag off.

1. **PREREQUISITE FIX — CustomerNeedProfile concurrency** (S03/S04 audit
   debt): `applyNeedProfileUpdate` now wraps read-merge-write in a
   transaction holding `SELECT … FOR UPDATE` on the profile row; creation
   races resolve via the sessionId unique index + ON CONFLICT DO NOTHING +
   re-lock; added per-field confidence support. Chosen over optimistic
   version-retry (same guarantee + a retry loop for a low-contention row)
   and over SQL jsonb-merge (would fork the tested TS rank gate into SQL).
   Concurrent disjoint writers, provenance-under-concurrency (both arrival
   orders), and creation races are tested
   (tests/need-profile-concurrency.test.ts). No schema change.
2. **Sales Agent runtime** — `lib/ai/agents/sales/` (agent/context/
   extraction/summarize), provider-independent (FakeAiProvider in every
   test), normalized SalesAgentResult; conversation lifecycle on the S03
   conversation service (+ findActiveConversation,
   markConversationEscalated — escalated conversations stay open,
   updateConversationSummary).
3. **Versioned sales persona** — `ai_sales_agent` v1.0.0 in the prompt
   registry ({{context}} var): progressive discovery, confirmed-only
   capability claims, no fabricated materials/dates/certifications/prices,
   DEMO pricing labeled, pricing-tool authority, escalation triggers,
   injection posture. Plus `ai_sales_need_extraction` and
   `ai_sales_summary` v1.0.0 (LOW_COST tier). AiUsage rows trace every
   call to prompt+version.
4. **Evidence-validated extraction (USER_STATED vs AI_INFERRED)** — model
   proposes {field, value, kind, evidence, confidence}; SERVER validates:
   USER_STATED only when quoted evidence occurs verbatim in the actual
   message AND the value is consistent with it (complete-number match for
   numerics — "5,000" states 5000 never 500; topic keyword for booleans;
   substring for strings). Fabricated quotes dropped entirely; honest
   interpretations + hedged numbers demote to AI_INFERRED;
   priceSensitivity/purchaseIntent permanently AI_INFERRED; per-candidate confidence
   stored per field. saveCustomerNeed tool remains hard-coded AI_INFERRED —
   the model has NO path to claim USER_STATED.
5. **Two new tools (toolset 6→8)** — recommendProduct (READ,
   catalog-validated; hallucinated ids rejected; ai_product_recommended
   event) and requestHumanHelp (CUSTOMER_WRITE; structured handoff with
   reason enum/requirement summary/customer question/voluntary contact/
   profile snapshot persisted as a system message; conversation
   escalated-not-ended; human_handoff_requested event; delivery = owner
   config, deferred).
6. **Chat API `/api/ai/chat`** — POST {message} only; server-resolved
   bd_sid identity (client cannot supply customerId/agentType/price);
   413/400/422 validation; per-session + per-IP token buckets
   (lib/rate-limit.ts, in-memory, documented per-instance limitation +
   LAUNCH_CHECKLIST edge requirement); every AI failure → 503 with ONE
   fixed customer-safe sentence (provider internals never cross); GET
   history filters to user/assistant rows (system handoffs + tool rows
   never reach clients); rolling cookies preserved.
7. **AI Packaging Expert UI** — server-gated launcher (both flags + key or
   nothing renders) + client widget: history restore, quick prompts,
   loading/error/retry, escalation banner, "Configure this bag →"
   recommendation chip, aria-live log + labels + Escape, mobile layout,
   Hallmark Cobalt tokens. Mounted in app/layout.tsx.
8. **Events & metrics groundwork** — ai_chat_started / ai_message_sent
   (bounded props, never transcript content) / ai_product_recommended /
   human_handoff_requested; AiUsage rows carry conversationId+agentType →
   per-conversation cost is computable once ai-pricing is filled. No
   dashboard, no invented conversion attribution.
9. **Tests 198 → 252** (all green; zero credentials/network): concurrency
   (6), extraction evidence/adversarial/contradiction (13), agent
   end-to-end incl. injection red-team + loop limits + failure modes (19),
   chat route validation/gating/rate/leak checks (12), rate limiter (4);
   S04 toolset assertions updated for the two new tools.
10. **Optional live smoke** — `npm run ai:smoke` (scripts/ai-smoke-test.ts):
    skips cleanly without credentials; verifies all three configured model
    ids via the provider models API (404 ⇒ actionable error + account model
    list) before ONE real LOW_COST call; never part of npm test / build.
11. **Docs** — new docs/AI_SALES_AGENT.md (authoritative); AI_RUNTIME
    (concurrency RESOLVED, 8 tools, sales prompts), AI_AGENT_ARCHITECTURE
    (status, toolset, implemented conversation flow), ARCHITECTURE (S05
    layer + 3 decision-log entries), DATABASE_SCHEMA (locking + S05
    conversation semantics), BUSINESS_CONFIG_TODO (escalation delivery),
    LAUNCH_CHECKLIST (new AI section), README (ai:smoke), .env.example.

## Completed in Session 06 (2026-08-10) — AI Sales × Product Configurator

ONE shared authoritative configuration state — invariant 1 realized. The
known issue "six useState hooks local to ProductConfigurator" is RESOLVED.

1. **`lib/configuration/` domain layer** — validation.ts (pure, isomorphic:
   `defaultConfiguration` shared by UI+server, `applyConfigurationPatch`
   all-or-nothing partial patches with structured `PatchIssue[]`+available
   alternatives, `validateFullConfiguration`, `describeConfiguration`;
   below-MOQ + custom color stay LEGAL custom-quote states, matching the
   UI's historical behavior), store.ts (pure reducer: SET_* actions,
   LOAD_SERVER_CONFIGURATION with revision gate + field-level dirty merge
   so a customer's in-flight click never gets visually clobbered,
   SYNC_ACKNOWLEDGED value-compare, RESET), context.tsx (React provider:
   GET restore on mount, 700ms debounced POST persistence that never
   blocks clicks and silently retries, sync-bus subscription, flushSync
   before add-to-cart), sync-bus.ts (typed pub/sub bridging the layout-
   mounted chat and page-mounted configurator + presence registry).
2. **Server application path** — server.ts `resolveCurrentConfiguration` /
   `applyConfigurationPatchForSession` / `syncConfigurationForSession`
   over configuration-service's new `updateConfigurationChecked`
   (transaction + SELECT…FOR UPDATE + expectedRevision compare → stale
   writes return current state, never clobber) and
   `getLatestActiveConfiguration`. Prices via `sellPriceFor` — engine
   sell side only. CONFIGURATOR-rank need evidence on every apply
   (need-mapping.ts mirrors checkout's ORDER_DATA field mapping).
3. **`/api/configuration`** — POST {productId, config} (UI snapshot sync,
   deliberately last-write-wins) | {productId, patch, expectedRevision?}
   (tapped suggestion; full revalidation; 409 STALE_REVISION with current
   state; 422 UNSUPPORTED_OPTION with issues; 404 unknown product), GET
   restore (no session minting). Strict zod patch schema — price/artwork/
   admin keys are loud errors, not stripped.
4. **ProductConfigurator refactor** — six useState hooks → the shared
   store (UI-local state stays local: custom-qty echo, postal, shipping
   msg, added-flash); behavior + analytics byte-identical; adds session
   restore, AI-change highlight (~6s "Updated by Packaging Expert" badge
   + accent ring), sr-only aria-live announcements ("Packaging Expert
   updated quantity to 10,000."), flushSync on add-to-cart.
5. **Three configuration tools (registry 8→11)** — getCurrentConfiguration
   (READ; customer-visible view: labels, quantity, artwork status,
   revision, engine price, requiresCustomQuote; cost/margin/floor/source
   structurally excluded), updateConfiguration (CUSTOMER_WRITE; partial
   patch of the 5 option fields ONLY — no artwork/customDimensions/price
   inputs exist; applied|rejected(issues+alternatives)|stale_revision|
   unknown_product), suggestConfigurationUpdate (READ; validates+prices a
   hypothetical, writes nothing, returns label/patch/basedOnRevision/
   productPath/preview for the apply chip). Events:
   ai_configuration_updated/rejected/proposed (taxonomy +2).
6. **Agent + chat wiring** — sales context injects the live configuration
   ("Current configuration (live, revision N)… never ask them to repeat
   it"); SalesAgentResult + /api/ai/chat carry configurationUpdate
   (validated config+revision+changedFields+changeSummary+price) and
   suggestedActions; assistant rows stamp configSnapshotJson; prompt
   ai_sales_agent v1.1.0 (COMMIT vs PREVIEW: "make it 10,000" commits,
   "what would 10,000 cost?" prices only; small clear changes apply
   directly, substantial-cost changes preview+propose; never change
   unrequested fields; relay rejection alternatives; reconcile on
   stale_revision; artwork only via the uploader).
7. **Chat UI** — publishes server-validated updates on the sync bus (the
   configurator applies through the reducer), renders "✓ Configurator
   updated" chips (changeSummary + engine total + "(demo pricing)") and
   suggestion apply-chips (POST through /api/configuration; stale →
   honest "no longer matches" copy; off-page → link to configurator);
   mobile launcher bottom-24 + panel bottom-[9.5rem] when a configurator
   is mounted so the sticky Add-to-Cart CTA is never covered.
8. **Conversation outcomes (S03/S05 debt)** —
   `markConversationOutcomeForSession` stamps quote_started/
   checkout_started/purchased from the quote/checkout routes without
   ending conversations; purchased never downgrades; escalated preserved.
   Decided: quotes never point configurationId at the live row (it keeps
   mutating) — embedded payloads remain the quote truth.
9. **Tests 252 → 317** (all green; zero credentials/network):
   configuration-store (validation rules, reducer, stale-revision gate,
   field-merge race, artwork preservation), configuration-route (sync/
   patch/restore/cross-session isolation/CONFIGURATOR-vs-USER_STATED
   provenance/cart-consistency), ai-configuration-tools (all three tools,
   partial-patch preservation, structured rejections, stale protection,
   price/artwork injection red-team, event emission, provenance),
   ai-sales-agent "shared configuration flow" (commit/suggest/stale/
   red-team turns, context injection, configSnapshot), chat-route wire
   signals, conversation outcome stamping.
10. **Browser-verified (desktop + 375px mobile)** on `next dev` with a
    scripted localhost mock of the provider Messages API
    (ANTHROPIC_BASE_URL env; zero real credentials, zero app-code
    changes, .env.local removed after): flags-off manual flow + no
    launcher; "Make it 10,000 bags" → visible configurator update +
    badge/ring highlight + aria-live + $3,700.00 re-price; suggestion
    chip "Update to 25,000 bags · $8,250.00 (demo)" → tap → visible
    update to 25,000/$8,250; manual click → agent sees it next turn;
    reload restoration (incl. an S03-era row restored by cookie);
    cart line = shared state (Large·Black·No logo·10,000×$0.37=$3,700);
    provider-down → the one customer-safe sentence; mobile launcher/
    panel clear the sticky CTA.
11. **Docs** — new docs/AI_CONFIGURATOR_INTEGRATION.md (authoritative);
    ARCHITECTURE (S06 module row, invariant 1 "enforced since S06", 5
    decision-log entries), AI_SALES_AGENT (11 tools, v1.1.0 prompt, S06
    result/UI/outcomes, limitations updated), AI_AGENT_ARCHITECTURE
    (toolset ✅, flow + config sync), AI_RUNTIME (toolset table),
    DATABASE_SCHEMA (revision semantics, live writers, outcome stamping,
    configSnapshotJson, taxonomy +2), CURRENT_SYSTEM_AUDIT (risk 6 +
    REFACTOR item RESOLVED), BUSINESS_CONFIG_TODO (confirmation
    thresholds item). No schema/migration changes — S03's tables already
    carried version/source/configSnapshotJson.

## Completed in Session 07 (2026-08-11) — AI Sales × Cart / Checkout

The first full AI-assisted purchase path (§44), OFF by default; manual
commerce browser-verified byte-identical with every flag off.

1. **`lib/commerce/cart-line.ts`** — ONE server validation path behind
   every AI-path cart addition (tool commit AND chip tap): loads the
   AUTHORITATIVE shared configuration, verifies `expectedRevision` (S06
   guard extended to commerce), enforces manual-parity add rules (artwork
   required, custom-quote routing), re-prices with the engine, and treats
   `expectedTotalCents` as drift detection only → `repriced` with both
   totals (never a silent add at a changed price). The prepared line is
   byte-equivalent to a manual add (same config/optionSummary/engine
   prices — asserted in tests).
2. **`/api/cart/line`** — the chip-tap endpoint: STRICT body (injected
   price/config keys = loud 422), session-scoped, 200 prepared / 409
   REPRICED / 409 STALE_CONFIGURATION / 422 ARTWORK·QUOTE / 404; emits
   `ai_add_to_cart_requested{via:chip}` + stamps `cart_added`.
3. **Four commerce tools (registry 11→15; sales grants COMMERCE)** —
   addConfiguredProductToCart (explicit customer intent only; structured
   price_changed/stale/blocked outcomes), suggestAddToCart (no-write
   "Add to cart" button proposal), getCartSummary (engine-priced view of
   the client-reported cart; honest "unavailable" without a snapshot),
   startCheckout (EMPTY strict input; validates readiness and surfaces a
   customer-confirmed CONTINUE_TO_CHECKOUT action — with the mock
   provider a checkout IS an order, so tap-to-confirm is structural).
4. **Cart visibility** — chat POST gains a bounded STRICT **price-free**
   cart snapshot (ids/quantities/hasArtwork, ≤50 lines; client prices are
   a 422, never data); server-minted into ToolExecutionContext; context
   block renders the engine-priced cart ("Cart (N lines)…" /
   "Cart: empty."); MAX_CONTEXT_CHARS 2400→3200.
5. **Client execution through the manual paths** — validated `cartAdd`
   payloads apply via the SAME `useCart().addLine` the configurator uses
   (+ generic add_to_cart event with addedVia:"ai_chat"); NEW
   `lib/cart/checkout-client.ts` is the ONE client checkout submission
   (cart page refactored onto it); the chat's "Continue to checkout · $X"
   runs it, shows REPRICED as "Prices were updated … Confirm & continue
   at $Y" (cart corrected to server numbers, second explicit tap), and
   navigates only to the app's order page or the provider URL returned by
   `/api/checkout`. Chips: real buttons, loading/disabled states,
   role="status" announcements; mobile keeps the S06 offsets.
6. **Attribution & outcomes** — `lib/data/ai-assistance.ts` defines
   material assistance conservatively (sales conversation + ≥1 of
   ai_product_recommended / ai_configuration_updated /
   ai_add_to_cart_requested / ai_checkout_requested); order creation
   stamps `aiAssisted` + links `conversationId` (linked whenever a
   conversation exists; assisted only when material) and
   purchase_completed carries an aiAssisted prop. Conversation outcome
   `cart_added` added with funnel ranking (purchased > checkout_started >
   cart_added/quote_started); escalated preserved. Taxonomy +3:
   ai_add_to_cart_proposed / ai_add_to_cart_requested{via,outcome} /
   ai_checkout_requested{outcome}.
7. **Prompt `ai_sales_agent` v1.2.0** — cart & checkout contract:
   explicit-intent-only with counted examples AND non-examples ("looks
   good"/"how much" never add), read-then-add (revision + shown total),
   reprice → state new price + wait for confirmation, stale → reconcile,
   artwork/quote routing, "add it and take me to checkout" as dual
   intent, getCartSummary for cart questions (never guess), duplicate-add
   honesty, shipping/tax = "calculated at checkout" only.
8. **Security (structural, red-team-tested)** — no tool input carries a
   usable price/discount/config/artwork/URL (STRICT schemas →
   invalid_input); markOrderPaid/applyDiscount/capturePayment/
   createCheckout/setShippingCost/setTax don't exist (unknown_tool, zero
   side effects); "add this for $1" → server re-quote wins; checkout
   destinations are provider-generated only; purchase events fire ONLY at
   authoritative order creation (tested: none from AI actions).
9. **Tests 317 → 352** (all green; zero credentials/network):
   tests/cart-line.test.ts (prepare statuses, manual-equivalence,
   /api/cart/line contract + injection, outcome ranking, aiAssisted
   attribution + purchase-prop), tests/ai-cart-tools.test.ts (4 tools,
   permission tiers, injection red-team, §44 flow, weak-language no-op,
   ADD_TO_CART action lift, cart context injection, chat-route wire +
   strict snapshot); S04–S06 toolset/permission assertions updated.
10. **Browser-verified (desktop + 375px mobile)** on `next dev` with the
    S06-style scripted provider mock (ANTHROPIC_BASE_URL; no credentials,
    no app-code changes, .env.local removed after): "Make it 10,000 large
    black bags with no logo" → config sync; "Add it to my cart." →
    "✓ Added to your cart" chip (Large·Black·No logo·10,000×$0.37=
    $3,700.00 demo) + badge + identical cart-page line; "add at the old
    price" → price_changed relayed, nothing added; "Checkout please" →
    "Continue to checkout · $3,700.00 (demo)" → tap → order
    MOCK-MSPBCD9Q; tampered cart price → visible REPRICED confirm →
    corrected order; mobile flow no-overlap; provider-down single safe
    sentence with manual commerce intact; flags-off manual two-line order
    (AI line preserved beside manual line).
11. **Docs** — new docs/AI_COMMERCE_INTEGRATION.md (authoritative);
    ARCHITECTURE (S07 module row, invariant 2 extended, 4 decision-log
    entries), AI_SALES_AGENT (15 tools, v1.2.0, wire shape, S07 UI/
    metrics/limitations), AI_AGENT_ARCHITECTURE (toolset ✅, flow,
    red-team), AI_RUNTIME (toolset table), AI_CONFIGURATOR_INTEGRATION
    (S07 cross-ref), DATABASE_SCHEMA (taxonomy, outcomes, aiAssisted
    semantics), LAUNCH_CHECKLIST (+/api/cart/line edge limiting, S07
    boundary verification), prompts/00-INDEX statuses. No schema/migration
    changes — S03's orders.aiAssisted/conversationId columns were waiting.

## Completed in Session 08 (2026-08-12) — Customer Intelligence Engine

The first intelligence layer + the first admin surface. OBSERVE→CLASSIFY→
AGGREGATE→REPORT only; commerce verified untouched (all S02–S07 tests
green, no commerce file modified).

1. **Schema (migration `0002_customer_intelligence.sql`, additive)** —
   new `conversation_classifications` (one row per conversation: status
   classified|failed, classifierVersion, promptId/promptVersion/model,
   questions/objections/unsupportedRequests JSON with per-message
   evidence, userMessageCount, sourceUpdatedAt; UNIQUE(conversationId);
   CASCADE with its conversation so privacy deletion rides the S03.5
   cascade) + `product_opportunities` gains opportunityType/valueJson/
   periodStart/periodEnd.
2. **`modules/customer-intelligence/`** — deterministic authority with NO
   lib/ai import: taxonomy.ts (14 question themes, 12 objection types,
   request kinds, support verdicts, insight/opportunity types, outcome
   groups, CLASSIFIER_VERSION), catalog-support.ts (real-catalog matching;
   custom color/size/capacity/below-MOQ = custom_quote_path, never gaps;
   short option ids match whole words only), qualified.ts (THE deterministic
   denominator), period.ts ([start,end) windows, safePercentage/safeTrendPct
   — null under documented minimums), aggregate.ts (corpus load,
   conversation-level dedup with separate mention counts, three demand
   lanes, funnel from events+orders, segments, attribution [click ids
   never surfaced], descriptive associations), insights.ts +
   opportunities.ts (template-filled candidates from real counts; stable
   identityKey; dismissed/archived resurrect only on grown evidence;
   opportunities created `proposed` only, human decisions frozen),
   report.ts (everything the admin page renders + conservative
   lost-opportunity view).
3. **AI classification (`lib/ai/agents/customer-intelligence/`)** —
   classifier.ts: LOW_COST `generateStructuredObject` with closed-enum zod
   schema; labels pointing at messages we didn't send are DROPPED
   (logged); request phrases lowercased+deduped; prompt
   `ai_customer_intelligence_classifier` v1.0.0 (registry) with explicit
   question-vs-objection contract. process.ts: explicit idempotent
   batches (never page-load; cap 25) — reprocess only when version
   changed / new messages / previous failure; budget/provider/rate/timeout
   ⇒ abort batch leaving rows PENDING; invalid output ⇒ that row failed
   (errorCode), batch continues; flags-off/config ⇒ `unavailable`, zero
   writes. AiUsage stamped per call (agentType customer_intelligence).
4. **`lib/data/intelligence-service.ts`** — all intelligence DB access:
   corpus queries (conversations/messages/profiles/orders/configurations/
   sessions), GROUP BY event counts + FILTER order counts (::float8),
   classification upsert + needs-classification detection, and
   `resolveEvidenceRefs` (bounded excerpts; deleted rows counted as
   missing, never reconstructed). insight-service extended: getInsight/
   getOpportunity, updateInsightMetrics/updateOpportunityMetrics
   (regeneration paths; opportunity status/humanValidationRequired
   untouchable), INSIGHT_STATUSES +dismissed.
5. **Admin auth (FIRST admin surface; decision in ARCHITECTURE.md)** —
   HTTP Basic from `ADMIN_USER`/`ADMIN_PASSWORD`: `proxy.ts` (Next 16
   middleware) challenges /admin + /api/admin; `lib/admin/auth.ts`
   (edge-safe, constant-time compare) re-checked inside EVERY page and
   route; env unset ⇒ 404 everywhere (fail closed, tests included);
   /admin robots-disallowed, pages noindex.
6. **Admin UI + API** — `/admin/customer-intelligence`: period selector
   (7/30/90 + custom ?from/?to), classification status + "Process new
   conversations" button (the ONLY AI trigger), overview cards,
   AI-assisted funnel (session-distinct; purchases from the conservative
   order flag), questions/objections tables (counts, mentions,
   denominator-honest percentages, gated trends), three-lane demand,
   product gaps + custom-quote-path requests, conservative lost
   opportunities, opportunities + insights with status chips + evidence
   drill-down pages, segments/associations (sample-gated), honest empty
   states quoting real thresholds. API: POST process (runs classification
   batch, then deterministic insight+opportunity generation — works with
   AI unavailable), POST insights/[id]/status, POST
   opportunities/[id]/status (the only path to validated/rejected).
7. **Config** — `config/customer-intelligence.ts` (documented policy
   thresholds + VOLUME_GROUPS derived from the real 500 MOQ + presets);
   `.env.example` +AI_CUSTOMER_INTELLIGENCE_ENABLED +ADMIN_USER/
   ADMIN_PASSWORD; flag already existed (S04).
8. **Tests 352 → 415** (all green; zero credentials/network; fixtures
   test-only): taxonomy/catalog-support/qualified/period math (17),
   classifier + processing failure modes incl. fabricated-messageId drop,
   idempotency, budget/provider aborts, flags-off (10), aggregation —
   dedup(4 mentions=1 conversation), question-vs-objection fixtures
   (Restaurant B/D), period filtering, demand-lane separation, funnel,
   gated associations, trends, attribution without click ids, suppressed
   percentages (12), insights/opportunities — thresholds, identity dedup,
   dismissed suppression+resurrection, human-frozen statuses,
   evidence-vs-refs enforcement (10), privacy — cascade + missing-evidence
   honesty + bounded excerpts (4), admin — fail-closed auth, flag gating,
   graceful AI-less processing, status routes (10).
9. **Docs** — new docs/CUSTOMER_INTELLIGENCE.md (authoritative);
   ARCHITECTURE (admin-surface note, module map, 4 decision-log entries),
   DATABASE_SCHEMA (S08 writer + classification table + privacy note),
   AI_AGENT_ARCHITECTURE (agent #2 implemented), AI_RUNTIME (prompt),
   GUARDRAILS (CI autonomy row), AI_PLATFORM_ROADMAP (Stage D ✅),
   prompts/00-INDEX (08 ✅, 09 next), LAUNCH_CHECKLIST (admin section),
   BUSINESS_CONFIG_TODO (admin auth RESOLVED + CI thresholds), .env.example.

## Completed in Session 09 (2026-08-12) — Business Intelligence + CEO Recommendation Agent

The business-level intelligence layer + the second admin surface.
MEASURE→SYNTHESIZE→EXPLAIN→RECOMMEND only; storefront/commerce verified
untouched (all S02–S08 tests green, no commerce file modified).

1. **Schema (migration `0003_business_intelligence.sql`, additive)** —
   new `ceo_reports` (one append-only row per explicit generation run:
   periodStart/End/Days, promptId+version, model, provider, snapshotJson
   [the exact deterministic snapshot the model saw], reviewJson
   [server-validated output], decisionIdsJson). Decision documented: a
   dedicated table, NOT AgentDecision — a review is a versioned document;
   recommendations are individual decision rows.
2. **`modules/business-intelligence/`** — deterministic authority with NO
   lib/ai import: availability.ts (Metric<T> AVAILABLE/PARTIAL/UNAVAILABLE
   + denominator-honest ratio; metricValue() returns null, never 0),
   trend.ts (explicit states, MIN_TREND_BASE gate), revenue.ts (orders
   table = truth; multi-line dedup; cancelled/refunded excluded+reported;
   single-currency headline rule), funnel.ts (distinct sessions/stage +
   4 documented-denominator rates; purchases from orders), ai-metrics.ts
   (S07-conservative AI sales + spend by provider/model/agent; unpriced
   calls → PARTIAL/UNAVAILABLE, never $0; cost-per metrics inherit
   availability), profitability.ts (order-level reconstruction via the
   S02 cost model; gross vs contribution-BEFORE-paid-media precisely
   named; per-ORDER payment fee; isCostModelFullyConfigured static
   check), products.ts (per-product performance + GROSS-only profit —
   fee allocation would be invented), segments.ts (businessType only),
   attribution.ts (first/last touch, campaign, landing page; click ids
   never surfaced; adSpendIntegrated:false — no CAC/ROAS), snapshot.ts
   (BusinessHealthSnapshot + 7 deterministic data-quality warning codes),
   report.ts (dashboard assembly; CEO narrative = persisted report only,
   with staleness note).
3. **CEO agent (`lib/ai/agents/ceo/`)** — schema.ts (zod review schema;
   controlled confidence/risk/category enums; ordinal confidence encoding
   documented as sort-key-only), context.ts (bounded PII-free snapshot
   rendering that BUILDS the validMetricRefs/validEvidenceRefs whitelists
   from exactly what it prints), agent.ts (flags→snapshot→context→ONE
   REASONING structured call→server-side ref validation [invalid refs
   filtered; ref-less recommendations dropped+logged]→AgentDecision
   persistence with identity dedup→ceo_reports row; budget/provider
   failures return failed/unavailable and persist NOTHING). Prompt
   `ai_ceo_business_review` v1.0.0 registered (numbers-only-from-context,
   availability respect, observational language, ref-copying contract,
   recommendation-only stance). agent-service gained
   `updateDecisionRecommendation` (pending+unexecuted rows only).
4. **Admin** — `/admin/business-intelligence` (S08 auth + flag,
   fail-closed 404; periods 1/7/30/90 + custom; owner-friendly metric
   cards with reasons as hints — "Unavailable — configure manufacturing
   costs", never $0; funnel/AI/profitability/signals/trends/products/
   segments/attribution sections; CEO review renders the persisted
   report + "Generate your first CEO Review" empty state) + POST
   `/api/admin/business-intelligence/ceo-review` (strict body; 404/401/
   413/400/422; AI failures → honest 503 while deterministic metrics
   stay up). New flag `AI_BUSINESS_INTELLIGENCE` (+ .env.example).
5. **Config** — `config/business-intelligence.ts` (documented policy
   thresholds: %≥5 denominator, trend≥5 base, segment≥5, ≤10
   recommendations/review, context ≤16k chars, 5k row bounds).
6. **Tests 415 → 451** (all green; zero credentials/network;
   FakeAiProvider only): availability/ratio/trend semantics, revenue
   (multi-line dedup, mixed-currency unavailability, cancelled exclusion,
   0-orders AOV honesty), funnel denominators, segments, attribution
   (click-id absence), snapshot assembly + data-quality codes, §46
   cost-config suite (all-null ⇒ revenue AVAILABLE + every profit metric
   UNAVAILABLE with reasons and NO value property; test-only configured
   model ⇒ exact gross/contribution math incl. one-fee-per-order and
   PARTIAL mixed coverage; production placeholders untouched), AI cost
   availability tiers, CEO agent (report+decision persistence, no-tools
   structural check, fabricated-ref dropping, dedup update-in-place,
   human-verdict freezing, budget/provider fail-safety with prior report
   surviving, flags-off unavailability, PII-free context against seeded
   email/name/artwork/message content), admin route gates + strict
   validation + deterministic-report-without-AI.
7. **Docs** — new docs/BUSINESS_INTELLIGENCE.md (authoritative);
   ARCHITECTURE (module rows + 3 decision-log entries), DATABASE_SCHEMA
   (ceo_reports + service table), AI_AGENT_ARCHITECTURE (agent #7
   implemented), AI_RUNTIME (prompt), GUARDRAILS (CEO autonomy row),
   AI_PLATFORM_ROADMAP (Stage E core ✅, Action Center → S10),
   prompts/00-INDEX (09 ✅, 10 next), LAUNCH_CHECKLIST (+BI section),
   BUSINESS_CONFIG_TODO (launch-vs-profit-intelligence cost split + BI
   section), .env.example.

## Completed in Session 10 (2026-08-12) — Guardrail Engine + AI Action Center

The system-wide safety/approval layer. Recommendation → structured action
→ deterministic evaluation → risk → human approve/reject/modify →
approved-action record. **Execution stays deferred: no executor exists.**
Storefront/commerce verified untouched (every S02–S09 test green; no
commerce file modified).

1. **Schema (migration `0004_guardrails_action_center.sql`, additive)** —
   `agent_actions` (source, decision link, closed actionType, validated
   payload, revision/originActionId/supersededByActionId lineage, status
   ⟂ executionStatus, policy risk + modelSuggestedRisk metadata,
   server-derived reviewedBy/reviewedAt/reviewNotes, stateVersion,
   partial unique index `(source_decision_id) WHERE origin_action_id IS
   NULL` = sync idempotency at the DB level), append-only
   `guardrail_evaluations` (policy version, applied autonomy mode,
   allowed/executionEligible/approvalRequired, violated rules, missing
   config, limits snapshot) and append-only `agent_action_events`;
   `approvals` gained a nullable `action_id` so the S03/S09 decision-level
   approval spine records WHICH revision the human reviewed (no second
   approval model).
2. **`modules/guardrails/`** — the deterministic authority, no `lib/ai`
   and no `db/` import: types.ts (sources/modes/risk/rule severity/
   execution states/GuardrailDecision), actions.ts (20-type closed
   registry with strict per-type schemas, base risk, execution support,
   required limits, source→type permissions), evaluate.ts (the pure
   evaluator), executors.ts (EMPTY registry + the documented future
   executor contract), decision-mapping.ts (CEO category → review type,
   uncategorized ⇒ null).
3. **`config/guardrails.ts`** — `GUARDRAIL_POLICY_VERSION`, 10 `null`
   `[TO BE PROVIDED]` limits, per-agent `{defaultMode, maxMode}` (all
   business agents capped at RECOMMEND), EMPTY
   `GUARDED_AUTO_ALLOWED_ACTION_TYPES`, `MAX_UNATTENDED_RISK_LEVEL=MEDIUM`.
   Margin floors are NOT duplicated — `config/costs.ts → marginPolicy`
   stays the single home and the engine calls the same
   `evaluatePriceFloor`.
4. **`lib/data/agent-action-service.ts`** — proposeAction (evaluates and
   stores, blocked included), reviewAction and modifyAction (transaction +
   `SELECT … FOR UPDATE` + `stateVersion` check ⇒ 409 on double-click or
   stale reviewer), syncDecisionsToActions (deterministic, idempotent, no
   model call), plus reads for the admin surface.
   `lib/data/action-evidence.ts` resolves evidence refs against real
   insight/opportunity rows; unresolved refs are reported, never
   reconstructed.
5. **Admin** — `/admin/ai-actions` + `/admin/ai-actions/[id]` (S08 auth +
   `AI_ACTION_CENTER` flag, fail-closed 404) and POST
   `/api/admin/ai-actions/sync|[id]/review|[id]/modify` behind
   `lib/admin/write-guard.ts` (POST + auth + same-origin Origin/Referer +
   `application/json` + bounded body + strict schema — the CSRF answer to
   browser-auto-sent Basic credentials). `lib/admin/auth.ts` gained
   `adminIdentity()`: server-derived `reviewedBy`, never client-supplied.
   BI page links through to the Action Center when the flag is on.
6. **Tests 451 → 512** (all green; zero credentials/network/AI provider):
   guardrails-engine (fail-closed matrix, determinism, limits snapshot,
   autonomy clamping, source permissions, policy-vs-model risk, missing
   config, price-floor fail-closed, empty executor registry, null-limit
   assertion, no-lib/ai structural check, CEO category coverage),
   ai-actions-workflow (propose/blocked/OBSERVE/clamped, CEO sync
   idempotency, approve/reject + decision mirroring, double-click and
   stale-reviewer conflicts, modification lineage + re-evaluation +
   invented-evidence refusal, evidence resolution), ai-actions-admin
   (404/401/flag gates, cross-origin 403, form-post 415, no-Origin 403,
   strict bodies, red team: reviewedBy/riskLevel/approvalStatus/
   executionStatus rejection, server-recomputed risk, 409 staleness,
   approval ≠ execution, blocked action unapprovable),
   guardrails-separation (15 sales tools unchanged, no commerce/sales file
   imports the guardrail layer, no mutation/network call anywhere in it,
   CEO agent still tool-free and cannot approve).
7. **Docs** — docs/GUARDRAILS.md rewritten as the IMPLEMENTED spec; new
   docs/AI_ACTION_CENTER.md (authoritative); ARCHITECTURE (module map +
   admin note + 5 decision-log entries), DATABASE_SCHEMA (three tables +
   services), AI_AGENT_ARCHITECTURE (autonomy clamping + CEO approval
   path + tool separation), AI_PLATFORM_ROADMAP (Stage E complete),
   prompts/00-INDEX (10 ✅, 11 next), LAUNCH_CHECKLIST (+Action Center
   section), BUSINESS_CONFIG_TODO (+Guardrail limits, split into
   currently-required vs required-before-GUARDED_AUTO), .env.example.

## Important decisions (and why)

1. **Database is the first ADD** — every roadmap capability consumes
   structured first-party data; nothing unblocks without persistence.
   SQLite dev / Postgres prod, TS ORM, inside the monolith.
2. **Pricing engine is extended, not replaced** — already deterministic,
   pure, tested. Gaps: cost model, margin outputs, server-side checkout
   re-quote. Engine math is reused as the kernel of `modules/pricing`.
3. **Shopify stays behind `lib/commerce`; no Stripe** — checkout/payments/
   tax stay delegated; the AI layer operates above the commerce provider.
4. **Margin guardrails fail closed** — until real costs are configured, any
   price-affecting agent action is rejected as unverifiable.
5. **One configurator state** — AI tools will mutate the same validated
   reducer the UI uses; never parallel states.
6. **Checkout drift → 409 REPRICED, never silent substitution** — no order
   is created at a total the customer wasn't shown; the cart self-corrects
   and the user confirms again. Future AI cart/checkout tools must handle
   REPRICED the same way. Cost/margin data never leaves the server.
7. **(S03) Postgres one-dialect / two-driver (Drizzle + PGlite dev,
   node-postgres prod)** — one schema + one migration set, zero-setup dev,
   no SQLite/Postgres drift; external DBs never auto-migrate at request
   time.
8. **(S03) Persistence is additive to commerce** — DB failures log loudly
   and never fail a checkout/quote the customer completed; `/api/events`
   answers 503 quietly and the storefront never notices.
9. **(S03) Need-profile provenance is authority-ranked** — AI inference is
   data about our guess, never allowed to overwrite USER_STATED/ORDER_DATA/
   CONFIGURATOR facts; enforced in `applyNeedProfileUpdate`, not prompts.
10. **(S03) purchase_completed is server-written at order creation** — the
    first-party purchase record is immune to ad-blockers, StrictMode
    double-fires, and closed tabs; the client `purchase` event stays
    dataLayer-only (GA4/Meta copies).
11. **(S03) AgentAction = typed schema inside AgentDecision (no table);
    missing AgentConfig ⇒ OBSERVE** — one audit trail, fail-safe autonomy
    floor; insights REQUIRE sourceRefs so fabricated intelligence is
    structurally impossible.
12. **(S04) Official vendor SDK inside our adapter, one provider
    implemented** — @anthropic-ai/sdk stays entirely inside
    lib/ai/providers/anthropic.ts; the loop is provider-agnostic; no
    speculative openai/gemini adapters (interface-ready, loud typed error).
13. **(S04) AI security is capability-based, AI spend fails closed** —
    permission tiers + server-minted contexts + structurally-limited output
    schemas (sell-side pricing only), injection cases are unit tests;
    budgets over unpriced models or a failed budget check block the call
    rather than silently spending. Pricing config ships null (no invented
    economics), so budget caps are unenforceable until the owner fills
    config/ai-pricing.ts — deliberate.
14. **(S05) Need-profile writes serialize with row locks, not versions or
    SQL merges** — `SELECT … FOR UPDATE` in a transaction preserves the
    tested TS provenance logic byte-for-byte and gives real-Postgres row
    granularity; PGlite serializes whole transactions (same guarantee).
    Optimistic retry adds loops for a low-contention row; SQL jsonb-merge
    forks the rank gate into a second implementation.
15. **(S05) USER_STATED must be earned through server-verified evidence** —
    no model-writable path to top-rank provenance exists: the tool is
    hard-coded AI_INFERRED and the extractor grants USER_STATED only after
    verifying the quoted evidence against the customer's actual message
    (fabricated quotes die entirely; hedged numbers demote). The rank gate
    stays the final authority beneath both paths.
16. **(S05) One safe sentence for every AI failure at the chat boundary** —
    all AiError codes map to the same 503 customer copy; codes/details go
    to server logs. Customers never see provider internals, and the
    storefront's manual paths are always the stated fallback.
17. **(S05) Escalations are recorded before they are routed** — the
    structured handoff persists in conversation storage (queryable,
    testable) with delivery to email/Slack/CRM deferred to owner config;
    an unroutable escalation still exists and still shows the customer an
    honest "human will follow up" state.
18. **(S06) The shared configuration truth is the DB row; the React store
    is its live view** — the AI runs server-side and must read/commit
    without a browser; restore-on-mount + debounced sync keep the UI
    view live. No state library: useReducer+context matches the repo's
    cart pattern.
19. **(S06) AI writes are revision-checked under a row lock; UI snapshots
    are last-write-wins; client-side, dirty fields win field-wise** — the
    smallest strategy that makes silent clobbering impossible in every
    direction (stale AI patch vs newer manual change; concurrent AI load
    vs in-flight click). Chosen over event sourcing/CRDTs deliberately.
20. **(S06) The UI applies only server-validated configuration payloads,
    and patch schemas are STRICT** — configurationUpdate is lifted from
    validated tool output (never model prose); suggestion chips re-POST
    through /api/configuration for full revalidation; unknown patch keys
    (price/artwork/admin) are loud validation errors, never silently
    stripped — injection surfaces to the agent instead of half-working.
21. **(S06) AI-committed configuration changes record CONFIGURATOR-rank
    evidence** — the tool records what the configuration now IS; when the
    customer's words drove it, the S05 evidence extractor independently
    grants USER_STATED from the actual message. Still zero model-writable
    paths to top-rank provenance.
22. **(S07) The cart stays client-side; the AI gets a validated channel
    INTO it, not a server cart** — a server cart would fork the working
    localStorage-cart + checkout-re-quote design into two truths. The
    server validates/prices lines from the authoritative configuration;
    the client applies them through the manual `addLine`; `/api/checkout`
    stays the only order authority. AI and manual lines are equivalent by
    construction.
23. **(S07) Commerce tools carry intent, never authority; checkout needs
    a customer tap** — expectedRevision/expectedTotalCents are drift
    detection (reprice/stale = fresh confirmation required);
    startCheckout's input is the empty strict object and only surfaces an
    action the customer clicks (mock checkout IS an order, so
    tap-to-confirm is structural). The agent sees the cart only as a
    price-free client-reported snapshot the engine re-prices.
24. **(S07) aiAssisted is conservative and event-derived** — a sales
    conversation plus ≥1 material ai_* commerce event; a loaded widget or
    small-talk chat never counts. The order stores the boolean +
    conversation link; details stay derivable from events (no duplicated
    columns, no invented probability scores).
25. **(S08) The intelligence module computes every number; the model only
    labels with closed enums** — modules/customer-intelligence has no
    lib/ai import (fabricated counts structurally impossible); classifier
    labels must cite messageIds we actually sent (fabricated ids
    dropped); catalog support is deterministic matching, never model
    opinion. Chosen over LLM-estimates-percentages and free-text
    categories.
26. **(S08) Admin auth = HTTP Basic from env, proxy challenge + per-route
    re-check, fail-closed 404** — no session store or login UI for a
    single-operator tool; unset credentials mean the surface doesn't
    exist; handlers stay directly testable. Chosen over login+session and
    URL tokens.
27. **(S08) Classification persists once per conversation; reprocessing
    is explicit and version/message-driven** — page loads never call the
    model; budget/provider failures leave work PENDING (not failed) so
    runs resume; AI spend is bounded by a batch-capped admin action.
    Chosen over classify-on-load and background workers.
28. **(S08) Insights/opportunities are identity-stable and humans own
    terminal statuses** — one row per TYPE:dimension:periodDays updated
    in place; dismissed rows return only on grown evidence; generation
    creates opportunities as `proposed` and never touches
    validated/rejected — manufacturing feasibility is human-only by
    construction.
29. **(S09) Business metrics are typed availability results; missing
    inputs are never zero** — Metric<T> AVAILABLE/PARTIAL/UNAVAILABLE
    with reason+missingInputs everywhere (profitability, AI spend, mixed
    currencies); UNAVAILABLE has no value property at all, so null→0 is
    structurally impossible. Chosen over null-coalescing dashboards and
    over letting the LLM fill gaps.
30. **(S09) The CEO agent has no tools and its references are earned** —
    one structured-output call over the PII-free snapshot; the context
    builder constructs the metric/evidence whitelists from exactly what
    it prints, and persistence filters/drops anything outside them.
    Recommendation ≠ authority: approvalRequired always true,
    executionStatus never leaves `none`, human-reviewed identities are
    frozen against regeneration.
31. **(S09) CEO reviews live in a dedicated append-only table** —
    `ceo_reports` versions the document (period/prompt/model/exact
    snapshot/validated review/decision links) so failures keep the last
    good report visible and audits can replay what the model actually
    saw; AgentDecision stays the per-recommendation approval spine.
    Chosen over stuffing documents into decision rows and over
    regenerate-on-load.

32. **(S10) One guardrail engine, and it is a pure function** —
    `modules/guardrails` imports neither `lib/ai` nor `db/`, and
    `evaluateAgentAction` has no clock, randomness or I/O, so the same
    input under the same `GUARDRAIL_POLICY_VERSION` always produces the
    same verdict and a model can never influence one. Persistence stamps
    the time and writes an append-only evaluation row carrying the policy
    version AND the exact limits consulted. Chosen over per-agent safety
    checks (which drift apart) and over an LLM-judged safety layer.
33. **(S10) The action taxonomy is CLOSED and payload schemas are
    STRICT** — 20 registered types, each with its own zod schema; unknown
    types and unknown payload keys are validation failures. A model can
    neither invent a capability ("TRANSFER_MONEY") nor smuggle an
    authorization field (`riskLevel`, `approvalStatus`) into a payload.
    ACTION TYPE and EXECUTION SUPPORT are separate axes, so
    `PRICE_EXPERIMENT` is representable today with executionStatus
    NOT_SUPPORTED. Also: the SOURCE grants nothing — CEO_AGENT is
    permitted review types only, so a "lower all prices 90%" proposal is
    denied by permission, not by prompt wording.
34. **(S10) Autonomy is clamped by policy, not merely stored** —
    `agent_configs` remains the store (absent row = OBSERVE), but the
    evaluator applies `min(stored, policy ceiling)` where every business
    agent's ceiling is RECOMMEND. A mistaken or tampered AUTONOMOUS row
    grants nothing; the guarded-auto allow-list is empty and HIGH/CRITICAL
    risk always requires a human. Chosen over trusting one mutable row.
35. **(S10) Approval and execution are separate columns, and the executor
    registry is EMPTY** — `status` records the human verdict,
    `executionStatus` records whether anything happened. No dummy
    executors exist, so approving records intent and mutates no price, ad,
    product or payment; the documented contract (validated action → fresh
    evaluation → approval → idempotency key → before/after → audit →
    rollback) must be met before the first executor is registered. Chosen
    over one ambiguous status field and over stubs that pretend to work.
36. **(S10) Proposals are immutable; modification creates a re-evaluated
    revision** — an admin edit marks the original SUPERSEDED and inserts
    `revision + 1` with `originActionId`, then runs the FULL evaluation on
    the new payload: no verdict is inherited and a rule-violating edit
    lands as GUARDRAIL_BLOCKED. Evidence refs may narrow but never grow,
    so an edit cannot launder fabricated evidence. Transitions are
    `stateVersion`-checked under a row lock, so a double-click or a stale
    second reviewer conflicts instead of rewriting history. Chosen over
    in-place payload edits.
37. **(S10) Admin mutation routes defend against the cost of Basic auth** —
    browsers send Basic credentials automatically, so authentication alone
    would leave approve/reject cross-site triggerable. Every write requires
    POST + authenticated admin + same-origin Origin/Referer +
    `application/json` + a bounded body + a strict schema, and
    `reviewedBy` is derived from the server's configured `ADMIN_USER`.
    Documented as a tested control set, NOT a claim of full security
    compliance; per-user RBAC stays deferred.

## Known issues

- ~~Configurator state is six `useState` hooks local to
  `ProductConfigurator`~~ — **RESOLVED in Session 06**: `lib/configuration`
  shared store + `/api/configuration` writer (source "configurator"/"ai");
  see docs/AI_CONFIGURATOR_INTEGRATION.md.
- (S06) Configuration sync is debounced (700ms): a change made <1s before
  closing the tab may not persist (the visible UI never lies — reload
  falls back to the last-synced state). `/api/configuration` has no route
  rate limit (same posture as `/api/events` — platform-edge limiting is
  the LAUNCH_CHECKLIST item; payloads are strictly bounded).
- (S06) The AI-change highlight/announcement lives in the mounted
  configurator only — an updateConfiguration committed while the customer
  is on another page is visible in chat ("✓ Configurator updated" chip)
  and on next configurator mount (restore), with no page-level toast
  elsewhere (deliberate, avoids cross-page notification noise).
- Shopify variant mapping is `TODO(shopify)` pending a real store;
  `createCheckout` still ships a `REPLACE_ME` variant id. The catalog-read
  mock fallback in `lib/commerce/catalog.ts` must be REMOVED once the
  mapping is complete (tracked in LAUNCH_CHECKLIST).
- Shopify order/customer rows are NOT persisted yet — order webhooks are a
  future session; today only mock orders write DB records (by design).
- Quantity changes on the cart page re-price client-side for instant
  feedback (optimistic); the server re-quote at checkout remains the
  authority, so drift is always caught before an order exists.
- Artwork binaries are not persisted (metadata rows only — storage is a
  launch task).
- Dev-mode React StrictMode double-fires some dataLayer events (view_item,
  page_view) — visible as duplicate first-party rows in the DEV database
  only (distinct clientEventIds, so dedup correctly doesn't collapse
  them); purchase is server-written and immune; production unaffected.
- First-party event persistence runs independently of the marketing-consent
  banner (separate `NEXT_PUBLIC_FIRST_PARTY_EVENTS` switch); the owner
  must review consent/privacy-policy copy before launch —
  BUSINESS_CONFIG_TODO "Database & first-party data".
- PGlite is single-process: don't open `.data/pglite` from a second
  process while `next dev` runs (inspect after stopping the server, or
  point `PGLITE_DATA_DIR` elsewhere). Deploys that run the standalone
  output tracer must include `db/migrations/` if embedded mode is ever
  used server-side (external Postgres doesn't read migrations at runtime).
- Vitest: PGlite WASM cold-start needs the raised hook/test timeouts and
  `maxWorkers: 4` in vitest.config.ts — don't remove them.
- After a mock purchase the header cart badge shows the old count until
  the next full page load (order-status clears localStorage directly, not
  through the cart context) — pre-existing cosmetic quirk from Session 01.
- `next dev` regenerates `AGENTS.md` (Next 16 breaking-changes notice) —
  keep it committed, keep the `@AGENTS.md` import at the top of this file.
- (S05) Chat rate limiting is per-instance in-memory token buckets — a
  deliberate application guard, not a distributed limiter; platform-edge
  limiting is a ⛔ LAUNCH_CHECKLIST item before enabling AI_SALES on real
  traffic (S07: `/api/cart/line` shares this posture — strictly bounded
  payloads, no route limiter).
- (S07) Explicit-intent classification is prompt-enforced (v1.2.0) plus
  structural backstops (chips are customer taps; reprice/stale/checkout
  all require explicit confirmation) — there is no deterministic intent
  classifier, so an over-eager model could add a REVERSIBLE cart line
  without perfect wording; it can never price, pay, or check out.
- (S07) The chat's cart chips (added/repriced states) are per-turn client
  state — reloading restores transcript text but not chip states (same as
  S06 suggestion chips; the cart itself persists). Duplicate adds follow
  existing cart semantics (append) — the agent is prompted to surface
  "already in your cart" instead of silently re-adding.
- (S07) `orders.conversationId` links the latest sales conversation
  whenever one exists; `aiAssisted` alone marks material assistance — do
  not read linkage as attribution.
- (S05) Escalation handoffs are recorded (system message rows +
  human_handoff_requested events) but not yet DELIVERED anywhere — the
  destination is owner config (BUSINESS_CONFIG_TODO).
- (S05→S06) Sales conversation outcomes: quote_started/checkout_started/
  purchased now stamp from their routes (S06); `abandoned` needs a
  session-expiry sweep (future session). Extraction covers scalar fields
  only (painPoints/objections arrays deferred); in-chat contact info lands
  in the handoff record, not the customers table.
- (S05) `messages` ordering uses createdAt (no per-conversation sequence
  column); same-millisecond rows in one turn could theoretically
  interleave in history reads — not observed in tests, revisit if turn
  transcripts ever misorder.
- (S08) The admin page inherits the storefront layout chrome
  (header/footer) — app/layout.tsx wraps every route and opting out would
  require a route-group restructure; accepted for an internal tool (the
  chat launcher only renders under the separate AI_SALES gates).
- (S08) Classification coverage is explicit-run-driven: the dashboard
  shows pending/failed counts instead of silently classifying on load.
  A "weekly" cadence means running the admin action weekly (or wiring a
  scheduler later) — no background worker exists by design.
- (S08) Intelligence corpus queries are bounded (5,000 rows/period,
  identity scan over listInsights(1000)) — fine at current scale;
  revisit with real volume. `product_configurations` is a live mutating
  row, so the configured demand lane reflects latest-state-in-period,
  not a history.
- (S08) Admin Basic auth is single-credential (no per-user identities or
  audit trail of WHO clicked); acceptable for the single-operator stage —
  revisit before a second admin exists. Basic auth requires HTTPS in
  production (LAUNCH_CHECKLIST).
- (S09) BI queries share the S08 bounded-load posture (5,000 rows/period
  per table; sessions likewise) — fine at current scale, revisit with
  real volume. `ceo_reports.snapshotJson` stores the full snapshot per
  run (append-only); acceptable while generation is an explicit manual
  action.
- (S09) The "Last 24 hours" period is a rolling window, not a calendar
  day (documented). CEO recommendation dedup keys on the refs the model
  cites — a re-generated recommendation citing different metric refs
  creates a separate pending decision (bounded at 10/review; the owner
  dismisses stragglers; S10's Action Center is the management surface).
- (S09) `/admin/business-intelligence` inherits the storefront layout
  chrome, same as the S08 page (accepted for an internal tool).
- (S10) Admin identity is still single-credential Basic auth, so every
  `reviewedBy` reads as the one configured `ADMIN_USER` — the Action
  Center records WHAT was decided and WHEN, but not WHICH person decided
  it. Per-user RBAC and a per-person audit trail are deferred (this is the
  S08 limitation, now visible on approval records).
- (S10) Magnitude-based risk escalation ("a >X% budget increase is
  CRITICAL") is deliberately NOT implemented — it would require inventing
  X. Missing limits are surfaced as missing configuration, which blocks
  automated execution; risk itself comes from the action-type table.
- (S10) The Modify control is a JSON payload editor, not a per-field form.
  It is fully validated and re-evaluated server-side (an invalid edit is
  refused), but it expects an operator comfortable with the structured
  payload; per-type edit forms are a future refinement.
- (S10) Sync materializes actions from PENDING CEO decisions only. A
  recommendation already approved/rejected is history, not a pending
  question, so re-running sync never resurrects it.
- (S10) `/admin/ai-actions` inherits the storefront layout chrome (same as
  S08/S09) and shares their bounded-load posture (500 actions).
- (S10) The Action Center list resolves each action's latest evaluation
  with a per-row query — fine at current volume, revisit alongside the
  S08/S09 bounded-load items if action counts grow.

## Business configuration still needed

See `BUSINESS_CONFIG_TODO.md` — notably: real prices (site shows DEMO
notices until `NEXT_PUBLIC_DEMO_PRICING=false`), the entire cost model
(now structured in `config/costs.ts`, every value a `null`
`[TO BE PROVIDED]` placeholder — margins stay "unavailable" and price
guardrails fail closed until filled), factory identity/photos, policies
legal review, Shopify store + variant mapping, production `DATABASE_URL`
(+ `npm run db:migrate` at deploy), consent-policy review for first-party
events, AI provider key + budget caps + **model pricing
(`config/ai-pricing.ts`, null placeholders — budget caps fail closed until
filled)**, guardrail thresholds, escalation destination.

## Deferred work

Explicitly preserved for later sessions: **human escalation delivery**
(owner config), **real action executors** (none exist — the contract in
docs/AI_ACTION_CENTER.md must be satisfied first), **GUARDED_AUTO
promotion** (needs operating history + the guardrail limits in
config/guardrails.ts + an explicit human decision, Stage J), **per-user
admin RBAC** (single Basic credential today), **CRO Agent** + experiment
runtime (S11),
**Pricing Agent/Intelligence** (S12 — the CEO may recommend "review
pricing", never compute optimal prices), **Google Ads Agent** (S13+ —
until then NO ad-spend ingestion, NO CAC/ROAS anywhere), **Meta Ads
Agent**, autonomous commerce/background actions (never — every commerce
mutation traces to an explicit customer message or tap; S08/S09
intelligence additionally runs only on explicit admin actions). Also
deferred: `createDraftQuote` tool (the AI points at /request-quote
today), `getOrderStatus` tool, Shopify order webhooks → DB order rows
(real-store aiAssisted linkage + order-status revenue semantics land
there), accounts/reorder, email automation, Merchant Center feed, further
admin surfaces (ai-usage), privacy portal UI, conversation
`abandoned` outcome sweep + intelligence abandonment labeling (needs an
inactivity rule), scheduled/weekly intelligence processing + scheduled
CEO review delivery (manual admin actions today), quote-payload demand
mining, painPoints/objections need-profile array extraction,
owner-configured confirmation thresholds (BUSINESS_CONFIG_TODO),
multi-currency conversion model (headline metrics stay single-currency
until one exists). Order per `docs/AI_PLATFORM_ROADMAP.md`.

### Deferred technical debt (Session 03 audit — accepted, not forgotten)

Findings from the Session 03 independent audit deliberately NOT fixed in
the 03.5 hardening pass (small blast radius, none block Session 04):

- **`/api/events` rate limiting** — the intake validates, bounds and
  413s payloads but has no per-session/IP rate limit; add one before
  real traffic (pairs with the launch checklist, likely at the platform
  edge or in the route).
- ~~**CustomerNeedProfile concurrent-writer locking**~~ — **RESOLVED in
  Session 05** (the mandated prerequisite): transaction +
  `SELECT … FOR UPDATE` in `applyNeedProfileUpdate`, creation race via
  unique index + ON CONFLICT + re-lock; tested in
  tests/need-profile-concurrency.test.ts.
- **Multi-line order need-profile enrichment** — checkout's ORDER_DATA
  enrichment reads only the first cart line; multi-line orders
  under-enrich the profile.
- **Quote live-configuration pointer semantics** — quotes don't set
  `configurationId` to the session's live configuration row (S06 wires
  the configurator writer; decide the pointer semantics there).
- **`quote_started` event double-fire cleanup** — both
  `request_custom_quote` and `quote_form_started` map to
  `quote_started{trigger}`, so one user journey can record it twice
  with different triggers; dedup/refine when funnel reporting exists.

## Recommended next session

**Session 11 — Experiment Engine + CRO Agent** — run `prompts/11-cro.md`.
Prerequisites now exist: the `experiments` + `experiment_assignments`
tables have been live schema since S03 (no runtime), first-party events
give exposure/outcome measurement, `modules/business-intelligence`
supplies denominator-honest conversion metrics, and S10 supplies the
approval spine a CRO agent must go through — `CRO_EXPERIMENT_PROPOSAL`
(review-only, LOW) and `CRO_EXPERIMENT_LAUNCH` (MEDIUM,
`executionStatus = NOT_SUPPORTED`) are already registered action types,
and `CRO_AGENT` is already permitted exactly those.

Boundaries that stay: the CRO agent proposes, it never launches — a launch
executor is the first executor this codebase would ever have, so it must
satisfy the full contract in docs/AI_ACTION_CENTER.md (fresh evaluation,
approval, idempotency key, before/after, audit, rollback) and register in
`modules/guardrails/executors.ts`. `maximumExperimentTrafficPct` is
`[TO BE PROVIDED]`, so any launch action reports missing configuration and
cannot be execution-eligible until the owner sets it. Checkout must stay a
protected page. No insufficient-sample winners — reuse the existing
threshold doctrine in `config/business-intelligence.ts`.

Do not start it automatically.
