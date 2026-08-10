# Session 06 — AI Sales × Configurator (one shared state)

Roadmap: Stage C (spec stage 5). Requires Session 05.

## Read first

- `CLAUDE.md`
- `docs/CURRENT_SYSTEM_AUDIT.md` (risk 6 + REFACTOR "Configurator state")
- `docs/ARCHITECTURE.md` (invariant 1)
- `docs/MASTER_PROMPT.md` §10
- `components/product/ProductConfigurator.tsx`

## Objective

ONE authoritative product-configuration state shared by the configurator
UI and the AI — never two copies.

## In scope

1. **Extract configurator state** from the six component-local `useState`
   hooks into a validated store/reducer (same option rules, MOQ checks,
   artwork requirements). The UI dispatches to it; behavior and analytics
   events stay identical. This is a refactor of the existing component,
   not a rebuild.
2. `getCurrentConfiguration` / `updateConfiguration` tools operate on that
   same store (server-validated against the catalog; invalid updates
   rejected with a reason the agent can relay).
3. Bidirectional sync: chat "5,000 large black bags" updates the visible
   configurator; a manual quantity change is visible to the agent on its
   next turn.
4. Recommendation UI: agent-proposed product/config renders as a card the
   customer can apply.
5. Mobile: chat surface must not cover configurator controls or the
   sticky CTA (spec §34).
6. Tests: reducer validation rules; AI-update → state → price recompute.

## Out of scope

Checkout via chat (07), new product features, visual redesign.

## Exit criteria

"I need 5,000 large black bags with my logo" configures the real UI;
manual edits round-trip back to the agent; storefront unchanged with the
flag off; all checks green.

## Closeout

Update `CLAUDE.md`, `docs/ARCHITECTURE.md`, audit REFACTOR status.
