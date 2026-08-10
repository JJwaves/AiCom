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

**Stage B "AI Data Foundation" COMPLETE AND HARDENED (Session 03 +
hardening Session 03.5, both 2026-08-09) — next milestone: Session 04
"AI Provider Infrastructure + Tool Architecture".**

## Current architecture (2026-08-09, post-Session 03)

Working B2B storefront, verified end-to-end (see
docs/CURRENT_SYSTEM_AUDIT.md + its Session-02 resolution note):
- Next.js 16.3 App Router · React 19 · TS · Tailwind v4 · zod · vitest (116 tests)
  · Drizzle ORM + Postgres (PGlite embedded dev/test, node-postgres prod).
- **Database (Session 03):** `db/schema.ts` (20 tables: sessions, events,
  customers, businesses, orders+lines, quotes, artworks, configurations,
  conversations+messages, need profiles, ai_usage, agent_decisions,
  approvals, agent_configs, insights, opportunities, experiments,
  assignments) + additive SQL migrations in `db/migrations/`.
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
- **AI-ops preparation (empty but live):** AiUsage (+ totals for budget
  caps), AgentDecision with typed AgentAction schema, Approval auto-created
  pending, AgentConfig (missing row ⇒ OBSERVE fail-safe), CustomerInsight
  (sourceRefs ≥ 1 enforced — fabrication structurally impossible),
  ProductOpportunity (humanValidationRequired always true), Experiment +
  sticky assignments. No agents, no LLM calls, no runtime.
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

## Known issues

- Configurator state is six `useState` hooks local to
  `ProductConfigurator` — the shared validated configuration store that
  AI tools will mutate does not exist yet — Session 06. (Configurator
  interactions DO reach the DB as `configurator_updated` events; the
  configuration-row writer for source "configurator" wires in S06 —
  today only checkout writes configuration rows.)
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

## Business configuration still needed

See `BUSINESS_CONFIG_TODO.md` — notably: real prices (site shows DEMO
notices until `NEXT_PUBLIC_DEMO_PRICING=false`), the entire cost model
(now structured in `config/costs.ts`, every value a `null`
`[TO BE PROVIDED]` placeholder — margins stay "unavailable" and price
guardrails fail closed until filled), factory identity/photos, policies
legal review, Shopify store + variant mapping, production `DATABASE_URL`
(+ `npm run db:migrate` at deploy), consent-policy review for first-party
events, AI provider keys + budget caps, guardrail thresholds, escalation
destination.

## Deferred work

Explicitly preserved for later sessions (data structures exist, no
runtime): **AI Sales Agent** (S05), **AI Configurator integration** (S06),
**Customer Intelligence** (S08), **Pricing Agent** (S12), **CRO Agent** +
experiment runtime (S11), **Google Ads Agent** (S13+), **Meta Ads Agent**,
**CEO Agent** (S09). Also deferred: Shopify order webhooks → DB order
rows, accounts/reorder, email automation, Merchant Center feed, admin
surfaces, privacy portal UI. Order per `docs/AI_PLATFORM_ROADMAP.md`.

### Deferred technical debt (Session 03 audit — accepted, not forgotten)

Findings from the Session 03 independent audit deliberately NOT fixed in
the 03.5 hardening pass (small blast radius, none block Session 04):

- **`/api/events` rate limiting** — the intake validates, bounds and
  413s payloads but has no per-session/IP rate limit; add one before
  real traffic (pairs with the launch checklist, likely at the platform
  edge or in the route).
- **CustomerNeedProfile concurrent-writer locking** —
  `applyNeedProfileUpdate` does read-merge-write without row locking;
  two simultaneous writers can lose one side's fields. Real risk begins
  when AI extraction (S04+) writes alongside checkout/quote — revisit
  with `SELECT … FOR UPDATE` or a jsonb-merge update then.
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

**Session 04 — AI Provider Infrastructure + Tool Architecture** — run
`prompts/04-ai-infrastructure.md`: `/lib/ai` provider abstraction
(env-selected vendor), model router (LOW_COST/STANDARD/REASONING), typed
tool registry (server-side, zod-validated, permission-scoped per agent),
versioned prompts, AiUsage recording through the existing
`lib/data/ai-usage-service` (+ budget caps via `aiUsageTotalsSince`),
feature flags in `config/flags.ts` (all default OFF). No customer-facing
chat yet. No prerequisite gaps surfaced during Session 03.
