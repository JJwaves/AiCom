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
  │                    zod-validated inputs; future AI tools call THESE)
  │    session · events · customer · need-profile (provenance) · configuration
  │    · conversation · order · quote · ai-usage · agent · insight ·
  │    experiment · privacy
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
exists WITHOUT auth — guests work unchanged. No admin surface yet. Payments
stay delegated to Shopify checkout. Checkout totals are server-computed;
the browser's prices are proposals only. Every AI-ops table
(AiUsage/AgentDecision/Approval/AgentConfig/Insight/Opportunity/Experiment)
is live schema with a validated service interface and zero runtime.

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
| `lib/ai/{providers,router,tools,schemas,prompts}` | ADD | Provider-agnostic; see AI_AGENT_ARCHITECTURE.md. |
| `modules/guardrails` | ADD | Central `evaluateAgentAction`; see GUARDRAILS.md. |
| `modules/customer-intelligence` | ADD (Stage D) | Aggregation over conversations/quotes/orders. |
| `modules/ads/google`, `modules/ads/meta` | DEFER | Read-only first, much later. |
| `config/flags.ts` | ADD | Feature flags; all AI features default OFF. |
| `app/admin/*` | ADD | Auth-gated; customer-intelligence, ai-actions, ai-usage. |

## Invariants (enforced across all future sessions)

1. **One configuration state.** The configurator state is the single source
   of truth; AI tools mutate it through the same validated reducer the UI
   uses. Never two parallel states.
2. **Server-priced checkout.** The browser proposes, the server re-quotes
   with the deterministic engine before any order/checkout is created.
   *Enforced since Session 02 (`/api/checkout`): price drift → 409
   REPRICED; invalid/custom-quote configs → 422; cost figures never leave
   the server.*
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
