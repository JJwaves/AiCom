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
orders        id · sessionId?⇢ · customerId?⇢ · businessId?⇢ ·
              conversationId?⇢ · provider (mock|shopify) · providerOrderId? ·
              providerCheckoutRef? · currency · subtotalCents · totalCents ·
              status (created→paid→artwork_review→in_production→shipped→
              delivered, additive) · aiAssisted · attributionJson? · timestamps
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
ai_message_sent · ai_product_recommended · ai_configuration_updated ·
human_handoff_requested · experiment_exposed · reorder_started.

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
              outcome? (abandoned|quote_started|checkout_started|purchased|
              escalated) · summaryJson? · startedAt · endedAt? · timestamps
messages      id · conversationId→conversations · role (user|assistant|tool|
              system — system rows NEVER reach customer-facing APIs) ·
              content (raw transcript, preserved) · structuredJson? ·
              toolName? · toolCallId? · toolResultJson? · model? ·
              configSnapshotJson? · createdAt

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
              reviewNotes? · beforeJson? · afterJson? · createdAt
agent_configs agentType (pk) · autonomyMode (OBSERVE|RECOMMEND|GUARDED_AUTO|
              AUTONOMOUS) · limitsJson? · updatedAt
              (missing row reads as OBSERVE — fail-safe default)
```

**AgentAction is a typed zod structure, not a table** (`agent-service.ts`:
`{ agentType, actionType, params, expectedEffect? }`). It lives inside its
decision record and, later, inside guardrail verdict logs — one audit
trail, no duplicate concepts. Approval-requiring decisions atomically
create their pending approval row.

## Intelligence outputs (implemented capability — NOTHING writes them yet)

```
customer_insights
              id · insightType · title · summary? · valueJson? ·
              evidenceCount · sourceRefsJson (≥1 {table,id} refs REQUIRED —
              fabrication is structurally impossible) · confidence? ·
              periodStart? · periodEnd? · status (candidate|validated|
              archived) · timestamps
product_opportunities
              id · title · description · evidenceCount · sourceRefsJson? ·
              estimatedDemand? (free text, never a manufactured number) ·
              status (proposed|under_review|validated|rejected|archived) ·
              humanValidationRequired (always true at creation) · timestamps
```

## Experiments (schema only — NO runtime until Stage F)

```
experiments   id · nameᵁ · hypothesis · status (draft|running|stopped|decided)
              · primaryMetric · guardrailMetricsJson? · controlJson? ·
              variantsJson? · trafficSplitJson? · audience? ·
              minimumSampleSize? · startAt? · endAt? · resultJson? · winner? ·
              timestamps
experiment_assignments
              (experimentId→experiments, sessionId→sessions) pk · variant ·
              assignedAt        — sticky: first assignment per session wins
Exposure      = events row (name=experiment_exposed, experimentId link)
```

## Privacy & deletion (prepared; hardened S03.5 — tests/privacy.test.ts)

Technical deletion/anonymization consistency (not legal policy — the owner
reviews policy before launch):

- `deleteSessionData(sessionId)` — erases ONE browser session's behavioral
  trail: cascades events, conversations+messages, need profile,
  configurations, assignments. Orders/quotes/artworks survive with the
  session link nulled and are NOT redacted (they belong to the customer
  identity, which this operation does not touch).
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
