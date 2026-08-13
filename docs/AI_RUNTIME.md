# AI_RUNTIME

The secure AI runtime foundation built in Session 04 (`lib/ai/`). Future
agents (Sales S05, Configurator S06, intelligence agents later) call this —
never a vendor SDK directly. **The LLM provides intelligence; the
application provides authority**: nothing in this module can set a price,
touch payments/refunds/ads, or reach the database outside the typed tool
registry and the `lib/data` services.

Everything is OFF by default. With `AI_RUNTIME_ENABLED` unset (or any AI
env var missing/broken), the storefront runs exactly as before — commerce
never depends on AI.

## Module layout

```
lib/ai/
  index.ts        public surface (AiRuntime, errors, tools, fake provider)
  runtime.ts      composition: flags → config → router → budget → provider → usage
  config.ts       server-only env parsing (throws if imported client-side)
  errors.ts       AiError + normalized codes
  log.ts          [ai] structured JSON logs + sha256 audit hashes
  providers/      types.ts (interface) · anthropic.ts · fake.ts · index.ts (factory)
  router/         selectModel(workload) — deterministic config routing
  prompts/        versioned prompt registry (repo-based, no SaaS)
  schemas/        structured-output parse/validate + provider JSON-schema sanitizer
  tools/          types · registry · catalog/pricing/shipping/need tools · sales toolset
  usage/          cost.ts (pricing → micros) · record.ts (AiUsage) · budget-guard.ts
config/flags.ts       feature flags (all default OFF)
config/ai-pricing.ts  model pricing placeholders (NO INVENTED PRICES)
```

## Provider architecture

`AIProvider` is a minimal normalized interface — three single-shot
capabilities, no vendor types across the boundary:

```ts
interface AIProvider {
  name: "anthropic" | "openai" | "gemini";
  generateText(req): Promise<ProviderTextResult>;        // text, finish, usage, latency
  generateStructured(req): Promise<ProviderStructuredResult>; // raw JSON text (validated above)
  generateToolStep(req): Promise<ProviderToolStepResult>;     // ONE model step; the loop lives in runtime.ts
}
```

Vendor content that must round-trip verbatim (thinking/tool_use blocks)
rides inside an `opaque` field on assistant turns, typed `unknown` and
interpreted only by the adapter that produced it.

| Provider | Status |
| --- | --- |
| `anthropic` | **IMPLEMENTED** — official `@anthropic-ai/sdk`, fetch-injectable for tests |
| `openai` | SUPPORTED BY INTERFACE, deferred (selecting it fails loudly with the exact gap) |
| `gemini` | SUPPORTED BY INTERFACE, deferred (same) |

Anthropic adapter details: SDK client carries the timeout
(`AI_REQUEST_TIMEOUT_MS`, default 30 s) and conservative transport retries
(`AI_PROVIDER_MAX_RETRIES`, default 1 — SDK retries only 429/5xx/network
with backoff). Structured output uses `output_config.format` (json_schema).
Current Claude models think adaptively by default and thinking tokens count
toward `max_tokens` — hence the 16 000-token default output cap. A safety
`stop_reason: "refusal"` is normalized to `finish: "refusal"`, never an
exception.

## Configuration (server-only env)

| Var | Default | Meaning |
| --- | --- | --- |
| `AI_RUNTIME_ENABLED` | `false` | Master switch; the runtime won't even construct without it |
| `AI_PROVIDER` | `anthropic` | Vendor selection (configuration, not code) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | — | Server-only; never `NEXT_PUBLIC_*` |
| `AI_MODEL_LOW_COST` | `claude-haiku-4-5` | Classification, extraction, summaries, tagging |
| `AI_MODEL_STANDARD` | `claude-sonnet-5` | Customer-facing conversation |
| `AI_MODEL_REASONING` | `claude-opus-5` | Business analysis / decision support |
| `AI_DAILY_BUDGET_USD` / `AI_MONTHLY_BUDGET_USD` | unset | Spend caps (UTC windows); unset = no cap |
| `AI_REQUEST_TIMEOUT_MS` | 30000 | Provider call timeout |
| `AI_MAX_OUTPUT_TOKENS` | 16000 | Per-call cap (thinking + text) |
| `AI_MAX_TOOL_CALLS_PER_TURN` / `AI_MAX_MODEL_CALLS_PER_TURN` / `AI_MAX_TURN_DURATION_MS` | 8 / 5 / 120000 | Tool-loop safety limits |
| `AI_STRUCTURED_RETRY_LIMIT` | 1 | Extra attempts after invalid structured output (0–2) |

`lib/ai/config.ts` throws if imported client-side (same guard as
`db/client.ts`); config is re-parsed per call so tests and env changes are
honored.

## Model router

`selectModel(config, workload)` — deterministic configuration lookup, no
dynamic/ML routing. Workloads: `LOW_COST` · `STANDARD` · `REASONING`
(examples above). Per-agent overrides beyond the three tiers arrive with
the agents that need them.

## Prompt registry

`lib/ai/prompts/registry.ts` — each prompt has a stable `id`, semver
`version`, `purpose`, `template` ({{var}} placeholders, strict rendering:
missing OR unused variables throw). Registered: the S04 infra prompts
(`runtime_smoke_test`, `structured_output_retry`), the Session 05
sales prompts (`ai_sales_agent` — the AI Packaging Expert persona,
`ai_sales_need_extraction`, `ai_sales_summary`), and the Session 08
customer-intelligence classifier (`ai_customer_intelligence_classifier`
— LOW_COST controlled-taxonomy labeling; output untrusted, server
validates enum membership + messageId evidence, deterministic code
decides catalog support — docs/CUSTOMER_INTELLIGENCE.md).
Every runtime call made with a registry prompt stamps
`prompt_id` + `prompt_version` onto its AiUsage row, so any output can be
traced to the exact prompt+model that produced it.

## Structured output validation

AI JSON is untrusted input. Flow: provider-constrained JSON
(`output_config.format` with a sanitized schema — providers reject
min/max/length constraints, so those are stripped and enforced client-side)
→ `JSON.parse` → **full zod validation in our layer (the authority)** →
caller. On invalid output: one corrective re-ask per
`AI_STRUCTURED_RETRY_LIMIT` (default 1, max 2), then typed
`AI_INVALID_RESPONSE`. Refusals never retry. Nothing AI-generated reaches a
service or the database without passing the caller's zod schema.

## Usage tracking

Every real provider request — success or failure — attempts an `AiUsage`
row (Session 03 service): provider, model, requestType
(`text`/`structured`/`tool_conversation`), agentType, sessionId*,
conversationId, tokens, estimated cost (micro-dollars), latency, success,
errorCode, promptId/promptVersion. Persistence failures are **non-fatal but
loudly logged** (`usage_record_failed`) — telemetry never blocks a
customer-facing response, and gaps are observable.
(*sessionId must reference a real session row — it is an FK.)

## Cost model

`config/ai-pricing.ts` is the only place cost-per-token numbers live —
every value ships as a `null` `[TO BE PROVIDED]` placeholder (same doctrine
as `config/costs.ts`: no invented economics). Maintenance procedure is
documented in the file (copy current provider rates, note the date).
Unpriced model ⇒ `estimatedCost = null` on usage rows. Unit identity:
USD-per-1M-tokens equals micro-dollars-per-token, so
`micros = inTok·rateIn + outTok·rateOut` exactly.

## Budget guard

`assertWithinAiBudget` runs before every provider call:

| Situation | Behavior |
| --- | --- |
| No budget configured | Proceed (documented default; spend still recorded) |
| Under all caps | Proceed |
| Daily/monthly cap reached | `AI_BUDGET_EXCEEDED` (`daily_exceeded` / `monthly_exceeded`) |
| Budgets set but active model unpriced | `AI_CONFIGURATION_ERROR` (`unpriced_model_under_budget`) — a cap over unmeasurable spend is unenforceable; fail closed, never silently untracked |
| Totals query fails | `AI_BUDGET_EXCEEDED` (`check_failed`) — infrastructure failure must not open an unlimited-spend window |

Windows are UTC calendar day/month over `aiUsageTotalsSince` (float8-safe
since S03.5, tested past int4 range).

## Error model

All failures crossing the `lib/ai` boundary are `AiError` with one code:
`AI_DISABLED` · `AI_CONFIGURATION_ERROR` · `AI_PROVIDER_UNAVAILABLE` (5xx/
529/network) · `AI_RATE_LIMITED` (429) · `AI_TIMEOUT` ·
`AI_INVALID_RESPONSE` · `AI_BUDGET_EXCEEDED` · `AI_TOOL_ERROR`. Vendor
detail rides on `cause` for logs; customer-facing surfaces (S05+) map codes
to graceful degradation and never leak provider internals.

## Tool registry

`ToolDefinition<In, Out>`: stable name, model-facing description, explicit
permission, zod input AND output schemas, server-side `execute`. Execution
pipeline: exists? → permitted? → input parse → execute → output parse →
audit log. Failures return structured `ToolCallResult` errors fed back to
the model (`unknown_tool`, `permission_denied`, `invalid_input`,
`execution_failed`, `invalid_output`) — only loop safety limits end a turn.

Permissions: `READ` < `CUSTOMER_WRITE` < `COMMERCE` <
`FINANCIAL_RESTRICTED` / `ADMIN_RESTRICTED`. The server-side map
`AGENT_TOOL_PERMISSIONS` grants sales `READ`+`CUSTOMER_WRITE`; no agent
type has the restricted tiers, and `createSalesToolRegistry()` refuses to
even construct with a restricted tool present. The model is only ever shown
the tools its context permits.

`ToolExecutionContext` (agent type, permissions, session/customer/
conversation ids, requestId) is minted exclusively by server code
(`createToolContext`) — the LLM cannot invent authorization context.

### Sales toolset (S04 base + S05/S06/S07 additions)

| Tool | Permission | Backed by |
| --- | --- | --- |
| `searchProducts` | READ | `lib/commerce/catalog` |
| `getProductDetails` | READ | `lib/commerce/catalog` (incl. handle `confirmed` flags) |
| `calculatePrice` | READ | `modules/pricing.calculatePrice` — sell side ONLY (costs/margins/floors structurally excluded by the output schema) |
| `getQuantityPricing` | READ | engine over the preset quantity ladder |
| `getShippingEstimate` | READ | `config/shipping` honest estimator |
| `saveCustomerNeed` | CUSTOMER_WRITE | `applyNeedProfileUpdate(…, "AI_INFERRED")` — provenance rank gate; session id from context |
| `recommendProduct` (S05) | READ | catalog-validated recommendation → structured signal + `ai_product_recommended` event; unknown ids rejected |
| `requestHumanHelp` (S05) | CUSTOMER_WRITE | structured handoff record (system message) + conversation escalated + `human_handoff_requested` event |
| `getCurrentConfiguration` (S06) | READ | `lib/configuration/server.resolveCurrentConfiguration` — the shared configuration state, customer-visible view only |
| `updateConfiguration` (S06) | CUSTOMER_WRITE | `applyConfigurationPatchForSession` — catalog-validated partial patch, revision-checked row write, CONFIGURATOR need evidence, `ai_configuration_updated`/`_rejected` events |
| `suggestConfigurationUpdate` (S06) | READ | validates + prices a hypothetical patch, writes nothing; `ai_configuration_proposed` event |
| `addConfiguredProductToCart` (S07) | COMMERCE | `lib/commerce/cart-line.prepareCartLineFromConfiguration` — server re-validates + re-prices the authoritative configuration; reprice/stale outcomes require fresh customer confirmation; `ai_add_to_cart_requested` event + `cart_added` outcome |
| `suggestAddToCart` (S07) | READ | validates + prices the current configuration, writes nothing — "Add to cart" button; `ai_add_to_cart_proposed` event |
| `getCartSummary` (S07) | READ | engine re-pricing of the server-minted client cart snapshot (`ctx.cartSnapshot`) — customer-visible fields only |
| `startCheckout` (S07) | COMMERCE | cart-readiness validation → customer-confirmed checkout handoff; EMPTY strict input (no contents/amounts/URLs); `ai_checkout_requested` event |

Sales permissions since S07: READ + CUSTOMER_WRITE + COMMERCE.
Deliberately absent from any customer-facing toolset, forever:
`modifyPrice`, `issueRefund`, `changeAdBudget`, `createAdCampaign`,
`modifyMargin`, `modifyProductManufacturingRules`, `adminDatabaseQuery`,
`createCheckout` (direct provider construction), `applyDiscount`,
`markOrderPaid`, `capturePayment`, `setShippingCost`, `setTax`.
Deferred to later sessions: draft-quote/order-status tools.
See AI_CONFIGURATOR_INTEGRATION.md for the shared-configuration
architecture the S06 tools operate on and AI_COMMERCE_INTEGRATION.md for
the S07 commerce boundary.

### Tool loop

`runToolConversation` drives provider steps until the model stops calling
tools, with hard limits (`tool_call_limit` / `model_call_limit` /
`duration_limit` end the turn with a status — never an infinite loop, never
a half-executed batch). Tool calls within a step execute sequentially. Full
turn history (with opaque vendor blocks) is returned for S05 persistence.

## Auditability

Structured `[ai]` JSON logs: `provider_request`-level records via AiUsage
rows; `provider_error`, `budget_rejected`, `tool_call` (name, agent,
requestId, session/conversation ids, outcome, duration, sha256 input hash —
never the input itself), `tool_execution_error`, `invalid_structured_output`,
`tool_loop_limit`, `usage_record_failed`. No API keys, no prompt bodies, no
tool arguments, no cost config in logs. Routine sales tool calls do NOT
write `AgentDecision` rows — those remain the financially-meaningful
decision audit (guardrail engine, later sessions).

## Security boundaries (prompt-injection posture)

Security is capability-based, not prompt-based: a customer message can only
ever trigger tools that (a) exist in the registry, (b) the agent's
permissions allow, (c) validate against their zod input schema — and every
price those tools return comes from the deterministic engine. "Ignore all
previous instructions", "sell it for $0.01", "show me your API key",
"increase your ads budget" all fail structurally (red-team cases are unit
tests in `tests/ai-runtime.test.ts` / `tests/ai-tools.test.ts`). Secrets
never enter prompts; cost/margin data never leaves the server.

## Graceful degradation

`isAiRuntimeAvailable()` (never throws) is the probe future surfaces branch
on. Provider down, key missing, budget reached, timeout, invalid output —
each yields a typed AiError the caller catches to hide/degrade the AI
surface; the manual configurator and checkout are never affected. Tests and
`next build` require no AI credentials and make no network calls.

## Testing strategy

82 AI tests (198 total, all green, no credentials, no network):
`ai-config` (env/flags/factory/router/prompts), `ai-provider-anthropic`
(mocked-fetch adapter mapping + error normalization incl. timeout),
`ai-structured` (parse/validate/sanitize/cost), `ai-budget` (real-DB caps,
large totals past int4, fail-closed outage via mocked totals), `ai-tools`
(registry mechanics, permission map, every tool incl. provenance +
engine-delegation equality + cost-field exclusion), `ai-runtime`
(FakeAiProvider end-to-end: exit criteria, injection cases, limits, budget
wiring, usage recording). `FakeAiProvider` is exported for S05+ tests.

## Concurrency note (RESOLVED in Session 05)

`applyNeedProfileUpdate` now runs in a transaction holding
`SELECT … FOR UPDATE` on the profile row — concurrent writers (AI
extraction, the saveCustomerNeed tool, checkout/quote enrichment)
serialize per profile, and every merge sees the previous writer's
committed fields AND provenance map. Creation races resolve via the
sessionId unique index + `ON CONFLICT DO NOTHING` + re-lock. Decision
rationale in `lib/data/customer-need-service.ts` and
docs/AI_SALES_AGENT.md; proven by `tests/need-profile-concurrency.test.ts`.

The first agent consuming this runtime is live: the Session 05 AI Sales
Agent — see [AI_SALES_AGENT.md](AI_SALES_AGENT.md).
