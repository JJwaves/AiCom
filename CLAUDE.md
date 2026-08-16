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

**Session 13.5 "Business Cost Model + Margin Policy" COMPLETE (2026-08-16) —
the platform now has a complete, deterministic, configurable unit-economics
model, and STILL knows none of the numbers. `modules/pricing` is the one cost
authority (NO `lib/ai` import, NO `db/` import, NO fetch — asserted
structurally), and `config/costs.ts` remains 100% `null` `[TO BE PROVIDED]`:
this session implemented the model, the owner supplies the values, and a
structural test scans the file for any numeric literal so an "industry
average" cannot be slipped in. **THREE COST SCOPES, and order-level costs are
applied EXACTLY ONCE**: per-unit (manufacturing ± size ± material or a
quantity tier, printing ink, packaging, other variable), per-line (printing
setup — one screen per artwork), per-order (order packaging [COGS], fulfilment
handling [selling cost], the processor's FIXED fee, the shipping subsidy). A
`per_order` freight basis is additionally deduplicated PER PRODUCT, because
two lines of the same product are one shipment — a real double-count that the
multi-line tests now pin. **SHIPPING SUBSIDY, NOT SHIPPING COST**: `subsidy =
max(actualFreight − customerShippingCharge, 0)`, never negative — profiting on
shipping is preserved SEPARATELY in `shippingMarginCents` and deliberately NOT
added to contribution, because the charge is not inside recorded order
revenue; `customerCharge: not_collected` is a STRUCTURAL fact (orders have no
shipping column; `totalCents = subtotalCents`), not an assumption. **THE
LADDER IS FOUR NAMED LEVELS**: sell price → −product COGS → GROSS PROFIT →
−variable selling/fulfilment → CONTRIBUTION PROFIT BEFORE PAID MEDIA →
−attributed ad spend → CONTRIBUTION PROFIT AFTER PAID MEDIA; nothing is ever
called "net profit". **AVAILABILITY IS PER LEVEL** — `UnitEconomics` carries
`grossStatus` and `contributionStatus` separately, so a missing payment fee
leaves gross AVAILABLE and contribution UNAVAILABLE rather than hiding both.
Margins are integer bps and are `null` — never NaN, never Infinity, never 0 —
on zero revenue. **MINIMUM ≠ TARGET**: `minimumGrossMarginBps` /
`minimumContributionMarginBps` are hard floors that block a price action;
`targetGrossMarginBps` (new) / `targetContributionMarginBps` are objectives
whose shortfall is a REVIEW signal, and `minimumAllowedPriceCents` consults
floors only. All four ship `null` — this session chose no margin value.
**HISTORICAL PROFIT COMES FROM A SNAPSHOT, NEVER FROM TODAY'S COSTS APPLIED
BACKWARDS**: migration 0008 adds `orders.cost_model_version` +
`orders.cost_snapshot_json` + `order_lines.cost_snapshot_json`, written
FORWARD ONLY and best-effort (capture failure never blocks an order); an order
without one reports `HISTORICAL_COST_UNAVAILABLE`, and a clearly-labelled
`CURRENT_CONFIG_SCENARIO` basis exists but is never the dashboard default.
**POAS IS REAL NOW, AND STILL UNAVAILABLE**: `POAS = contribution profit
before paid media ÷ ad spend` beside `ROAS = revenue ÷ ad spend` — separate
fields, separate formulas, no field named merely `roas` or `poas`; it requires
contribution profit AND real spend AND compatible currency AND adequate
attribution coverage, and any gap yields UNAVAILABLE or PARTIAL rather than an
approximation. `validateCostModel` fails LOUDLY on present-and-wrong values
(negative costs, fractional cents, fee ≥ 100%, margin < 0% or ≥ 100%, target
below its own minimum, unreachable contribution floor, unordered/duplicate
tiers, unknown product, missing size/print option, bad carton size) and never
normalises them; `null` is not an error. A shared READ-ONLY
`CostReadinessPanel` on `/admin/business-intelligence` +
`/admin/pricing-intelligence` shows every input Configured/Missing/Invalid and
what it unlocks — **there is no cost editor; `config/costs.ts` stays the single
authority**. **COST CONFIGURATION NEVER BLOCKS A SALE**: browser-verified a
real checkout completing with every cost null, no commerce file imports cost
readiness, and the checkout route is asserted never to reference the price
floor. NO new agent, NO storefront price change, NO MOQ change, NO discounts,
NO price/ads mutations, NO GUARDED_AUTO, NO executor, NO autonomy change —
`GUARDRAIL_POLICY_VERSION` is unchanged. 1072 tests (966 → 1072: 106 new).
Next milestone: Session 14 "Google Ads Recommendation Agent + Guarded Action
Preparation" (do not start automatically) — or, worth more, the owner filling
`config/costs.ts`.**

**Session 13 "Google Ads Read-Only Intelligence" COMPLETE (2026-08-15) — the
platform can now SEE what advertising costs, without acquiring any power over
it. The read-only invariant is STRUCTURAL, not promised: `lib/google-ads`
has ONE URL builder and it appends the LITERAL `/googleAds:search` (the
method is not a parameter, so no `:mutate` endpoint can be CONSTRUCTED
anywhere in the repo), there is no exported `request(method, path, body)`,
GAQL — the only reachable query language — has no mutation verb, the
transport refuses any query not starting with SELECT, and
`GoogleAdsReportingProvider` exposes exactly three read methods
(`status`/`getAccountInfo`/`getCampaignDailyMetrics`). Adding campaign
mutation requires DELETING A TEST. `modules/google-ads-intelligence` is the
deterministic advertising-analytics authority with NO `lib/ai` import, NO
`lib/google-ads` import and NO `fetch` — it reads PERSISTED daily snapshots,
so a dashboard render is never an API call and an outage cannot change a
number. **Google's numbers and ours are separate TYPES, not separate
labels**: `GoogleNativeTotals` has no `orders`/`revenueCents` field,
`GoogleAdsFunnel` has no `googleConversions`/`googleConversionValueCents`
field, and `AdEfficiency` has no field named merely `cac` or `roas` — so
`googleReportedCostPerConversionCents` can never become
`firstPartyCostPerOrderCents` by a careless destructure, and the two are
displayed side by side with a discrepancy view that reports the gap and its
five standing causes instead of "correcting" either side. Attribution has
THREE honest tiers and no fuzzy one — EXACT (`utm_campaign` = campaign id),
MAPPED (normalized name), UNMATCHED (revenue still counts account-wide,
under no campaign); `gclid` is a BOOLEAN "this was a paid click" and is never
stored, rendered, serialized or sent to a model; two campaigns normalizing to
the same name make BOTH unmatchable rather than a coin flip. Reporting days
stay on the ACCOUNT's calendar (a UTC period maps to the account-days it
OVERLAPS, inclusively, and the page prints the zone and the exact range).
**NOT_CONNECTED / SYNC_FAILED / STALE / PARTIAL are four states and none of
them is zero** — freshness advances only on a COMPLETE sync, a failed sync
leaves prior rows and their timestamp untouched, and credentials removed while
data remains still shows the data, saying it is frozen. Sync is IDEMPOTENT
(`UNIQUE(account, campaign, day)` upsert ⇒ syncing twice cannot double spend;
Google's RESTATEMENT of a recent day UPDATES in place, never appends).
CAC/ROAS carry named denominators (first-party CAC = spend ÷ BagDirect orders
attributed to a Google Ads click, NOT Google conversions); currency mismatch
BLOCKS every cross-lens ratio (no FX model, none invented); **POAS is
UNAVAILABLE** while `config/costs.ts` is null — revenue ROAS is never called
profitability. Migration 0007 adds `ad_accounts` / `ad_campaign_daily_metrics`
/ `google_ads_sync_runs` / `google_ads_reports`; **no table stores a
credential**, and the conversion columns are prefixed `google_` precisely so
they can never read as orders. The Google Ads Agent
(`lib/ai/agents/google-ads`, RECOMMEND) has NO tools, NO Google access at all,
makes ONE REASONING structured call over the PII-free snapshot, and **its
output schema cannot express a mutation** — no `proposedDailyBudgetCents`, no
`budgetChangePct`, no `newStatus`, no `pause`, no `bidCents`, no
`keywordText`, no `adCopy` — so "raise Campaign X to $500/day" is unwritable
rather than filtered; server-side every metric/evidence/signal ref is
validated against exactly what the context printed (none surviving ⇒ dropped)
and `campaignId` against the campaigns the snapshot contained.
`GUARDRAIL_POLICY_VERSION` → `2026-08-15.s13.1`; GOOGLE_ADS_AGENT default
autonomy OBSERVE → RECOMMEND (ceiling unchanged); one permission added
(`DATA_QUALITY_REVIEW`, review-only). **`AD_BUDGET_CHANGE`/`AD_PAUSE`/
`AD_RESUME`/`AD_CREATIVE_TEST` are ABSENT from the mapping table, the executor
registry is still EMPTY, and their limits are still `null` — so even a
HUMAN_ADMIN proposal is execution-ineligible with the missing configuration
named.** Search terms and keywords are deliberately NOT ingested (declared,
not faked). `/admin/google-ads-intelligence` behind the S08 auth + the new
`GOOGLE_ADS_INTELLIGENCE` flag (agent generation additionally behind
`AI_GOOGLE_ADS_AGENT`); three write-guarded routes (test-connection / sync /
ads-review); syncing never spends AI tokens. Session 09's metrics were
EXTENDED, not rewritten — `attribution.adSpendIntegrated` stays `false` and a
separate `adSpend` section carries its own availability. 966 tests (763 → 966: 203 new). Next
milestone: Session 14 "Google Ads Recommendation Agent + Guarded Action
Preparation" (do not start automatically).**

**Session 12 "Pricing Intelligence Agent" COMPLETE (2026-08-15) — the
platform can now UNDERSTAND its own pricing without acquiring any power over
it. `modules/pricing-intelligence` (no `lib/ai` import, no price-mutation
path, asserted structurally) is the deterministic pricing-analytics
authority: a pricing funnel built on CO-OCCURRENCE and REAL EVENT ORDERING
(price→cart counts sessions that did both; "handoff after price" requires the
handoff to actually come after), quantity bands derived from the REAL tier
ladder + MOQ (never invented ranges), the S08 three quantity lanes preserved
and provenance-split (requested [stated vs inferred] / configured /
purchased — "requested 300 · configured 500 · purchased 5,000" is three
findings, not a contradiction), per-tier performance with checkout reported
as UNAVAILABLE rather than 0 (the event carries no product/quantity) and
conversations attributed by configured-or-stated quantity, a price-realization
integrity check (paid snapshot vs today's engine quote ⇒ `catalog_price_changed`,
never "leakage" — there are no discounts), MOQ intelligence kept strictly
SEPARATE from price, and evidence-graded signals. **Price friction requires
someone to have SAID something**: a signal is `isPriceFriction` only with
EXPLICIT evidence (objection / repeated price question / handoff after price /
quote after price); sessions that saw a price and left produce a BEHAVIORAL
signal capped at LOW and flagged `isPriceFriction: false`. Strength is a
documented count-and-diversity rule (HIGH needs ≥10 conversations AND ≥2
evidence types), never a probability. **Elasticity is NOT ESTIMABLE and no
code path produces a coefficient** — `assessElasticity()` returns
`estimable: false` as a literal type, with an owner-language reason and the
exact preconditions. Cost/margin readiness names every unfilled
`config/costs.ts` path; null is never zero, margin is UNAVAILABLE, and
revenue is never used as a proxy for profit. `PricingReadiness`:
PRICING_REVIEW AVAILABLE · SPECIFIC_PRICE_CHANGE BLOCKED · PRICE_EXPERIMENT
BLOCKED · AUTOMATED_PRICE_CHANGE NOT_SUPPORTED. The Pricing Agent
(`lib/ai/agents/pricing`, RECOMMEND) has NO tools, makes ONE REASONING
structured call over the PII-free snapshot, and **its output schema CANNOT
EXPRESS A PRICE** — no `proposedUnitPriceCents`, no discount, no MOQ, no
optimal price — so "lower it to $0.37" is unwritable rather than filtered.
Server-side it validates every metric/evidence/signal ref against exactly
what the context printed (none surviving ⇒ dropped), validates `productId`
against the real catalog and `quantityTier` against that product's real
tiers, and RECOMPUTES `requiresCostConfiguration`/`requiresExperiment`.
Persistence: append-only `pricing_reports` (migration 0006, the exact
snapshot the model saw) + identity-deduped AgentDecisions with human verdicts
frozen → review-only actions (`PRICING_REVIEW`/`MOQ_REVIEW`/
`DATA_QUALITY_REVIEW`) in the Action Center. **`PRICE_CHANGE` and
`PRICE_EXPERIMENT` are absent from the mapping table, the executor registry
is still EMPTY, and the experiment engine still cannot run price variants.**
`GUARDRAIL_POLICY_VERSION` → `2026-08-15.s12.1`; PRICING_AGENT default
autonomy OBSERVE → RECOMMEND (ceiling unchanged); one permission added
(`DATA_QUALITY_REVIEW`, review-only). `/admin/pricing-intelligence` behind
the S08 auth + the new `PRICING_INTELLIGENCE` flag; deterministic analytics
need zero AI configuration. 763 tests. Next milestone: Session 13 "Google Ads
Read-Only Intelligence".**

**Session 11 "Experiment Engine + CRO Agent" COMPLETE (2026-08-12) — a
controlled experimentation system in which the AI proposes and DETERMINISTIC
software decides. `modules/experiments` (no `lib/ai`, no `db/` import) owns
eligibility, allocation, assignment, exposure semantics, metric definitions,
the sample gate and the statistical result: a CLOSED target registry (3
presentation surfaces — product.shipping_message / product.primary_cta /
homepage.hero, each naming its rendering component and its protected
fields), CLOSED typed variant schemas (`safeText` refuses angle brackets,
braces, template interpolation, `javascript:`/`data:` URLs and inline
handlers — no HTML/JS/CSS is storable or renderable anywhere), PURE
FNV-1a assignment (sticky before a row exists; the row is a record, not the
source of truth; per-experiment salt keeps arms independent), fail-closed
eligibility (an unknown device is not a desktop; admin and bot traffic never
enrol), allocations validated to total exactly 100 and capped by
`resolveTrafficCap()` (a null `maximumExperimentTrafficPct` BLOCKS in
production naming the config path, applies a documented 50% ceiling in
non-production, and is NEVER read as 100%), and a two-sided two-proportion
z-test with 7 explicit result states — RUNNING / INSUFFICIENT_DATA /
CONTROL_WIN / VARIANT_WIN / NO_CLEAR_WINNER / STOPPED / INVALID.
**No winner below 1,000 exposed sessions per arm** (a documented development
floor an experiment may raise, never lower). Resolution happens during the
SERVER render (no flicker, no hydration mismatch); ASSIGNMENT ≠ EXPOSURE
(`exposed_at` stamped once ⇒ one `experiment_exposed` event per session, no
write per page view); conversions count only at/after exposure, once per
session. The CRO agent (`lib/ai/agents/cro`, RECOMMEND) has NO tools, one
REASONING structured call, and its output is registry- and
reference-validated (unknown target / mismatched type / markup / fabricated
metric ref ⇒ DROPPED; audience, allocation and sample floor are server-
derived) → AgentDecision → `CRO_EXPERIMENT_PROPOSAL` or `CRO_REVIEW` in the
Action Center. A business/product problem routes to REVIEW, never to a copy
test that hides an objection. **Launch is an EXPLICIT HUMAN admin route, not
an executor — `modules/guardrails/executors.ts` is still EMPTY** — guardrail-
evaluated (verdict + policy version + missing configuration snapshotted onto
the row), traffic-capped, idempotent, `stateVersion`-guarded, one running
experiment per target (DB unique index), audited in `experiment_events`.
Stopping deletes nothing and freezes the readout. A VARIANT_WIN changes no
site content — promotion stays a human source change. Migration 0005;
`/admin/experiments` behind the S08 auth + `EXPERIMENT_ENGINE`. 661 tests.
Next milestone: Session 12 "Pricing Intelligence Agent".**

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

## Current architecture (2026-08-15, post-Session 13)

Working B2B storefront, verified end-to-end (see
docs/CURRENT_SYSTEM_AUDIT.md + its Session-02 resolution note):
- Next.js 16.3 App Router · React 19 · TS · Tailwind v4 · zod · vitest (1072 tests)
  · Drizzle ORM + Postgres (PGlite embedded dev/test, node-postgres prod).
- **Database (Session 03; +1 table S08; +1 S09; +3 S10; +1 S11; +1 S12; +4 S13):**
  `db/schema.ts` (31 tables: sessions, events, customers, businesses,
  orders+lines, quotes, artworks, configurations, conversations+messages,
  conversation_classifications (S08), ceo_reports (S09),
  pricing_reports (S12), need profiles,
  ai_usage, agent_decisions, approvals, agent_configs, agent_actions +
  guardrail_evaluations + agent_action_events (S10), insights,
  opportunities, experiments + experiment_assignments +
  experiment_events (S11), ad_accounts + ad_campaign_daily_metrics +
  google_ads_sync_runs + google_ads_reports (S13)) + additive SQL migrations
  in `db/migrations/` (0000–0008; 0008 adds order/line COST SNAPSHOT columns,
  S13.5).
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
- **Experiment Engine + CRO Agent (Session 11 — docs/EXPERIMENTATION.md +
  docs/CRO_AGENT.md are authoritative):** `modules/experiments` is the
  DETERMINISTIC measurement authority, with NO `lib/ai` and NO `db/` import
  (asserted structurally, like S08/S09/S10). targets.ts = the CLOSED
  registry of experimentable surfaces (product.shipping_message,
  product.primary_cta, homepage.hero — each declares its one experiment
  type, strict variant schema, targetVersion, routes, rendering component,
  protected fields and `describeControl()`); variants.ts = CLOSED typed
  records (HeroCopy/CtaCopy/ShippingMessage) whose `safeText` refuses
  markup, braces, template interpolation, `javascript:`/`data:` URLs, inline
  handlers and control characters — there is no code path anywhere turning
  experiment data into markup; allocation.ts = whole-percent arms totalling
  exactly 100, control required, MVP capped at control + one variant;
  assignment.ts = PURE FNV-1a bucketing (deterministic, sticky before
  persistence, per-experiment salt); eligibility.ts = route/source/campaign/
  device/visitor selectors where AMBIGUITY NEVER ENROLS, plus admin/bot
  exclusion; statistics.ts = two-sided two-proportion z-test (pooled SE,
  α=0.05, A&S 7.1.26 normal CDF, min 5 per cell) with its assumptions and
  limitations documented in code; results.ts = the 7 result states and the
  minimum-sample gate; proposal.ts = THE one experiment-design schema shared
  by the CRO agent, the guardrail payload and draft creation.
  `config/experiments.ts` holds processing policy + `resolveTrafficCap()`
  (owner limit → non-production-only 50% dev ceiling → BLOCKED in
  production; null is never 100%). Runtime: `lib/experiments/server.ts`
  resolves targets during the SERVER render (flag off ⇒ reads nothing and
  pages stay static; flag on ⇒ `/` and `/products/[slug]` become dynamic, so
  toggling needs a redeploy), enrols only sessions that already have a
  first-party `bd_sid` (a brand-new browser's first render sees control —
  costs sample, not validity), records ASSIGNMENT and EXPOSURE separately
  (`experiment_assignments.exposed_at` stamped once ⇒ exactly one
  `experiment_exposed` event per session), and degrades to control on any
  error. `lib/data/experiment-metrics-service.ts` counts distinct exposed
  sessions with the metric event AT OR AFTER exposure (pre-exposure
  conversions are never credited; repeats count once) over closed
  primary/secondary/guardrail metric lists — "checkout error rate", "AI
  failure rate" and contribution profit are deliberately ABSENT because no
  deterministic per-session source exists. `modules/business-intelligence/
  dropoff.ts` adds the sequential drop-off view with explicit denominators.
  CRO agent `lib/ai/agents/cro` (RECOMMEND): NO tools, one REASONING
  `generateStructuredObject` over a PII-free context that prints the
  deterministic numbers AND the closed target list; server validation drops
  proposals with an unknown target, a mismatched type, a variant config that
  fails the target's strict schema, or no surviving metric reference, and
  the SERVER derives audience (from the target's routes), allocation
  (`min(request, cap, 50)`) and the sample floor; identity-stable dedup with
  human verdicts frozen; kind=REVIEW routes business/product problems to
  `CRO_REVIEW` instead of an objection-hiding copy test. Persistence
  (migration 0005): `experiments` EXTENDED additively (S03 columns kept;
  `controlJson` = launch snapshot, `trafficSplitJson` = whole percents),
  `experiment_assignments` + `exposedAt`, new append-only
  `experiment_events`; partial unique indexes give ONE running experiment
  per target and one experiment per approved action. Admin:
  `/admin/experiments` (+ `/[id]`: what is being tested, how many saw it,
  what happened, can we trust it, provenance + timeline) behind the S08
  HTTP Basic + `EXPERIMENT_ENGINE`, fail-closed 404; POST
  `/api/admin/experiments/{create,materialize,cro-review,[id]/launch,
  [id]/stop,[id]/archive}` behind `lib/admin/write-guard.ts`. **Launch is a
  human admin route, NOT an executor** — the guardrail executor registry
  remains EMPTY — and every launch is guardrail-evaluated with its verdict,
  policy version and missing configuration snapshotted onto the row.
- **Pricing Intelligence + Pricing Agent (Session 12 —
  docs/PRICING_INTELLIGENCE.md is authoritative):**
  `modules/pricing-intelligence` is the DETERMINISTIC pricing-analytics
  authority, with NO `lib/ai` import and NO price-mutation path (both asserted
  structurally). tiers.ts derives quantity BANDS from the REAL catalog
  (`[tier.minQty, nextTier.minQty)` + a below-MOQ band from `minQuantity`) and
  catalog-wide buckets from the distinct tier breakpoints — no invented
  ranges; funnel.ts counts CO-OCCURRENCE over documented denominators
  (price→cart = sessions that did BOTH, over sessions that saw a price) and
  enforces real ORDERING for "after price" (per-session min/max
  `occurred_at`), plus the conversation-level PRICE/MOQ counts where a
  QUESTION is never an OBJECTION; demand.ts keeps the S08 three lanes
  separate with the requested lane provenance-split (USER_STATED vs
  AI_INFERRED; CONFIGURATOR/ORDER_DATA excluded so nothing double-counts);
  tier-performance.ts aggregates per band (checkout = `null` "unavailable",
  never 0 — the event carries no product/quantity; conversations attributed by
  configured-then-stated quantity, the rest counted as `unattributed`);
  realization.ts re-quotes stored order configurations against today's engine
  (a difference is `catalog_price_changed`, NEVER leakage — no discount
  mechanism exists) and reports checkout repricing as NOT INSTRUMENTED naming
  the two events that would be needed; moq.ts is its own section because
  wanting 200 bags is a QUANTITY problem, not a price one; signals.ts grades
  evidence — `isPriceFriction` requires EXPLICIT evidence (objection /
  repeated price question / handoff after price / quote after price /
  tier-concentrated objections), a price-view-then-nothing pattern is
  BEHAVIORAL, capped at LOW, and explicitly NOT friction, MOQ friction routes
  to MOQ_REVIEW and a product gap produces no pricing signal at all; strength
  is LOW/MEDIUM/HIGH from counted evidence AND evidence diversity (HIGH needs
  ≥10 conversations and ≥2 types), never a probability; readiness.ts names
  every unfilled `config/costs.ts` / `config/guardrails.ts` path (null is
  never zero and never "no limit"), returns `assessElasticity()` with
  `estimable: false` as a LITERAL type (no code path anywhere produces a
  coefficient) and the four-class `PricingReadiness` (PRICING_REVIEW
  AVAILABLE · SPECIFIC_PRICE_CHANGE BLOCKED · PRICE_EXPERIMENT BLOCKED ·
  AUTOMATED_PRICE_CHANGE NOT_SUPPORTED) → ONE PricingIntelligenceSnapshot
  (JSON-serializable, PII-free). `config/pricing-intelligence.ts` holds the
  documented thresholds + the CLOSED recommendation taxonomy and its
  review-only action mapping. Data access: `lib/data/pricing-intelligence-service.ts`
  (4 new READ queries: session/product event facts with first+last timestamps,
  quantity-bearing events, priced order lines) — everything else reuses the S08
  bounded reads, so there is no second pricing analytics source of truth.
  Pricing Agent `lib/ai/agents/pricing` (RECOMMEND): NO tools, ONE REASONING
  `generateStructuredObject` over a bounded PII-free context that prints the
  ENFORCEMENT RULES FIRST (truncation-safe) then cost truth, elasticity,
  signals and readiness before the long tables; prompt
  `ai_pricing_intelligence_review` v1.0.0. **The output schema cannot express
  a price** — no `proposedUnitPriceCents`, no `discountPct`, no `proposedMoq`,
  no `optimalPrice` — so a specific price change is UNREPRESENTABLE, not
  merely refused. Server-side: metric/evidence/signal refs filtered against
  exactly what the context printed (none surviving ⇒ recommendation DROPPED),
  `productId` validated against the real catalog and `quantityTier` against
  that product's real tiers (else null), and
  `requiresCostConfiguration`/`requiresExperiment` RECOMPUTED (a model
  disagreement is logged, never honoured). Persistence: append-only
  `pricing_reports` (migration 0006 — period, prompt+version, model, provider,
  the exact snapshot, the validated review, decision ids) + identity-deduped
  AgentDecisions (`PRICING:<type>:<product|all>:<tier|all>:<refs>:<days>d`,
  pending rows refresh in place, human verdicts frozen). Guardrails:
  `GUARDRAIL_POLICY_VERSION` → `2026-08-15.s12.1`, `PRICING_AGENT` default
  autonomy OBSERVE → RECOMMEND (ceiling unchanged at RECOMMEND, allow-list
  still empty), ONE permission added (`DATA_QUALITY_REVIEW` — review-only, so
  a "we have no costs" finding routes honestly instead of masquerading as a
  price problem), `mapPricingDecisionToAction` + `syncDecisionsToActions` now
  covering ceo/cro/pricing. **`PRICE_CHANGE` and `PRICE_EXPERIMENT` are absent
  from the mapping table** and remain executor-less; the experiment engine
  still cannot run price variants. Admin: `/admin/pricing-intelligence` +
  POST `/api/admin/pricing-intelligence/pricing-review` behind the S08 auth +
  the new `PRICING_INTELLIGENCE` flag (agent generation additionally behind
  `AI_PRICING_AGENT`), `lib/admin/write-guard.ts` on the mutation route;
  deterministic analytics render with zero AI configuration and a provider
  outage leaves the previous review visible.
- **Google Ads Read-Only Intelligence (Session 13 —
  docs/GOOGLE_ADS_INTELLIGENCE.md is authoritative):** four layers, each
  unable to cross the next. `lib/google-ads` is the ONLY door to Google and
  it opens one way: `client.ts` has a single URL builder appending the
  LITERAL `/googleAds:search` (the method is not a parameter ⇒ no `:mutate`
  URL is constructible anywhere), no exported `request(method, path, body)`,
  a SELECT-only guard, `queries.ts` holding the CLOSED two-query set
  (`customer` identity; `campaign` × `segments.date` with impressions/clicks/
  cost_micros/conversions/conversions_value — no click_view, no audience, no
  per-person field), `auth.ts` (env credentials + OAuth refresh + a
  module-private token cache with no exported reader), `errors.ts` (10
  normalized codes + `redact()` stripping bearer/ya29/1// tokens, secrets and
  developer tokens from anything persisted, logged or displayed) and
  `reporting-provider.ts` (the interface exposes exactly `status` /
  `getAccountInfo` / `getCampaignDailyMetrics`, plus
  `FakeGoogleAdsReportingProvider` with a byte-identical surface). Money
  converts ONCE at the boundary: `cost_micros → round(micros/10_000)` cents
  (rounded, not truncated — sub-cent spend is real), `conversions_value` (a
  DOUBLE in currency units) → `round(v*100)`. `lib/data/google-ads-service.ts`
  owns the three tables with an IDEMPOTENT upsert on
  `(adAccountId, campaignId, date)` — running a sync twice cannot double
  spend, and a Google RESTATEMENT overwrites that day in place rather than
  appending. `lib/google-ads/sync.ts` is the explicit admin operation
  (account identity FIRST so a credential failure costs no reporting quota,
  then the bounded report; SUCCESS / PARTIAL / FAILED, and only SUCCESS
  advances `lastSuccessfulSyncAt`). `modules/google-ads-intelligence` is the
  DETERMINISTIC authority with NO `lib/ai`, NO `lib/google-ads` and NO
  `fetch` (all asserted structurally): dates.ts (account-calendar day math —
  a UTC period maps to the account-days it OVERLAPS; `Intl` does DST),
  connection.ts (CONNECTED / NOT_CONNECTED / CONFIGURATION_INVALID /
  NEVER_SYNCED + FRESH / STALE / PARTIAL / SYNC_FAILED / NOT_CONNECTED, from
  documented thresholds), native.ts (Google's lens; every rate `null` on a
  zero or sub-minimum denominator, never 0 and never Infinity),
  attribution.ts (the paid-traffic test + EXACT/MAPPED/UNMATCHED matching,
  ambiguous names refusing, NO fuzzy tier, NO gclid→campaign resolution),
  firstparty.ts (our lens, reusing the S08/S09 bounded reads — no second
  source of truth), efficiency.ts (four separately-NAMED concepts + the
  currency gate + POAS permanently UNAVAILABLE), discrepancy.ts (both sides
  + five standing causes, never a correction), campaigns.ts (one row, two
  lenses, plus match quality and the click→session/session→conversation/
  conversation→order quality chain), signals.ts (count-based observations,
  each with a limitation, never a root-cause diagnosis), spend.ts (the
  narrow `adSpend` section S09's snapshot and the CEO context consume) →
  ONE GoogleAdsIntelligenceSnapshot (JSON-serializable, PII-free,
  credential-free). `config/google-ads.ts` centralizes the API VERSION
  (`v25`, `SUPPORTED_API_VERSIONS`; an unsupported `GOOGLE_ADS_API_VERSION`
  throws rather than silently falling back), sync/quota bounds (30-day
  default lookback, 180-day max range, 10k rows, 50 pages, 30s timeout),
  freshness thresholds, and the CLOSED 7-type recommendation taxonomy with
  its REVIEW-ONLY action mapping. Google Ads Agent `lib/ai/agents/google-ads`
  (RECOMMEND): NO tools, NO Google access, ONE REASONING
  `generateStructuredObject` over a bounded context that prints the
  ENFORCEMENT RULES and the connection/profit truth FIRST (truncation-safe);
  prompt `ai_google_ads_review` v1.0.0. Persistence: append-only
  `google_ads_reports` + identity-deduped AgentDecisions
  (`GOOGLE_ADS:<type>:<campaign|account>:<refs>:<days>d`, pending rows
  refresh in place, human verdicts frozen) → `MARKETING_REVIEW` /
  `DATA_QUALITY_REVIEW` in the Action Center. Admin:
  `/admin/google-ads-intelligence` + POST
  `/api/admin/google-ads/{test-connection,sync,ads-review}` behind the S08
  auth + the new `GOOGLE_ADS_INTELLIGENCE` flag and
  `lib/admin/write-guard.ts`; the connection test accepts NO parameters, so a
  client cannot ask the platform to probe an arbitrary Google Ads account.
- `lib/commerce` — provider abstraction; `mock` active, `shopify`
  Storefront skeleton env-gated (variant mapping TODO, needs real store).
  **All catalog reads go through `lib/commerce/catalog.ts`** (provider-
  backed; loud mock fallback while the Shopify mapping is incomplete —
  checkout never falls back). Client components receive catalog data as
  props from server components, never by importing `config/products`.
- `modules/pricing` — **the sole pricing AND unit-economics authority**
  (docs/UNIT_ECONOMICS.md is authoritative; no `lib/ai`, no `db/`, no fetch):
  `engine.ts` (tier kernel, unchanged Session-01 math), `cost-model.ts`
  (per-unit/per-line/per-order cost scopes, optional factory quantity tiers,
  `paymentFeeCents` [one fixed fee per TRANSACTION],
  `computeShippingEconomics` [subsidy = max(actual − charged, 0), never
  negative; shipping margin preserved separately],
  `evaluateMarginAgainstPolicy` [BELOW_MINIMUM / BELOW_TARGET /
  AT_OR_ABOVE_TARGET / NO_TARGET / UNAVAILABLE], `minimumAllowedPriceCents`
  [FLOORS only — a target is never a floor], `evaluatePriceFloor` fail-closed
  guardrail), `unit-economics.ts` (the order-level ladder: gross profit →
  contribution before paid media → contribution after paid media + POAS;
  order-level costs applied exactly ONCE; per-level availability; NO per-line
  contribution because no allocation rule exists), `snapshot.ts` (forward-only
  order cost snapshots stamped with `costModelVersion`), `validate.ts` (config
  validation that fails loudly and never normalises), `readiness.ts` (the
  owner-facing Configured/Missing/Invalid view + `isCostModelConfigured`, THE
  one completeness definition), `calculatePrice()` facade. Costs live in
  `config/costs.ts` — **every value is a `null` `[TO BE PROVIDED]`
  placeholder**; margins report "unavailable", price floors fail closed, and
  **missing costs never block a sale**. Cost/margin figures are server-only —
  never sent to the browser, a prompt or an analytics event.
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

## Completed in Session 11 (2026-08-12) — Experiment Engine + CRO Agent

Observation → hypothesis → proposal → guardrail → human approval → explicit
human launch → assignment → deterministic measurement → result. **The AI
proposes and explains; software decides.** Storefront/commerce verified
untouched (every S02–S10 test green; no commerce file modified).

1. **`modules/experiments/`** — the deterministic authority (no `lib/ai`, no
   `db/`): types.ts (8 experiment types + 2 named-as-unsupported deferred
   ones, 7 result states, closed primary/secondary/guardrail metric lists,
   protected surfaces), variants.ts (`safeText` + 3 strict variant schemas),
   targets.ts (the CLOSED 3-target registry), allocation.ts, assignment.ts
   (pure FNV-1a), eligibility.ts (ambiguity never enrols; admin/bot
   excluded), statistics.ts (two-proportion z-test + documented assumptions
   and limitations), results.ts (states + minimum-sample gate),
   proposal.ts (THE shared design schema), lifecycle.ts.
2. **`config/experiments.ts`** — processing policy (minimum sample 1,000/arm
   as a documented DEVELOPMENT default, α=0.05, min 5 per cell, MVP 2 arms)
   + `resolveTrafficCap()`: owner limit → non-production-only 50% ceiling →
   BLOCKED in production naming `config/guardrails.ts →
   GUARDRAIL_LIMITS.maximumExperimentTrafficPct`. Never 100%.
3. **Schema (migration `0005_experiment_engine.sql`, additive)** —
   `experiments` gains experimentType/targetKey/variantKey/targetVersion/
   audienceJson/secondaryMetricsJson/assignmentSalt/policyVersion+snapshot/
   sourceDecisionId+sourceActionId/createdBy/launched*/stopped*/archivedAt/
   stateVersion + `UNIQUE(target_key) WHERE status='running'` and
   `UNIQUE(source_action_id)`; `experiment_assignments` gains `exposed_at`;
   new append-only `experiment_events`. Two S03 semantics pinned down (the
   table had no runtime, so no data migrated): `controlJson` = launch-time
   control SNAPSHOT, `trafficSplitJson` = whole percents totalling 100.
4. **Runtime** — `lib/experiments/server.ts` (server-side resolution +
   sticky assignment + once-per-session exposure + `experiment_exposed`
   event; reads NOTHING while the flag is off; degrades to control on any
   error), `lib/experiments/readout.ts`, `lib/experiments/materialize.ts`
   (approved proposal → DRAFT, re-validated against the CURRENT registry and
   cap, idempotent), `lib/data/experiment-service.ts` (row-locked
   `stateVersion` transitions, idempotent launch/stop, DB-level overlap
   rule), `lib/data/experiment-metrics-service.ts` (post-exposure-only,
   once-per-session conversions), `modules/business-intelligence/dropoff.ts`.
5. **Storefront integration (narrow, 3 targets)** — `ProductConfigurator`
   accepts `experiments` (shipping message + CTA label/helper; defaults null
   ⇒ the pre-S11 UI byte-for-byte), and the homepage hero reads an optional
   headline/sub/CTA override. Nothing about pricing, validation, cart
   payloads or button behaviour is experimentable.
6. **CRO agent** — `lib/ai/agents/cro/{schema,context,agent}.ts` + prompt
   `ai_cro_experiment_review` v1.0.0. RECOMMEND, no tools, one structured
   call; server-side validation drops unknown targets, mismatched types,
   markup/unknown-key variant configs and fabricated references, and derives
   audience/allocation/sample-floor itself. kind=REVIEW keeps business
   problems out of objection-hiding copy tests.
7. **Guardrails/Action Center integration** — `GUARDRAIL_POLICY_VERSION` →
   `2026-08-12.s11.1`; `CRO_EXPERIMENT_PROPOSAL` gained a nullable
   registry-validated `design`; `CRO_EXPERIMENT_LAUNCH` gained a nullable
   `experimentId` (still NOT_IMPLEMENTED); `CRO_AGENT` default autonomy
   OBSERVE → RECOMMEND (ceiling unchanged, allow-list still empty);
   `mapCroDecisionToAction` + `mapAgentDecisionToAction`;
   `syncDecisionsToActions` now covers ceo AND cro decisions.
8. **Admin** — `/admin/experiments` + `/[id]` and POST
   `/api/admin/experiments/{create,materialize,cro-review,[id]/launch,
   [id]/stop,[id]/archive}` behind the S08 auth + `EXPERIMENT_ENGINE` and
   `lib/admin/write-guard.ts`. Actors are server-derived; a client sending a
   status, an actor or a traffic number gets 422.
9. **Tests 521 → 661** (all green; zero credentials/network/AI provider):
   experiments-engine (variant markup rejection, closed registry, allocation
   + cap, assignment determinism/independence/distribution, eligibility
   ambiguity, z-test fixtures incl. 1000/50 vs 1000/80 and 100/5 vs 100/7,
   all 7 result states, zero baseline, design validation, lifecycle),
   experiments-runtime (draft creation, launch idempotency + policy
   snapshot + stale CONFLICT + TARGET_BUSY + parallel targets, stop
   idempotency/preservation/return-to-control, flag-off = no writes, no
   session / bot / admin exclusion, stickiness + single exposure event,
   assignment vs exposure counts, post-exposure-only metrics, deterministic
   readout, INVALID on registry drift), experiments-admin (404/401/flag
   gates, cross-origin 403, no-Origin 403, form-post 415, strict bodies,
   launch/stop through the routes, materialize idempotency + approval gate),
   cro-agent (context whitelists + no PII, structured call with no tools,
   fabricated-ref drop, unknown target drop, markup drop, traffic clamp,
   sample floor, REVIEW routing, price-experiment refusal, dedup + frozen
   verdicts, Action Center mapping, provider/budget/flag failure = nothing
   persisted), experiments-separation (no lib/ai or db in
   modules/experiments, no clock/randomness in assignment or statistics,
   CRO cannot launch/stop/assign/approve, commerce untouched, no
   price/checkout target, executor registry still empty, launchExperiment
   called only from the admin route).
10. **Docs** — new docs/EXPERIMENTATION.md + docs/CRO_AGENT.md; updated
    ARCHITECTURE (module map + 6 decision-log entries), DATABASE_SCHEMA
    (experiments section rewritten + experiment_events), AI_AGENT_ARCHITECTURE
    (CRO agent spec = IMPLEMENTED), GUARDRAILS (S11 additions),
    AI_ACTION_CENTER (CRO decisions), BUSINESS_INTELLIGENCE (drop-off),
    AI_PLATFORM_ROADMAP (Stage F complete), prompts/00-INDEX (11 ✅, 12
    next), LAUNCH_CHECKLIST (+Experiments section), BUSINESS_CONFIG_TODO
    (+Experimentation), .env.example.

## Completed in Session 12 (2026-08-15) — Pricing Intelligence Agent

PRICING DATA → DETERMINISTIC ANALYSIS → SIGNALS → AI INTERPRETATION →
RECOMMENDATION → GUARDRAILS → ACTION CENTER → HUMAN. **The agent explains
pricing; the engine still owns it.** Storefront/commerce verified untouched
(every S02–S11 test green; no commerce, cart, checkout, configuration or
`modules/pricing` file modified; product page prices byte-identical).

1. **`modules/pricing-intelligence/`** — the deterministic authority (no
   `lib/ai`, no price mutation): types.ts (signal kinds, strengths, evidence
   kinds, readiness, the elasticity refusal type), tiers.ts (catalog-derived
   bands + buckets), funnel.ts (co-occurrence + real ordering + PRICE/MOQ
   question-vs-objection counts), demand.ts (three lanes, provenance-split),
   tier-performance.ts (per-band, checkout `null`, conversation attribution),
   realization.ts (engine re-quote + repricing NOT INSTRUMENTED),
   moq.ts, products.ts (margin UNAVAILABLE, revenue ≠ profit), breakdowns.ts
   (segments/attribution/AI-sales — descriptive only), signals.ts (the
   explicit-evidence rule + strength rules), readiness.ts (cost/limit
   readiness, `assessElasticity`, `PricingReadiness`), snapshot.ts, report.ts.
2. **`config/pricing-intelligence.ts`** — documented thresholds (% ≥5
   denominator, signal ≥3 explicit conversations, MEDIUM ≥5, HIGH ≥10 with ≥2
   evidence types, behavioural observation ≥20 price-view sessions) + the
   CLOSED 6-type recommendation taxonomy and its review-only action mapping.
3. **Schema (migration `0006_pricing_intelligence.sql`, additive)** — ONE new
   table `pricing_reports`, mirroring `ceo_reports`. **No table stores a
   price**; every other pricing number is read from existing rows.
4. **Data access** — `lib/data/pricing-intelligence-service.ts` (session and
   product event facts with min/max `occurred_at`, quantity-bearing events,
   priced order lines) + `lib/data/pricing-report-service.ts`. The S08 reads
   are reused, not duplicated.
5. **Pricing Agent** — `lib/ai/agents/pricing/{schema,context,agent}.ts` +
   prompt `ai_pricing_intelligence_review` v1.0.0. No tools, one structured
   call, a schema with no price field, server-validated refs and scope, and
   server-recomputed prerequisites. Provider/budget failure persists NOTHING.
6. **Guardrails / Action Center** — `GUARDRAIL_POLICY_VERSION` →
   `2026-08-15.s12.1`; `PRICING_AGENT` default OBSERVE → RECOMMEND;
   `+DATA_QUALITY_REVIEW` permission (review-only, justified);
   `mapPricingDecisionToAction` + `PRICING_RECOMMENDATION_TO_ACTION_TYPE`;
   `syncDecisionsToActions` covers ceo/cro/pricing.
7. **Admin** — `/admin/pricing-intelligence` (overview, funnel, three lanes,
   tier table, friction, other observations, MOQ, cost/margin readiness,
   readiness classes, price sensitivity, trends, review, data quality) + POST
   `/api/admin/pricing-intelligence/pricing-review` behind the S08 auth, the
   new `PRICING_INTELLIGENCE` flag and `lib/admin/write-guard.ts`.
8. **Tests 661 → 763** (all green; zero credentials/network/real model):
   pricing-intelligence-metrics (41 — catalog-derived bands, funnel
   co-occurrence + ordering + suppression, question≠objection for PRICE and
   MOQ, three-lane separation + provenance exclusion, multi-line orders,
   cancelled exclusion, checkout-unavailable, band attribution, realization +
   repricing, MOQ, the non-purchase-is-not-friction rule, strength grading,
   product-gap routing, null-cost/limit availability, elasticity refusal,
   readiness, snapshot assembly + trend states + PII-freedom, segment gating),
   pricing-agent (22 — context whitelists, one no-tools call, fabricated
   metric/evidence/signal drops, unknown product and tier removal,
   prerequisite override, price-unrepresentable, closed-enum rejection,
   limitation requirement, dedup + frozen verdicts, Action Center mapping,
   provider/flag/budget failure), pricing-intelligence-admin (11 — fail-closed
   auth, both flag gates, cross-origin 403, no-Origin 403, form-post 415,
   strict bodies, deterministic report without AI, honest 503),
   pricing-intelligence-separation (28 — no lib/ai, no mutation, no optimal
   price, no elasticity coefficient, no personalized pricing, no tools,
   schema key set, closed taxonomy, mapping-table agreement, commerce
   untouched, costs and limits still null, empty executor registry,
   HUMAN_ADMIN price change still floor-blocked, no price experiment target,
   ethical-boundary scan).
9. **Docs** — new docs/PRICING_INTELLIGENCE.md (authoritative); updated
   ARCHITECTURE (module row + admin row + 6 decision-log entries),
   DATABASE_SCHEMA (`pricing_reports` + the "no table stores a price" note),
   AI_AGENT_ARCHITECTURE (agent #4 = IMPLEMENTED), AI_RUNTIME (prompt),
   GUARDRAILS (Session 12 additions + autonomy table + flags),
   AI_ACTION_CENTER (pricing decisions), BUSINESS_INTELLIGENCE (sibling
   layer), EXPERIMENTATION (§24 why price experiments are different),
   AI_PLATFORM_ROADMAP (Stage G ✅ with the honest caveats),
   prompts/00-INDEX (12 ✅, 13 next), LAUNCH_CHECKLIST (+pricing section),
   BUSINESS_CONFIG_TODO (three-way cost split + a pricing section),
   .env.example.

## Completed in Session 13 (2026-08-15) — Google Ads Read-Only Intelligence

READ → INGEST → RECONCILE → MEASURE → INTERPRET. Never MUTATE → OPTIMIZE →
EXECUTE. Storefront/commerce verified untouched (every S02–S12 test green;
no commerce, cart, checkout, configuration or `modules/pricing` file
modified; product page prices byte-identical; a test asserts Google Ads code
appears under `/admin` only).

1. **`lib/google-ads/`** — the READ-ONLY adapter: `auth.ts` (5 required env
   vars + optional manager id + optional version pin; OAuth refresh with a
   module-private token cache), `client.ts` (ONE literal `:search` endpoint,
   pagination, 10 normalized error codes, request-id preserved, bodies
   discarded), `queries.ts` (the CLOSED query set + `YYYY-MM-DD` validation
   as the injection guard), `reporting-provider.ts` (three read methods,
   live + fake), `sync.ts` (idempotent explicit sync + connection test),
   `errors.ts` (redaction), `credential-snapshot.ts` (the non-secret bridge
   to the deterministic module).
2. **`modules/google-ads-intelligence/`** — the deterministic authority (no
   `lib/ai`, no `lib/google-ads`, no `fetch`): types, dates, connection,
   native, attribution, firstparty, efficiency, discrepancy, campaigns,
   signals, spend, snapshot, report.
3. **`config/google-ads.ts`** — API version + supported list, sync/quota
   bounds, freshness thresholds, reporting minimums, the CLOSED 7-type
   recommendation taxonomy and its review-only mapping, and the
   `SEARCH_TERMS_INGESTED`/`KEYWORDS_INGESTED` `false` constants that make a
   deferral a declaration rather than an empty table.
4. **Schema (migration `0007_google_ads_intelligence.sql`, additive)** —
   `ad_accounts` (currency + time zone, never assumed),
   `ad_campaign_daily_metrics` (`UNIQUE(account, campaign, date)`),
   `google_ads_sync_runs` (append-only audit, redacted messages),
   `google_ads_reports`. **No table stores a credential.**
5. **Google Ads Agent** — `lib/ai/agents/google-ads/{schema,context,agent}.ts`
   + prompt `ai_google_ads_review` v1.0.0. No tools, no Google access, one
   structured call, a schema with no budget/status/bid/keyword/ad field,
   server-validated refs and campaign scope.
6. **Guardrails / Action Center** — `GUARDRAIL_POLICY_VERSION` →
   `2026-08-15.s13.1`; `GOOGLE_ADS_AGENT` default OBSERVE → RECOMMEND;
   `+DATA_QUALITY_REVIEW` permission; `mapGoogleAdsDecisionToAction` +
   `GOOGLE_ADS_RECOMMENDATION_TO_ACTION_TYPE`; `syncDecisionsToActions`
   covers ceo/cro/pricing/google_ads. The four executable ad types stay
   registered, unmapped, executor-less and limit-blocked.
7. **Business Intelligence** — a SEPARATE `adSpend` section on
   `BusinessHealthSnapshot` + two citable CEO metric refs. S09 semantics
   unchanged; `attribution.adSpendIntegrated` stays `false`.
8. **Admin** — `/admin/google-ads-intelligence` (connection & sync, both
   lenses, funnel, campaigns, coverage, discrepancy, customer signals,
   trends, review, data quality, sync history) + three write-guarded routes.
9. **Tests 763 → 966** (203 new; all green; zero credentials, zero network, zero
   real model): google-ads-adapter (47 — credential status without values,
   API-version refusal + the no-scattered-literal scan, micros rounding,
   response normalization + dropped rows, account-calendar dates and DST,
   the closed query set + injection refusal, the `:search`-only endpoint,
   headers, pagination, all 9 error classes, OAuth-failure redaction),
   google-ads-sync (20 — first sync, idempotency, restatement, per-campaign/
   per-day rows, window filtering, failed-sync isolation, PARTIAL, oversized
   range refused before quota, all five freshness states, connection test),
   google-ads-metrics (49 — native aggregation, null-never-zero rates,
   mixed-currency null, paid-traffic identification, EXACT/MAPPED/no-fuzzy/
   ambiguous matching, first-party counting + cancelled exclusion + unmatched
   revenue, CAC/ROAS with denominators, PARTIAL on low coverage, the currency
   gate, **the six §64 semantic-boundary assertions**, credentials-removed-
   with-data, discrepancy, snapshot PII-freedom, BI ad-spend availability),
   google-ads-readonly (33 — no mutate service, no mutation writer, no
   generic request(), exactly one `:search` endpoint, SELECT-only GAQL, the
   three-method interface, analytics/agent cannot reach the adapter, no
   blended CAC, no profiling, no tools, the schema key set, the closed
   taxonomy, mapping-table agreement, empty executor registry, HUMAN_ADMIN
   budget change still blocked, commerce untouched, admin-only surface, and
   the suite's own offline guarantees), google-ads-agent (22), google-ads-admin
   (32 — fail-closed auth, both flag gates, cross-origin 403, no-Origin 403,
   form-post 415, GET 403, strict bodies, the client cannot name the account,
   honest NOT_CONFIGURED/NOT_CONNECTED, 503 without AI).
10. **Browser-verified** on `next dev` (desktop + 375px mobile): the honest
    NOT_CONNECTED state with every figure absent rather than zero; both
    buttons returning their honest messages; then — with the DEV database
    seeded through the REAL sync path using `FakeGoogleAdsReportingProvider`
    (no credential, no network) — campaign metrics rendering with Google's
    and BagDirect's numbers visibly distinct, match quality per campaign, the
    discrepancy view, coverage, the account-timezone note, and sync history.
    That pass caught a real inconsistency (credentials removed while data
    remains showed "Unavailable" cards above a populated campaign table),
    which was FIXED and locked in with a regression test. Storefront
    unaffected; no console errors; no horizontal overflow; tables scroll
    inside their own containers. Seed data removed afterwards.
11. **Docs** — new docs/GOOGLE_ADS_INTELLIGENCE.md (authoritative); updated
    ARCHITECTURE (module row + 6 decision-log entries), DATABASE_SCHEMA (the
    four tables + the no-credential and no-orders-column notes),
    AI_AGENT_ARCHITECTURE (agent #5 = IMPLEMENTED, read-only), AI_RUNTIME
    (prompt), GUARDRAILS (Session 13 additions), AI_ACTION_CENTER (Google Ads
    decisions), BUSINESS_INTELLIGENCE (the ad-spend section + why S09 did not
    change), AI_PLATFORM_ROADMAP (Stage H1 ✅, H2 next), prompts/00-INDEX
    (13 ✅), LAUNCH_CHECKLIST (+Google Ads section), BUSINESS_CONFIG_TODO
    (connect / useful / still-unavailable split), .env.example.

## Completed in Session 13.5 (2026-08-16) — Business Cost Model + Margin Policy

SELL PRICE → DETERMINISTIC COST MODEL → GROSS PROFIT → VARIABLE SELLING COSTS
→ CONTRIBUTION PROFIT BEFORE PAID MEDIA → ATTRIBUTED AD SPEND → CONTRIBUTION
PROFIT AFTER PAID MEDIA. **The model is complete; the numbers are still the
owner's to supply.** Storefront/commerce verified untouched (every S02–S13
test green; product page prices byte-identical; a real checkout completed in
the browser with every cost `null`).

### Audit verdict on the existing model

- **KEEP** — the S02 cost-model kernel: integer cents + bps, the
  missing-input collector, `productCostCents`, the `minimumAllowedPriceCents`
  derivations, `evaluatePriceFloor`'s fail-closed posture, S09's `Metric<T>`
  availability model, and the guardrail engine already reading
  `config/costs.ts → marginPolicy` rather than duplicating it.
- **EXTEND** — cost scopes (per-unit / per-line / per-order), optional factory
  quantity tiers, order packaging + fulfilment handling, shipping SUBSIDY
  semantics, `targetGrossMarginBps`, a cost-model version stamp.
- **REPLACE** — only the ambiguity: freight was subtracted as a raw cost with
  no notion of what the customer pays, and one status covered both profit
  levels.
- **DEFER** — refunds, discounts (structurally absent), overhead/salaries/
  tax, freight rate shopping, FX, negotiated quote economics, printing SIDES
  (the configurator has no side selector — modelling one would invent a
  manufacturing capability).

1. **`modules/pricing/cost-model.ts` (extended)** — three cost scopes;
   `ManufacturingTier[]` OPTIONAL (key absent ⇒ base applies everywhere; key
   present ⇒ authoritative, and below the first tier is a MISSING input, never
   a silent fallback — and factory breaks are never assumed to match the
   storefront's sell tiers); `OrderCostConfig` (`packagingCentsPerOrder` =
   COGS, `handlingCentsPerOrder` = variable selling cost);
   `CustomerShippingChargeBasis` (`not_collected` / `flat_per_order` /
   `unavailable`); `paymentFeeCents()` (round half-up ONCE per order + ONE
   fixed fee); `computeShippingEconomics()` (subsidy ≥ 0, shipping margin
   preserved separately and never folded into contribution);
   `evaluateMarginAgainstPolicy()` (5 states, minimum ≠ target);
   `computeLineCosts()` carrying `shippingScope` so order assembly can
   deduplicate per-order freight.
2. **`modules/pricing/unit-economics.ts` (new)** — `computeOrderUnitEconomics`
   assembles the ladder for a whole order: order-level costs applied exactly
   once, `per_order` freight deduplicated per product, per-level availability
   (`grossStatus` / `contributionStatus`), integer-bps margins that are `null`
   on zero revenue, per-line GROSS economics and **no per-line contribution
   field at all** (§31 — no allocation rule exists, so none is invented).
   `computePaidMediaEconomics` produces POAS and post-ad contribution.
3. **`modules/pricing/snapshot.ts` (new)** — `captureOrderCostSnapshot` /
   `economicsFromSnapshot` / `HISTORICAL_COST_UNAVAILABLE`. Forward only,
   best-effort, version-stamped.
4. **`modules/pricing/validate.ts` (new)** — `validateCostModel` with ERROR vs
   WARNING. `null` is never an error; a present-and-wrong value always is, and
   is never repaired into something plausible.
5. **`modules/pricing/readiness.ts` (new)** — `assessCostReadiness`
   (16 categories × 4 capabilities) and `isCostModelConfigured`, THE single
   completeness definition that S09's `isCostModelFullyConfigured` and S12's
   `assessCostReadiness` both now delegate to.
6. **`config/costs.ts`** — `COST_MODEL_VERSION`, `orderCosts`,
   `shippingPolicy`, `targetGrossMarginBps`. **Every business value is still
   `null`**, and `tests/unit-economics-separation.test.ts` scans the file for
   any numeric literal so no average can be slipped in.
7. **Schema (migration `0008_order_cost_snapshots.sql`, additive)** —
   `orders.cost_model_version`, `orders.cost_snapshot_json`,
   `order_lines.cost_snapshot_json`. `createOrder` captures best-effort and
   swallows failures; with costs unconfigured it writes nothing and the order
   is unaffected.
8. **Business Intelligence** — `profitability.ts` rebuilt on the unit-economics
   model with `historicalCostBasis` (`SNAPSHOT_ONLY` default /
   `CURRENT_CONFIG_SCENARIO` labelled), separate gross/contribution coverage,
   and `ordersWithoutCostSnapshot` / `ordersWithoutContribution` surfaced.
   `products.ts` costs lines from their own snapshots. S09 availability
   semantics unchanged.
9. **Pricing Intelligence** — readiness extended for the new inputs and the
   completeness verdict delegated; `SPECIFIC_PRICE_CHANGE` still BLOCKED,
   `AUTOMATED_PRICE_CHANGE` still NOT_SUPPORTED, the Pricing Agent's schema
   still cannot express a price.
10. **Google Ads Intelligence** — real POAS: `AdEfficiency` gained
    `contributionBeforePaidMediaCents`, `profitOnAdSpend` and
    `postAdContributionCents`; `GoogleAdsFunnel`/`CampaignFirstParty` gained
    `contributionBeforePaidMediaCents` (null, never 0) and
    `ordersWithContribution`. Four gates (costs · spend · currency · coverage)
    each downgrade to UNAVAILABLE or PARTIAL rather than approximating. ROAS
    and POAS remain separate fields. Read-only boundary untouched.
11. **Admin** — shared read-only `components/admin/cost-readiness.tsx` on
    `/admin/business-intelligence` and `/admin/pricing-intelligence`; a "Did
    the advertising make money?" section on `/admin/google-ads-intelligence`.
    No cost editor anywhere.
12. **Tests 966 → 1072** (106 new; zero credentials/network/AI provider):
    `unit-economics` (58 — the null-config state, the $10,000/$5,700/$4,300
    fixture ladder, payment-fee rounding + one fee per order, all five
    shipping-subsidy cases, per-level availability, multi-line with
    per-product freight dedup, quantity tiers incl. fail-closed below the
    first tier, minimum-vs-target across all five verdicts, zero-revenue
    safety, snapshots + immutability under a later config change, ROAS-vs-POAS
    and the six Google Ads POAS availability cases),
    `cost-config-validation` (27 — 15 invalid-value classes, `null` is not an
    error, the readiness view in both the null and fully-configured states,
    INVALID blocking capabilities), `unit-economics-separation` (21 — no
    lib/ai, no db, no fetch, no estimated-cost field, no numeric literal in
    config/costs.ts, commerce never gates on cost readiness, checkout never
    calls the price floor, storefront tier prices asserted unchanged, no new
    agent/executor/action type, every ceiling still RECOMMEND, every guardrail
    limit still null, no sales tool exposes cost data, contribution never
    unqualified, ROAS/POAS never aliased). Existing S09 profit-math tests now
    run on the labelled scenario basis and gained snapshot-semantics coverage.
13. **Browser-verified** on `next dev` (desktop + 375px mobile): the honest
    all-missing readiness panel with the version stamp on both admin pages;
    POAS/contribution unavailable on the Google Ads page with the 32 blocking
    paths listed; `HISTORICAL_COST_UNAVAILABLE` on every profit card with
    "6 of 6 orders carry no cost snapshot"; **a real checkout completing with
    every cost null** (order MOCK-MSW6LT63); storefront tier prices unchanged
    ($0.62 → $0.33); no console errors; no page-level horizontal overflow
    (wide tables scroll inside their own containers).
14. **Docs** — new `docs/UNIT_ECONOMICS.md` (authoritative, 23 sections);
    updated ARCHITECTURE (module row + decisions 55–61), DATABASE_SCHEMA
    (order cost snapshots), BUSINESS_INTELLIGENCE (profitability rebuilt),
    PRICING_INTELLIGENCE (§24), GOOGLE_ADS_INTELLIGENCE (§22 POAS), GUARDRAILS
    (S13.5 additions — no autonomy change), BUSINESS_CONFIG_TODO (cost-model
    section rewritten with the four-way classification and a fill-in owner
    template), LAUNCH_CHECKLIST (+Unit economics section).

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

38. **(S11) Experiment assignment is a pure hash, and the stored row is a
    RECORD of it** — `assignVariant(experimentId, salt, sessionId,
    allocation)` has no randomness and no I/O, so a session's arm is decided
    before any row exists. Stickiness is structural (not a lucky write), a
    lost write cannot move a customer between arms, and editing an
    allocation mid-flight cannot re-randomise anyone. The per-experiment
    salt keeps arms independent across experiments. Chosen over a random
    draw persisted at first sight.
39. **(S11) Experiments resolve during the SERVER render, and the cost is
    stated rather than hidden** — the HTML the browser receives already
    contains the right arm: no client swap, no flicker, no hydration
    mismatch, no bias in the very metric being measured. The price is that
    reading the session cookie makes the hosting page dynamic, so the engine
    reads NOTHING while the flag is off (pages stay static, exactly as
    before S11) and enabling it requires a redeploy. `cookies()`/`headers()`
    are called before the DB lookup and OUTSIDE the defensive try/catch —
    both were bugs first: querying first short-circuits during the build and
    silently prerenders the page, and catching Next's dynamic-usage signal
    does the same. Enrolment also needs an existing first-party session, so
    a brand-new browser's first render sees control; that costs sample, not
    validity, because non-enrolment happens before an arm is chosen.
40. **(S11) Variants are closed typed records, never content** — a variant
    is a strict schema of presentation VALUES an existing component already
    renders; no code path turns experiment data into markup, and `safeText`
    refuses angle brackets, braces, template interpolation,
    `javascript:`/`data:` URLs and inline handlers on top of React's
    escaping. The CONTROL arm renders the app's own UI with NO override at
    all; `control_json` is a launch-time snapshot kept only so historical
    reports stay interpretable. Chosen over a generic remote-content CMS,
    which is the shape this feature keeps trying to become.
41. **(S11) The engine decides, the model explains** — `modules/experiments`
    imports neither `lib/ai` nor `db/`, so eligibility, assignment,
    exposure, counting, the sample gate and the two-proportion z-test are
    structurally beyond model influence. "Inconclusive" is a first-class
    result, no winner exists below the documented minimum sample, and the
    CRO agent receives result STATES rather than producing them. Chosen over
    letting an LLM read a dashboard and call a winner.
42. **(S11) Launch is a human admin route, NOT the first executor** —
    `CRO_EXPERIMENT_LAUNCH` stays NOT_IMPLEMENTED and
    `modules/guardrails/executors.ts` stays EMPTY, so S10's invariant
    ("approving executes nothing") holds system-wide. Launching is instead
    an explicit human action that is guardrail-EVALUATED (verdict + policy
    version + missing configuration snapshotted onto the row),
    traffic-capped, idempotent, `stateVersion`-guarded, limited to one
    running experiment per target by a DB unique index, and audited in
    `experiment_events`. An executor would have been permanently blocked
    anyway while `maximumExperimentTrafficPct` is unset — a
    registered-but-unusable executor is exactly the fake the doctrine
    forbids.
43. **(S11) A missing traffic limit blocks in production and applies a
    documented development ceiling elsewhere** — `resolveTrafficCap()` uses
    the owner's `maximumExperimentTrafficPct` when set, otherwise a 50%
    ceiling in NON-PRODUCTION ONLY, otherwise it refuses the launch and
    names the exact config path. `null` is never "no limit" and never 100%.
    Same doctrine as the S02 cost model: ship the refusal, not an invented
    number.
44. **(S11) A legitimate objection is never "solved" by hiding it** — the
    CRO agent's `kind` is EXPERIMENT or REVIEW, and evidence pointing at a
    business/product problem (MOQ, real delivery times, a product we do not
    make) maps to `CRO_REVIEW`. A REVIEW carries no design, so it cannot be
    materialized into a running experiment even by relabelling. Dark
    patterns are barred by the prompt AND by variant schemas that cannot
    express a countdown, a scarcity claim, a price or a guarantee.

45. **(S12) A specific price is UNREPRESENTABLE, not merely refused** — the
    Pricing Agent's output schema has no `proposedUnitPriceCents`, no
    `discountPct`, no `proposedMoq` and no `optimalPrice`, and its closed
    recommendation taxonomy maps only to REVIEW-ONLY action types. "Lower it
    to $0.37" is not caught by a filter that could be misconfigured — there
    is nowhere to write it. Chosen over a validated `calculateOptimalPrice()`,
    which would make correctness depend on every downstream layer behaving.
46. **(S12) Elasticity is a refusal with a reason, not an unavailable
    number** — `assessElasticity()` returns a type whose `estimable` field is
    the literal `false`; no code path produces a coefficient, so no model can
    be asked to fill one in. The platform has never shown two prices for the
    same configuration to comparable audiences, so every observed
    price/quantity relationship is confounded. The owner is told why in plain
    language plus exactly what would have to exist first. Chosen over
    reporting an observational correlation as elasticity.
47. **(S12) Price friction requires EXPLICIT evidence; a non-purchase is a
    behavioural observation** — `isPriceFriction` is true only when a customer
    actually said something (objection, repeated price question, handoff after
    price, quote after price). Price-view-then-nothing is BEHAVIORAL, capped
    at LOW, and flagged `isPriceFriction: false` with its own limitations.
    Strength is a documented count-and-diversity rule, never a probability —
    there is no "price sensitivity index" because there is nothing to compute
    one from.
48. **(S12) MOQ friction and product gaps are routed AWAY from pricing** —
    a customer wanting 200 bags has a QUANTITY problem and a customer wanting
    insulated bags has a PRODUCT problem; neither is evidence that the unit
    price is wrong, and lowering it would sell them nothing. MOQ signals carry
    `route: MOQ_REVIEW` + `isPriceFriction: false`; product gaps produce no
    pricing signal at all. Chosen over letting a pricing layer claim every
    unclosed sale.
49. **(S12) Repricing is reported as NOT INSTRUMENTED rather than derived** —
    `/api/checkout` answers 409 REPRICED and the client re-confirms, but no
    first-party event records it, so repricing counts, post-reprice
    confirmations and abandonment are unknown. Session 12 names the two events
    that would need to exist instead of inferring a figure from cart
    abandonment. Same doctrine as the S02 cost model: ship the refusal, not an
    invented number.

50. **(S13) Google Ads mutation is UNCONSTRUCTIBLE, not merely uncalled** —
    `lib/google-ads/client.ts` has one URL builder and it appends the literal
    `/googleAds:search`; the method is not a parameter, there is no exported
    `request(method, path, body)`, GAQL has no mutation verb, the transport
    refuses a non-SELECT query, and the provider interface has three read
    methods. Chosen over adopting a Google Ads client library, whose surface
    would include every mutate service and leave "we simply do not call them"
    as the only guard. A structural test asserts each of these, so adding
    campaign mutation requires deleting a test.
51. **(S13) Google's numbers and ours are separate TYPES** —
    `GoogleNativeTotals` has no `orders`/`revenueCents`, `GoogleAdsFunnel`
    has no `googleConversions`/`googleConversionValueCents`, `AdEfficiency`
    has no field named merely `cac` or `roas`. A Google "conversion" is
    whatever that account's conversion actions count — possibly a form view.
    Where the two disagree, BOTH are shown with the five standing causes;
    nothing merges, averages or corrects either side. Chosen over one blended
    attribution model, which would make a guess look like a measurement.
52. **(S13) Attribution has three honest tiers and no fuzzy one** — EXACT
    (`utm_campaign` = campaign id), MAPPED (normalized name), UNMATCHED
    (revenue counts account-wide, under no campaign). `gclid` is used only as
    a BOOLEAN "this was a paid click" and its value never leaves the matching
    function — resolving it to a campaign needs Google's `click_view`, which
    is deliberately not ingested. Two campaigns normalizing to the same name
    make BOTH unmatchable rather than a coin flip. Coverage is reported with
    an owner-language interpretation, and below 50% first-party CAC/ROAS go
    PARTIAL. Chosen over approximate string matching, which would turn
    revenue attribution into a guess wearing a number.
53. **(S13) Reporting days stay on the ACCOUNT's calendar** — Google reports
    a day in the account's time zone and daily totals cannot be re-cut into
    UTC without hourly data this integration does not fetch, so a UTC period
    maps to the account-days it OVERLAPS, inclusively, and the surface prints
    the zone, the exact range, and the fact that boundary days may include
    hours outside the window. Chosen over silently assuming UTC, which shifts
    spend onto the wrong day at both ends of every window.
54. **(S13) NOT CONNECTED, SYNC FAILED, STALE and PARTIAL are four states,
    and none of them is zero** — freshness advances only on a COMPLETE sync;
    a failed sync leaves prior rows and their timestamp untouched; a
    truncated sync keeps its data without claiming freshness; and credentials
    removed while data remains still SHOWS the data, saying it is real but
    frozen. The idempotent `(account, campaign, day)` upsert means a re-sync
    restates rather than accumulates. Chosen over `?? 0`, which would let a
    missing integration read as free advertising — the exact error this
    session exists to prevent.

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

- (S11) Enabling `EXPERIMENT_ENGINE` changes how `/` and `/products/[slug]`
  render (static → dynamic), so the flag must be set at BUILD time: a build
  made with it off will never enrol anyone even if the flag is on at
  runtime. Documented in .env.example + LAUNCH_CHECKLIST.
- (S11) A brand-new browser's FIRST page render is not enrolled — session
  rows are minted by persisting API routes (`/api/events`) and a Server
  Component cannot set a cookie. Enrolment starts from the next navigation.
  This reduces sample; it cannot bias control vs variant, because
  non-enrolment happens before an arm is chosen.
- (S11) The `visitor` (new vs returning) audience selector exists but never
  enrols, because the signal is not deterministically known yet — ambiguity
  fails closed by design.
- (S11) Interaction between concurrent experiments on DIFFERENT targets is
  not modelled (arms are independent by salt, but a page can host two
  experiments at once). Fine at current volume; revisit with real traffic.
- (S11) No sequential-testing correction: read results at the sample
  threshold, not continuously. The minimum-sample gate is the only defence
  against peeking, and the default (1,000 exposed sessions per arm) is a
  documented development floor, NOT a power calculation.
- (S11) Guardrail metrics are event-based only. "Checkout error rate" and
  "AI failure rate" are deliberately unavailable (no per-session
  deterministic source), and contribution profit stays out while
  `config/costs.ts` is unconfigured — an unavailable metric is never turned
  into an experiment guardrail.
- (S11) The draft-experiment form is a JSON design editor, not a per-field
  builder (same posture as the S10 Modify control): fully validated
  server-side, but it expects an operator comfortable with the payload.
- (S11) `/admin/experiments` inherits the storefront layout chrome and the
  S08–S10 bounded-load posture (500 rows), and computes each experiment's
  readout with per-experiment queries — fine at current volume.
- (S11) Exposure is written during a Server Component render; React's dev
  double-render can call it twice, which the `exposed_at` dedup makes a
  no-op.

- (S12) Pricing question/objection evidence comes from AI sales conversations
  only — customers who never opened the chat are invisible to every
  conversation-level pricing metric. Every affected signal states this as a
  limitation rather than implying full coverage.
- (S12) Checkout is not attributable to a quantity tier (`checkout_started`
  records a cart value, not a product and quantity), so that column renders
  "unavailable", never 0.
- (S12) Checkout repricing (the 409 REPRICED path) is not instrumented — no
  first-party event exists, so repricing counts, confirmations and
  abandonment are genuinely unknown and are not derived from anything else.
- (S12) A conversation only reaches a per-tier rate when its session has a
  configured quantity, or a USER_STATED requested quantity together with a
  `productInterest` matching a catalog product id. The rest are counted as
  `unattributedConversations` and are absent from every per-tier rate (a
  data-quality warning says by how many).
- (S12) The configured demand lane reflects latest-state-in-period, not a
  history (`product_configurations` is a live mutating row — inherited S08
  limitation).
- (S12) The Pricing Agent context is truncated at 16k chars; the enforcement
  rules, cost truth, elasticity refusal, signals and readiness are printed
  FIRST precisely so a busy period cannot cut them, but the long tables and
  the data-quality list can truncate.
- (S12) Pricing analytics share the S08–S11 bounded-load posture (5,000
  rows/query, 20,000 session-event pairs) and `/admin/pricing-intelligence`
  inherits the storefront layout chrome, like every admin page since S08.
- (S12) Demo pricing is still active, so every tier price analysed today is a
  placeholder — a DEMO_PRICING_ACTIVE data-quality warning says so, and every
  pricing conclusion drawn now is a conclusion about the placeholder.

- (S13) Google Ads sync is MANUAL — there is no scheduler, so "weekly
  reporting" means pressing the button weekly. Freshness thresholds
  (26h fresh / 72h stale) describe how recently someone pressed it.
- (S13) Search-term and keyword performance are NOT ingested. Campaign-level
  economics came first, and Google withholds low-volume search terms for
  privacy, so that table would be incomplete by construction. The snapshot
  and the page declare the absence rather than rendering an empty table.
- (S13) Per-campaign first-party revenue depends on tracking templates.
  Without `{campaignid}` (EXACT) or a `utm_campaign` matching the campaign
  name (MAPPED), real visits are UNMATCHED: account-level figures stay
  correct, per-campaign figures are understated, and the coverage section
  says by how much. A `SPEND_WITHOUT_SESSIONS` signal exists precisely so
  "no tracking" is not mistaken for "no traffic" — and it explicitly is NOT
  evidence of click fraud.
- (S13) Google's clicks and our sessions are not expected to match: a
  visitor who leaves before first-party tracking runs is a click with no
  session. The gap is reported and is not lost revenue.
- (S13) Cost per NEW CUSTOMER is not computed — checkout is anonymous, so
  first-time vs repeat is not deterministically known. Only cost per
  attributed ORDER exists, and it is named that way everywhere.
- (S13) Session 13 is single-account by design (no multi-tenant OAuth
  onboarding). More than one `ad_accounts` row would mean the customer id
  changed; the most recently updated wins.
- (S13) Google Ads analytics share the S08–S12 bounded-load posture (5,000
  rows/query) and `/admin/google-ads-intelligence` inherits the storefront
  layout chrome, like every admin page since S08.
- (S13) `config/costs.ts` is still unfilled, so POAS is unavailable: revenue
  ROAS is shown and is explicitly not profitability. A campaign with strong
  revenue ROAS can still lose money on every order.

- (S13.5) **Every value in `config/costs.ts` is still `null`**, so gross
  profit, contribution profit, POAS and the minimum safe price are all
  unavailable. That is the shipped state, not a bug: this session built the
  model and deliberately chose none of the numbers.
- (S13.5) **Orders placed before this session carry no cost snapshot**, so
  their profit reads `HISTORICAL_COST_UNAVAILABLE` permanently. Today's costs
  are never applied backwards. Profit will appear only for orders placed after
  `config/costs.ts` is filled.
- (S13.5) A `flat_per_order` customer shipping charge is supported but makes
  shipping economics PARTIAL, because `orders` records no per-order shipping
  charge. Real shipping charging needs an order-model change alongside the
  config.
- (S13.5) `per_carton` freight rounds per LINE, not per order (separate lines
  are separate artwork and are packed apart). `per_order` freight is
  deduplicated per PRODUCT within an order.
- (S13.5) Per-product profitability is GROSS only. Order-level costs (payment
  fixed fee, order packaging, handling, shipping subsidy) are never allocated
  across products — no deterministic rule exists and none is invented.
- (S13.5) Refunds, discounts, overhead, salaries, rent, tax/duty, freight rate
  shopping, dimensional weight, FX and negotiated quote economics are all
  outside this model. It is contribution accounting, not a P&L.
- (S13.5) The configured-cost browser pass was NOT run: it would have required
  writing invented values into `config/costs.ts`, which this session forbids.
  The configured-state math is covered by 85 unit tests instead.

## Business configuration still needed

See `BUSINESS_CONFIG_TODO.md` — notably: real prices (site shows DEMO
notices until `NEXT_PUBLIC_DEMO_PRICING=false`; until then every S12 pricing
conclusion is about a placeholder price list, and the dashboard says so), **the
entire cost model** (S13.5 completed the MODEL; `config/costs.ts` is still
100% `null` `[TO BE PROVIDED]` — margins, contribution profit, POAS and the
minimum safe price all stay "unavailable", price guardrails fail closed, and
S12's `SPECIFIC_PRICE_CHANGE` readiness stays BLOCKED until filled together
with `maximumPriceDecreasePct` / `maximumPriceIncreasePct`. A fill-in owner
template is in BUSINESS_CONFIG_TODO → "Cost model"; the architecture is
docs/UNIT_ECONOMICS.md. **Missing costs never block a sale** — only profit
analytics and future price actions), factory identity/photos, policies
legal review, Shopify store + variant mapping, production `DATABASE_URL`
(+ `npm run db:migrate` at deploy), consent-policy review for first-party
events, AI provider key + budget caps + **model pricing
(`config/ai-pricing.ts`, null placeholders — budget caps fail closed until
filled)**, **Google Ads read-only credentials (the five `GOOGLE_ADS_*`
server variables — until they exist the dashboard reads NOT_CONNECTED, which
is never interpreted as $0 spend; a PRODUCTION account is additionally needed
for the figures to mean anything, since a Google Ads test account serves no
real ads)**, guardrail thresholds — including
**`maximumExperimentTrafficPct`, which is REQUIRED before running any
experiment in production (the launch route refuses while it is null and
never assumes 100%)** — and escalation destination.

## Deferred work

Explicitly preserved for later sessions: **human escalation delivery**
(owner config), **real action executors** (none exist — the contract in
docs/AI_ACTION_CENTER.md must be satisfied first), **GUARDED_AUTO
promotion** (needs operating history + the guardrail limits in
config/guardrails.ts + an explicit human decision, Stage J), **per-user
admin RBAC** (single Basic credential today),
**real price experiments** (the
experiment engine deliberately cannot run price variants — a price test
changes cart totals, checkout, repricing semantics and what a returning
customer sees, so it needs an authority-aware design; docs/EXPERIMENTATION.md
§24), **a PRICE_CHANGE executor** (none exists; requires the full executor
contract PLUS real costs, a margin policy and price-movement limits),
**guarded-auto pricing** (allow-list empty, ceiling RECOMMEND),
**competitive/market pricing inputs** (no external price data is ingested
anywhere), **repricing instrumentation** (the two events named in
docs/PRICING_INTELLIGENCE.md §8), **winner auto-promotion** (a VARIANT_WIN never changes site
content — promotion is a human source/config change), **GUARDED_AUTO CRO**
and a real `CRO_EXPERIMENT_LAUNCH` executor (need operating history, the
guardrail limits, and the full executor contract), **adaptive traffic /
bandits / RL** (deliberately never at this stage), **multi-arm experiments**
(needs a multiple-comparison correction), **scheduled CRO reviews**, **Google Ads MUTATION of any
kind** (S13 is read-only: budget changes, pause/resume, campaign creation,
keyword management, ad creative and conversion upload all require a SEPARATE
`GoogleAdsMutationProvider` with its own OAuth scope, real ad-spend limits in
`config/guardrails.ts`, and the full executor contract — none exists),
**scheduled Google Ads sync** (manual admin action today), **Google Ads
search-term and keyword ingestion** (declared as not ingested rather than
faked), **Google Ads guarded automation**, **Meta Ads
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
until one exists). **S13.5 additionally defers: the owner's real cost values,
advanced freight modelling (rate shopping, dimensional weight, zone tables),
refund economics (the order model supports no refunds), negotiated quote
economics, per-order customer shipping charges (needs an order-model column),
overhead/salary/tax allocation, per-line contribution allocation (no
deterministic rule exists), and a cost-editing admin panel (`config/costs.ts`
stays the single authority).** Order per `docs/AI_PLATFORM_ROADMAP.md`.

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

**Session 14 — Google Ads Recommendation Agent + Guarded Action Preparation.**
Do not start it automatically.

**Before it, and worth more: fill `config/costs.ts`.** Session 13.5 built the
complete unit-economics model and deliberately supplied none of its numbers.
Filling it unblocks gross profit, contribution profit before paid media, the
minimum safe price and POAS across S09, S12 AND S13 at once — POAS being the
only advertising metric that can tell you whether a campaign makes money. The
fill-in template is in BUSINESS_CONFIG_TODO → "Cost model". That is a
business-input task, not a coding session.

Why this and not something else: Session 13 built the measurement layer and
deliberately stopped at the boundary. The platform can now see what each
campaign costs and what it produced in first-party terms, and it can raise
REVIEWS about that — but every advertising ACTION remains unrepresentable,
unmapped, executor-less and limit-blocked. Session 14 is where the owner
decides whether to cross that line, and under what constraints.

What it would have to establish, in order:

1. **Real ad-spend limits** in `config/guardrails.ts` —
   `maximumDailyAdSpendCents`, `maximumCampaignBudgetChangePct`,
   `maximumNewCampaignTestBudgetCents`. All three are `null` today, and a
   `null` limit BLOCKS; it never means "no limit". These are business
   inputs, not code.
2. **A separate `GoogleAdsMutationProvider`** — its own file, its own OAuth
   scope, its own tests. The reporting provider is never extended, because
   its three-method surface is what makes the read-only guarantee checkable.
3. **The first real executor**, satisfying the contract in
   docs/AI_ACTION_CENTER.md end to end: validated action → fresh evaluation →
   human approval → idempotency key → before/after snapshot → audit →
   rollback. `modules/guardrails/executors.ts` has been empty since S10 on
   purpose; registering the first entry is the single largest authority
   change this platform has made.
4. **Human approval per action**, with GUARDED_AUTO left for Stage J after
   real operating history.

Boundaries that must survive it: the READ path stays structurally read-only
(a mutation provider is added BESIDE it, never merged into it); Google's
conversions never become BagDirect orders; and profit-based decisions stay
unavailable until `config/costs.ts` is filled.

Also available if the owner prefers, and arguably worth more: **filling
`config/costs.ts`**. It unblocks profit intelligence across S09, S12 AND S13
at once — margin, minimum safe price, the first pricing recommendation that
could ever carry a number, and POAS, which is the only advertising metric
that can actually tell you whether a campaign makes money. That is a
business-input task, not a coding session.

Second alternative: **improve Google Ads tracking coverage** before adding
any automation. Adding `{campaignid}` to tracking templates moves attribution
from MAPPED to EXACT and raises match coverage, which is what makes every
per-campaign number on the new dashboard trustworthy. Also a configuration
task, not a coding session.
