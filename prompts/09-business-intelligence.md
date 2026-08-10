# Session 09 — Contribution profit + CEO agent (recommendation-only)

Roadmap: Stage E (spec stage 8). Requires the Session-02 cost model to be
populated with real costs, plus real order history.

## Read first

- `CLAUDE.md`
- `docs/MASTER_PROMPT.md` §30, §33
- `docs/AI_AGENT_ARCHITECTURE.md` (per-agent spec #7)
- `modules/pricing` (cost model), `BUSINESS_CONFIG_TODO.md` (cost inputs)

## Objective

Per-order contribution profit and a daily recommendation-only business
review.

## In scope

1. Contribution-profit computation per order: revenue − manufacturing −
   printing − packaging − shipping subsidy − payment fees − discounts −
   attributed ad spend. Missing cost inputs ⇒ metric renders
   "unavailable", never a guessed number.
2. AI Sales dashboard metrics (spec §33): conversations, AI-assisted
   purchases/revenue/conversion, escalations, cost per conversation.
3. CEO agent: daily summary + ranked opportunities as `AgentDecision`
   rows. RECOMMEND mode, permanently; it can propose, never execute.
4. Admin: business-review page listing decisions with supporting metrics.

## Out of scope

Approval-center workflow (Session 10), any automated action, ads data
(that's Stage H — ad-spend attribution uses first-party data only for
now).

## Exit criteria

Contribution profit visible per order (or honestly "unavailable");
a daily review generates AgentDecision rows citing real metrics; all
checks green.

## Closeout

Update `CLAUDE.md`, roadmap, `docs/AI_AGENT_ARCHITECTURE.md`.
