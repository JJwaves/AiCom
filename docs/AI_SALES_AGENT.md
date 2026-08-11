# AI_SALES_AGENT

The customer-facing **AI Packaging Expert** (Session 05) — the first real
agent on the Session 04 runtime. It helps restaurants/cafes choose custom
non-woven takeout bags: understands needs, answers supported product
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
      → context assembly (profile + summary)    lib/ai/agents/sales/context.ts
      → versioned prompt ai_sales_agent v1.0.0  lib/ai/prompts/registry.ts
      → AiRuntime.runToolConversation (STANDARD workload, loop limits)
          → sales tool registry (8 tools, READ/CUSTOMER_WRITE only)
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

Not present in any customer-facing registry, ever: `modifyPrice`,
`issueRefund`, `changeAdBudget`, `createAdCampaign`, `modifyMargin`,
`modifyProductManufacturingRules`, `adminDatabaseQuery`.
`createSalesToolRegistry()` refuses to construct with a
FINANCIAL_RESTRICTED/ADMIN_RESTRICTED tool present. Injection defenses are
capability-based and unit-tested (`tests/ai-sales-agent.test.ts`).

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
  human follows up. `endConversation` remains the terminal transition
  (outcome wiring for abandoned/checkout_started arrives with the sessions
  that connect chat to cart/checkout).
- First-party events: `ai_chat_started` (conversation creation),
  `ai_message_sent` (per turn, with status/tool-count props — never
  transcript content), `ai_product_recommended`, `human_handoff_requested`.
  Raw chat stays in Conversation/Message persistence, not analytics props.

## Sales prompt

`ai_sales_agent` **v1.0.0** in `lib/ai/prompts/registry.ts` — identity,
progressive-discovery sales behavior, truthfulness rules (confirmed-only
capabilities, no fabricated materials/dimensions/certifications/dates/
sustainability claims/reviews/prices, DEMO pricing labeled), pricing-tool
authority, escalation triggers, and injection posture. One `{{context}}`
variable carries the server-assembled customer context. Any semantic change
bumps the version; AiUsage rows stamp prompt id+version on every call.

## Customer context (what the model sees)

`buildSalesContext` renders, bounded to ~2.4k chars: the conversation's
product, the session's CustomerNeedProfile fields **with provenance labels**
("customer-stated" vs "our guess" — the model is told which facts are
verified), and the rolling conversation summary. Structurally excluded:
other sessions/customers, admin data, secrets, cost/margin figures,
provider credentials.

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

- **POST** `{message}` (1–2000 chars; body ≤16 KB). The client supplies
  NOTHING else authoritative — session identity is the httpOnly `bd_sid`
  cookie; customerId/agentType/permissions/conversation are server-resolved;
  unknown body fields are ignored. Responses:
  `200 {ok, conversationId, reply, status, recommendedProductId?,
  recommendedProductPath?, needsHuman, handoffReason?, conversationStatus}` ·
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
priced once `config/ai-pricing.ts` is filled). AI-assisted cart/checkout
attribution deliberately does NOT exist yet — no invented conversion
attribution before the cart/checkout integration sessions.

## Testing

`tests/need-profile-concurrency.test.ts` (locking),
`tests/ai-extraction.test.ts` (evidence validation, adversarial
fabrication, contradiction, over-infer resistance),
`tests/ai-sales-agent.test.ts` (lifecycle, context/history continuity,
recommendation/escalation signals, prompt injection, loop limits,
disabled/failure/budget, summarization),
`tests/ai-chat-route.test.ts` (validation, gating, rate limits, error
normalization, history filtering), `tests/rate-limit.test.ts`.
All FakeAiProvider — zero credentials, zero network. The optional live
check is `npm run ai:smoke` (credential-gated, verifies model ids via the
provider's models API before any real call; never part of build/test).

## Limitations (known, deliberate)

- No configurator synchronization (S06): the agent recommends and links to
  the product page; it does not read or mutate configurator state.
- No cart/checkout/quote/order tools (later sessions) — spec §32.
- Handoff records are stored, not yet delivered anywhere (owner must
  configure the escalation destination).
- Extraction handles scalar fields only (painPoints/objections arrays are a
  later refinement); contact info in handoffs is not upserted into the
  customers table.
- Rate limiting is per-instance; edge limiting is a launch requirement.
- Sales conversations currently record outcome only for escalation;
  abandoned/quote/checkout outcomes wire up with S06+.
