# Session 03 — AI data foundation

Roadmap: Stage B (spec stage 2). Nothing AI-facing ships without this.

## Read first

- `CLAUDE.md`
- `docs/DATABASE_SCHEMA.md` (the whole plan — implement it)
- `docs/MASTER_PROMPT.md` §5–§7, §15, §31
- `lib/analytics/track.ts`, `lib/attribution/attribution.ts`,
  `types/commerce.ts`

## Objective

Add the persistence layer: database, server session identity, first-party
events, need profiles, conversations — with zero visible change to
customers.

## In scope

1. SQLite (dev) / Postgres (prod) via a TS ORM with migrations (choose
   Drizzle or Prisma here; record the decision in `docs/ARCHITECTURE.md`).
2. Tables per `docs/DATABASE_SCHEMA.md`: commerce spine (Customer,
   Business, Session, Order, OrderLine, Quote, Artwork, Configuration),
   Event, Conversation, Message, CustomerNeedProfile, AiUsage,
   AgentDecision, Approval, AgentConfig. Experiment schema may land;
   no runtime.
3. Server-minted session id (cookie) linked to attribution snapshots —
   preserve the existing first/last-touch merge semantics server-side.
4. **Event dual-write:** `track()` keeps its GA4-shaped dataLayer output
   unchanged and additionally posts to a first-party event endpoint;
   the mapping GA4 name → platform taxonomy (`view_item` →
   `product_viewed`, …) lives in one explicit table in code.
5. Orders/quotes persisted server-side at creation (mock provider too).

## Out of scope

AI provider layer (Session 04), any chat UI, admin surfaces, deleting
localStorage behavior (client stays as cache).

## Exit criteria

Events queryable in the DB; a conversation row can be created and read
back; storefront behavior unchanged; all checks green; migrations
reversible.

## Closeout

Update `CLAUDE.md`, `docs/DATABASE_SCHEMA.md` (planned → implemented
status per table), `docs/ARCHITECTURE.md`.
