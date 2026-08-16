# DATABASE_SCHEMA

## Status: IMPLEMENTED (Session 03) + HARDENED (Session 03.5)

Engine: **PostgreSQL — one dialect, two drivers.**

- Production/staging: real Postgres via node-postgres (`DATABASE_URL`),
  migrations applied explicitly with `npm run db:migrate`.
- Development/tests: **PGlite** (embedded WASM Postgres) at
  `PGLITE_DATA_DIR` (default `.data/pglite`, gitignored; tests use
  `memory://`). Embedded databases **self-migrate** on first access
  (db/client.ts) — `next dev` and vitest need zero database setup.
- **Production refuses the embedded fallback (Session 03.5):** with
  `NODE_ENV=production` and `DATABASE_URL` missing/empty, the first
  database access throws an actionable error instead of silently writing
  to per-instance PGlite storage (which would vanish on redeploy). The
  failure is not cached — fixing the env and retrying works. Tested in
  `tests/db-client.test.ts`.

ORM: **Drizzle** (`db/schema.ts` is the single schema source;
`drizzle-kit generate` emits reviewable SQL migrations to
`db/migrations/`). Why Drizzle + PGlite over Prisma/SQLite: one Postgres
dialect end-to-end (no SQLite/Postgres type drift, one migration set),
no codegen step, plain-TS schema, and PGlite gives dev/test a real
Postgres without a server. Decision log: docs/ARCHITECTURE.md.

Conventions (all enforced in code):

- ids: app-generated prefixed hex (`sess_…`, `conv_…`, `evt_…`, `ord_…`) —
  `lib/data/id.ts`.
- Money: integer cents. AI cost: integer **micro-dollars** (per-call costs
  are fractions of a cent). Timestamps: `timestamptz` UTC.
- Enum-like columns are TEXT validated by zod **at the service boundary**
  (`lib/data/*`) — status vocabularies grow additively without ALTER TYPE.
- JSON snapshot columns reuse existing domain types (`ProductConfiguration`,
  `ArtworkRef`, attribution `Touch`) — the DB speaks the app's shapes.
- **No raw DB access outside `lib/data/` services** (agents later get
  typed tools that call these services — never SQL).

## Access layer (`lib/data/`)

| Service | Owns |
| --- | --- |
| `session-service` + `request-session` | cookie identity (`bd_sid`/`bd_aid`), server-side attribution merge, conversion stamp |
| `event-service` | platform event taxonomy, validated batch + server event writes |
| `customer-service` | Customer/Business upserts + linking |
| `customer-need-service` | CustomerNeedProfile progressive updates + provenance precedence |
| `configuration-service` | one live configuration per session×product, versioned |
| `conversation-service` | Conversation/Message transcript persistence |
| `order-service` / `quote-service` | order + line snapshots; quotes + artwork metadata |
| `ai-usage-service` | AiUsage rows + spend totals (budget-cap input) |
| `agent-service` | AgentDecision/Approval/AgentConfig + typed `AgentAction` schema |
| `insight-service` | CustomerInsight (sourceRefs mandatory) + ProductOpportunity |
| `experiment-service` | Experiment + sticky ExperimentAssignment |
| `intelligence-service` | S08 corpus reads, classification upsert, evidence resolution |
| `business-intelligence-service` | S09 session counts + AI-usage aggregates (unpriced calls counted, never $0) |
| `ceo-report-service` | S09 CEO review documents (append-only, versioned) |
| `agent-action-service` | S10 proposed actions: guardrail-evaluated proposal, human approve/reject/modify (row-locked + `stateVersion`-checked), CEO-decision sync, append-only evaluation + history rows |
| `action-evidence` | S10 server-side resolution of an action's evidence refs (unresolved refs are reported, never reconstructed) |
| `privacy` | deleteSessionData / deleteCustomerData (cascade + PII redaction) |

## Identity & commerce spine (implemented)

```
businesses    id · name · businessType? · industry? · website? · city? ·
              stateProvince? · country? · timestamps
customers     id · shopifyCustomerId?ᵁ · email?ᵁ · phone? · name? ·
              businessId?→businesses · firstSeenAt · lastSeenAt · timestamps
sessions      id (bd_sid cookie) · anonymousId (bd_aid cookie) ·
              customerId?⇢ · businessId?⇢ · userAgent? ·
              firstTouchJson? · lastTouchJson?      ← attribution snapshots
              · startedAt · lastSeenAt · convertedAt? · timestamps
              (first touch IMMUTABLE once set; last touch updates only on
               campaign visits — same mergeAttribution as the client)
product_configurations
              id · sessionId→sessions · productId · version · configJson ·
              priceSnapshotJson? (sell-side ONLY — never costs/margins) ·
              source (configurator|checkout|quote|ai) · timestamps
              UNIQUE(sessionId, productId) — one live row, versioned in place
              S06: THE shared configuration state (UI + AI). version = the
              configuration REVISION: writes go through
              updateConfigurationChecked (SELECT…FOR UPDATE + optional
              expectedRevision compare) so a stale AI patch can never
              overwrite a newer manual change. Live writers: configurator
              sync + tapped suggestions (source configurator), the AI
              updateConfiguration tool (source ai), checkout (source
              checkout). Quotes deliberately do NOT set configurationId to
              this row (it keeps mutating; quotes embed their own payload).
orders        id · sessionId?⇢ · customerId?⇢ · businessId?⇢ ·
              conversationId?⇢ · provider (mock|shopify) · providerOrderId? ·
              providerCheckoutRef? · currency · subtotalCents · totalCents ·
              status (created→paid→artwork_review→in_production→shipped→
              delivered, additive) · aiAssisted · attributionJson? · timestamps
              S07: aiAssisted + conversationId are LIVE at order creation —
              aiAssisted true only under the conservative material-
              assistance check (lib/data/ai-assistance.ts: a sales
              conversation exists AND ≥1 of ai_product_recommended /
              ai_configuration_updated / ai_add_to_cart_requested /
              ai_checkout_requested); conversationId links the latest
              sales conversation whenever one exists. Detail breakdown
              stays derivable from ai_* events (no duplicate columns).
order_lines   id · orderId→orders · productId · quantity · unitPriceCents ·
              totalCents · title · optionSummary? · configJson (IMMUTABLE
              snapshot — reproducible after config-file changes) ·
              artworkJson? · createdAt
quotes        id · sessionId?⇢ · customerId?⇢ · businessId?⇢ ·
              configurationId?⇢ · status (draft|submitted|priced|
              customer_review|accepted|rejected|expired|manual_review) ·
              payloadJson · priceSnapshotJson? · shippingEstimateJson? ·
              expiresAt? · providerDraftOrderId? · createdBy
              (customer|ai|admin) · attributionJson? · timestamps
artworks      id · sessionId?⇢ · customerId?⇢ · orderId?⇢ · quoteId?⇢ ·
              fileName · fileType · sizeBytes · storageUrl? · notes? ·
              status (uploaded|review_required|proof_created|proof_sent|
              approved|revision_requested|production_ready) · timestamps
              (metadata only — binaries remain a launch task)
```

ᵁ = unique. `→` = FK cascade on delete; `⇢` = FK set-null on delete
(behavioral data dies with the session; commerce records survive detached).

**Shopify boundary:** Shopify stays the commerce system of record. Rows
here link via `shopifyCustomerId` / `providerOrderId` /
`providerCheckoutRef` / `providerDraftOrderId` and never mirror Shopify
admin data. There is deliberately **no separate OrderIntelligence table**
— `orders` + its nullable links (session, customer, business,
conversation, attribution, aiAssisted, line snapshots) *is* the
intelligence link; profitability metrics attach later as additive columns.
Mock checkout writes an order row at creation; **Shopify orders arrive
with order webhooks (future session)** — a checkout redirect alone creates
no order row.

## Events (implemented)

```
events        id · sessionId→sessions · customerId?⇢ · name · page? ·
              productId? · configurationId?⇢ · orderId?⇢ · conversationId?⇢ ·
              experimentId?⇢ · propsJson (bounded scalars, no PII by policy) ·
              clientEventIdᵁ (dedup for beacon retries) ·
              occurredAt (client clock) · receivedAt (server clock)
```

Platform taxonomy (validated enum): session_started · page_view ·
product_viewed · configurator_started · configurator_updated ·
quantity_selected · artwork_uploaded · price_viewed ·
shipping_estimate_requested · add_to_cart · checkout_started ·
purchase_completed · quote_started · quote_submitted · ai_chat_started ·
ai_message_sent · ai_product_recommended · ai_configuration_proposed (S06)
· ai_configuration_updated · ai_configuration_rejected (S06) ·
ai_add_to_cart_proposed · ai_add_to_cart_requested ·
ai_checkout_requested (S07) · human_handoff_requested ·
experiment_exposed · reorder_started.

S07 notes: `ai_add_to_cart_requested` carries `{via: conversation|chip,
outcome}` props; completions ride the GENERIC events with AI metadata —
`add_to_cart` may carry `addedVia: "ai_chat"` and `checkout_started` a
`trigger: "ai_chat"` prop. `purchase_completed` now carries an
`aiAssisted` prop mirroring the order row.

Flow: `track()` (GA4-shaped dataLayer, unchanged) **dual-writes** through
the explicit GA4→platform mapping table in `lib/analytics/first-party.ts`
→ beacon-batched POST `/api/events` → validated → stored. Server-emitted
events: `session_started` (session mint) and `purchase_completed` (order
creation — authoritative, ad-blocker-proof; the client `purchase` event is
deliberately dataLayer-only). Attribution reference = `sessionId` (the
session rows carry the touch snapshots; events don't duplicate them).

## Conversations & need profile (implemented; live with the S05 Sales Agent)

Session 05 semantics: one ACTIVE sales conversation per session — status
`active` or `escalated` resumes on the next message; `escalated` does NOT
set `endedAt` (the customer keeps chatting while a human follows up), and
`ended` is terminal. Human handoffs persist as `system` message rows
(`structuredJson.kind = "human_handoff"`), which never reach customer
APIs. `summaryJson` holds the rolling LOW_COST summary
(`{text, coveredMessages, promptVersion, updatedAt}`) — a derived view,
never a substitute for the raw rows.

```
conversations id · sessionId→sessions · customerId?⇢ · agentType (sales) ·
              productId? · configurationId?⇢ · status (active|ended|escalated) ·
              outcome? (abandoned|quote_started|cart_added|checkout_started|
              purchased|escalated) · summaryJson? · startedAt · endedAt? ·
              timestamps
              S06/S07: commerce outcomes stamp WITHOUT ending
              (markConversationOutcomeForSession from the quote/cart/
              checkout routes and the add-to-cart tool). Funnel-ranked:
              purchased > checkout_started > cart_added/quote_started —
              deeper stages never downgrade; escalated outcomes preserved.
              abandoned still unwired.
messages      id · conversationId→conversations · role (user|assistant|tool|
              system — system rows NEVER reach customer-facing APIs) ·
              content (raw transcript, preserved) · structuredJson? ·
              toolName? · toolCallId? · toolResultJson? · model? ·
              configSnapshotJson? (S06: written on assistant rows whose
              turn committed a configuration change) · createdAt

customer_need_profiles
              id · sessionId→sessionsᵁ · customerId?⇢ · businessId?⇢
              · businessName? businessType? industry? location?
              · estimatedDailyOrders? estimatedMonthlyUsage?
              · productInterest? desiredCapacity?
              · desiredWidth? desiredHeight? desiredGusset?   (inches)
              · materialPreference? gsmPreference? colorPreference?
                handlePreference?
              · printingRequirement? printingColors? printingSides?
                logoAvailable?
              · quantity? budgetCents? targetUnitPriceCents?
              · shippingPostalCode? desiredDeliveryDate?
              · priceSensitivity? purchaseIntent?   (low|medium|high)
              · painPointsJson? objectionsJson? questionsAskedJson?
              · conversationSummary?
              · fieldSourcesJson  ← PER-FIELD PROVENANCE
              · timestamps
```

**Provenance rule (enforced + tested):** every written field records
`{ source, confidence?, updatedAt }`. Rank
`USER_STATED(4) > ORDER_DATA(3) > CONFIGURATOR(2) > SYSTEM_DERIVED(1) >
AI_INFERRED(0)`; a write applies only when its source rank ≥ the field's
current rank (equal rank = newer info wins). AI inference can never
displace what the customer said or did; unknown stays unknown (absent
fields are never fabricated — e.g. the quote form's "about 5000" quantity
is NOT parsed into a number). Raw transcript and extracted profile are
separate: extraction never deletes messages.

**Concurrency (Session 05):** `applyNeedProfileUpdate` runs in a
transaction that locks the profile row (`SELECT … FOR UPDATE`) before
merging — concurrent writers serialize per profile, so no update or
provenance decision is ever lost to a read-merge-write race; creation
races resolve via the sessionId unique index + `ON CONFLICT DO NOTHING` +
re-lock (no schema change — tested in
`tests/need-profile-concurrency.test.ts`).

Live writers today: quote form (USER_STATED), mock-order checkout
(ORDER_DATA), and the S05 AI Sales Agent — the `saveCustomerNeed` tool
(always AI_INFERRED) plus the server-side evidence-validated extractor,
the ONLY path that can grant USER_STATED (quoted evidence must occur in
the customer's actual message; see docs/AI_SALES_AGENT.md). Configurator
(CONFIGURATOR) wires in Session 06.

## AI operations (implemented — empty until agents exist)

```
ai_usage      id · sessionId?⇢ · conversationId?⇢ · agentType? · provider ·
              model · requestType · inputTokens? · outputTokens? ·
              estimatedCostMicros? · latencyMs? · success · errorCode? ·
              createdAt          (+ aiUsageTotalsSince() for budget caps —
              totals are overflow-safe (S03.5): sums cast to float8, never
              back into int4, so windows past ~$2,147 of cost micros /
              2.1B tokens aggregate correctly on both drivers)
agent_decisions
              id · agentType · decisionType · observation · reasoningSummary ·
              supportingDataJson? · confidence? · riskLevel (low|medium|high) ·
              proposedActionJson (typed AgentAction — see below) ·
              approvalRequired · approvalStatus (none|pending|approved|
              rejected|modified) · executionStatus (none|scheduled|executed|
              rolled_back|failed) · resultJson? · createdAt · executedAt?
approvals     id · decisionId→agent_decisions · status (pending|approved|
              rejected|modified) · requestedAt · reviewedAt? · reviewedBy? ·
              reviewNotes? · beforeJson? · afterJson? ·
              actionId? (S10 — which proposed-action revision the human
              actually reviewed) · createdAt
agent_configs agentType (pk) · autonomyMode (OBSERVE|RECOMMEND|GUARDED_AUTO|
              AUTONOMOUS) · limitsJson? · updatedAt
              (missing row reads as OBSERVE — fail-safe default; S10 also
              CLAMPS whatever is stored to the per-agent ceiling in
              config/guardrails.ts, so a wrong row grants nothing)
```

**AgentAction is a typed zod structure, not a table** (`agent-service.ts`:
`{ agentType, actionType, params, expectedEffect? }`). It lives inside its
decision record — the AI's own description of what it proposes. Session 10
adds the separate `agent_actions` table below: the STRUCTURED, closed-type
proposal a human reviews. The two are distinct on purpose (spec §13) —
decision = reasoning, action = the proposed business change.
Approval-requiring decisions atomically create their pending approval row.

## Guardrails + AI Action Center (Session 10 — migration 0004)

```
agent_actions id · sourceAgent (CEO_AGENT|PRICING_AGENT|CRO_AGENT|
              GOOGLE_ADS_AGENT|META_ADS_AGENT|HUMAN_ADMIN) ·
              sourceDecisionId?→agent_decisions (set null) ·
              actionType (CLOSED taxonomy — modules/guardrails/actions.ts) ·
              title · payloadJson (validated by the type's STRICT schema;
              a blocked proposal stores a bounded preview of what was
              attempted) · identityKey? (carried from the decision) ·
              revision (1, +1 per human modification) · originActionId? ·
              supersededByActionId? ·
              status (PROPOSED|GUARDRAIL_BLOCKED|PENDING_APPROVAL|APPROVED|
              REJECTED|SUPERSEDED) ·
              executionStatus (NOT_APPLICABLE|NOT_SUPPORTED|READY|EXECUTING|
              EXECUTED|FAILED|ROLLED_BACK — SEPARATE from approval:
              "approved" never implies "happened") ·
              riskLevel (LOW|MEDIUM|HIGH|CRITICAL — POLICY-derived) ·
              modelSuggestedRisk? (metadata only, never applied) ·
              approvalRequired · latestEvaluationId? ·
              reviewedBy? (SERVER-derived admin identity) · reviewedAt? ·
              reviewNotes? · createdBy · stateVersion (optimistic
              concurrency: every transition increments it) · timestamps
              UNIQUE (sourceDecisionId) WHERE originActionId IS NULL
              — one ORIGINAL action per decision (sync idempotency)
guardrail_evaluations
              id · actionId→agent_actions (cascade) · actionRevision ·
              policyVersion · sourceAgent · actionType · autonomyMode
              (as APPLIED, after clamping) · allowed · executionEligible ·
              approvalRequired · riskLevel · violatedRulesJson
              ({id,severity HARD|SOFT,blocks PROPOSAL|EXECUTION,message}) ·
              missingConfigurationJson (config paths, verbatim) · reason ·
              executionSupport · limitsSnapshotJson (the limits as they
              were) · evaluatedAt
              APPEND-ONLY — answers "why was this allowed on that date?"
agent_action_events
              id · actionId→agent_actions (cascade) · type
              (ai_action_proposed|ai_action_guardrail_blocked|
              ai_action_approved|ai_action_rejected|ai_action_modified) ·
              actor (SERVER-derived: "system:ceo_sync" | "admin:<user>") ·
              detailJson? · createdAt
              APPEND-ONLY admin history. Deliberately NOT the `events`
              table: that taxonomy is the customer journey (every row needs
              a session) and feeds third-party analytics copies — business
              action details stay first-party only.
```

Immutability: payloads are never edited in place. A human modification
marks the original SUPERSEDED and inserts `revision + 1` with
`originActionId`, which is then RE-EVALUATED from scratch (no inherited
verdict). All state transitions run under `SELECT … FOR UPDATE` with a
`stateVersion` check, so a double-clicked Approve or a stale second
reviewer gets a conflict instead of rewriting history.

## Intelligence outputs (written by Session 08 — docs/CUSTOMER_INTELLIGENCE.md)

```
customer_insights
              id · insightType (S08 vocabulary: CUSTOMER_QUESTION|
              OBJECTION_PATTERN|DEMAND_PATTERN|PRODUCT_GAP|MOQ_SIGNAL|
              SHIPPING_SIGNAL|PRICING_SIGNAL|SEGMENT_PATTERN|
              CONVERSION_PATTERN) · title · summary? · valueJson?
              (carries identityKey = TYPE:dimension:periodDays — stable
              generation identity, one row per identity ever; plus
              eligiblePopulation/percentage/metric fields) ·
              evidenceCount · sourceRefsJson (≥1 {table,id} refs REQUIRED —
              fabrication is structurally impossible; evidenceCount ≥ refs
              enforced) · confidence? · periodStart? · periodEnd? ·
              status (candidate|validated|archived|dismissed — dismissed
              added S08: suppresses identical regeneration until evidence
              grows) · timestamps
product_opportunities
              id · title · description · opportunityType? (S08: lower_moq|
              unsupported_product) · valueJson? (identityKey + metrics) ·
              evidenceCount · sourceRefsJson? ·
              estimatedDemand? (free text, never a manufactured number) ·
              status (proposed|under_review|validated|rejected|archived —
              generation creates proposed ONLY and never modifies
              validated/rejected rows; feasibility is human-validated) ·
              humanValidationRequired (always true at creation) ·
              periodStart? · periodEnd? · timestamps
```

## Conversation classification (Session 08 — migration 0002)

```
conversation_classifications
              id · conversationIdᵁ→conversations (CASCADE — dies with its
              conversation, and therefore with the session/customer:
              privacy rides the S03.5 cascade) · status (classified|failed
              — failed rows retry next run) · classifierVersion ·
              promptId? · promptVersion? · model? · errorCode? ·
              questionsJson [{theme, messageId}] ·
              objectionsJson [{type, messageId}] ·
              unsupportedRequestsJson [{kind, normalized, messageId,
              support}] (support decided DETERMINISTICALLY against the
              catalog, never by the model) · userMessageCount ·
              sourceUpdatedAt (latest covered customer message —
              reprocess trigger) · processedAt · timestamps
```

One row per conversation (unique index), upserted. Labels are controlled
enums validated by the classifier's zod layer; every messageId is
verified against the transcript actually sent. Counts/percentages are
NEVER stored here — deterministic aggregation over these rows happens at
read time in `modules/customer-intelligence`. All aggregate SQL casts
`::float8` (S03.5 rule).

## CEO business reviews (Session 09 — migration 0003)

```
ceo_reports   id · periodStart · periodEnd · periodDays (admin selects
              latest report by this) · promptId? · promptVersion? ·
              model? · provider? · snapshotJson (the deterministic,
              PII-free BusinessHealthSnapshot the model actually saw) ·
              reviewJson (server-validated CEO structured output —
              metric/evidence refs already filtered) ·
              decisionIdsJson [agent_decisions ids persisted from this
              review's recommendations] · generatedAt · createdAt
```

One row per explicit generation run — append-only history, no update or
delete path. A review is a versioned DOCUMENT; each recommendation inside
it is its own `agent_decisions` row (agentType `ceo`, decisionType
`ceo_recommendation`, approvalRequired true ⇒ pending approval row,
executionStatus stays `none`). Dedup identity lives in
`proposedActionJson.params.identityKey` (category + sorted refs +
periodDays): pending rows update in place on regeneration, human-reviewed
rows are frozen. Reports contain aggregates only (no PII) and are exempt
from the customer-deletion cascade by construction — see
docs/BUSINESS_INTELLIGENCE.md.

## Pricing reviews (Session 12 — migration 0006)

```
pricing_reports  id · periodStart · periodEnd · periodDays (admin selects
                 latest report by this) · promptId? · promptVersion? ·
                 model? · provider? · snapshotJson (the deterministic,
                 PII-free PricingIntelligenceSnapshot the model actually
                 saw) · reviewJson (server-validated Pricing Agent output —
                 metric/evidence/signal refs already filtered, product/tier
                 scope already validated, prerequisites already recomputed)
                 · decisionIdsJson [agent_decisions ids] · generatedAt ·
                 createdAt
                 index (periodDays, generatedAt)
```

Structurally identical to `ceo_reports`, and for the same reason (spec §39):
a review is a versioned DOCUMENT that must survive a provider outage, while
each recommendation inside it is its own `agent_decisions` row (agentType
`pricing`, decisionType `pricing_recommendation`, approvalRequired true ⇒
pending approval row, executionStatus stays `none`). Dedup identity lives in
`proposedActionJson.params.identityKey`
(`PRICING:<type>:<productId|all>:<tier|all>:<sorted refs>:<periodDays>d`):
pending rows update in place on regeneration, human-reviewed rows are frozen.

**No table stores a price.** Session 12 introduces no pricing table, no
price override column and no discount record — `config/products.ts` (via the
catalog provider) remains the only place a sell price is defined, and
`modules/pricing` the only thing that computes one. Reports contain
aggregates only (no PII) and are exempt from the customer-deletion cascade by
construction — see docs/PRICING_INTELLIGENCE.md.

Session 12 reads existing tables only: `events`, `orders`, `order_lines`,
`product_configurations`, `customer_need_profiles`, `conversations`,
`conversation_classifications`, `customer_insights`, `product_opportunities`.
`lib/data/pricing-intelligence-service.ts` adds the four new READ queries
(session/product event facts with first/last timestamps, quantity-bearing
events, priced order lines); everything else reuses the Session 08 bounded
reads in `intelligence-service.ts`.

## Experiments (Session 03 schema · Session 11 runtime — migration 0005)

```
experiments   id · nameᵁ · hypothesis ·
              status (draft|approved|running|stopped|decided|archived) ·
              primaryMetric · secondaryMetricsJson? · guardrailMetricsJson? ·
              controlJson?      ← launch-time CONTROL SNAPSHOT (never rendered)
              variantsJson?     ← { [variantKey]: validated variant config }
              trafficSplitJson? ← { control: 50, variant_b: 50 } WHOLE PERCENTS, total 100
              audience? (label) · audienceJson? (structured rules) ·
              minimumSampleSize? · startAt? · endAt? · resultJson? · winner? ·
              experimentType? · targetKey? · variantKey? · targetVersion? ·
              assignmentSalt? · policyVersion? · policySnapshotJson? ·
              sourceDecisionId?→agent_decisions · sourceActionId?→agent_actions ·
              createdBy? · launchedBy? · launchedAt? · stoppedBy? · stoppedAt? ·
              stopReason? · archivedAt? · stateVersion · timestamps
              INDEX (status, createdAt)
              UNIQUE (targetKey) WHERE status='running'      ← one per target
              UNIQUE (sourceActionId) WHERE not null         ← materialize idempotency

experiment_assignments
              (experimentId→experiments, sessionId→sessions) pk · variant ·
              assignedAt · exposedAt?      INDEX (experimentId, variant)
              — sticky: the first assignment per session wins
              — exposedAt stamped ONCE, the first time the session actually
                rendered the surface (assignment ≠ exposure)

experiment_events   (append-only audit)
              id · experimentId→experiments · type (experiment_created|
              approved|launched|stopped|decided|archived) · actor
              (SERVER-DERIVED "admin:<user>") · detailJson? · createdAt
              INDEX (experimentId, createdAt)

Exposure event = events row (name=experiment_exposed, experimentId link,
                 props {experiment, variant, target}) — one per exposed session
```

Two Session-03 column semantics were PINNED DOWN in Session 11 (the table had
no runtime and therefore no rows, so nothing migrated): `controlJson` is the
launch-time control snapshot rather than page content to render, and
`trafficSplitJson` holds whole percents totalling 100 rather than fractions.

Services: `lib/data/experiment-service.ts` (lifecycle + assignment/exposure,
row-locked `stateVersion` transitions, idempotent launch/stop) and
`lib/data/experiment-metrics-service.ts` (`::float8` aggregates; conversions
counted only at/after a session's exposure, once per session). Deterministic
logic lives in `modules/experiments` (no `db/`, no `lib/ai`) — see
docs/EXPERIMENTATION.md.

## Privacy & deletion (prepared; hardened S03.5 — tests/privacy.test.ts)

Technical deletion/anonymization consistency (not legal policy — the owner
reviews policy before launch):

- `deleteSessionData(sessionId)` — erases ONE browser session's behavioral
  trail: cascades events, conversations+messages (+ S08 conversation
  classifications), need profile, configurations, assignments.
  Orders/quotes/artworks survive with the session link nulled and are NOT
  redacted (they belong to the customer identity, which this operation
  does not touch). S08: customer_insights/product_opportunities rows are
  aggregated business records and survive, but their sourceRefs stop
  resolving — the admin evidence view reports them as "no longer
  available" (tests/customer-intelligence-privacy.test.ts).
- `deleteCustomerData(customerId)` — erases the PERSON, in one
  transaction: (1) deletes their sessions (same cascade as above),
  (2) deletes need profiles and conversations linked by `customerId` from
  other sessions (raw transcripts/profile fields carry the same PII),
  (3) redacts surviving commerce records — quote `payloadJson` PII fields
  (`businessName`, `contactName`, `email`, `phone`, `notes`, and the raw
  `artworkFileName`) → `"[deleted]"`; artwork `fileName` → `"[deleted]"`,
  `storageUrl`/`notes` → null (fileType/sizeBytes/status/links kept),
  (4) deletes the identity row (remaining FKs set-null). Orders survive
  detached as anonymous business records. Business rows are companies,
  not people — never deleted here.
- Event props are bounded scalar maps; PII does not belong in them (policy
  + validation); stray `events.customerId` links null via FK.

## Operations

```
npm run db:generate   # schema → new SQL migration (drizzle-kit)
npm run db:migrate    # apply migrations (DATABASE_URL or embedded dev dir)
npm run db:seed       # DEMO-labeled dev data (refuses DATABASE_URL without --force)
```

- Dev/tests: nothing to run — embedded PGlite self-migrates.
- Production: set `DATABASE_URL`, run `npm run db:migrate` at deploy time
  (the app never runs DDL against external databases at request time).
  Missing `DATABASE_URL` under `NODE_ENV=production` fails loudly at first
  DB use — there is no silent embedded fallback (S03.5). See
  LAUNCH_CHECKLIST "Database (first-party data)".
- Migrations are additive; regenerate (never hand-edit) applied ones.
- Session-02 note preserved: localStorage cart/attribution stay the client
  cache; the server records are authoritative.
- The Session-01 "no speculative empty tables" rule was consciously
  superseded by the Session-03 scope: the AI-ops/insight/experiment tables
  land now, empty, with their validated service interfaces — that
  preparation was this session's purpose.
