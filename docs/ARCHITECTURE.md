# ARCHITECTURE

Living document. Current state first, target state second, migration path
last. See CURRENT_SYSTEM_AUDIT.md for the Session-01 snapshot.

## Core rule

**The LLM provides intelligence. The application provides authority.**

AI may understand, classify, recommend, summarize, analyze, explain,
propose, communicate. Deterministic code controls prices, minimum margins,
payments, product/manufacturing rules, authentication, authorization, ad
spend, refunds, agent autonomy, factory commitments. Business rules are
never enforced only in prompts.

## Current architecture (as built — Session 03)

```
Browser
  ├─ Storefront (Next.js App Router, server components + client islands)
  │    ├─ Landing system (config/landing-pages.ts → organic + /lp/* ad pages)
  │    ├─ ProductConfigurator (client) ── modules/pricing (pure, shared)
  │    ├─ Cart (React context + localStorage; server-loaded catalog props)
  │    └─ AnalyticsProvider (consent → dataLayer → GTM/GA4/Meta)
  ├─ lib/attribution  (first/last touch, localStorage → checkout metadata
  │                    AND server session snapshots via /api/events)
  ├─ lib/analytics    (track() GA4 dataLayer UNCHANGED + first-party.ts
  │                    dual-write: explicit GA4→platform mapping table,
  │                    beacon-batched, never blocks the storefront)
  ├─ lib/commerce     (CommerceProvider interface — mock active, shopify
  │                    env-gated; catalog.ts read facade)
  ├─ modules/pricing  (sole pricing authority — engine + fail-closed cost model)
  ├─ lib/data         (SERVICE BOUNDARY — the only way anything touches the DB;
  │                    zod-validated inputs; AI tools call THESE)
  │    session · events · customer · need-profile (provenance) · configuration
  │    · conversation · order · quote · ai-usage · agent · insight ·
  │    experiment · privacy
  ├─ lib/ai           (S04 — AI RUNTIME, server-only, OFF by default:
  │                    provider abstraction [anthropic implemented], model
  │                    router, versioned prompts, budget guard + AiUsage
  │                    recording, typed permission-scoped tool registry with
  │                    8 sales tools — see AI_RUNTIME.md)
  │    └─ agents/sales (S05 — AI SALES AGENT "AI Packaging Expert":
  │                    conversation orchestration, evidence-validated need
  │                    extraction [USER_STATED requires verified quotes],
  │                    threshold summaries, structured escalation — see
  │                    AI_SALES_AGENT.md; UI = components/ai/* behind
  │                    AI_RUNTIME+AI_SALES flags)
  ├─ /api/ai/chat     (S05 — customer chat endpoint: bd_sid-resolved trust,
  │                    body/message caps, per-session+per-IP token buckets,
  │                    normalized customer-safe errors; GET history returns
  │                    user/assistant rows only)
  ├─ db/              (Drizzle schema + migrations + client)
  │    └─ Postgres: DATABASE_URL (node-postgres, explicit migrations)
  │                 or embedded PGlite dev/test (self-migrating);
  │                 NODE_ENV=production without DATABASE_URL fails loudly
  │                 — no silent embedded fallback in production (S03.5)
  ├─ /api/events      (first-party event intake: session cookie mint bd_sid/
  │                    bd_aid, attribution merge, taxonomy validation, dedup)
  ├─ /api/checkout    (SERVER RE-QUOTE unchanged; mock success now persists
  │                    Order + lines + purchase_completed event + convertedAt
  │                    + checkout configuration + ORDER_DATA need profile —
  │                    all non-fatal: commerce never fails on a DB hiccup)
  └─ /api/quote       (webhook intake unchanged; now persists Quote + Customer
                       + Business + Artwork metadata + USER_STATED profile)
```

Server session identity (`bd_sid`/`bd_aid` httpOnly cookies, rolling 1y)
exists WITHOUT auth — guests work unchanged. Payments stay delegated to
Shopify checkout. Checkout totals are server-computed; the browser's
prices are proposals only. Every AI-ops table
(AiUsage/AgentDecision/Approval/AgentConfig/Insight/Opportunity/Experiment)
is live schema with a validated service interface; Insight/Opportunity
gained their first writer in Session 08 (Customer Intelligence).

The FIRST admin surface exists since Session 08:
`/admin/customer-intelligence` (+ `/api/admin/*`), gated by HTTP Basic
auth (`ADMIN_USER`/`ADMIN_PASSWORD`, fail-closed 404 when unset) in
`proxy.ts` AND re-checked per page/route, plus the
`AI_CUSTOMER_INTELLIGENCE` flag — see docs/CUSTOMER_INTELLIGENCE.md.
Session 09 added `/admin/business-intelligence` under the SAME auth
(no second auth system) plus `AI_BUSINESS_INTELLIGENCE` — see
docs/BUSINESS_INTELLIGENCE.md. Session 10 added `/admin/ai-actions` under
the same auth plus `AI_ACTION_CENTER` — the first admin MUTATION routes,
which additionally require POST + same-origin + JSON content type + a
strict schema, and derive `reviewedBy` server-side — see
docs/AI_ACTION_CENTER.md and docs/GUARDRAILS.md.

## Target architecture (evolved incrementally)

Commerce spine:

```
Storefront
   ↓
Customer Interaction Layer   (pages, configurator, AI chat surface)
   ↓
AI Sales Layer               (AI Packaging Expert, typed tools only)
   ↓
Product Configuration        (ONE shared configuration state — UI & AI)
   ↓
Deterministic Pricing Engine (/modules/pricing — sole pricing authority)
   ↓
Commerce Layer               (lib/commerce — Shopify behind interface)
   ↓
Payment / Checkout           (Shopify secure checkout)
   ↓
Orders                       (persisted, linked to conversation + profile)
   ↓
Factory Workflow             (status pipeline, artwork proofs)
```

Parallel intelligence layer:

```
Events · Chats · Orders · Pricing · Ads · Experiments
   ↓
Data Layer            (DB: sessions, events, conversations, profiles…)
   ↓
AI Agents             (/lib/ai — provider-agnostic, model-routed)
   ↓
Recommendations       (AgentDecision records)
   ↓
Guardrail Engine      (/modules/guardrails — evaluateAgentAction)
   ↓
Human Approval (/admin/ai-actions)  |  Guarded auto-execution (later)
```

## Module map (target)

| Module | Status | Notes |
| --- | --- | --- |
| `lib/commerce` | KEEP | Provider abstraction + `catalog.ts` read facade (Session 02); extend with `getOrder`/order persistence hooks. |
| `modules/pricing` | DONE (Session 02) | Engine math kept as `engine.ts`; cost model + margins + `minimumAllowedPrice` in `cost-model.ts` (config/costs.ts placeholders, fail-closed); server checkout re-quote at `/api/checkout`. |
| `lib/analytics` | DONE (Session 03) | `track()` dual-writes: dataLayer unchanged + `first-party.ts` mapping → `/api/events`. |
| `lib/attribution` | DONE (Session 03) | Same pure merge now also runs server-side; sessions carry immutable first-touch snapshots; orders/quotes carry attribution copies. |
| `db/` + `lib/data/` | DONE (Session 03) | Postgres via Drizzle (PGlite dev/test, node-postgres prod), 20 tables, additive SQL migrations, zod-validated service boundary. See DATABASE_SCHEMA.md. |
| `lib/ai/{providers,router,tools,schemas,prompts,usage}` | DONE (Session 04) | Provider-agnostic runtime: Anthropic adapter (openai/gemini interface-ready), workload router, versioned prompts, budget guard, permission-scoped tool registry (8 sales tools). See AI_RUNTIME.md. |
| `lib/ai/agents/sales` + `/api/ai/chat` + `components/ai` | DONE (Session 05) | AI Packaging Expert: conversation lifecycle, evidence-validated extraction, summarization, escalation, rate-limited chat API, flag-gated chat UI. See AI_SALES_AGENT.md. |
| `lib/configuration` + `/api/configuration` | DONE (Session 06) | THE shared configuration state (invariant 1 realized): pure catalog validation + reducer, React provider with restore/debounced persistence, sync bus, one server application path (row-locked, revision-checked), 3 AI configuration tools. See AI_CONFIGURATOR_INTEGRATION.md. |
| `lib/commerce/cart-line` + `/api/cart/line` + `lib/cart/checkout-client` | DONE (Session 07) | AI-assisted cart/checkout: ONE server validation path from the authoritative configuration to an engine-priced cart line (reprice + stale guards), 4 COMMERCE/READ sales tools (add/suggest/summary/startCheckout), shared client checkout submission, conservative aiAssisted order attribution. See AI_COMMERCE_INTEGRATION.md. |
| `modules/guardrails` + `lib/data/agent-action-service` + `app/admin/ai-actions` | DONE (Session 10) | THE central safety layer: closed proposed-action taxonomy with strict per-type schemas, pure `evaluateAgentAction()` (no lib/ai, no db, no clock), policy-clamped autonomy modes, deterministic risk, hard/soft rules, append-only guardrail evaluations, and the human approve/reject/modify surface. Executor registry is EMPTY — approval records intent, never a mutation. See GUARDRAILS.md + AI_ACTION_CENTER.md. (S04's budget guard covers AI spend only.) |
| `modules/customer-intelligence` + `lib/ai/agents/customer-intelligence` + `lib/data/intelligence-service` | DONE (Session 08) | Deterministic aggregation authority (taxonomies, qualified rule, catalog-support verdicts, insights/opportunities — NO lib/ai import) + LOW_COST message labeling with server-validated evidence + idempotent explicit processing. See CUSTOMER_INTELLIGENCE.md. |
| `modules/business-intelligence` + `lib/ai/agents/ceo` + `lib/data/{business-intelligence,ceo-report}-service` | DONE (Session 09) | Deterministic business-metrics authority (metric availability AVAILABLE/PARTIAL/UNAVAILABLE, revenue/funnel/AI-cost/profitability/segments/attribution/trends, BusinessHealthSnapshot — NO lib/ai import) + recommendation-only CEO agent (REASONING structured output, NO tools, server-validated metric/evidence refs, AgentDecision + ceo_reports persistence). See BUSINESS_INTELLIGENCE.md. |
| `modules/experiments` + `lib/experiments` + `lib/ai/agents/cro` + `app/admin/experiments` | DONE (Session 11) | Deterministic experiment authority (closed target registry, closed typed variant schemas, pure hash assignment, eligibility, allocation caps, two-proportion z-test, result states — NO lib/ai and NO db import) + server-side resolution/exposure + recommendation-only CRO agent (REASONING structured output, NO tools, registry- and reference-validated proposals) + the human launch/stop admin surface. No executor: launching is an explicit human action. See EXPERIMENTATION.md + CRO_AGENT.md. |
| `modules/pricing-intelligence` + `lib/ai/agents/pricing` + `lib/data/{pricing-intelligence,pricing-report}-service` + `app/admin/pricing-intelligence` | DONE (Session 12) | Deterministic pricing-analytics authority (pricing funnel with co-occurrence + real ordering, three quantity lanes, catalog-derived tier bands, MOQ intelligence, price-realization check, evidence-graded signals, cost/margin readiness, PricingReadiness, the elasticity refusal, PricingIntelligenceSnapshot — NO lib/ai import, NO price mutation path) + recommendation-only Pricing Agent (REASONING structured output, NO tools, an output schema with NO price field at all, server-validated refs and product/tier scope, server-recomputed prerequisites) + `pricing_reports` persistence. `modules/pricing` remains the sole pricing authority; no PRICE_CHANGE executor exists. See PRICING_INTELLIGENCE.md. |
| `modules/ads/google`, `modules/ads/meta` | DEFER | Read-only first, much later. |
| `config/flags.ts` | DONE (Session 04) | Feature flags (`AI_RUNTIME`, `AI_SALES`, …); all default OFF, env-enabled (`*_ENABLED=true`). |
| `app/admin/*` | STARTED (Session 08) | `customer-intelligence` (S08), `business-intelligence` (S09), `ai-actions` (S10, the first admin MUTATION routes — POST + same-origin + JSON content type + strict schema), `experiments` (S11) and `pricing-intelligence` (S12) live behind HTTP Basic (`proxy.ts` + per-route checks, fail-closed 404) + their feature flags; ai-usage remains a future session. |

## Invariants (enforced across all future sessions)

1. **One configuration state.** The configurator state is the single source
   of truth; AI tools mutate it through the same validated reducer the UI
   uses. Never two parallel states. *Enforced since Session 06:
   `lib/configuration` (shared validation + reducer + one server
   application path over the S03 `product_configurations` row, version =
   revision); the AI's only channel is
   getCurrentConfiguration/updateConfiguration/suggestConfigurationUpdate
   through that same path — see AI_CONFIGURATOR_INTEGRATION.md.*
2. **Server-priced checkout.** The browser proposes, the server re-quotes
   with the deterministic engine before any order/checkout is created.
   *Enforced since Session 02 (`/api/checkout`): price drift → 409
   REPRICED; invalid/custom-quote configs → 422; cost figures never leave
   the server. Session 07 extends the same semantics to AI-path cart
   additions (`lib/commerce/cart-line.ts`): expected totals are drift
   detection only, and repriced/stale results require fresh customer
   confirmation.*
3. **Typed tools only.** No agent gets DB or HTTP access; every tool
   validates inputs server-side and is permission-scoped per agent.
4. **Feature-flagged AI.** Commerce must work with every AI flag off.
5. **First-party first.** Third-party tags (GA4/Meta) receive copies of
   selected events; the platform's own store is authoritative.
6. **No invented data.** Costs, insights, and metrics render only from real
   configuration or real records; demo data is visibly labeled.
7. **Modular monolith.** No microservices without a demonstrated scaling
   need.

## Decision log

- **2026-08-12 · (S11) Experiment assignment is a pure hash, and the row is
  a record of it.** `assignVariant(experimentId, salt, sessionId,
  allocation)` has no randomness and no I/O, so a session's arm is decided
  before any row exists: stickiness is structural, a lost write cannot move
  a customer between arms, and a mid-flight allocation edit cannot
  re-randomise anyone. The per-experiment salt keeps arms independent across
  experiments. Chosen over a random draw persisted at first sight.
- **2026-08-12 · (S11) Experiments resolve during the SERVER render, and the
  cost is stated rather than hidden.** The HTML the browser receives already
  contains the right arm — no client swap, no flicker, no hydration
  mismatch, no bias in the metric being measured. The price is that reading
  the session cookie makes the hosting page dynamic, so the engine reads
  NOTHING while `EXPERIMENT_ENGINE` is off (pages stay static exactly as
  before) and enabling the flag requires a redeploy. Enrolment also requires
  an existing first-party session, so a brand-new browser's first render
  sees control — that costs sample, not validity, because non-enrolment
  happens before an arm is chosen.
- **2026-08-12 · (S11) Variants are closed typed records, never content.**
  A variant is a strict schema of presentation VALUES an existing component
  already renders; there is no code path turning experiment data into
  markup, and `safeText` refuses angle brackets, braces, template
  interpolation, `javascript:`/`data:` URLs and inline handlers on top of
  React's escaping. The control arm renders the app's own UI with NO
  override; `control_json` is a launch-time snapshot for historical
  reporting only. Chosen over a generic remote-content CMS.
- **2026-08-12 · (S11) The experiment engine decides; the model explains.**
  `modules/experiments` imports neither `lib/ai` nor `db/`, so eligibility,
  assignment, exposure, counting, the sample gate and the two-proportion
  z-test are structurally beyond model influence. "Inconclusive" is a
  first-class result state, and no winner may be declared below the
  documented minimum sample. Chosen over letting an LLM read a dashboard and
  call a winner.
- **2026-08-12 · (S11) Launch is a human admin route, NOT the first
  executor.** `CRO_EXPERIMENT_LAUNCH` stays `NOT_IMPLEMENTED` and the
  guardrail executor registry stays EMPTY, so the Session-10 invariant
  ("approving executes nothing") holds system-wide. A launch is instead an
  explicit human action that is guardrail-EVALUATED (verdict, policy version
  and missing configuration snapshotted onto the row), traffic-capped,
  idempotent, `stateVersion`-guarded and audited in `experiment_events`. An
  executor would have been permanently blocked anyway while
  `maximumExperimentTrafficPct` is unset — a registered-but-unusable
  executor is exactly the fake this doctrine forbids.
- **2026-08-12 · (S11) A missing traffic limit blocks in production and
  applies a documented development ceiling elsewhere.** `null` is never read
  as "no limit" and never as 100%: `resolveTrafficCap()` uses the owner's
  `maximumExperimentTrafficPct` when set, otherwise a 50% ceiling in
  NON-PRODUCTION ONLY, otherwise it refuses the launch and names the exact
  config path. Chosen over shipping an invented production number.

- **2026-08-15 · (S12) A specific price is UNREPRESENTABLE, not merely
  refused.** The Pricing Agent's output schema has no
  `proposedUnitPriceCents`, no `discountPct`, no `proposedMoq` and no
  `optimalPrice` field, and its closed recommendation taxonomy maps only to
  REVIEW-ONLY action types. So "lower the price to $0.37" is not caught by a
  filter that could be misconfigured — there is nowhere to write it. Chosen
  over a `calculateOptimalPrice()` guarded by validation, which would make
  correctness depend on every downstream layer behaving.
- **2026-08-15 · (S12) Elasticity is a refusal with a reason, not an
  unavailable number.** `assessElasticity()` returns a type whose `estimable`
  field is the literal `false`; no code path anywhere produces a coefficient,
  so no model can be asked to fill one in. The platform has never shown two
  prices for the same configuration to comparable audiences, so every
  observed price/quantity relationship is confounded. The owner is told why,
  in plain language, plus exactly what would have to exist first. Chosen over
  reporting an observational correlation as elasticity.
- **2026-08-15 · (S12) Price friction requires EXPLICIT evidence; a
  non-purchase alone is a behavioural observation.** A signal is
  `isPriceFriction` only when a customer actually said something — an
  objection, a repeated price question, a handoff after a price, a quote
  request after a price. Sessions that saw a price and left produce a
  BEHAVIORAL signal capped at LOW strength and explicitly flagged as not
  price friction. Strength itself is a documented count-and-diversity rule,
  never a probability. Chosen over a "price sensitivity index" the data
  cannot support.
- **2026-08-15 · (S12) MOQ friction and product gaps are routed AWAY from
  pricing.** A customer wanting 200 bags has a quantity problem; a customer
  wanting insulated bags has a product problem. Neither is evidence that the
  unit price is wrong, and lowering it would sell them nothing. MOQ signals
  carry `route: MOQ_REVIEW` and `isPriceFriction: false`; product gaps
  produce no pricing signal at all. Chosen over letting a pricing layer claim
  every unclosed sale.
- **2026-08-15 · (S12) Repricing is reported as NOT INSTRUMENTED rather
  than derived.** `/api/checkout` answers 409 REPRICED and the client
  re-confirms, but no first-party event records it — so repricing counts,
  post-reprice confirmations and abandonment are unknown. Session 12 names
  the two events that would need to exist instead of inferring a figure from
  cart abandonment. Same doctrine as the S02 cost model: ship the refusal.
- **2026-08-15 · (S12) Pricing reviews live in a dedicated append-only
  table.** `pricing_reports` versions the document (period / prompt / model /
  the exact snapshot the model saw / the validated review / decision links),
  mirroring `ceo_reports` for the same reason: a failed generation must leave
  the last good review visible, and an audit must be able to replay what the
  model actually saw. AgentDecision stays the per-recommendation approval
  spine. Chosen over stuffing a document into a decision row.

- **2026-08-08 · Keep Shopify-behind-interface, no Stripe.** Checkout,
  payments, tax, discounts stay delegated; the AI layer operates above the
  commerce provider. Reason: prompt-pack §3 + existing working abstraction.
- **2026-08-08 · DB is the first ADD.** Every roadmap stage consumes
  structured first-party data; nothing else unblocks until persistence
  exists. Chosen over "chatbot first" deliberately.
- **2026-08-08 · Pricing engine is extended, not replaced.** It is already
  deterministic, pure, and tested; the gap is the cost model and
  server-side enforcement, not the math.
- **2026-08-08 (S02) · Checkout re-quote returns 409 on drift instead of
  silently substituting.** The user must see and re-confirm corrected
  totals before an order exists — no order is ever created at a price the
  customer wasn't shown. Second click proceeds.
- **2026-08-08 (S02) · Cost model lives in code config (`config/costs.ts`),
  not env vars.** Structured (per-product, per-size, per-print-option)
  placeholders type-checked against `modules/pricing/cost-model.ts`; all
  values null until the owner provides real economics — computations
  report "unconfigured" and price floors fail closed.
- **2026-08-08 (S02) · Catalog reads go through `lib/commerce/catalog.ts`.**
  The empty-Shopify fallback described (but unimplemented) in Session 01 is
  now real: reads fall back to the mock catalog with a loud warning while
  the variant mapping is incomplete; checkout never falls back.
- **2026-08-08 (S02) · Published-price-below-floor is a warning, not a
  block.** If the owner's tiers ever violate the (future) configured margin
  floor, checkout proceeds at the published price with a loud server
  warning — guardrails gate price *deviations* (agents, discounts), and a
  store must not silently go down from a config mistake. The fail-closed
  rule applies to price-affecting agent actions, which remain blocked
  until costs exist.
- **2026-08-09 (S03) · Postgres one-dialect, two drivers (Drizzle + PGlite
  dev / node-postgres prod) — over Prisma and over SQLite-dev.** One
  schema and ONE migration set with no cross-dialect drift; PGlite gives
  dev/tests a real embedded Postgres with zero setup (self-migrating);
  plain-TS schema, no codegen. External databases are never auto-migrated
  at request time — `npm run db:migrate` is an explicit deploy step.
- **2026-08-09 (S03) · Data persistence is additive to commerce, never a
  dependency.** Order/quote/event persistence wraps in non-fatal guards:
  a database failure logs loudly and the customer's checkout/quote still
  succeeds. Mirrors the feature-flag rule — commerce works with the data
  layer down.
- **2026-08-09 (S03) · First-party events are consent-flexible by design.**
  The GA4/Meta dataLayer stays strictly consent-gated (unchanged). The
  first-party operational dual-write has its own switch
  (`NEXT_PUBLIC_FIRST_PARTY_EVENTS`) and fires independently; the mapping
  table marks `purchase` server-authoritative (written at order creation,
  immune to ad-blockers/double-fires). No legal claims are made in code —
  the owner reviews consent policy before launch (BUSINESS_CONFIG_TODO).
- **2026-08-09 (S03) · Orders table IS the order-intelligence link; no
  OrderReference twin, no Shopify mirroring.** Nullable FKs (session,
  customer, business, conversation) + attribution + aiAssisted + immutable
  line config snapshots cover every linkage the AI roadmap needs; Shopify
  order rows arrive only with webhooks (future session) — a checkout
  redirect creates nothing.
- **2026-08-09 (S03) · AgentAction is a typed schema inside AgentDecision,
  not a table.** One audit trail (decision → approval → execution status);
  the same zod structure feeds the future guardrail engine's
  `evaluateAgentAction`. Missing `agent_configs` rows read as OBSERVE —
  autonomy defaults fail-safe.
- **2026-08-09 (S03.5) · Production refuses the embedded database.** With
  `NODE_ENV=production` and no `DATABASE_URL`, `db/client.ts` throws an
  actionable error at first DB use instead of falling back to PGlite —
  embedded storage is per-instance and evaporates on redeploy, so a silent
  fallback would quietly lose sessions/events/orders. Dev/tests keep the
  zero-setup fallback; `next build` is unaffected because only dynamic API
  routes touch the DB. (Same audit pass: `aiUsageTotalsSince` casts sums
  to float8, not int4 — budget-cap math survives >$2,147 windows — and
  customer deletion now removes the person's sessions/cross-session
  behavioral rows and redacts artwork filenames; see DATABASE_SCHEMA.md.)
- **2026-08-10 (S04) · Official vendor SDK behind our own interface, one
  implemented provider.** `@anthropic-ai/sdk` (typed errors, built-in
  429/5xx retries, timeout) lives entirely inside
  `lib/ai/providers/anthropic.ts`; the `AIProvider` interface exposes three
  single-shot primitives and the agentic LOOP lives provider-agnostically in
  `runtime.ts`. OpenAI/Gemini are interface-supported, deliberately not
  implemented (no speculative adapters).
- **2026-08-10 (S04) · AI spend fails closed.** Budget caps configured +
  unpriced model ⇒ typed configuration error (a cap over unmeasurable spend
  is unenforceable); budget-check infrastructure failure ⇒
  `AI_BUDGET_EXCEEDED check_failed`, never an unlimited-spend window. Model
  pricing follows the costs doctrine: `config/ai-pricing.ts` ships null
  placeholders — no invented economics.
- **2026-08-10 (S04) · Tool security is capability-based.** Permission
  tiers (`READ`/`CUSTOMER_WRITE`/`COMMERCE`/`FINANCIAL_RESTRICTED`/
  `ADMIN_RESTRICTED`) with a server-side agent→permissions map; the model
  only sees permitted tools, contexts are server-minted, price-tool output
  schemas structurally exclude cost/margin/floor fields, and the sales
  registry refuses to construct with a restricted tool present. Injection
  defenses are unit tests, not prompt wording.
- **2026-08-10 (S05) · CustomerNeedProfile writes serialize via
  transaction + `SELECT … FOR UPDATE`** — over optimistic version-retry
  (same guarantee plus a retry loop on a low-contention per-session row)
  and over pure-SQL jsonb merging (would fork the tested TS provenance
  rank-gate into SQL). Without it, S05's concurrent writers (extraction
  alongside tool/checkout/quote writes) could lose fields AND provenance
  entries in read-merge-write races. PGlite serializes transactions on its
  single connection — same guarantee in dev/test.
- **2026-08-10 (S05) · USER_STATED provenance must be EARNED through
  server-verified evidence.** The model cannot label facts USER_STATED:
  the saveCustomerNeed tool is hard-coded AI_INFERRED, and the extraction
  pipeline grants USER_STATED only when the model's quoted evidence occurs
  verbatim in the customer's actual message AND the value is consistent
  with it (complete-number match for quantities; hedged numbers demote).
  Fabricated quotes are dropped entirely — hallucinated direct statements
  must not survive even as guesses. Judgment enums
  (priceSensitivity/purchaseIntent) are permanently AI_INFERRED.
- **2026-08-10 (S05) · Chat abuse control = in-process token buckets +
  budget guard; distributed limiting belongs at the edge.** Per-session and
  per-IP buckets bound the endpoint's direct API cost without new
  infrastructure (no Redis for a single-instance store); the launch
  checklist requires platform/CDN rate limiting before real traffic, and
  the AI budget guard stays the hard spend backstop.
- **2026-08-10 (S06) · The shared configuration state lives in the DB row,
  not in a client store the server mirrors.** The S03
  `product_configurations` row (session × product, version column) is the
  cross-surface truth; the React store is its live view (restore on mount,
  debounced sync back). Chosen over a client-first design because the AI
  runs server-side turns and must read/commit without a browser present,
  and over introducing a state library because one page consumes it —
  useReducer + context (the repo's existing cart pattern) suffices.
- **2026-08-10 (S06) · AI configuration writes are revision-checked
  (`expectedRevision` against the row version) under a row lock; UI
  snapshots are last-write-wins.** An AI update computed against revision N
  never overwrites revision N+1 — it gets the current state back and
  reconciles. The UI records what the customer currently sees, which
  cannot be stale from their perspective. Client-side, locally-dirty
  fields win field-wise over concurrent AI loads. Chosen over event
  sourcing / CRDTs as the smallest strategy that makes silent clobbering
  impossible.
- **2026-08-10 (S06) · The UI applies only server-validated configuration
  payloads — never model output.** SalesAgentResult.configurationUpdate is
  lifted from the validated updateConfiguration TOOL OUTPUT (post catalog
  validation + persistence), and suggestion chips POST their patch back
  through /api/configuration where everything revalidates. Patch schemas
  are STRICT zod objects over the five option fields, so price/artwork/
  admin keys are loud validation errors, not silently-stripped keys —
  injection attempts surface to the agent instead of half-succeeding.
- **2026-08-10 (S06) · AI-committed changes record CONFIGURATOR-rank
  need-profile evidence; USER_STATED still only comes from the evidence
  extractor.** The tool records what the configuration now IS (a
  configurator-state fact, same rank as manual clicks); when the
  customer's words drove the change, the S05 extractor independently
  grants USER_STATED from the actual message. Keeps zero model-writable
  paths to top-rank provenance.
- **2026-08-10 (S06) · Quotes never point at the live configuration row.**
  The deferred S03 pointer question is decided: the live row keeps
  mutating after submission and would misrepresent what was quoted;
  quotes keep their embedded configuration payloads (orders already
  snapshot per line).
- **2026-08-11 (S07) · The cart stays client-side; the AI gets a validated
  channel INTO it, not a server cart.** A server-side cart would fork the
  existing (working) localStorage cart + checkout re-quote design into two
  sources of truth. Instead, `lib/commerce/cart-line.ts` turns the
  AUTHORITATIVE shared configuration into a server-validated engine-priced
  line, and the client applies it through the SAME `useCart().addLine` the
  manual configurator uses. `/api/checkout` remains the single order
  authority; AI-added and manual lines are equivalent by construction.
- **2026-08-11 (S07) · The agent sees the cart only as a price-free
  client-reported snapshot.** The chat request carries ids + quantities +
  hasArtwork (STRICT schema — a client-sent price is a 422, not data);
  the server re-prices with the engine for context/tools. Same trust
  level as the localStorage cart it mirrors, because checkout re-quotes
  everything anyway. Chosen over a server cart mirror (drift) and over
  keeping the agent cart-blind (can't answer "did you add it?").
- **2026-08-11 (S07) · Commerce tools carry intent, never authority — and
  checkout requires a customer tap.** `addConfiguredProductToCart` states
  what the customer was shown (revision + total) purely for drift
  detection; `startCheckout` has an EMPTY strict input and only surfaces a
  "Continue to checkout" action the customer must click, which then runs
  the same shared `submitCartCheckout` path as the cart page. With the
  mock provider a checkout IS an order, so tap-to-confirm is structural,
  not stylistic. No tool for payments/refunds/discounts/URLs exists.
- **2026-08-11 (S07) · aiAssisted is conservative and event-derived.**
  An order is AI-assisted only when a sales conversation exists AND a
  material AI commerce event (recommendation, config commit, add-to-cart
  request, checkout request) was recorded — a loaded widget or
  small-talk-only chat never counts. The order row stores the boolean +
  conversation link; the detailed breakdown stays derivable from events
  (no duplicated columns).
- **2026-08-12 (S08) · Admin auth is HTTP Basic from env, challenged in
  proxy.ts and re-checked per page/route, failing closed to 404.**
  `ADMIN_USER`/`ADMIN_PASSWORD` unset ⇒ every /admin and /api/admin path
  answers 404 — the surface does not exist until the owner configures it,
  in dev, prod, and tests alike. Basic auth needs no session store, no
  login UI, and works identically for pages and API calls; the browser
  challenge lives in `proxy.ts` (Next 16's middleware) while every
  handler re-checks `checkAdminAuth` itself, keeping routes directly
  testable and following Next's guidance that proxy is an optimistic
  check, not the authorization system. Chosen over a login page + session
  cookie (state and UI for a single-operator tool) and over a bearer
  token in the URL (credentials must never ride in query strings).
- **2026-08-12 (S08) · The intelligence module computes every number; the
  model only labels messages with closed enums.**
  `modules/customer-intelligence` (aggregation, denominators, trends,
  insight generation) has no lib/ai import — fabricated counts are
  structurally impossible, satisfying invariant 6 for intelligence.
  The LOW_COST classifier emits only controlled-taxonomy labels tied to
  messageIds we actually sent (fabricated ids dropped server-side), and
  catalog support verdicts come from deterministic matching against the
  real catalog, never from the model's opinion. Chosen over "LLM reads
  100 conversations and estimates percentages" (unverifiable, invents
  statistics) and over free-text categories (unbounded vocabulary drift).
- **2026-08-12 (S08) · Classification is persisted once per conversation
  and reprocessed only on explicit admin runs when version/messages
  change.** `conversation_classifications` stores classifierVersion +
  prompt/model + sourceUpdatedAt; page loads never call the model, and a
  budget/provider failure leaves conversations PENDING (not failed) so a
  later run resumes cleanly — AI cost is bounded by an explicit,
  batch-capped action. Chosen over classify-on-page-load (unbounded
  spend, §33) and over an always-running background worker (autonomous
  surface area Session 08 explicitly excludes).
- **2026-08-12 (S08) · Insights/opportunities have stable identities and
  humans own their terminal statuses.** One row per
  TYPE:dimension:periodDays, updated in place; dismissed/archived rows
  regenerate only when evidence GROWS; generation creates opportunities
  as `proposed` only and never touches validated/rejected rows —
  manufacturing feasibility is a human decision by construction
  (humanValidationRequired hard-coded true). Chosen over
  insert-per-run (duplicate spam defeating admin review) and over
  AI-settable validation states.
- **2026-08-12 (S09) · Business metrics are typed availability results;
  missing inputs are never zero.** Every metric in
  `modules/business-intelligence` is AVAILABLE / PARTIAL / UNAVAILABLE
  with reason + missingInputs; profitability reconstructs order costs
  from the SAME cost model as pricing and stays UNAVAILABLE while
  config/costs.ts holds null placeholders ("Unavailable — configure
  manufacturing costs", never $0). Currencies are never combined without
  a conversion model; trends use explicit states (NEW_ACTIVITY /
  LOW_BASELINE / NO_ACTIVITY) instead of +∞% noise. Chosen over
  null-coalescing dashboards (silently wrong economics) and over
  LLM-computed totals (invariant 6).
- **2026-08-12 (S09) · The CEO agent interprets a deterministic snapshot
  and has no tools; its references are server-validated.** One
  REASONING generateStructuredObject call over the PII-free
  BusinessHealthSnapshot context; every supportingMetricRef/evidenceRef
  must match what the context actually offered (fabricated refs filtered,
  ref-less recommendations dropped). Recommendations persist as pending
  AgentDecision rows with stable-identity dedup (pending rows update in
  place, human-reviewed rows frozen). Chosen over a tool-wielding
  "super-agent" (composition never escalates privileges, per-agent spec
  #7) and over trusting model-cited numbers.
- **2026-08-12 (S09) · CEO reviews persist in a dedicated additive
  `ceo_reports` table, not inside AgentDecision.** A review is a
  versioned DOCUMENT (period, prompt id+version, model, provider, the
  exact snapshot the model saw, validated review, linked decision ids)
  generated only by the explicit admin action; decisions stay
  per-recommendation audit records. Reports are append-only, so a
  provider/budget failure leaves the last good review visible while the
  deterministic dashboard keeps rendering with zero AI configuration.
  Chosen over shoehorning documents into decision rows (blurs both
  concepts) and over regenerate-on-page-load (unbounded AI spend).
- **2026-08-12 (S10) · ONE guardrail engine, and it is a pure function.**
  `modules/guardrails` imports neither `lib/ai` nor `db/`, and
  `evaluateAgentAction` has no clock, no randomness and no I/O — so the
  same input under the same `GUARDRAIL_POLICY_VERSION` always yields the
  same verdict, and a model can never influence one. Persistence stamps
  the timestamp and writes an append-only `guardrail_evaluations` row
  (policy version + the exact limits consulted) so "why was this allowed
  on that date?" stays answerable. Chosen over per-agent safety checks
  (which drift) and over an LLM-judged safety layer (invariant 6).
- **2026-08-12 (S10) · The action taxonomy is CLOSED and its payloads are
  STRICT.** Every proposed action is one of ~20 registered types with its
  own zod schema; unknown types and unknown payload keys are validation
  failures, not warnings. A model therefore cannot invent a capability
  ("TRANSFER_MONEY") or smuggle an authorization field
  (`riskLevel`/`approvalStatus`) into a payload. ACTION TYPE and EXECUTION
  SUPPORT are separate axes: `PRICE_EXPERIMENT` is representable today
  with `executionStatus = NOT_SUPPORTED`. Chosen over free-form JSON
  action blobs.
- **2026-08-12 (S10) · Autonomy is clamped by policy, not only stored in
  the database.** `agent_configs` remains the store (absent row = OBSERVE),
  but the evaluator applies `min(storedMode, policy ceiling)` from
  `config/guardrails.ts`, where every business agent's ceiling is
  RECOMMEND. A mistaken or tampered AUTONOMOUS row cannot grant execution;
  the guarded-auto allow-list is empty and HIGH/CRITICAL risk always needs
  a human. Chosen over trusting a single mutable row.
- **2026-08-12 (S10) · Approval and execution are separate columns, and the
  executor registry is empty.** `status` records the human verdict;
  `executionStatus` records whether anything happened. No dummy executors
  exist, so approving records intent and mutates no price, ad, product or
  payment — the documented contract (validated action → fresh evaluation →
  approval → idempotency key → before/after → audit → rollback) must be
  satisfied before the first one is registered. Chosen over a single
  ambiguous status field and over stub executors that "would" work.
- **2026-08-12 (S10) · Proposals are immutable; modification creates a
  re-evaluated revision.** A human edit marks the original SUPERSEDED and
  inserts `revision + 1` with `originActionId`, then runs the FULL
  guardrail evaluation on the new payload — no verdict is inherited, and an
  edit that violates a hard rule lands as GUARDRAIL_BLOCKED. Evidence
  references may narrow but never grow, so an edit cannot launder
  fabricated evidence. State transitions are `stateVersion`-checked under a
  row lock, so a double-click or a stale second reviewer gets a conflict
  rather than a rewritten history. Chosen over in-place payload edits.
