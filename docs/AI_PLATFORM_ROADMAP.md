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

## Stage E — AI Business Intelligence
- Contribution-profit analytics (needs Stage A cost model):
  revenue − manufacturing − printing − packaging − shipping subsidy −
  payment fees − discounts − attributed ad spend
- CEO agent: recommendation-only daily business review
- AI Action Center (`/admin/ai-actions`) + full guardrail evaluation path
Exit: AgentDecision → human approval loop operating.

## Stage F — CRO
- Experiment engine (model from DATABASE_SCHEMA.md; flag
  `EXPERIMENT_ENGINE`); exposure as first-party events
- CRO agent proposes experiments; human approval to launch; no
  insufficient-sample winners
## Stage G — Pricing Intelligence
- Pricing agent (RECOMMEND) analyzing price↔conversion↔margin↔segment;
  objective = expected contribution profit; bounded price experiments only
  within guardrails
## Stage H — Google Ads   (read-only → recommend → approval → guarded auto)
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
