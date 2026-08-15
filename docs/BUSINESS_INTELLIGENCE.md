# Business Intelligence + CEO Recommendation Agent (Session 09)

Authoritative reference for the business-intelligence layer:
`modules/business-intelligence` (deterministic metrics),
`lib/ai/agents/ceo` (recommendation-only interpretation),
`/admin/business-intelligence` (the owner dashboard).

**Core principle:** quantitative business metrics come from deterministic
software; the LLM may interpret them, never produce them. The flow is
MEASURE → SYNTHESIZE → EXPLAIN → RECOMMEND — never RECOMMEND → EXECUTE.

```
Database rows (orders, events, sessions, conversations, ai_usage)
  → lib/data queries (bounded, ::float8 aggregates)
  → modules/business-intelligence (NO lib/ai import — deterministic)
  → BusinessHealthSnapshot (metric availability explicit)
  → CEO agent (REASONING, structured output, NO tools)
  → server-validated recommendations → AgentDecision + ceo_reports rows
  → /admin/business-intelligence (deterministic dashboard + persisted review)
```

## Metric availability model

Every metric is a typed `Metric<T>` (modules/business-intelligence/availability.ts):

| Status | Meaning |
| --- | --- |
| `AVAILABLE` | Fully computed from real data. |
| `PARTIAL` | Computed over part of the data; `reason` + `missingInputs` say what is excluded. |
| `UNAVAILABLE` | Cannot be computed; `reason` (+ `missingInputs`) explain why. **There is no value — null is never rendered or stored as zero.** |

`metricValue()` returns `null` for UNAVAILABLE; consumers must render the
reason, not 0. The CEO agent receives these states verbatim and is
prompt-bound (and reference-validated) against turning UNAVAILABLE into a
confident conclusion.

## Period semantics

Shared with Session 08: half-open windows `[start, end)` from
`modules/customer-intelligence/period.ts` (`periodFromDays`,
`customPeriod`, `previousPeriod`). The admin page offers 1 ("Last 24
hours" — a rolling window, not a calendar day) / 7 / 30 / 90 days plus a
custom `?from/?to` range. One period definition is used across the whole
page/report; "daily review" = the 1-day period, "weekly review" = the
7-day period — same architecture, no scheduling (admin generates
manually).

## Revenue metrics (revenue.ts)

Source of truth: the `orders` table (server-written at order creation;
engine-priced totals the customer confirmed).

- **Counted orders**: every persisted order except terminal
  `cancelled`/`refunded` statuses (none exist yet — mock orders are
  `created`; Shopify webhooks are a later session). Exclusions are
  reported (`excludedOrders`), not hidden.
- **Revenue** = Σ `orders.totalCents`. Line rows contribute units/config
  breakdowns only, so **multi-line orders are never double counted**.
- **AOV** = revenue ÷ orders (unavailable with zero orders — 0/0 is not $0).
- **Currency rule**: per-currency rows are always exact; the headline
  single-number metrics are AVAILABLE only while the period's orders share
  one currency. Multiple currencies ⇒ headline UNAVAILABLE ("no conversion
  model"), never a silent merge. Order counts stay available (currency-free).
- **AI-assisted revenue/orders**: the conservative Session-07 order flag
  (sales conversation + ≥1 material ai_* commerce event). A loaded widget
  never counts.

## Funnel metrics (funnel.ts)

Stage counts are **distinct sessions** per first-party event (raw event
counts alongside): product_viewed, ai_chat_started, configurator_started/
updated, price_viewed, add_to_cart, checkout_started, quote_started,
human_handoff_requested. `Sessions started` comes from the sessions
table; **purchases come from the orders table** (purchase_completed
events mirror order creation; the order row is authoritative).

Conversion rates carry explicit denominator definitions and are
suppressed (`percentage: null`, raw counts still shown) below
`MIN_DENOMINATOR_FOR_PERCENTAGE`:

| Rate | Definition |
| --- | --- |
| Session → purchase | orders ÷ sessions started in period |
| Price view → add to cart | add_to_cart sessions ÷ price_viewed sessions |
| Add to cart → checkout | checkout_started sessions ÷ add_to_cart sessions |
| Checkout → purchase | orders ÷ checkout_started sessions |

## AI sales performance + AI cost (ai-metrics.ts)

Conversations/qualified/purchased come from the S08 corpus (the
deterministic qualified rule); cart/checkout assistance from
ai_add_to_cart_requested / ai_checkout_requested sessions; purchases from
the order flag.

**Cost honesty:** AiUsage rows record `estimatedCostMicros` only when the
model was priced in `config/ai-pricing.ts` at call time. Aggregates count
unpriced calls explicitly:

- all calls priced → spend AVAILABLE;
- some unpriced → PARTIAL (value covers priced calls only, reason names the gap);
- none priced → UNAVAILABLE ("model pricing not configured") — **an
  unpriced call is never $0**;
- zero calls → AVAILABLE 0 (a real zero).

Spend breaks down by provider / model / agentType. Cost-per-conversation
and cost-per-AI-assisted-order divide the sales-agent spend by their
denominators and inherit the spend's availability (zero denominators ⇒
UNAVAILABLE).

## Profitability (profitability.ts)

Reconstructed per order from the SAME cost model as pricing
(`config/costs.ts` → `modules/pricing/cost-model.ts`). Every missing
input makes affected orders un-costable — PARTIAL/UNAVAILABLE with
`missingCostInputs` listed. **Null is never zero; nothing estimates a
cost; production placeholders are all null today, so these metrics render
"Unavailable — configure manufacturing costs."**

Exact formulas (also shipped as `PROFITABILITY_NOTES` on the metric):

- **Gross profit** = revenue − product COGS
  (manufacturing + printing + setup + packaging).
- **Contribution profit BEFORE paid media** = revenue − all variable costs
  (product COGS + shipping + payment fees + other variable). The payment
  fee is computed per ORDER: `round(orderTotal × percentBps/10000) +
  fixedCents` — one fixed fee per transaction, never per line.
- Margins are fractions of the same revenue base (costed orders only when
  PARTIAL).
- **Ad spend is NOT ingested** (Google/Meta are later sessions) — the
  metric name says "before paid media" and is never presented as net
  profit. No CAC, no ROAS anywhere.
- **Discounts are structurally zero**: the deterministic engine is the
  only price authority and no discount mechanism exists.
- Per-product profitability is **GROSS only** (products.ts) —
  allocating the per-order fixed fee across products would be an invented
  split, so contribution stays order-level.
- Mixed currencies in one period ⇒ profitability UNAVAILABLE (same
  no-conversion rule as revenue).

`isCostModelFullyConfigured()` drives the dashboard's
COST_MODEL_UNCONFIGURED data-quality warning even in zero-order periods.

## Trends (trend.ts)

Period-over-period vs `previousPeriod(period)` with explicit states —
no "+∞%" and no noise percentages:

| State | When | changePct |
| --- | --- | --- |
| `TREND` | previous ≥ MIN_TREND_BASE | whole-number % |
| `NEW_ACTIVITY` | previous = 0, current > 0 | null |
| `LOW_BASELINE` | 0 < previous < MIN_TREND_BASE | null |
| `NO_ACTIVITY` | both 0 | null |

Tracked: revenue (only when both periods are single-same-currency),
orders, sessions, qualified conversations, AI-assisted orders,
add-to-cart sessions, checkout sessions.

## Segments (segments.ts)

Descriptive performance by **business type** from need profiles
(restaurant, cafe, bakery, catering, … as actually recorded; unknown
stays "unknown"; never sensitive personal characteristics). Per segment:
qualified conversations, purchased conversations, orders, revenue, AOV,
conversation→purchase ratio. Rows render when they have ≥1 order, reach
MIN_SEGMENT_SAMPLE qualified conversations, or are "unknown".
Question/objection patterns per segment stay on the S08 page.

## Attribution (attribution.ts)

First-party only. Breakdowns by first-touch source/medium, campaign, and
landing page, plus last-touch source/medium — sessions, orders, revenue,
and orders÷sessions conversion per key. Sessions are keyed by their own
touch; orders are keyed by their linked session's touch (sessions may
predate the period; sessionless orders count under "(no session)").
Click ids (gclid & co) are never surfaced. **No ad spend exists, so no
CAC/ROAS — `adSpendIntegrated: false` renders as a standing data-quality
note.**

## BusinessHealthSnapshot (snapshot.ts)

The ONE structure everything consumes: commerce (revenue + funnel), AI
sales, AI cost, customer signals (S08 top questions/objections/gaps +
insight/opportunity summaries), products, segments, attribution,
profitability, trends, and deterministic data-quality warnings
(COST_MODEL_UNCONFIGURED, AI_PRICING_UNCONFIGURED,
CLASSIFICATIONS_PENDING, DEMO_PRICING_ACTIVE, NO_AD_SPEND_DATA,
PROVIDER_WEBHOOKS_INCOMPLETE, LOW_SAMPLE). JSON-serializable — persisted
verbatim with every CEO report.

## CEO Recommendation Agent (lib/ai/agents/ceo)

**RECOMMEND mode, permanently.** Structural boundaries:

- **No tools.** One `generateStructuredObject` call (REASONING workload,
  prompt `ai_ceo_business_review` v1.0.0) over the snapshot context.
  There is no tool registry, no execute path, and no code that can change
  pricing, MOQ, products, ads, pages, budgets, refunds, checkout, or
  orders. Its only writes are audit rows (AgentDecision + ceo_reports).
- **Bounded, PII-free input** (context.ts): a text rendering of the
  snapshot — aggregates only. No customer emails/names/phones/addresses,
  no artwork names, no raw messages, no DB access, no credentials
  (tested).
- **Untrusted output** (schema.ts + agent.ts): zod-validated shape, then
  server-side reference validation — every `supportingMetricRef` must be
  a key the context actually printed, every `evidenceRef` an
  insight/opportunity id it actually offered. Invalid refs are filtered;
  a recommendation with no surviving metric ref is DROPPED (logged).
  The model cannot cite numbers we didn't compute.
- **Controlled vocabularies**: confidence LOW/MEDIUM/HIGH (no fake
  precision — the ordinal 0.25/0.5/0.75 stored on the decision row is a
  coarse sort key; the label in supportingDataJson is authoritative),
  risk LOW/MEDIUM/HIGH, actionCategory ∈ {CUSTOMER_EXPERIENCE, PRODUCT,
  PRICING_REVIEW, MARKETING_REVIEW, SALES, OPERATIONS, AI_COST,
  DATA_QUALITY, CRO_REVIEW}. **A category grants zero execution
  authority.**
- **Language rules** (prompt-enforced, §37): observational only, never
  causal; consider/review/test/investigate; product opportunities are
  framed as "worth reviewing" and always respect
  `humanValidationRequired` — the agent cannot validate manufacturing
  feasibility.

### Persistence & versioning

- Each surviving recommendation ⇒ one `AgentDecision`
  (agentType `ceo`, decisionType `ceo_recommendation`,
  `approvalRequired: true` always ⇒ pending Approval row;
  `executionStatus` stays `none`). `proposedActionJson` is a structured,
  category-scoped proposal (identityKey, metric/evidence refs, period) —
  future-Action-Center compatible but executed by nothing today.
- **Dedup (stable identity)**: identityKey = actionCategory + sorted
  metric/evidence refs + periodDays. Pending decisions with the same
  identity are UPDATED in place (`updateDecisionRecommendation`, which
  refuses non-pending rows); human-reviewed decisions are frozen — a
  regeneration never overwrites an owner's verdict.
- Each generation run ⇒ one `ceo_reports` row: period, promptId+version,
  model, provider, the exact snapshot the model saw, the validated
  review, and the linked decision ids. **Decision (spec §33): a dedicated
  additive table** — a review is a versioned document, while
  AgentDecision stays a per-recommendation audit record; shoehorning the
  document into a decision row would blur both. Reports are append-only
  history; the admin page shows the latest per periodDays.

### Failure modes

- Flags off / no key / config error ⇒ `unavailable` (nothing persisted).
- Budget exceeded / provider down / rate limit / invalid output after
  retry ⇒ `failed` with the AiError code: **no report row, no decisions,
  no fake narrative** — the previously persisted report stays visible and
  the deterministic dashboard is untouched (tested).
- Generation happens ONLY via the explicit admin action
  (`POST /api/admin/business-intelligence/ceo-review`) — never on page
  load, never scheduled.

## Admin surface

`/admin/business-intelligence` + `/api/admin/business-intelligence/*`
reuse the Session 08 auth exactly (HTTP Basic via proxy.ts challenge +
per-route re-check; env unset ⇒ 404 fail-closed) and are additionally
gated by `AI_BUSINESS_INTELLIGENCE_ENABLED` (off ⇒ 404). Deterministic
metrics render with no AI configuration at all; the CEO review section
shows the persisted report (with generatedAt/prompt/model and a staleness
note) or the "Generate your first CEO Review" empty state. Owner-friendly
copy throughout ("12 customers asked about MOQ", "Unavailable — configure
manufacturing costs"), with metric reasons as hints.

## Privacy

Business intelligence is aggregate-only by construction: the snapshot
carries counts, sums, controlled-taxonomy labels, business types, UTM
keys, and template-generated insight/opportunity titles. The CEO context
never includes customer email/phone/names, artwork names, raw addresses,
or raw message content (tested against seeded PII). Deletion semantics
ride S03.5: deleted rows simply stop counting; nothing is reconstructed.

## Configuration

`config/business-intelligence.ts` — policy thresholds
(MIN_DENOMINATOR_FOR_PERCENTAGE 5, MIN_TREND_BASE 5, MIN_SEGMENT_SAMPLE
5, MIN_ATTRIBUTION_SAMPLE 5, MAX_BREAKDOWN_ROWS 10,
MAX_RECOMMENDATIONS_PER_REVIEW 10, CEO_CONTEXT_MAX_CHARS 16000,
MAX_ROWS_PER_QUERY 5000). They gate when the system SPEAKS, not what it
claims. Flag: `AI_BUSINESS_INTELLIGENCE_ENABLED` (default off).

## Session 11 addition — funnel drop-off

`modules/business-intelligence/dropoff.ts` adds the sequential CRO view on
top of the S09 funnel: product views → configurator starts → price views →
cart adds → checkout starts → purchases, each step carrying an EXPLICIT
denominator ("distinct sessions with <event> in period"), the raw counts
alongside the rate, and the same minimum-denominator suppression as every
other percentage. Purchases still come from the orders table, not events.

Ordering is the site's funnel, **not** proof a session passed through the
earlier step — sessions can enter mid-funnel (a direct link to a product
page), which is exactly why raw counts always render next to the rate. It
feeds the CRO agent's context (docs/CRO_AGENT.md); the
`BusinessHealthSnapshot` shape is unchanged.

## Known limitations

- Bounded corpus loads (5,000 rows/period per table) — same S08 posture;
  revisit at real volume.
- Only mock orders persist order rows today (Shopify webhooks are a later
  session) — surfaced as PROVIDER_WEBHOOKS_INCOMPLETE.
- "Today" is a rolling 24h window, not a calendar day.
- The 1-day/7-day reviews are generated manually; scheduled delivery is a
  later session.
- CEO report `snapshotJson` grows with data volume; acceptable for the
  current scale (reports are explicit, not scheduled).
