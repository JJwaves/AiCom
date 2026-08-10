# Session 07 — AI Sales × Checkout end-to-end (§44 milestone)

Roadmap: Stage C (spec stage 6). Requires Sessions 02, 05, 06.

## Read first

- `CLAUDE.md`
- `docs/MASTER_PROMPT.md` §44 (the flow this session must complete)
- `docs/AI_AGENT_ARCHITECTURE.md` (conversation flow, escalation)
- `lib/commerce/`, the Session-02 server re-quote route

## Objective

The first full AI-assisted purchase: conversation → recommendation →
configuration → logo → deterministic price → cart → checkout → order,
with the conversation and profile linked to the order.

## In scope

1. `addConfiguredProductToCart` tool — server re-quotes at add time (the
   Session-02 route is the authority); AI explains the price, never
   creates it.
2. Artwork-upload step reachable from chat (reuses the existing uploader
   + validation).
3. Checkout handoff through the existing `CommerceProvider` — AI never
   talks to Shopify directly.
4. Order linked to conversationId + CustomerNeedProfile;
   `aiAssisted: true` recorded; purchase + `ai_*` first-party events.
5. Human escalation path live end-to-end (summary handoff — customer
   never repeats themselves).
6. Automated test of the §44 flow against the mock provider.

## Out of scope

Real Shopify store setup, payment changes, dashboards.

## Exit criteria

§44 flow demonstrated (mock provider) with the order row referencing the
conversation; AI-assisted attribution recorded; red-team suite still
green; all checks green.

## Closeout

Update `CLAUDE.md` (Stage C complete), roadmap status,
`docs/AI_AGENT_ARCHITECTURE.md`.
