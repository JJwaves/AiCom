@AGENTS.md

# CLAUDE.md — Project Memory

Persistent context for every development session. Read this first, then the
documents relevant to your phase. Do not depend on prior conversation
context existing.

**Long-term vision & specification: [docs/MASTER_PROMPT.md](docs/MASTER_PROMPT.md)**
— the owner's authoritative product/architecture spec (upgrade prompt §1–46
+ multi-session prompt pack). Execution is phase-by-phase per
`AI_PLATFORM_ROADMAP.md`; each phase re-reads its relevant spec sections.
It is a vision document, not a single-session to-do list.

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

**Stage A complete (audit) — next milestone: Stage A remainder + Stage B
"AI Data Foundation" (prompt-pack Sessions 02–03).**

## Current architecture (2026-08-08)

Working B2B storefront, verified end-to-end (see CURRENT_SYSTEM_AUDIT.md):
- Next.js 16.3 App Router · React 19 · TS · Tailwind v4 · zod · vitest (39 tests).
- No database yet. State: `config/*.ts` (catalog/pricing/landing content),
  localStorage (cart `bd_cart_v1`, attribution `bd_attribution_v1`, consent
  `bd_consent_v1`), sessionStorage (mock orders).
- `lib/commerce` — provider abstraction; `mock` active, `shopify`
  Storefront skeleton env-gated (variant mapping TODO, needs real store).
- `lib/pricing/engine.ts` — deterministic tier pricing (pure, tested);
  sell prices only, **no cost model yet**.
- `lib/analytics/track.ts` — typed dataLayer events, consent-gated,
  purchase dedup. `lib/attribution` — first/last touch. Both client-side.
- `/api/quote` — validated quote intake → `QUOTE_WEBHOOK_URL` or log.
- Design system: Hallmark Cobalt theme (OKLCH tokens in `app/globals.css`).
- Docs: README, BUSINESS_CONFIG_TODO, LAUNCH_CHECKLIST, plus the AI-platform
  set (below). Placeholder brand "BagDirect"; demo pricing visibly flagged
  via `NEXT_PUBLIC_DEMO_PRICING`.

## Completed in Session 01 (2026-08-08)

- Full repository audit → `CURRENT_SYSTEM_AUDIT.md` (implemented / partial /
  missing / risks / KEEP-REFACTOR-ADD-DEFER classification).
- Architecture direction → `ARCHITECTURE.md` (current + target + invariants
  + decision log).
- Data design → `DATABASE_SCHEMA.md` (current no-DB state + full planned
  schema: commerce spine, events, conversations, CustomerNeedProfile,
  AgentDecision/Approval/AgentConfig, AiUsage, experiments).
- AI design → `AI_AGENT_ARCHITECTURE.md` (provider layer, model router,
  typed tool rules, sales toolset, injection posture, escalation, UX).
- Safety design → `GUARDRAILS.md` (evaluateAgentAction, autonomy modes,
  hard limits, never-automated list, feature flags).
- Rollout → `AI_PLATFORM_ROADMAP.md` (Stages A–J ↔ session map).
- `BUSINESS_CONFIG_TODO.md` extended with cost-model + AI/guardrail config.
- No application code changed this session (audit-only by design).

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

## Known issues

- Mock checkout trusts browser-computed price snapshots (fine while demo,
  must be fixed by server re-quote before real orders — Session 02).
- Shopify variant mapping is `TODO(shopify)` pending a real store.
- Artwork binaries are not persisted (metadata only).
- Dev-mode React StrictMode double-fires some dataLayer events (view_item,
  page_view); purchase is deduped; production unaffected.
- `next dev` regenerates `AGENTS.md` (Next 16 breaking-changes notice) —
  keep it committed, keep the `@AGENTS.md` import at the top of this file.

## Business configuration still needed

See `BUSINESS_CONFIG_TODO.md` — notably: real prices (site shows DEMO
notices until `NEXT_PUBLIC_DEMO_PRICING=false`), the entire cost model
(manufacturing/printing/packaging/shipping/payment fees — required for
margins and price guardrails), factory identity/photos, policies legal
review, Shopify store + variant mapping, AI provider keys + budget caps,
guardrail thresholds, escalation destination.

## Deferred work

Ads integrations (even read-only), autonomous/experimental pricing, CRO
automation, CEO agent, experiment runtime, accounts/reorder, email
automation, Merchant Center feed. Order per `AI_PLATFORM_ROADMAP.md`.

## Recommended next session

**Session 02 — Commerce Stabilization + Pricing Engine** (prompt pack):
1. Server-side checkout re-quote (never trust browser pricing).
2. Cost model + margin/contribution outputs + `minimumAllowedPrice` in a
   `modules/pricing` boundary (explicit `[TO BE PROVIDED]` placeholders —
   no invented economics; keep existing engine math + tests, extend both).
3. Keep the storefront journey green (run existing tests + build).
Then Session 03 — AI Data Foundation (DB + events + profiles +
conversations) per `DATABASE_SCHEMA.md`.
