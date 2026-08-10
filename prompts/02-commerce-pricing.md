# Session 02 — Commerce stabilization + deterministic pricing engine

Roadmap: Stage A remainder (spec stage 1). Prerequisite for everything.

## Read first

- `CLAUDE.md`
- `docs/CURRENT_SYSTEM_AUDIT.md` (risks 2, 3, 7; REFACTOR list)
- `docs/MASTER_PROMPT.md` §12–§14
- `lib/pricing/engine.ts`, `lib/commerce/`, `app/cart/page.tsx`,
  `tests/pricing.test.ts`

## Objective

Make pricing server-authoritative and give the engine a cost model —
without changing the engine's existing tested math or breaking the
storefront journey.

## In scope

1. **Server-side checkout re-quote.** A server route re-prices every cart
   line with the deterministic engine before any checkout/order is
   created. The browser proposes; the server disposes. Mock provider
   included.
2. **Cost model + margins** in a `modules/pricing` boundary that wraps and
   reuses the existing engine: manufacturing / material / printing /
   setup / packaging / shipping-basis / payment-fee inputs as explicit
   `[TO BE PROVIDED]` config placeholders (NEVER invented numbers);
   outputs extended with totalCost, grossProfit, grossMargin,
   contributionMargin, `minimumAllowedPrice`. With costs unset, margin
   outputs report "unavailable" and price guardrails fail closed.
3. **Catalog reads through the provider.** Replace the 8 direct
   `config/products` imports (audit risk 7) with `getCommerce()` calls or
   a thin catalog module backed by it; fix the stale mock-fallback comment
   in `lib/commerce/shopify.ts` (or implement the described fallback).
4. Extend unit tests: re-quote route, cost/margin math, fail-closed
   behavior.

## Out of scope

Database, AI anything, Shopify variant mapping (needs a real store), UI
redesign.

## Exit criteria

Journey (configure → cart → checkout → confirmation) green; checkout
totals come from the server; margin outputs exist but visibly
"unavailable" until real costs are configured; all checks green.

## Closeout

Update `CLAUDE.md` + `docs/ARCHITECTURE.md` (+ audit REFACTOR items done).
