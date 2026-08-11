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

**Session 06 "AI Sales × Product Configurator" COMPLETE (2026-08-10) —
ONE shared authoritative configuration state (`lib/configuration` +
`product_configurations` row, version = revision) drives both the visual
configurator and the AI: chat "make it 10,000" visibly updates the
configurator + price; manual choices are visible to the agent; stale AI
writes are revision-blocked; the manual cart receives the same shared
state. AI still OFF by default. Next milestone: Session 07 "AI Sales ×
Cart / Checkout".**

## Current architecture (2026-08-10, post-Session 06)

Working B2B storefront, verified end-to-end (see
docs/CURRENT_SYSTEM_AUDIT.md + its Session-02 resolution note):
- Next.js 16.3 App Router · React 19 · TS · Tailwind v4 · zod · vitest (317 tests)
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
  traffic.
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

## Business configuration still needed

See `BUSINESS_CONFIG_TODO.md` — notably: real prices (site shows DEMO
notices until `NEXT_PUBLIC_DEMO_PRICING=false`), the entire cost model
(now structured in `config/costs.ts`, every value a `null`
`[TO BE PROVIDED]` placeholder — margins stay "unavailable" and price
guardrails fail closed until filled), factory identity/photos, policies
legal review, Shopify store + variant mapping, production `DATABASE_URL`
(+ `npm run db:migrate` at deploy), consent-policy review for first-party
events, AI provider key + budget caps + **model pricing
(`config/ai-pricing.ts`, null placeholders — budget caps fail closed until
filled)**, guardrail thresholds, escalation destination.

## Deferred work

Explicitly preserved for later sessions: **AI-assisted Add-to-Cart /
checkout** (S07 — S06 deliberately stops at synchronized configuration:
no cart/quote/order tools exist, the manual Add-to-Cart flow receives the
shared state), **human escalation delivery** (owner config), **Customer
Intelligence** (S08), **Business Intelligence / Guardrails Action Center**,
**Pricing Agent/Intelligence** (S12), **CRO Agent** + experiment runtime
(S11), **Google Ads Agent** (S13+), **Meta Ads Agent**, **CEO Agent**
(S09), autonomous/background configuration actions (never — AI acts only
on customer interaction). Also deferred: Shopify order webhooks → DB order
rows, accounts/reorder, email automation, Merchant Center feed, admin
surfaces, privacy portal UI, conversation `abandoned` outcome sweep,
owner-configured confirmation thresholds (BUSINESS_CONFIG_TODO). Order per
`docs/AI_PLATFORM_ROADMAP.md`.

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

**Session 07 — AI Sales × Cart / Checkout** — run
`prompts/07-ai-checkout.md`:
the end-to-end configuration system is stable (317 tests, browser-verified
both directions), so the natural next milestone is letting the
conversation carry through to commerce: an `addConfiguredProductToCart`
tool that routes the SHARED configuration through the existing server
re-quote (409 REPRICED semantics preserved — the AI never sets prices),
customer-confirmed add-to-cart from chat (structured action, same
suggestion-chip pattern as S06), cart visibility for the agent
(getCartState READ tool), and the conversation outcome links
(`aiAssisted` on orders + conversationId already exist on the schema).
Hard boundaries staying: no checkout submission, no payment actions, no
autonomous cart mutations — customer-confirmed actions only. Also
available if preferred: Session 08 Customer Intelligence (the
conversation/configuration/order corpus is now rich enough to aggregate).
