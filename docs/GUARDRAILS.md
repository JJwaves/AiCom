# GUARDRAILS

**Status: IMPLEMENTED (Session 10)** — `modules/guardrails` is the one
authoritative safety/approval layer every financially or operationally
meaningful AI action passes through. The human surface is
`/admin/ai-actions` (docs/AI_ACTION_CENTER.md).

## Principle

Never enforce a critical business rule only inside an LLM prompt. Guardrails
are deterministic code evaluating structured actions against configured
limits. Prompts are UX; guardrails are authority.

```
Agent
  ↓ ProposedAction (closed type + strict payload schema)
evaluateAgentAction()          ← deterministic, pure, no LLM, no I/O
  ↓ GuardrailDecision (+ persisted guardrail_evaluations row)
Approval workflow              ← human approve / reject / modify
  ↓
Future Executor                ← none exist yet
```

**Permanent architecture invariant.** No agent may call a pricing, ads,
catalog, or payment mutation directly. The only path is
`Agent → ProposedAction → Guardrail → Approval (if required) → Executor`,
and no future executor may bypass this layer.

## Module structure

| File | Role |
| --- | --- |
| `modules/guardrails/types.ts` | Vocabulary: sources, autonomy modes, risk levels, rule severity, execution states, `GuardrailDecision`. |
| `modules/guardrails/actions.ts` | The CLOSED action taxonomy: per-type zod payload schema, base risk, execution support, required limits, source permissions. |
| `modules/guardrails/evaluate.ts` | `evaluateAgentAction()` — the deterministic authority. |
| `modules/guardrails/executors.ts` | Executor registry — **empty by design**. |
| `modules/guardrails/decision-mapping.ts` | AgentDecision → ProposedAction (CEO categories → review types). |
| `config/guardrails.ts` | Policy version, hard limits (`null` placeholders), per-agent autonomy defaults + ceilings, guarded-auto allow-list. |
| `lib/data/agent-action-service.ts` | Persistence: propose / review / modify / sync, concurrency + idempotency. |

Structural invariants (tested in `tests/guardrails-engine.test.ts` and
`tests/guardrails-separation.test.ts`):

- `modules/guardrails` imports **no** `lib/ai` and **no** `db/` — authority
  code cannot depend on the model layer or on request state.
- `evaluateAgentAction` is pure: no clock, no randomness, no network. The
  same input under the same policy version returns a byte-identical verdict.
- The executor registry is empty, so no action type is executable.

## `evaluateAgentAction()`

```ts
evaluateAgentAction({
  source,               // untrusted — validated against ACTION_SOURCES
  actionType,           // untrusted — validated against the closed registry
  payload,              // untrusted — validated by the type's STRICT schema
  autonomyMode,         // untrusted — validated, then clamped to the ceiling
  modelSuggestedRiskLevel?,  // metadata only, never applied
  priceContext?,        // optional real pricing state for the margin floor
}): { decision: GuardrailDecision; validatedPayload: Record<string, unknown> | null }
```

`GuardrailDecision` carries: `policyVersion`, `source`, `actionType`,
`autonomyMode` (applied), `allowed`, `executionEligible`, `approvalRequired`,
`riskLevel`, `modelSuggestedRiskLevel`, `violatedRules[]`,
`missingConfiguration[]`, `reason`, `executionSupport`, `executionState`,
`limitsSnapshot`.

Two different questions, deliberately separate:

- **`allowed`** — may this proposal be recorded and put in front of a human?
- **`executionEligible`** — may software carry it out with no human decision?
  In Session 10 this is `false` for every action type, in every mode.

## Fail-closed defaults

| Condition | Result |
| --- | --- |
| Unknown agent / source | DENY (`unknown_agent`) |
| Unknown action type (`TRANSFER_MONEY`) | DENY (`unknown_action_type`) |
| Malformed payload, or extra fields | DENY (`malformed_action_payload`) |
| Missing / unrecognized autonomy mode | DENY (`unknown_autonomy_mode`) |
| Agent in OBSERVE | DENY (`autonomy_observe_cannot_propose`) |
| Source not permitted for that action type | DENY (`source_not_permitted_for_action_type`) |
| Evaluator throws | DENY (`guardrail_evaluation_failed`) |
| Missing required configuration | Reviewable, but **never** execution-eligible |
| No executor registered | `executionStatus = NOT_SUPPORTED` — nothing runs |

No policy ever means unlimited authority. A `null` limit is reported as
missing configuration, never as "no limit".

## Autonomy modes

`OBSERVE → RECOMMEND → GUARDED_AUTO → AUTONOMOUS`, stored per agent in
`agent_configs` (absent row reads OBSERVE) **and clamped by policy**: the
evaluator applies `min(storedMode, AGENT_AUTONOMY_POLICY[source].maxMode)`,
so a wrong or tampered database row can never grant execution.

| Agent | Default (policy) | Ceiling | Notes |
| --- | --- | --- | --- |
| CEO / Business Review | RECOMMEND | RECOMMEND | Permanently recommendation-only (S09). May propose review-shaped actions only. |
| Pricing Intelligence | RECOMMEND | RECOMMEND | Implemented S12. May propose review-shaped actions only; its output schema cannot express a price. |
| CRO | RECOMMEND | RECOMMEND | Implemented S11. May propose experiments; launching is a separate human action. |
| Google Ads | OBSERVE | RECOMMEND | Agent not implemented; no API connected. |
| Meta Ads | OBSERVE | RECOMMEND | Agent not implemented; no API connected. |
| Human admin | RECOMMEND | RECOMMEND | A human proposal is still guardrail-checked. |
| Customer Intelligence | — | — | Read-only analysis; produces insights, not business actions (S08). |
| Sales ("AI Packaging Expert") | — | — | **Not in this space.** Customer transaction tools are governed by tool permission tiers + customer confirmation (see below). |

Meanings: OBSERVE = analyze only. RECOMMEND = may create proposed actions,
never executes. GUARDED_AUTO = may execute only the action classes in
`GUARDED_AUTO_ALLOWED_ACTION_TYPES` (currently **empty**) inside configured
limits. AUTONOMOUS = broader execution authority, still bounded by hard
rules. Promotion requires real operating history plus an explicit human
decision (roadmap Stage J). Demotion can happen any time.

## Risk classification

Deterministic, from policy — never from the model. An LLM-suggested level is
stored as `modelSuggestedRisk` metadata and can never lower the policy value.

| Risk | Action types |
| --- | --- |
| LOW | All `*_REVIEW` types, `CRO_EXPERIMENT_PROPOSAL` |
| MEDIUM | `AD_PAUSE`, `AD_RESUME`, `AD_CREATIVE_TEST`, `AI_COST_CHANGE`, `CRO_EXPERIMENT_LAUNCH` |
| HIGH | `PRICE_CHANGE`, `PRICE_EXPERIMENT`, `MOQ_CHANGE`, `AD_BUDGET_CHANGE` |
| CRITICAL | `REFUND`, `MANUFACTURING_CHANGE` |

HIGH and CRITICAL always require a human decision
(`MAX_UNATTENDED_RISK_LEVEL = MEDIUM`), in every autonomy mode, permanently.

Magnitude-based escalation (e.g. "a >X% budget increase escalates to
CRITICAL") is **not implemented**, because it would require inventing a
threshold. The missing values are listed as missing configuration instead,
which blocks automated execution — the honest fail-closed answer.

## Hard vs soft rules

- **HARD** — cannot be waived by a normal approval. Either it blocks the
  PROPOSAL (unknown agent/type, malformed payload, OBSERVE, source not
  permitted) or it blocks EXECUTION forever (`never_automated_action_type`,
  price floor unverifiable/violated, risk above the unattended ceiling).
- **SOFT** — precisely what human approval is for (no executor implemented,
  autonomy clamped, limits requiring review).

There is **no bypass semantic**. A super-admin override is deliberately
deferred; if one is ever added it must be a distinct, separately audited
capability, not a flag on approval.

## Hard limits (configurable — placeholders, never invented)

`config/guardrails.ts → GUARDRAIL_LIMITS`, every value `null`
`[TO BE PROVIDED]` (BUSINESS_CONFIG_TODO.md → "Guardrail limits"):

`maximumDiscountPct` · `maximumPriceDecreasePct` · `maximumPriceIncreasePct`
· `maximumCampaignBudgetChangePct` · `maximumDailyAdSpendCents` ·
`maximumNewCampaignTestBudgetCents` · `maximumExperimentTrafficPct` ·
`highValueOrderThresholdCents` · `refundApprovalThresholdCents` ·
`maximumMoqChangePct`

**Margin floors are NOT duplicated here.** `config/costs.ts → marginPolicy`
(`minimumGrossMarginBps`, `minimumContributionMarginBps`) is already the
pricing engine's authority, and the guardrail engine reads that same config
and calls the same `evaluatePriceFloor()`. One number, one home.

Until the cost model exists, every price-affecting action reports
`price_floor_unverified` (or the floor's own violation when real pricing
state is supplied) and can never be execution-eligible — fail closed.

AI spend caps are a separate, already-implemented mechanism
(`config/ai-pricing.ts` + the Session 04 budget guard); they gate model
calls, not business actions.

## What is never automated (regardless of mode)

Enforced structurally — the type is marked `neverAutomated`, and no executor
exists in any case:

- Refunds and any payment mutation. No AI ever receives payment credentials
  or a payment tool.
- Factory / manufacturing promises: new material, new product, unsupported
  size, delivery promise, capability claim. Feasibility is human knowledge,
  never model output.
- Legal / policy changes — not representable as an action type at all.
- Price and spend changes beyond configured bounds (which are unconfigured,
  so all of them today).

## Sales-agent guardrails (a separate system — spec §32)

The customer-facing AI Sales Agent is **not** governed by this engine. Its
boundary is the Session 04–07 design: 15 permission-tiered typed tools,
server-minted execution contexts, structurally price-free schemas, and
customer confirmation for every commerce effect. `searchProducts`,
`calculatePrice`, `saveCustomerNeed` and `addConfiguredProductToCart` are
CUSTOMER TRANSACTION TOOLS, not BUSINESS MANAGEMENT ACTIONS, and must never
be modelled as proposed actions. Its rules remain:

- Only allowlisted tools (AI_AGENT_ARCHITECTURE.md).
- Prices only from `calculatePrice`; no invented numbers, no ad-hoc discounts.
- Capability claims restricted to `confirmed: true` catalog data.
- No delivery promises beyond configured production/shipping statements.
- Escalates rather than improvising on refunds, complaints, legal, large or
  unsupported orders.
- Customer messages are untrusted input; capability comes from tool
  permissions, not prompt compliance.

## Session 11 additions (experiments)

- `GUARDRAIL_POLICY_VERSION` → `2026-08-12.s11.1`.
- `CRO_EXPERIMENT_PROPOSAL` gained a nullable `design` field carrying the
  registry-validated experiment (`modules/experiments/proposal.ts`), so a
  human approves the exact experiment rather than a paragraph. A proposal
  WITHOUT a design is a direction, not a launchable experiment.
- `CRO_EXPERIMENT_LAUNCH` gained a nullable `experimentId`. It remains
  `NOT_IMPLEMENTED` / `NOT_SUPPORTED` and still requires
  `maximumExperimentTrafficPct`, which is still `[TO BE PROVIDED]`.
- `AGENT_AUTONOMY_POLICY.CRO_AGENT.defaultMode` rose OBSERVE → RECOMMEND
  (the agent now exists and is designed to recommend). The ceiling is
  unchanged, the guarded-auto allow-list is still empty, and the
  `AI_CRO_AGENT` flag still gates whether it runs at all.
- `maximumExperimentTrafficPct` being `null` is handled by
  `config/experiments.ts → resolveTrafficCap()`: it BLOCKS a launch in
  production naming the exact config path, and applies a documented
  development-only 50% ceiling elsewhere. It is never read as 100%.
- The executor registry remains **EMPTY**. Experiment launch is an explicit
  HUMAN admin route that is guardrail-EVALUATED (the verdict, policy version
  and missing configuration are snapshotted onto the experiment row) — not
  an executor. See docs/EXPERIMENTATION.md §19.

## Session 12 additions (pricing intelligence)

- `GUARDRAIL_POLICY_VERSION` → `2026-08-15.s12.1`.
- `SOURCE_PERMITTED_ACTION_TYPES.PRICING_AGENT` gained exactly one entry:
  **`DATA_QUALITY_REVIEW`** — a REVIEW-ONLY type granting zero authority. The
  Pricing Agent's closed recommendation taxonomy includes a `DATA_QUALITY`
  class precisely so a pricing question we CANNOT answer ("we have no
  manufacturing costs") routes honestly, instead of being forced into a
  `PRICING_REVIEW` that would misrepresent a configuration gap as a price
  problem. Nothing else was widened.
- `PRICE_CHANGE` and `PRICE_EXPERIMENT` remain listed for `PRICING_AGENT`
  from Session 10 and remain **unreachable in practice**: the agent's output
  schema has no price field, and
  `modules/guardrails/decision-mapping.ts → PRICING_RECOMMENDATION_TO_ACTION_TYPE`
  contains neither. They are reachable only by an explicit `HUMAN_ADMIN`
  proposal — which the cost-model price floor still refuses to bless while
  `config/costs.ts` is unconfigured (tested).
- `AGENT_AUTONOMY_POLICY.PRICING_AGENT.defaultMode` rose OBSERVE →
  RECOMMEND (the agent now exists and is designed to recommend), exactly as
  CEO did in S09 and CRO in S11. The ceiling is unchanged, the guarded-auto
  allow-list is still empty, and `AI_PRICING_AGENT` still gates whether it
  runs at all.
- `syncDecisionsToActions()` now covers `ceo`, `cro` AND `pricing` decisions.
- The executor registry remains **EMPTY**. There is no `PRICE_CHANGE`
  executor, and none may be registered until the full executor contract in
  docs/AI_ACTION_CENTER.md is satisfied AND real costs, margin policy and
  price-movement limits exist.
- `maximumPriceDecreasePct`, `maximumPriceIncreasePct`, `maximumDiscountPct`
  and `maximumMoqChangePct` are all still `null`. Session 12 reports each as
  MISSING CONFIGURATION by exact config path — never as "no limit".

## Session 13 additions (Google Ads read-only intelligence)

- `GUARDRAIL_POLICY_VERSION` → `2026-08-15.s13.1`.
- `GOOGLE_ADS_AGENT` default autonomy OBSERVE → **RECOMMEND** (the agent is
  implemented and designed to recommend). **The CEILING is unchanged at
  RECOMMEND**, `GUARDED_AUTO_ALLOWED_ACTION_TYPES` is still empty, and
  `AI_GOOGLE_ADS_AGENT` still gates whether the agent runs at all.
- ONE permission added: `GOOGLE_ADS_AGENT` may now propose
  `DATA_QUALITY_REVIEW` (review-only). Justification: an advertising question
  the platform CANNOT answer ("Google Ads has never synced", "spend and
  revenue are in different currencies") must route honestly instead of being
  forced into a `MARKETING_REVIEW` that would misrepresent a configuration
  gap as a campaign problem.
- `mapGoogleAdsDecisionToAction` + `GOOGLE_ADS_RECOMMENDATION_TO_ACTION_TYPE`;
  `syncDecisionsToActions` now covers ceo / cro / pricing / google_ads.
- **`AD_BUDGET_CHANGE`, `AD_PAUSE`, `AD_RESUME` and `AD_CREATIVE_TEST` are
  ABSENT from the Session 13 mapping table.** They remain registered in the
  taxonomy for a later guarded session, and remain `NOT_IMPLEMENTED`,
  executor-less, and blocked by the still-`null`
  `maximumDailyAdSpendCents` / `maximumCampaignBudgetChangePct` /
  `maximumNewCampaignTestBudgetCents` — including for a HUMAN_ADMIN proposal,
  which lands PENDING_APPROVAL with `executionEligible: false` and the
  missing configuration named.
- The Google Ads agent's output schema has no budget, campaign-status, bid,
  keyword or ad field, so an executable ad action is unrepresentable at the
  model boundary as well as unmapped at the action boundary.
- **`modules/guardrails/executors.ts` is still EMPTY.**

## Policy versioning

Every evaluation stores `GUARDRAIL_POLICY_VERSION` plus the limits snapshot
it consulted, in the append-only `guardrail_evaluations` table. Any change to
`config/guardrails.ts` (limits, ceilings, allow-list) or to the action
taxonomy **must** bump the version, so "why was this allowed on that date?"
stays answerable. Evaluations contain no secrets and no customer PII.

## Approval Center (`/admin/ai-actions`)

Implemented — see docs/AI_ACTION_CENTER.md for the action model, statuses,
approval/modification semantics, concurrency rules and the future executor
contract.

## Feature flags

`config/flags.ts` (env-overridable), all default **false**:

```
AI_RUNTIME · AI_SALES · AI_CUSTOMER_INTELLIGENCE · AI_BUSINESS_INTELLIGENCE
AI_ACTION_CENTER · PRICING_INTELLIGENCE · AI_PRICING_AGENT · AI_CRO_AGENT
GOOGLE_ADS_INTELLIGENCE · AI_GOOGLE_ADS_AGENT · AI_META_ADS_AGENT
AI_AUTO_PRICING · AI_AUTO_ADS
EXPERIMENT_ENGINE
```

`AI_ACTION_CENTER` gates the ADMIN SURFACE only: the Guardrail Engine
evaluates proposed actions whether or not the flag is on.
`PRICING_INTELLIGENCE` likewise gates the pricing dashboard and its route,
while `AI_PRICING_AGENT` separately gates whether the model may be called —
the deterministic pricing analytics need no AI configuration at all. The storefront
does not depend on it. Any flag off ⇒ its surfaces disappear and its agents
cannot run; commerce must be fully functional with every flag off.

## Session 13.5 additions (business cost model + margin policy)

**No autonomy change.** `GUARDRAIL_POLICY_VERSION` is unchanged, every agent
ceiling is still RECOMMEND, `GUARDED_AUTO_ALLOWED_ACTION_TYPES` is still
empty, `modules/guardrails/executors.ts` is still empty, every
`GUARDRAIL_LIMITS` value is still `null`, and no action type was added or
removed. Session 13.5 is analytics and configuration infrastructure.

**Margin policy stays in ONE place.** `config/costs.ts → marginPolicy` remains
the single home; `config/guardrails.ts` still deliberately does not duplicate
margin floors, and the evaluator still calls the same `evaluatePriceFloor`.
The policy gained `targetGrossMarginBps` alongside the existing
`targetContributionMarginBps`.

**MINIMUM vs TARGET is now explicit in code.** A minimum is a hard boundary
that blocks a price-affecting action; a target is an objective whose shortfall
is a review signal and never a block. `minimumAllowedPriceCents` consults
FLOORS ONLY — a target can never become a floor by configuration accident, and
`validateCostModel` rejects a target set below its own minimum.

**The price floor still fails closed**, and now for one more reason: a cost
model that is fully configured but INVALID (a negative cost, a fee ≥ 100%, an
unreachable margin) is rejected rather than normalised into something
plausible that would flow into the floor looking real.

**Nothing in the customer path calls the floor.** Structural tests assert that
the checkout route never references `evaluatePriceFloor`, and that no file in
`lib/commerce`, `lib/cart` or `lib/configuration` gates on cost readiness.
Missing cost configuration blocks profit analytics and future price actions —
never a sale.

See `docs/UNIT_ECONOMICS.md` §16–§18.
