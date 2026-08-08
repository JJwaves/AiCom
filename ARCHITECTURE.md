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

## Current architecture (as built)

```
Browser
  ├─ Storefront (Next.js App Router, server components + client islands)
  │    ├─ Landing system (config/landing-pages.ts → organic + /lp/* ad pages)
  │    ├─ ProductConfigurator (client) ── lib/pricing/engine (pure, shared)
  │    ├─ Cart (React context + localStorage)
  │    └─ AnalyticsProvider (consent → dataLayer → GTM/GA4/Meta)
  ├─ lib/attribution  (first/last touch, localStorage, → checkout metadata)
  ├─ lib/commerce     (CommerceProvider interface)
  │    ├─ mock provider (seed catalog from config/products.ts)  ← active
  │    └─ shopify provider (Storefront API skeleton, env-gated)
  └─ /api/quote       (zod-validated intake → QUOTE_WEBHOOK_URL | log)
```

No database. No auth. No admin. Payments delegated to Shopify checkout
(never custom card handling).

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
| `lib/commerce` | KEEP | Already the provider abstraction; extend with `getOrder`/order persistence hooks. |
| `lib/pricing` → `modules/pricing` | REFACTOR | Engine math kept; add cost model, margins, `minimumAllowedPrice`, server-side checkout re-quote. |
| `lib/analytics` | REFACTOR | `track()` dual-writes dataLayer + first-party event store. |
| `lib/attribution` | KEEP | Link records to session/customer/conversation/order once DB exists. |
| `db/` (new) | ADD | SQLite dev / Postgres prod, TS ORM, migrations. See DATABASE_SCHEMA.md. |
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
