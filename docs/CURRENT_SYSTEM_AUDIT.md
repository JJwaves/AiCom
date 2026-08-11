# CURRENT_SYSTEM_AUDIT

Audited 2026-08-08 (Session 01 of the AI-platform upgrade). Snapshot of the
storefront as originally built; the source of truth for what exists before
any AI work begins.

Re-verified 2026-08-08 (second pass, full source read): all Session-01
claims held up; three code-level findings were added — catalog reads
bypassing the commerce provider (risk 7), component-local configurator
state (risk 6), and the stale mock-fallback comment in the Shopify
provider. Baseline re-confirmed green: 39/39 tests, clean typecheck, clean
lint, clean production build.

**Session 02 resolution note (2026-08-08, same day):** risks 2 (client-
trusted checkout pricing), 3 (no margin floor — structure now exists,
values still `[TO BE PROVIDED]`) and 7 (catalog reads bypassing the
provider) are RESOLVED; the stale Shopify fallback comment is resolved by
implementing the described fallback in `lib/commerce/catalog.ts`. The
pricing REFACTOR (→ `modules/pricing` + cost model + server re-quote at
`/api/checkout`) and the catalog-reads REFACTOR are done — see
ARCHITECTURE.md and CLAUDE.md for the as-built state. 59/59 tests green.
Risks 1, 4, 5, 6 (persistence, session identity, catalog id stability,
configurator store) remain open for Sessions 03/06. The snapshot below is
kept as originally audited.

## Stack summary

| Layer | Current implementation |
| --- | --- |
| Frontend | Next.js 16.3 (App Router), React 19, TypeScript, Tailwind v4 |
| Backend | Next.js route handlers only (`/api/quote`). No standalone backend. |
| Database | **None.** State lives in TS config files, localStorage (cart, attribution, consent), sessionStorage (mock orders). |
| Commerce | Provider abstraction (`lib/commerce/`): `mock` (active, seed catalog) + `shopify` (Storefront API skeleton, activates on env vars, variant mapping TODO). |
| Stripe | Not used. Payments are delegated to Shopify checkout by design. |
| Auth | None (guest checkout by design; no admin surface exists yet). |
| Deployment | Not configured. `npm run build` is clean; any Node host works. |
| Tests | 39 vitest unit tests: pricing tiers/quotes, attribution merging, artwork + quote validation, postal detection. |

## Already implemented (functional)

- **Full customer journey** — landing → product → configurator (size /
  material / color / print / artwork / quantity) → live price → cart →
  checkout handoff → order confirmation. Verified end-to-end in-browser.
- **Deterministic pricing engine** (`lib/pricing/engine.ts`) — pure
  integer-cent functions: tier selection, option deltas, savings %,
  below-MOQ / custom-config routing to quote. Unit-tested.
- **Commerce abstraction** (`lib/commerce/provider.ts`) — the
  `CommerceProvider` interface (`listProducts` / `getProduct` /
  `createCheckout`) exists and checkout goes through it; Shopify swaps in
  via env. **Caveat (verified in code):** catalog *reads* do not all go
  through it — 8 files (`app/page.tsx`, `app/products/page.tsx`,
  `app/products/[slug]/page.tsx`, `app/cart/page.tsx`, `app/sitemap.ts`,
  `app/request-quote/quote-client.tsx`, `components/landing/*`) import
  `config/products` directly. Harmless while mock ≡ config, but under
  Shopify the catalog pages and cart re-pricing would silently keep using
  the seed catalog. See REFACTOR.
- **Typed analytics event model** (`lib/analytics/track.ts`) — GA4-compatible
  ecommerce events + funnel events, pushed to a dataLayer, consent-gated
  with pre-consent buffering, purchase dedup by transaction id.
- **First-party attribution** (`lib/attribution/attribution.ts`) — UTM +
  gclid/gbraid/wbraid/fbclid, immutable first touch, campaign-only
  last-touch updates, flattened into checkout metadata. Unit-tested.
- **Artwork upload (client side)** — MIME/extension/size validation
  (client + re-validated server-side in `/api/quote`), notes field,
  filename/notes travel with the cart line.
- **Quote intake** (`/api/quote`) — zod-validated, size-capped attribution
  passthrough, webhook delivery abstraction (`QUOTE_WEBHOOK_URL`).
- **Landing-page system** — 4 differentiated organic SEO pages + `/lp/*`
  ad variants (minimal nav, noindex) from one content config.
- **SEO** — per-page metadata, canonicals, sitemap, robots, Product/FAQ/
  Breadcrumb/Organization JSON-LD (price omitted while demo pricing active).
- **Honest-content guards** — visible DEMO-pricing notices, draft-policy
  banners, placeholder photo slots; no fabricated claims.
- **Cart** — React context + localStorage persistence, re-priced quantity
  changes via the pricing engine.

## Partially implemented

- **Shopify provider** — checkout mutation + config detection exist;
  product/variant mapping and the `b2b.pricing_tiers` metafield read are
  `TODO(shopify)` (needs a real store). **Two verified gotchas:** (a) a
  comment in `lib/commerce/shopify.ts` claims `index.ts` "falls back to the
  mock catalog for empty results" — no such fallback exists; the switch in
  `getCommerce()` is all-or-nothing, so setting the Shopify env vars before
  the mapping is complete empties the catalog. (b) `createCheckout` ships a
  hard-coded `REPLACE_ME` variant id, so it cannot succeed until mapping is
  done. Neither matters today (env vars unset), both are Session-02 fixes.
- **Artwork persistence** — files validated but held as object URLs;
  no binary storage (S3/Shopify Files is a launch task).
- **Order status** — mock orders render from sessionStorage; Shopify order
  lookup not built.
- **Account/reorder** — stub page; data model records everything reorder
  needs, no implementation.
- **Email automation** — abstraction points documented, nothing wired.

## Missing (relevant to the AI roadmap)

- **Any persistence layer** — no database, no server-side sessions,
  customers, orders, events, conversations. *The single biggest gap.*
- **Server-authoritative checkout pricing** — mock cart trusts
  browser-computed snapshots. Acceptable for a demo checkout that charges
  nothing; unacceptable once orders are real or an AI can influence carts.
- **Cost model** — the engine knows sell prices only. No manufacturing /
  printing / packaging / shipping / payment-fee costs → no margin or
  contribution-profit math, no price guardrails.
- **First-party event storage** — events go to the dataLayer only; nothing
  is queryable by future agents.
- **Conversations, CustomerNeedProfile, AgentDecision, approvals, AI usage
  tracking, guardrail engine, feature flags, experiments** — none exist.
- **Admin surface + admin auth** — none.
- **AI provider layer** — none.

## Architecture risks for AI functionality

1. **No data layer.** Every future agent (sales, intelligence, pricing,
   CRO) consumes structured first-party data; today there is nowhere to put
   it. Must be solved before any agent work (→ AI Data Foundation).
2. **Client-trusted pricing at checkout.** An AI tool that mutates
   configurations must never be able to influence a price the server
   doesn't recompute. The engine is already pure/shared, so the fix is a
   server-side re-quote at checkout, not a rewrite.
3. **No margin floor.** Without a cost model, `minimumAllowedPrice` /
   `minimumMargin` guardrails cannot be computed — blocking any future
   pricing intelligence.
4. **No server session identity.** Attribution and events are keyed to a
   browser, not a session/customer record; conversations and profiles need
   a durable session id minted server-side.
5. **Anonymous config-file catalog.** Fine for now (KEEP), but product ids
   must remain stable once conversations/orders reference them.
6. **Configurator state is component-local.** ~~`ProductConfigurator` holds
   size/material/color/print/quantity/artwork in six `useState` hooks
   inside one client component.~~ **RESOLVED in Session 06:**
   `lib/configuration` is the ONE shared validated state (pure reducer +
   catalog validation + server application path over the S03
   `product_configurations` row); the UI dispatches to it and the AI's
   getCurrentConfiguration/updateConfiguration tools mutate the same
   path — see docs/AI_CONFIGURATOR_INTEGRATION.md.
7. **Catalog reads bypass the provider.** Product/landing/cart/sitemap
   code imports `config/products` directly (8 files) instead of calling
   `getCommerce()`. The abstraction is real at checkout but only nominal
   for catalog reads; AI product tools must not repeat this shortcut, and
   the read path must be unified before Shopify activation.

## Classification

### KEEP
- Next.js modular monolith, App Router, TS, Tailwind — no microservices.
- `lib/commerce` provider abstraction (already the shape Session 03 asks for).
- Pricing engine core math (pure, tested) — it becomes the kernel of
  `/modules/pricing`, not replaced.
- Attribution library and its first/last-touch semantics.
- Typed analytics event model + consent gating + third-party tag loading.
- Configurator UX, landing-page system, SEO, honest-content guards.
- Config-first catalog (`config/products.ts`) until Shopify goes live.
- Existing docs (README, BUSINESS_CONFIG_TODO, LAUNCH_CHECKLIST) and tests.

### REFACTOR
- **Pricing** → move to `/modules/pricing` semantics: extend with a cost
  model (explicit config placeholders — never invented economics), margin /
  contribution outputs, `minimumAllowedPrice`; add server-side checkout
  re-quote. Engine math itself is reused as-is.
- **Events** → `track()` dual-writes: dataLayer (existing) + first-party
  event store (new). Component call sites stay unchanged. Note: the client
  event names are GA4-shaped (`view_item`, `product_config_started`,
  `select_quantity`…) while the planned first-party taxonomy in
  DATABASE_SCHEMA.md uses platform names (`product_viewed`,
  `configurator_started`, `quantity_selected`…) — the dual-write layer
  owns that mapping explicitly; do not rename the GA4-facing events.
- **Checkout** → server route validates cart lines against the engine
  before creating a checkout/order.
- **Configurator state** → ~~extract the component-local `useState` cluster
  into one shared, validated configuration store (reducer semantics, same
  option/quantity rules).~~ **DONE (Session 06):** `lib/configuration`
  reducer/validation + `/api/configuration` persistence; UI and AI tools
  share the exact path (docs/AI_CONFIGURATOR_INTEGRATION.md).
- **Catalog reads** → route the 8 direct `config/products` imports through
  `getCommerce()` (or a thin server catalog module backed by it) so the
  provider switch actually switches the whole storefront, not just
  checkout. Also fix the stale mock-fallback comment in
  `lib/commerce/shopify.ts` (or implement the fallback it describes).
- **Artwork** → extend metadata flow with persistence + workflow states.

### ADD (in roadmap order)
- Database (SQLite dev / Postgres prod via a TS ORM) + migrations.
- Server session identity; Customers, Orders, Quotes, Events persistence.
- CustomerNeedProfile, Conversations/Messages storage.
- `/lib/ai` provider abstraction + model router + usage tracking.
- Typed AI tool layer (server-side, validated, permission-scoped).
- AgentDecision + approvals models; Guardrail engine (`/modules/guardrails`).
- Feature flags (all AI features default OFF).
- Admin shell + auth (`/admin/*`).
- AI Sales Agent ("AI Packaging Expert") + configurator synchronization.
- Customer-intelligence aggregation + dashboard.

### DEFER
- Google Ads / Meta Ads integrations (even read-only) — after customer
  intelligence works.
- Autonomous or experiment-driven pricing; CRO automation; CEO agent.
- Experiment engine implementation (schema may land with the data
  foundation; no runtime until Stage F).
- Microservices, queues, vector stores — no scale justification.

## Recommended migrations (only the necessary ones)

1. **Add a database.** Not aesthetic — nothing in the AI roadmap works
   without persistence. Everything else stays in the monolith.
2. **Server-side checkout re-quote.** Small, uses the existing engine.
3. **Cost-model extension of the pricing config.** Explicit
   `[TO BE PROVIDED]` placeholders; demo-guarded like sell prices.

No other migration is warranted. Shopify stays behind the commerce
interface; Stripe is not introduced.
