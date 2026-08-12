# AI_COMMERCE_INTEGRATION

Session 07 — AI Sales × Cart / Checkout. This document is authoritative for
the AI-assisted add-to-cart and checkout-handoff capability.

## Cart authority

The cart itself did not move: it lives client-side (`bd_cart_v1`
localStorage, `lib/cart/cart-context.tsx`), and `/api/checkout` remains the
single re-quoting authority over whatever the browser proposes (Session 02,
unchanged). Session 07 adds the AI as a way to REQUEST validated cart
operations — never a second cart, never a second commerce path:

```text
Customer intent ("add it to my cart" / Add-to-cart button / "checkout")
      ↓
AI Sales Agent (intent only)
      ↓
Typed COMMERCE tool  ──or──  /api/cart/line (tapped chip)
      ↓
lib/commerce/cart-line.ts — ONE server validation path:
  authoritative shared configuration (S06 row) at expectedRevision
  → add-to-cart legality (artwork, custom-quote) — same rules as the manual button
  → deterministic engine re-quote; expectedTotalCents is drift detection ONLY
      ↓
server-validated line → client applies via the SAME useCart().addLine
the manual configurator uses
      ↓
existing cart page / shared submitCartCheckout → /api/checkout re-quote
      ↓
CommerceProvider checkout (mock order · Shopify redirect)
```

An AI-added line and a manually-added line are equivalent by construction
(same config shape, same engine prices, same optionSummary format —
asserted in tests). The cart page renders them identically.

## AI commerce tools (sales registry, 11 → 15)

- **`addConfiguredProductToCart`** (COMMERCE) — add the session's CURRENT
  authoritative configuration. Input is STRICT and price-free in effect:
  `productId`, `expectedRevision` (the revision the model last read),
  `expectedTotalCents` (the total the customer was last shown — drift
  detection only, mirroring checkout's proposed prices; it confers no
  authority). Outcomes: `added` (validated line + engine price),
  `price_changed` (both totals; requires fresh customer confirmation),
  `stale_configuration` (current state returned; reconcile),
  `artwork_required`, `custom_quote_required`, `not_configured`,
  `unknown_product`. Emits `ai_add_to_cart_requested` (props: via, outcome)
  and stamps conversation outcome `cart_added` on success.
- **`suggestAddToCart`** (READ — writes nothing) — offer an "Add to cart"
  button at the validated current price. The tap POSTs `/api/cart/line`,
  which re-validates against the THEN-current configuration. Emits
  `ai_add_to_cart_proposed`.
- **`getCartSummary`** (READ) — engine-priced view of the client-reported
  cart snapshot: lines, quantities, current prices, subtotal, per-line
  issues, `checkoutReady`. Honest `available:false` when the snapshot is
  absent. No cost/margin/provider fields exist in the schema.
- **`startCheckout`** (COMMERCE) — validates cart readiness and surfaces a
  "Continue to checkout" action the CUSTOMER confirms. Input schema is the
  empty strict object: the model cannot construct checkout contents,
  amounts, or destinations. Outcomes: `ready`, `cart_empty`, `blocked`
  (per-line issues), `cart_unavailable`. Emits `ai_checkout_requested`.

Sales agent permissions are now READ + CUSTOMER_WRITE + COMMERCE.
FINANCIAL_RESTRICTED / ADMIN_RESTRICTED remain granted to nobody, and
customer-facing registries still refuse them structurally.

## Explicit confirmation rules

- **Add to cart** requires the customer's own explicit request ("add it to
  my cart", "yes, add it", "let's buy this"). Interest, approval ("looks
  good"), and price questions never count — the prompt (v1.2.0) states the
  policy with examples, and the no-side-effect alternative
  (`suggestAddToCart` → button the customer taps) is always available.
  "Add it and take me to checkout" counts for both steps in one turn.
- **Checkout** requires explicit customer initiation ("checkout", "let's
  pay") AND a customer tap on the rendered "Continue to checkout" action —
  the model's tool call only validates and offers; the click executes.
  With the mock provider a checkout IS an order, so this tap-to-confirm is
  a hard rule, not a courtesy.
- Every commerce mutation is auditable back to a customer message (tool
  rows + `structuredJson` on the assistant message) or a customer tap
  (`/api/cart/line` request + events). There is no autonomous path: tools
  execute only inside a customer-initiated chat turn, and chips execute
  only on click.

## Repricing (409 REPRICED preserved end-to-end)

- Tool path: `expectedTotalCents` ≠ fresh engine total ⇒ `price_changed`,
  nothing added; the agent must state the new price and may retry only
  with the customer's confirmation (new expectedTotalCents).
- Chip path: `/api/cart/line` answers 409 REPRICED with the current price;
  the chip re-renders as "Price updated: was $X, now $Y — Add at $Y" and
  requires a second tap.
- Checkout path: the shared `submitCartCheckout` surfaces `/api/checkout`'s
  409 REPRICED; the chat corrects the cart lines to the server's numbers
  and renders "Prices were updated … Confirm & continue at $Y" — the same
  semantics as the cart page's error + re-confirm flow. Nothing is ever
  auto-accepted at a changed price, anywhere.

## Stale-configuration protection

`expectedRevision` extends the S06 revision guard to commerce: an add based
on a configuration the customer has since changed writes nothing and
returns the current state for reconciliation (`stale_configuration` /
409 STALE_CONFIGURATION). Chips carry `basedOnRevision`; taps re-validate.

## Cart state back to the agent

The cart is client-side, so the chat POST body carries a bounded, STRICT,
**price-free** snapshot (`{lines: [{lineId, productId, sizeId, materialId,
colorId, printOptionId, quantity, hasArtwork}]}`, ≤50 lines) — client-sent
prices are a loud 422, never data. The server re-prices the snapshot with
the engine for the agent's context block ("Cart (N lines): … $X (DEMO
pricing)") and for `getCartSummary`/`startCheckout`. It is untrusted client
state at exactly the trust level of the localStorage cart it mirrors;
`/api/checkout` re-quotes before any order exists. The snapshot travels
into tools via the server-minted `ToolExecutionContext` — the model cannot
supply one.

## Checkout & payment boundary

- `startCheckout` produces a signal; the client executes the SAME
  `submitCartCheckout` module the cart page uses (extracted in S07 — one
  client submission path). The checkout destination is exclusively what
  `/api/checkout`/the provider returns; no model output can carry a URL
  (no tool input accepts one — injection tests pin this).
- The AI never sees payment data, cannot mark orders paid, cannot refund,
  capture, discount, or alter shipping/tax — no such tools exist
  (capability boundary), and the Shopify Admin API remains unreachable
  from the agent (Storefront-side `CommerceProvider` only).
- Purchase events: `purchase_completed` is written ONLY by the
  authoritative order-creation path (mock order creation today; Shopify
  webhooks later). AI add-to-cart and checkout-handoff creation never fire
  it (tested).

## AI-assisted attribution (conservative)

`lib/data/ai-assistance.ts` defines material assistance deterministically:
the session has a sales conversation AND at least one of
`ai_product_recommended`, `ai_configuration_updated`,
`ai_add_to_cart_requested`, `ai_checkout_requested`. At order creation,
`/api/checkout` stamps `orders.aiAssisted` (true only under that
definition) and links `orders.conversationId` to the latest sales
conversation whenever one exists (intelligence linkage even when
assistance wasn't material); `purchase_completed` carries an `aiAssisted`
prop. A loaded chat widget — or chat that never touched commerce — is NOT
an AI-assisted sale. The detailed breakdown (what assisted, when) stays
derivable from the `ai_*` events joined on conversationId; it is
deliberately not duplicated onto the order row.

## Conversation outcomes

`cart_added` joins the outcome set. Funnel ranking prevents downgrades:
`purchased` > `checkout_started` > `cart_added`/`quote_started` (the last
two share a rank as parallel paths). Escalated conversations keep their
escalated outcome. `checkout_started`/`purchased` stamping from the
checkout/quote routes is unchanged (S06).

## First-party events

New taxonomy names: `ai_add_to_cart_proposed`, `ai_add_to_cart_requested`
(props: via `conversation|chip`, outcome), `ai_checkout_requested` (props:
outcome). Completions ride the GENERIC commerce events with AI metadata —
`add_to_cart` gains an optional `addedVia: "ai_chat"` prop and
`checkout_started` an optional `trigger: "ai_chat"` prop (GA4 dataLayer
output unchanged when absent). No `purchase` changes.

## UI

`PackagingExpertChat` renders only server-validated payloads: "✓ Added to
your cart" confirmation (line summary + engine total + demo label + View
cart link), "Add to cart" offer chips (idle/applying/added/repriced/stale/
blocked states), and the "Continue to checkout · $X" action with its
visible repriced-confirmation state. All chips are real buttons (keyboard
accessible, disabled/loading states, `role="status"` announcements inside
the existing `aria-live` log). Mobile keeps the S06 offsets — panel and
launcher clear the sticky Add-to-Cart bar. The cart page itself is
unchanged; AI-added lines are indistinguishable from manual ones.

## Failure behavior

- AI off/unavailable: no launcher; manual configurator → cart → checkout
  byte-identical to pre-AI behavior (browser-verified with flags off).
- Provider down mid-conversation: the S05 single customer-safe sentence;
  manual commerce unaffected.
- `/api/cart/line` failures are structured (409/422/404/503 with codes);
  chips degrade to honest copy ("no longer matches", "needs a logo file"),
  and raw provider/internal errors never reach the client.
- Cart snapshot malformed or oversized ⇒ loud 422 (STRICT schema); absent
  ⇒ the agent says the cart isn't visible instead of guessing.

## Security (tested)

- No tool input carries a price the server honors, a discount, a config
  object, artwork, or a URL — STRICT schemas reject injected keys loudly
  (`unitPriceCents`, `discountPct`, `config`, `url` → `invalid_input`).
- `markOrderPaid` / `applyDiscount` / `capturePayment` / `createCheckout`
  (direct provider construction) / `setShippingCost` / `setTax` do not
  exist — `unknown_tool` with zero side effects (red-team tests).
- "Add this for $1" ⇒ the server re-quote wins (`price_changed`); "use
  this checkout URL" ⇒ no field to travel in; "skip shipping and tax" ⇒
  impossible (checkout provider owns both; the prompt says "calculated at
  checkout").
- Contexts (session id, cart snapshot) are server-minted; cross-session
  state is unreachable (route tests).

## Tests

`tests/cart-line.test.ts` (prepare statuses, manual-equivalence,
`/api/cart/line` HTTP contract + strict-body injection, outcome ranking,
aiAssisted attribution + purchase-event props) and
`tests/ai-cart-tools.test.ts` (all four tools incl. permission tiers +
injection red-team, §35/§44 conversational flow, weak-language no-op,
suggested-action lift, cart context injection, chat-route wire + strict
cart snapshot). Plus updated toolset/permission assertions in the S04–S06
suites. 352 tests total, no network, FakeAiProvider only.

## Verification (2026-08-11)

352 vitest tests, typecheck, lint, production build. Browser-verified on
`next dev` (desktop + 375 px mobile) with a scripted local mock of the
provider Messages API (`ANTHROPIC_BASE_URL`; zero real credentials, zero
app-code changes, `.env.local` removed after): chat configure → "Add it to
my cart." → "✓ Added to your cart" chip + cart badge + identical cart-page
line; "add at the old price" → price_changed relayed, nothing added;
"Checkout please" → "Continue to checkout · $3,700.00 (demo)" → tap →
order confirmation (server-priced); tampered cart price → visible
"Prices were updated … Confirm & continue at $3,700.00" → corrected order;
mobile flow without overlap; provider-down single-sentence fallback with
manual commerce untouched; flags-off manual two-line order (AI line
preserved next to manual line, $7,400).
