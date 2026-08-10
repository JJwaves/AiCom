# Session 08 — Customer intelligence engine

Roadmap: Stage D (spec stage 7). Requires Stage C in production long
enough to have real conversations/quotes/orders.

## Read first

- `CLAUDE.md`
- `docs/AI_AGENT_ARCHITECTURE.md` (per-agent spec #2)
- `docs/MASTER_PROMPT.md` §16–§17
- `docs/DATABASE_SCHEMA.md` (Insight model)

## Objective

`/modules/customer-intelligence`: recurring questions, objections, demand
signals, and lost opportunities — every insight traceable to real rows.

## In scope

1. Aggregations over conversations, quotes, orders, abandoned
   configurations: top questions, objections, requested quantities /
   colors / sizes, industries, shipping/MOQ/price concerns, requested
   products we do not sell.
2. LOW_COST model classification where needed; counts come from data, not
   the model. Minimum-sample thresholds before a pattern is claimed.
3. `Insight` rows with `sourceRefsJson`; weekly generation (manual
   trigger acceptable first).
4. `/admin/customer-intelligence` — first admin surface; ships with admin
   auth (decide the auth approach here; record it in
   `docs/ARCHITECTURE.md`). Real data only; demo data visibly labeled.
5. Flag `AI_CUSTOMER_INTELLIGENCE`.

## Out of scope

Acting on insights (pricing/ads/CRO), CEO agent, contribution profit.

## Exit criteria

A weekly report renders from real stored data with drill-through to
sources; nothing fabricated; all checks green.

## Closeout

Update `CLAUDE.md`, `docs/ARCHITECTURE.md` (admin auth decision), roadmap.
