# AI_PLATFORM_ROADMAP

From working storefront to AI-native B2B commerce platform, in guarded
increments. Each stage maps to one or more focused development sessions;
commerce must remain fully functional at every step (all AI behind flags).

## Stage A — Existing Commerce Stabilization  ✅ audited / ◐ two gaps
The storefront (configurator → pricing → artwork → cart → checkout →
confirmation, analytics, attribution) is built and verified.
Remaining for "stable" (next implementation session, with Stage B):
- Server-side checkout re-quote (browser must not be pricing authority).
- Pricing cost model + margin outputs + `minimumAllowedPrice`
  (explicit config placeholders; no invented economics).

## Stage B — AI Data Foundation  ← NEXT MILESTONE
- Database (SQLite dev / Postgres prod) + migrations per DATABASE_SCHEMA.md
- Server session identity; orders/quotes/configurations persisted
- First-party event store (dual-write from existing `track()`)
- Attribution linked to session/customer/order server-side
- CustomerNeedProfile + Conversation/Message models
- `/lib/ai` provider abstraction + model router + AiUsage tracking
- AgentDecision/Approval/AgentConfig models; guardrail engine skeleton
- Feature flags (`config/flags.ts`, all OFF)
Exit: events queryable; a conversation can be stored; no visible change to
customers.

## Stage C — AI Sales
- AI Packaging Expert (flag `AI_SALES`) with typed toolset
- Shared configuration state: chat ↔ configurator bidirectional sync
- Need extraction → progressively richer CustomerNeedProfile
- Conversation persistence + outcome tracking + sales analytics
- Human escalation with summary handoff
- Prompt-injection red-team cases as CI tests
Exit: the §44 end-to-end flow works — visitor → chat → recommendation →
configurator updates → logo → deterministic price → checkout → order linked
to conversation + profile, AI-assisted attribution recorded.

## Stage D — Customer Intelligence ✅ COMPLETE (Session 08, 2026-08-12)
- `/modules/customer-intelligence`: aggregate questions, objections, MOQ/
  price/shipping concerns, requested quantities/sizes/colors, unsupported
  requests, industry patterns, lost opportunities
- `/admin/customer-intelligence` dashboard (real data only; demo data
  visibly labeled)
Exit: weekly insight reports traceable to underlying records. ✅
Report renders from real stored data with per-insight evidence
drill-through (sourceRefs ≥ 1 enforced); explicit (manual-trigger)
processing per the prompt's "weekly generation, manual trigger acceptable
first". See docs/CUSTOMER_INTELLIGENCE.md.

## Stage E — AI Business Intelligence ✅ CORE COMPLETE (Session 09, 2026-08-12)
- ✅ `/modules/business-intelligence`: deterministic revenue/funnel/AI-cost/
  segment/attribution/trend metrics with explicit AVAILABLE/PARTIAL/
  UNAVAILABLE availability; contribution-profit analytics implemented as
  "contribution before paid media" (revenue − manufacturing − printing −
  packaging − shipping − payment fees; discounts structurally zero; ad
  spend not yet ingested) — UNAVAILABLE until the owner fills
  config/costs.ts (needs Stage A cost model; never zero, never invented)
- ✅ CEO agent: recommendation-only business review (no tools; explicit
  admin trigger; AgentDecision + ceo_reports persistence) —
  docs/BUSINESS_INTELLIGENCE.md
- ✅ `/admin/business-intelligence` dashboard (deterministic without AI)
- ✅ AI Action Center (`/admin/ai-actions`) + the central Guardrail Engine
  (`modules/guardrails`) — Session 10: closed proposed-action taxonomy,
  pure `evaluateAgentAction()`, policy-clamped autonomy, deterministic
  risk, append-only evaluation log, approve/reject/modify with
  concurrency + idempotency. Executor registry EMPTY: approval records a
  human decision, never a mutation.
Exit: ✅ AgentDecision → guardrail → human approval loop operating
end-to-end on real CEO recommendations. Execution remains deferred (no
executor exists for any business action type).

## Stage F — CRO ✅ COMPLETE (Session 11, 2026-08-12)
- Experiment engine (`modules/experiments` + `lib/experiments`, flag
  `EXPERIMENT_ENGINE`): CLOSED target registry (3 presentation surfaces),
  CLOSED typed variant schemas (no HTML/JS/CSS anywhere), pure-hash sticky
  assignment, fail-closed eligibility, allocation validation capped by
  `maximumExperimentTrafficPct` (a `null` limit BLOCKS in production, never
  reads as 100%), server-side resolution with exposure recorded ONCE per
  session as a first-party `experiment_exposed` event, post-exposure-only
  measurement, two-proportion z-test, and 7 explicit result states —
  "inconclusive" included. No winner below the documented minimum sample.
- CRO agent (flag `AI_CRO_AGENT`, RECOMMEND): NO tools, one structured call
  over deterministic data, registry/reference-validated proposals →
  AgentDecision → `CRO_EXPERIMENT_PROPOSAL` / `CRO_REVIEW` in the Action
  Center. Business/product problems route to REVIEW, never to a copy test
  that hides an objection.
- Launch/stop are EXPLICIT HUMAN admin actions (`/admin/experiments`),
  guardrail-evaluated, traffic-capped, idempotent, `stateVersion`-guarded
  and audited. **The guardrail executor registry stays EMPTY** — approving
  still executes nothing. Winner promotion remains a human source change.
- See docs/EXPERIMENTATION.md + docs/CRO_AGENT.md.
## Stage G — Pricing Intelligence ✅ COMPLETE (Session 12, 2026-08-15)
- `modules/pricing-intelligence` = the DETERMINISTIC pricing-analytics
  authority (no `lib/ai` import, no price-mutation path): pricing funnel
  (co-occurrence + real event ordering), the three quantity lanes preserved
  from S08, catalog-derived tier bands, MOQ intelligence kept separate from
  price, a price-realization integrity check, evidence-graded pricing
  signals, cost/margin readiness, `PricingReadiness`, and the elasticity
  refusal → ONE `PricingIntelligenceSnapshot`.
- Pricing Agent (`lib/ai/agents/pricing`, RECOMMEND): NO tools, one REASONING
  structured call, and an output schema that **cannot express a price** — no
  `proposedUnitPriceCents`, no discount, no MOQ, no optimal price. Every
  reference, product id and tier is server-validated; the cost/experiment
  prerequisites are server-recomputed → `AgentDecision` + `pricing_reports`
  → review-only actions in the Action Center.
- **Objective is NOT "expected contribution profit" yet** — and cannot be:
  `config/costs.ts` is entirely `[TO BE PROVIDED]`, so margin and profit
  impact are UNAVAILABLE and no specific price change can be shown to be
  safe. Session 12 ships the refusal, not an estimate.
- **Bounded price experiments are NOT enabled.** The experiment engine still
  cannot run price variants (docs/EXPERIMENTATION.md §24), and no
  `PRICE_CHANGE` executor exists. Both remain deferred.
- See docs/PRICING_INTELLIGENCE.md.
## Stage H1 — Google Ads READ-ONLY ✅ COMPLETE (Session 13, 2026-08-15)

Ad spend is no longer a blind spot. `lib/google-ads` reads Google Ads
reporting through `GoogleAdsService:search` and **cannot mutate anything** —
the single URL builder appends the literal `/googleAds:search`, there is no
generic `request()`, GAQL has no mutation verb, and the provider interface
has three read methods. `modules/google-ads-intelligence` turns persisted
daily snapshots into deterministic advertising analytics (Google-native
metrics, the first-party lens, EXACT/MAPPED/UNMATCHED campaign attribution
with coverage, CAC and ROAS with named denominators, the
Google-vs-first-party discrepancy view, data-quality signals) with no
`lib/ai` import, no `lib/google-ads` import and no `fetch`. The Google Ads
Agent is RECOMMEND-only, tool-free, and its output schema has no budget,
status, bid, keyword or ad field. See docs/GOOGLE_ADS_INTELLIGENCE.md.

Honest caveats carried forward: search terms and keywords are NOT ingested;
per-campaign first-party revenue depends on tracking-template coverage;
**profit on ad spend stays UNAVAILABLE** while `config/costs.ts` is
unconfigured, so revenue ROAS is never profitability.

## Stage H2 — Google Ads recommendations → approval → guarded auto (next)

Needs: real ad-spend limits in `config/guardrails.ts`
(`maximumDailyAdSpendCents`, `maximumCampaignBudgetChangePct`,
`maximumNewCampaignTestBudgetCents` — all `null` today), a separate
`GoogleAdsMutationProvider` with its own OAuth scope, the full executor
contract from docs/AI_ACTION_CENTER.md, and operating history. Until then
`AD_BUDGET_CHANGE` / `AD_PAUSE` / `AD_RESUME` / `AD_CREATIVE_TEST` stay
registered, unmapped, executor-less and limit-blocked.

## Stage I — Meta Ads     (same progression)
## Stage J — Guarded Autonomy
- With sufficient history, selectively promote low-risk actions to
  GUARDED_AUTO (small budget changes, low-risk experiments, bounded price
  tests, reorder outreach). Never automated: large refunds, legal changes,
  unsupported factory promises, major price/spend changes.

## Stage-number mapping (owner spec ↔ this roadmap)

The owner's spec numbers phases 0–17; this roadmap groups them A–J.
Same plan, two labels:

| Spec stage | Meaning | Here |
| --- | --- | --- |
| 0 | Existing system audit | A (Session 01 ✅) |
| 1 | Commerce + pricing stabilization | A remainder |
| 2 | AI data foundation | B |
| 3 | AI provider infrastructure | B |
| 4 | AI Sales Agent | C |
| 5 | AI Sales × Configurator | C |
| 6 | AI Sales × Checkout | C |
| 7 | Customer intelligence | D |
| 8 | Contribution profit + business intelligence | E |
| 9 | Guardrails + AI Action Center | E |
| 10 | Experiment engine + CRO agent | F |
| 11 | Pricing intelligence | G |
| 12–14 | Google Ads read-only → recommendations → guarded automation | H |
| 15 | Meta Ads | I |
| 16 | Advanced business decision agent | J |
| 17 | Guarded autonomous commerce | J |

## Session map (prompt pack ↔ stages)

| Session | Scope | Stage |
| --- | --- | --- |
| 01 ✅ | Audit + architecture docs | A |
| 02 | Commerce stabilization + pricing engine cost model | A |
| 03 | Data foundation (DB, events, profiles, conversations) | B |
| 04 | AI provider layer + tools + usage tracking | B |
| 05 | Sales agent core | C |
| 06 | Chat ↔ configurator sync | C |
| 07 | AI-assisted checkout end-to-end | C |
| 08 | Customer intelligence | D |
| 09 | Profit analytics + CEO agent | E |
| 10 | Guardrails + action center | E |
| 11 | Experiments + CRO agent | F |
| 12 | Pricing intelligence | G |
| 13–18 | Ads, advanced CEO, guarded autonomy | H–J |

## Anti-overbuild rules

1. Existing commerce keeps working — every session runs the storefront
   tests before finishing.
2. Data before agents; sales before marketing; recommendations before
   automation.
3. No microservices; modular monolith until scale demands otherwise.
4. No agent ships without its guardrail config and red-team tests.
5. Financially sensitive autonomy requires real operating history + human
   promotion decision.
