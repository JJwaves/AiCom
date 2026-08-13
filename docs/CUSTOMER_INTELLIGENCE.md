# Customer Intelligence Engine (Session 08) — authoritative

Turns accumulated first-party data — conversations, need profiles,
configurations, quotes, orders, events — into structured, evidence-backed
customer intelligence for `/admin/customer-intelligence`. This layer
OBSERVES → CLASSIFIES → AGGREGATES → REPORTS. It never acts: no pricing,
MOQ, product, ads, landing-page, or storefront mutation of any kind, and
no customer-facing output.

## Core principle

**The database computes the numbers; the model only labels messages.**

```
Real rows (lib/data)
  ↓ LOW_COST classification (controlled enums, per-message evidence,
  ↓ server-validated, persisted once — lib/ai/agents/customer-intelligence)
conversation_classifications
  ↓ deterministic aggregation (modules/customer-intelligence — NO lib/ai import)
counts · denominators · percentages · trends
  ↓ deterministic templates
CustomerInsight · ProductOpportunity (sourceRefs ≥ 1, enforced)
  ↓
/admin/customer-intelligence (+ evidence drill-down)
```

`modules/customer-intelligence` has no `lib/ai` import — the aggregation
layer is structurally incapable of asking a model for a number. The
classifier (`lib/ai/agents/customer-intelligence/`) can only emit values
from closed enums, every label must point at a customer message we
actually sent it (fabricated messageIds are dropped server-side), and
catalog support is decided afterwards by deterministic code.

## Architecture & files

| Piece | Location | Role |
| --- | --- | --- |
| Taxonomies + classifier version | `modules/customer-intelligence/taxonomy.ts` | Closed vocabularies (questions, objections, request kinds, verdicts, insight/opportunity types, outcome groups) |
| Catalog support | `modules/customer-intelligence/catalog-support.ts` | supported / custom_quote_path / unsupported, from the REAL catalog + quote-path rules |
| Qualified rule | `modules/customer-intelligence/qualified.ts` | The deterministic denominator (below) |
| Periods & math | `modules/customer-intelligence/period.ts` | [start, end) windows, safePercentage, safeTrendPct |
| Aggregation | `modules/customer-intelligence/aggregate.ts` | Corpus load, dedup, demand lanes, funnel, segments, associations |
| Insight generation | `modules/customer-intelligence/insights.ts` | Threshold-gated, identity-stable CustomerInsight writer |
| Opportunity generation | `modules/customer-intelligence/opportunities.ts` | lower_moq + unsupported_product, human-gated |
| Report | `modules/customer-intelligence/report.ts` | Everything the admin page renders |
| AI classifier | `lib/ai/agents/customer-intelligence/classifier.ts` | LOW_COST structured labeling (prompt `ai_customer_intelligence_classifier` v1.0.0) |
| Batch processing | `lib/ai/agents/customer-intelligence/process.ts` | Explicit idempotent runs, failure policy |
| Data access | `lib/data/intelligence-service.ts` | ALL db reads/writes for intelligence (house rule: no SQL outside lib/data) |
| Storage | `conversation_classifications` (migration `0002_customer_intelligence.sql`) + S03 `customer_insights` / `product_opportunities` (+4 additive columns) |
| Admin auth | `lib/admin/auth.ts` + `proxy.ts` | HTTP Basic, fail-closed 404 (see ARCHITECTURE decision log) |
| Admin UI | `app/admin/customer-intelligence/` | Report page + evidence drill-downs + status controls |
| Admin API | `app/api/admin/customer-intelligence/` | process + insight/opportunity status routes |
| Policy config | `config/customer-intelligence.ts` | Documented thresholds + volume groups |

Flags: the surface requires `AI_CUSTOMER_INTELLIGENCE_ENABLED`; AI
classification additionally requires `AI_RUNTIME_ENABLED` + a provider
key. With only the first, deterministic metrics still render — with
neither, every admin intelligence path 404s and commerce is untouched.

## Data sources

Conversations + messages (user role only reaches the classifier), the
provenance-labeled CustomerNeedProfile, ProductConfiguration rows,
orders + order-line config snapshots, quotes (ids/status only — payload
PII is never surfaced), first-party events, session attribution
snapshots, and the S07 `orders.aiAssisted` flag. First-party only: no
GA4/Google Ads/Meta APIs anywhere in this layer.

## Question taxonomy (closed)

`SHIPPING` (cost/methods/destinations) · `DELIVERY_TIME` (how long) ·
`MOQ` · `PRICE` · `SIZE` · `CAPACITY` (what fits) · `PRINTING` · `COLOR`
· `MATERIAL` · `ARTWORK` · `CUSTOM_PRODUCT` · `REORDER` ·
`PRODUCT_AVAILABILITY` · `OTHER`

"How long does shipping take?" → `DELIVERY_TIME` (time semantics);
"How much is shipping? / Do you ship to Canada?" → `SHIPPING`.
Unknown themes map to `OTHER` — the model cannot invent categories.

## Objection taxonomy (closed, distinct from questions)

`PRICE_TOO_HIGH` · `MOQ_TOO_HIGH` · `SHIPPING_COST` · `DELIVERY_TOO_LONG`
· `PRODUCT_NOT_AVAILABLE` · `SIZE_NOT_AVAILABLE` · `COLOR_NOT_AVAILABLE`
· `MATERIAL_NOT_AVAILABLE` · `PRINTING_NOT_AVAILABLE` ·
`CUSTOMIZATION_LIMITATION` · `NEEDS_MORE_INFORMATION` · `OTHER`

A question asks for information; an objection says something about the
offer blocks buying. "What is your MOQ?" is ONLY a question; "500 is too
many, I need 200" is an `MOQ_TOO_HIGH` objection. Enforced by prompt AND
tested end-to-end (Restaurant D fixture: MOQ question + purchase, zero
objections).

## Demand signals — three lanes, never merged

- **REQUESTED** — what prospects say they want: need-profile fields with
  `USER_STATED` vs `AI_INFERRED` counted SEPARATELY (§7); plus classified
  requests (product/size/color/material/printing/capacity phrases).
- **CONFIGURED** — what users set up: live `product_configurations` rows.
- **PURCHASED** — what customers buy: immutable order-line snapshots.

20 insulated-bag requests with 0 configured and 0 purchased stays visible
as unmet requested demand. `CONFIGURATOR`/`ORDER_DATA`-provenance profile
values are excluded from the requested lane (they ARE the other lanes).

## Catalog support verdicts (deterministic, §20)

`checkRequestSupport` decides against the real catalog
(`lib/commerce/catalog`): option ids/labels/product terms matched
case-insensitively (single-char size ids match whole words only).
Verdicts: `supported`, `custom_quote_path` (custom color, custom
dimensions/size, capacity needs — existing quote routes, NOT gaps),
`unsupported` (insulated bags, paper material, full-color photo print…)
— only `unsupported` feeds PRODUCT_GAP intelligence and opportunities.
Below-MOQ is computed only from real numbers vs `product.minQuantity`.
The model's opinion about availability never reaches storage.

## Qualified conversation (deterministic denominator, §9)

A sales conversation is QUALIFIED iff at least one of:
(a) outcome ∈ {quote_started, cart_added, checkout_started, purchased}
or the conversation escalated; (b) its session recorded ≥1 of:
price_viewed, add_to_cart, checkout_started, purchase_completed,
quote_started, quote_submitted, ai_product_recommended,
ai_configuration_updated, ai_add_to_cart_requested,
ai_checkout_requested, human_handoff_requested; (c) its need profile has
quantity or productInterest with provenance USER_STATED / CONFIGURATOR /
ORDER_DATA. `AI_INFERRED` alone never qualifies; opening the widget never
qualifies. Defined once in `modules/customer-intelligence/qualified.ts`.

## Aggregation semantics

- **Unit = conversation.** Four shipping questions in one conversation =
  1 conversation with a shipping question; message-level `mentions` are
  tracked separately and never used as the headline (§8).
- **Periods** are explicit half-open windows `[start, end)`; standard 7/30/90
  days + custom `?from/?to`. Every persisted insight stamps
  periodStart/periodEnd. Conversations enter a period by `startedAt`;
  profiles by `updatedAt`; configurations by `updatedAt`; orders by
  `createdAt` (§13).
- **Denominators**: percentages exist only with their denominator and only
  when it ≥ `MIN_DENOMINATOR_FOR_PERCENTAGE` (5). Question/objection
  percentages use qualified∧classified conversations in the period (§14).
- **Trends**: current vs the immediately-preceding equal window; labeled
  only when the previous count ≥ `MIN_TREND_BASE` (5) (§28).
- **Segments/attribution**: ≥ `MIN_SEGMENT_SAMPLE` (5) per cell; business
  type from the need profile only (no sensitive attributes); attribution
  from first-touch utm_source/medium — click ids (gclid/fbclid) are never
  surfaced (§26–§27).
- **Associations**: descriptive purchase-rate comparisons ("observed…"),
  both cells ≥ 5, persisted as CONVERSION_PATTERN only when the gap ≥
  `MIN_ASSOCIATION_DELTA_PP` (10pp). Never causal language (§24).
- **Outcome groups**: purchased > checkout_started > cart_added >
  quote_started (funnel outcomes, never downgraded) · human_handoff
  (escalated keeps its outcome per S05–S07) · product_recommended ·
  engaged_no_purchase · conversation_only. Nothing is labeled "abandoned"
  — no inactivity rule exists yet (§10, deferred).
- All SQL counts cast `::float8` (bigint-safe), matching the S03.5 rule.

## AI classification & processing

`ai_customer_intelligence_classifier` v1.0.0, LOW_COST tier, agentType
`customer_intelligence` (READ-only grant, RECOMMEND-style: it executes
nothing). Structured output is zod-validated (closed enums), then the
server drops any label whose messageId wasn't in the transcript sent
(logged), lowercases request phrases, dedups, computes catalog support,
and persists ONE row per conversation in `conversation_classifications`
with classifierVersion + promptId/promptVersion + model + sourceUpdatedAt.

**Idempotency (§16)**: a conversation is reprocessed only when it was
never classified, the classifier version changed, the last attempt
failed, or new customer messages arrived (`sourceUpdatedAt` < latest user
message). Page loads NEVER classify; only the explicit admin action does
(`POST /api/admin/customer-intelligence/process`, batch-capped at 25).

**Failure policy (§33–§34)**: budget/provider/rate-limit/timeout errors
abort the batch and leave conversations PENDING (a budget stop is not a
classification failure); an invalid response after the bounded retry
marks that one conversation `failed` (errorCode kept, retried next run)
and the batch continues; flags-off/config errors return `unavailable`
touching nothing. Deterministic metrics and previously persisted
classifications always keep working without a provider; every AI call
records AiUsage and passes the S04 budget guard (fail closed).

## Insights & opportunities

Generation is deterministic template-filling over aggregate counts —
insight titles/summaries embed the real numbers and denominators.
Types: CUSTOMER_QUESTION, OBJECTION_PATTERN, DEMAND_PATTERN, PRODUCT_GAP,
MOQ_SIGNAL, SHIPPING_SIGNAL, PRICING_SIGNAL, SEGMENT_PATTERN,
CONVERSION_PATTERN.

- **Thresholds (§15)**: nothing persists below
  `MIN_EVIDENCE_FOR_INSIGHT` (3) distinct evidence records; raw metrics
  still render on the dashboard below it.
- **Identity (§35)**: `valueJson.identityKey` = TYPE:dimension:periodDays.
  One row per identity ever: candidate/validated update in place;
  dismissed/archived regenerate only when evidenceCount GREW (resurrected
  to candidate). Statuses: candidate · validated · archived · dismissed
  (S08 added dismissed).
- **Traceability (§18–§19)**: `createInsight` enforces sourceRefs ≥ 1 and
  evidenceCount ≥ refs. Refs point at conversations/messages/need
  profiles; the drill-down resolves them read-time and reports deleted
  rows as "no longer available" — dangling refs are counted, never
  reconstructed.
- **Opportunities (§21–§22)**: `lower_moq` (stated below-MOQ demand + MOQ
  objections) and `unsupported_product` (per catalog-unsupported
  request). Generation creates `proposed` rows only and refreshes metrics
  on proposed/under_review; validated/rejected/archived rows are frozen —
  **AI can never validate manufacturing feasibility**;
  `humanValidationRequired` is hard-coded true. `estimatedDemand` is a
  sentence built from real counts. Nothing is ever auto-published to the
  storefront.

## Admin surface

`/admin/customer-intelligence` (+ `insights/[id]`, `opportunities/[id]`
evidence pages). Auth: HTTP Basic from `ADMIN_USER`/`ADMIN_PASSWORD`,
challenged in `proxy.ts` (Next 16's middleware) and re-checked inside
every page/route; unset env ⇒ 404 everywhere (fail closed); flag off ⇒
404. `/admin` is robots-disallowed; pages set noindex. The page renders:
overview (qualified conversations, AI-assisted purchases, handoffs,
purchase conversion), AI-assisted funnel (session-distinct event counts;
purchases from the conservative order flag — a loaded widget never counts),
top questions/objections with trends, three-lane demand, product gaps,
conservative lost opportunities, opportunities + insights with status
chips, associations, segments, and honest empty states quoting the real
thresholds. The storefront layout chrome (header/footer) wraps the page;
the AI chat launcher only renders when the separate sales flags are on.

Evidence drill-down shows bounded message excerpts (240 chars), dates,
outcomes, business type, quantities — never prompts, keys, cost/margin
data, or contact PII (quote payloads are shown as id + status only).

## Privacy (§32)

Classification rows cascade with their conversation (session and
customer deletion both reach them through the S03.5 cascade). Insight
and opportunity rows are aggregated business records and survive, but
their refs stop resolving — the UI reports "N references no longer
available (deleted data stays deleted)". Aggregations recompute from
live rows, so deleted conversations disappear from every count. Tested
in tests/customer-intelligence-privacy.test.ts.

## Limitations (known, deliberate)

- Classification coverage is whatever explicit runs have processed —
  the dashboard shows pending/failed counts rather than silently
  classifying on load.
- `product_configurations` are live rows (they mutate); the configured
  lane reflects the latest state within the period, not a history.
- Trend/segment floors mean early low-volume periods show counts without
  percentages/trends — by design, not a bug.
- Insight identity is period-length-scoped (…:30d), so 7/30/90-day runs
  maintain separate rows; listInsights(1000) is the identity scan bound.
- No scheduled/background processing, no "abandoned" outcome sweep, no
  quote-payload mining, and painPoints/objections profile arrays remain
  unwritten (S05 extraction is scalar-only) — future sessions.
