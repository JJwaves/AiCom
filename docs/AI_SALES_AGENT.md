# AI_SALES_AGENT

The customer-facing **AI Packaging Expert** (Session 05) — the first real
agent on the Session 04 runtime. It helps restaurants/cafes choose custom
insulated takeout bags: understands needs, answers supported product
questions, recommends products, explains engine-computed pricing, and
escalates to a human when a request can't be safely handled.

**It is a sales assistant for BagDirect products, not a generic
assistant** — and it has zero business authority: every price comes from
`modules/pricing`, every capability claim from catalog data, every write
from a permission-scoped tool. The LLM provides intelligence; the
application provides authority.

Everything is OFF by default: the surface requires `AI_RUNTIME_ENABLED=true`
**and** `AI_SALES_ENABLED=true` **and** a provider key. With any of them
missing, the storefront renders no chat UI, the API answers a clean 503,
and commerce is completely unaffected.

## Architecture

```
Customer message (UNTRUSTED)                    app/api/ai/chat  (POST)
  → body/message caps → session from bd_sid cookie (server-resolved)
  → per-session + per-IP token buckets
  → runSalesAgentTurn                           lib/ai/agents/sales/agent.ts
      → conversation resolve/create             lib/data/conversation-service
      → persist user message (raw transcript)
      → context assembly (profile + summary
        + live shared configuration — S06
        + engine-priced cart snapshot — S07)    lib/ai/agents/sales/context.ts
      → versioned prompt ai_sales_agent v1.2.0  lib/ai/prompts/registry.ts
      → AiRuntime.runToolConversation (STANDARD workload, loop limits)
          → sales tool registry (15 tools, READ/CUSTOMER_WRITE/COMMERCE)
      → persist tool rows + assistant message
      → evidence-validated need extraction      lib/ai/agents/sales/extraction.ts  (LOW_COST, non-fatal)
      → threshold summarization                 lib/ai/agents/sales/summarize.ts   (LOW_COST, non-fatal)
  → normalized JSON (reply + structured signals) — client never parses prose
```

No Anthropic-specific logic exists in the agent layer; tests drive the
whole stack with `FakeAiProvider` and zero network.

## Tools available to the Sales Agent (complete list)

| Tool | Permission | Effect |
| --- | --- | --- |
| `searchProducts` / `getProductDetails` | READ | catalog truth (incl. handle `confirmed` flags) |
| `calculatePrice` / `getQuantityPricing` | READ | deterministic engine delegation; output schemas structurally exclude cost/margin/floor |
| `getShippingEstimate` | READ | honest estimator ("calculated at checkout" until rates configured) |
| `saveCustomerNeed` | CUSTOMER_WRITE | need-profile write, hard-coded `AI_INFERRED` provenance |
| `recommendProduct` (S05) | READ | catalog-validated recommendation → structured signal + `ai_product_recommended` event; hallucinated ids are rejected |
| `requestHumanHelp` (S05) | CUSTOMER_WRITE | structured handoff record + conversation escalated + `human_handoff_requested` event |
| `getCurrentConfiguration` (S06) | READ | the session's live shared configuration (labels, quantity, artwork status, revision, engine price) — customer-visible fields only |
| `updateConfiguration` (S06) | CUSTOMER_WRITE | COMMIT a customer-requested partial patch through the shared validation path; structured rejection with alternatives; revision-checked (stale writes impossible); `ai_configuration_updated`/`_rejected` events |
| `suggestConfigurationUpdate` (S06) | READ | PROPOSE a validated+priced change without committing — becomes an apply chip in the chat; `ai_configuration_proposed` event |
| `addConfiguredProductToCart` (S07) | COMMERCE | add the AUTHORITATIVE configuration to the cart on explicit customer request; server re-validates + re-prices; `price_changed`/`stale_configuration`/`artwork_required`/`custom_quote_required` are structured; `ai_add_to_cart_requested` event + `cart_added` outcome |
| `suggestAddToCart` (S07) | READ | offer an "Add to cart" button at the validated current price; the tap re-validates via `/api/cart/line`; `ai_add_to_cart_proposed` event |
| `getCartSummary` (S07) | READ | engine-priced view of the client-reported cart snapshot (lines, subtotal, per-line issues, checkout readiness) — honest "unavailable" without a snapshot |
| `startCheckout` (S07) | COMMERCE | validate cart readiness and surface a customer-confirmed "Continue to checkout" action; empty strict input — no contents/amounts/URLs can be constructed; `ai_checkout_requested` event |

Configuration tools are the AI's ONLY channel into the configuration and
run through the exact server path the visual configurator uses — see
AI_CONFIGURATOR_INTEGRATION.md (authoritative for the shared state).
Cart/checkout tools are intent-only and covered by
AI_COMMERCE_INTEGRATION.md (authoritative for the commerce boundary).
Sales permissions since S07: READ + CUSTOMER_WRITE + COMMERCE.

Not present in any customer-facing registry, ever: `modifyPrice`,
`issueRefund`, `changeAdBudget`, `createAdCampaign`, `modifyMargin`,
`modifyProductManufacturingRules`, `adminDatabaseQuery`, `createCheckout`
(direct provider checkout construction), `applyDiscount`, `markOrderPaid`,
`capturePayment`, `setShippingCost`, `setTax`.
`createSalesToolRegistry()` refuses to construct with a
FINANCIAL_RESTRICTED/ADMIN_RESTRICTED tool present. Injection defenses are
capability-based and unit-tested (`tests/ai-sales-agent.test.ts`,
`tests/ai-cart-tools.test.ts`).

## Conversation lifecycle

- One **active** sales conversation per session (`findActiveConversation`):
  status `active` or `escalated` resumes; `ended` never resumes.
- Every user message, assistant reply, and tool call persists as Message
  rows (raw transcript preserved verbatim). Assistant rows carry model,
  prompt id, turn status, and tool-call outcomes in `structuredJson`.
- `system` rows (the escalation handoff records) and `tool` rows **never
  reach client APIs** — GET history returns user/assistant rows only.
- Escalation marks the conversation `status=escalated, outcome=escalated`
  WITHOUT ending it: the customer keeps chatting in the same thread while a
  human follows up. `endConversation` remains the terminal transition.
- (S06/S07) Commerce outcomes stamp WITHOUT ending:
  `markConversationOutcomeForSession` sets `quote_started` / `cart_added`
  (S07) / `checkout_started` / `purchased` on the session's active sales
  conversation; funnel ranking (`purchased` > `checkout_started` >
  `cart_added`/`quote_started`) prevents downgrades and escalated
  outcomes are preserved. `abandoned` remains unwired (needs a
  session-expiry sweep, future session).
- (S06) Assistant messages carry `configSnapshotJson` — the shared
  configuration as of each AI-committed configuration change; (S07) their
  `structuredJson` also flags `cartAdded`/`checkoutProposed` turns.
- First-party events: `ai_chat_started` (conversation creation),
  `ai_message_sent` (per turn, with status/tool-count props — never
  transcript content), `ai_product_recommended`, `human_handoff_requested`,
  (S07) `ai_add_to_cart_proposed` / `ai_add_to_cart_requested` /
  `ai_checkout_requested`. Raw chat stays in Conversation/Message
  persistence, not analytics props.

## Sales prompt

`ai_sales_agent` **v1.2.0** in `lib/ai/prompts/registry.ts` — identity,
progressive-discovery sales behavior, truthfulness rules (confirmed-only
capabilities, no fabricated materials/dimensions/certifications/dates/
sustainability claims/reviews/prices, DEMO pricing labeled), pricing-tool
authority, escalation triggers, and injection posture. v1.1.0 (S06) adds
the shared-configuration rules: read before acting, COMMIT ("make it
10,000") vs PREVIEW ("what would 10,000 cost?") distinction, apply small
clearly-requested changes immediately but preview + propose
(suggestConfigurationUpdate) for changes with substantial cost impact the
customer hasn't confirmed, never change unrequested fields, relay
structured rejection alternatives, reconcile on stale_revision, and
artwork only via the configurator's uploader. v1.2.0 (S07) adds the cart &
checkout contract: explicit-intent-only for `addConfiguredProductToCart` /
`startCheckout` (with counted examples and non-examples), reprice
confirmation before any retry, stale reconciliation, artwork/custom-quote
routing, "add it and take me to checkout" as dual intent, cart questions
via `getCartSummary` (never guessed), duplicate-add honesty, and
"shipping and taxes are calculated at checkout" as the only permitted
shipping/tax language. One `{{context}}` variable carries the
server-assembled customer context. Any semantic change bumps the version;
AiUsage rows stamp prompt id+version on every call.

Confirmation policy note: no owner-configured cost-impact thresholds exist
yet, so the policy is behavioral (preview-first for clearly
price-changing alternatives) — thresholds are a BUSINESS_CONFIG_TODO item.

## Customer context (what the model sees)

`buildSalesContext` renders, bounded to ~3.2k chars (raised from 2.4k in
S07 for the cart block): the conversation's product, (S06) the session's
LIVE shared configuration ("Current configuration (live, revision N): … —
never ask them to repeat it"), (S07) the client-reported cart snapshot
re-priced by the engine ("Cart (N lines): …" / "Cart: empty." — never
client-sent prices), the session's CustomerNeedProfile fields **with
provenance labels** ("customer-stated" vs "our guess" — the model is told
which facts are verified), and the rolling conversation summary.
Structurally excluded: other sessions/customers, admin data, secrets,
cost/margin figures, provider credentials.

## CustomerNeedProfile extraction — USER_STATED vs AI_INFERRED

Two separate write paths, by design:

1. **`saveCustomerNeed` tool** (model-initiated, mid-conversation):
   provenance hard-coded `AI_INFERRED`. The model cannot claim USER_STATED
   through any tool input.
2. **Server-side evidence-validated extractor** (`extraction.ts`, runs
   after each turn on the LOW_COST tier): the model proposes candidates
   `{field, value, kind, evidence, confidence}`; **the server decides
   provenance**. USER_STATED requires ALL of:
   - kind `stated` with quoted evidence,
   - the evidence occurs verbatim in the customer's actual message
     (whitespace/case-normalized) — **fabricated quotes are dropped
     entirely**, not demoted,
   - the value is consistent with the evidence (strings appear in it;
     numbers must equal a complete number in it, grouping-tolerant —
     "5,000" states 5000, never 500; booleans need the field's topic
     keyword),
   - the value passes the field's zod schema,
   - the field is not judgment-only (`priceSensitivity`/`purchaseIntent`
     are always AI_INFERRED).
   Honest interpretations demote to AI_INFERRED; hedged numbers ("about
   5,000") demote too — vague quantities never become authoritative
   USER_STATED numbers (S03 doctrine). Unknown stays unknown: sparse
   messages produce sparse profiles.

Underneath both paths, `applyNeedProfileUpdate`'s provenance rank gate
(USER_STATED > ORDER_DATA > CONFIGURATOR > SYSTEM_DERIVED > AI_INFERRED)
remains the final authority: equal rank + newer wins, weaker never
overwrites stronger.

### Concurrency (S05 prerequisite fix)

`applyNeedProfileUpdate` now runs in a transaction holding
`SELECT … FOR UPDATE` on the profile row, serializing concurrent writers
(AI extraction, the saveCustomerNeed tool, checkout ORDER_DATA enrichment,
quote-form writes). Chosen over optimistic version-retry (same guarantee
plus a retry loop, for a low-contention per-session row) and over pure-SQL
jsonb merging (would fork the tested TS rank-gate logic into SQL). Creation
races resolve via the sessionId unique index + `ON CONFLICT DO NOTHING` +
re-lock. On PGlite (dev/test) transactions serialize on the single
connection — same guarantee, coarser. Proven by
`tests/need-profile-concurrency.test.ts`.

## Human escalation

`requestHumanHelp` builds a structured handoff — reason (enum), requirement
summary, the customer's open question, voluntarily-supplied contact info,
session/conversation/product refs, and a need-profile snapshot — persisted
as a `system` message row, so the customer never repeats themselves. The
conversation is marked escalated, `human_handoff_requested` is recorded,
and the server logs `escalation_requested` loudly.

**Delivery is deliberately deferred**: routing to a real inbox/Slack/CRM is
owner configuration (BUSINESS_CONFIG_TODO "escalation destination"). Until
configured, handoffs are queryable in the DB (`messages` where
`role='system'` and `structuredJson->>'kind'='human_handoff'`).

## Chat API (`app/api/ai/chat`)

- **POST** `{message, cart?}` (message 1–2000 chars; body ≤16 KB). The
  client supplies NOTHING else authoritative — session identity is the
  httpOnly `bd_sid` cookie; customerId/agentType/permissions/conversation
  are server-resolved. `cart` (S07) is the STRICT, bounded, price-free
  snapshot of the client-side cart (ids + quantities + hasArtwork, ≤50
  lines) — client-sent prices are a loud 422; the server re-prices with
  the engine. Responses:
  `200 {ok, conversationId, reply, status, recommendedProductId?,
  recommendedProductPath?, configurationUpdate?, suggestedActions?,
  cartAdd?, checkoutAction?, needsHuman, handoffReason?,
  conversationStatus}` — `configurationUpdate` (S06) is the
  SERVER-VALIDATED committed configuration the client applies to the
  shared store; `suggestedActions` are validated
  APPLY_CONFIGURATION_PATCH / ADD_TO_CART proposals; `cartAdd` (S07) is
  the server-validated engine-priced cart line the client adds through
  `useCart().addLine`; `checkoutAction` (S07) is the validated
  CONTINUE_TO_CHECKOUT offer the customer confirms — never model prose. ·
  `400/413/422` validation · `429 {code:RATE_LIMITED}` (+Retry-After) ·
  `503 {code:AI_UNAVAILABLE}` with fixed customer-safe copy for EVERY
  AI-side failure (flags off, no key, provider down/timeout/rate-limited,
  budget exceeded, invalid output) — provider internals never cross the
  boundary (codes go to server logs).
- **GET** — history of the session's current conversation, user/assistant
  rows only; never mints a session.

## Rate protection

Two in-memory token buckets (`lib/rate-limit.ts`): per-session 6 burst /
6 per minute, per-IP 20 burst / 20 per minute (catches cookie-dropping
clients). **Per-instance only — this is an application guard, not a
distributed limiter.** Production requirement (LAUNCH_CHECKLIST): put
robust rate limiting at the deployment edge (platform/CDN/WAF). The AI
budget guard (`AI_DAILY_BUDGET_USD`/`AI_MONTHLY_BUDGET_USD` + filled
`config/ai-pricing.ts`) remains the hard spend backstop underneath.

## UI

`components/ai/PackagingExpertLauncher.tsx` (server gate — renders nothing
unless both flags + key present) → `PackagingExpertChat.tsx` (client):
floating "Ask Our Packaging Expert" button, panel with history, quick-start
prompts, loading/error/retry states, escalation banner, recommendation
link chip ("Configure this bag →"), Escape-to-close, `role="log"`
aria-live transcript, labeled input, mobile-width layout. Positioned as a
packaging expert — never "AI chatbot".

S06 additions: committed updates render a "✓ Configurator updated" chip
(changeSummary + engine total, "(demo pricing)" labeled) and publish the
server-validated payload on the configuration sync bus (the configurator
applies, highlights, and announces via aria-live); proposals render apply
chips that POST through `/api/configuration` (server revalidation; stale →
honest "no longer matches" copy; off-page applies link to the
configurator). When a configurator is mounted, the mobile launcher and
panel lift above the sticky Add-to-Cart bar so the CTA is never covered.

S07 additions: server-validated `cartAdd` payloads apply through the SAME
`useCart().addLine` the manual configurator uses and render a "✓ Added to
your cart" chip (line summary, engine total, demo label, View cart link);
"Add to cart" offer chips re-validate at tap time via `/api/cart/line`
with visible repriced ("Price updated … Add at $Y") / stale / blocked
states; the "Continue to checkout · $X" action runs the shared
`submitCartCheckout` path and shows the REPRICED confirmation ("Prices
were updated … Confirm & continue at $Y") before any resubmission. Every
chip is a real button with loading/disabled states and `role="status"`
announcements. Details: AI_COMMERCE_INTEGRATION.md.

## Failure behavior

| Failure | Customer experience |
| --- | --- |
| Flags off / no key | No UI at all; API 503 with fallback copy |
| Provider down / timeout / provider rate limit / budget exceeded | 503 + "Our packaging assistant is temporarily unavailable. You can still configure and order your bags directly." |
| Loop limit hit | Safe "couldn't finish" reply; partial tool batch never half-executes |
| Invalid structured output (extraction) | Reply unaffected; extraction skipped, loudly logged |
| Summarization failure | Reply unaffected; summary skipped, loudly logged |
| DB telemetry failure (events/usage rows) | Reply unaffected; loud logs |
| Conversation persistence failure | 503 fallback (chat needs its transcript); commerce unaffected |

## Metrics foundation (S05 groundwork, no dashboard)

Countable today: conversations (`conversations`), conversations reaching
recommendation/pricing (events `ai_product_recommended` / tool rows for
`calculatePrice`), handoffs (`human_handoff_requested` + escalated
conversations), per-conversation AI cost (`ai_usage.conversationId`,
priced once `config/ai-pricing.ts` is filled). S07 adds real AI-assisted
commerce attribution: `orders.aiAssisted` + `orders.conversationId` under
the conservative material-assistance definition
(AI_COMMERCE_INTEGRATION.md), the `ai_add_to_cart_*` /
`ai_checkout_requested` funnel events, and `cart_added` conversation
outcomes. Still no dashboard — deliberate.

## Testing

`tests/need-profile-concurrency.test.ts` (locking),
`tests/ai-extraction.test.ts` (evidence validation, adversarial
fabrication, contradiction, over-infer resistance),
`tests/ai-sales-agent.test.ts` (lifecycle, context/history continuity,
recommendation/escalation signals, prompt injection, loop limits,
disabled/failure/budget, summarization),
`tests/ai-chat-route.test.ts` (validation, gating, rate limits, error
normalization, history filtering, S06 wire signals),
`tests/rate-limit.test.ts`; S06 adds
`tests/configuration-store.test.ts` (validation + reducer),
`tests/configuration-route.test.ts` (sync/apply/restore/provenance),
`tests/ai-configuration-tools.test.ts` (the three tools + security
red-team), and the "shared configuration flow" suite in
`tests/ai-sales-agent.test.ts` (commit/suggest/stale/red-team turns); S07
adds `tests/cart-line.test.ts` (server cart-line preparation, `/api/cart/
line`, outcome ranking, aiAssisted attribution) and
`tests/ai-cart-tools.test.ts` (four commerce tools + injection red-team,
§44 conversational flow, chat-route wire).
All FakeAiProvider — zero credentials, zero network. The optional live
check is `npm run ai:smoke` (credential-gated, verifies model ids via the
provider's models API before any real call; never part of build/test).

## Limitations (known, deliberate)

- ~~No configurator synchronization~~ — RESOLVED in S06
  (AI_CONFIGURATOR_INTEGRATION.md).
- ~~No cart/checkout tools~~ — RESOLVED in S07
  (AI_COMMERCE_INTEGRATION.md): validated add-to-cart + checkout handoff.
  Still none of: quote tools (`createDraftQuote` is future work — the AI
  points at /request-quote), order mutation, payment anything.
- Explicit-intent classification is prompt-enforced (v1.2.0) with the
  structural backstops (customer-confirmed chips, reprice/stale guards,
  checkout tap) — there is no separate deterministic intent classifier;
  weak-language turns are covered by tests only at the plumbing level.
- Handoff records are stored, not yet delivered anywhere (owner must
  configure the escalation destination).
- Extraction handles scalar fields only (painPoints/objections arrays are a
  later refinement); contact info in handoffs is not upserted into the
  customers table.
- Rate limiting is per-instance; edge limiting is a launch requirement
  (now also covering `/api/cart/line`).
- Conversation outcomes: quote_started/cart_added/checkout_started/
  purchased stamp from their routes (S06/S07); `abandoned` needs a
  session-expiry sweep (future session).
