# GUARDRAILS

The safety/control layer that gates every financially meaningful AI action.
Design is binding now; implementation lands with the roadmap (module
`/modules/guardrails`, admin center at `/admin/ai-actions`).

## Principle

Never enforce a critical business rule only inside an LLM prompt.
Guardrails are deterministic code evaluating structured actions against
configured limits. Prompts are UX; guardrails are authority.

## Interface (target)

```ts
evaluateAgentAction(action: AgentAction): GuardrailVerdict

type GuardrailVerdict =
  | { allowed: true;  approvalRequired: boolean; riskLevel: Risk; reason: string }
  | { allowed: false; reason: string; violatedRules: string[] };
```

Every allowed-with-approval action becomes an `AgentDecision` awaiting the
Approval Center; every verdict is logged.

## Autonomy modes

`OBSERVE → RECOMMEND → GUARDED_AUTO → AUTONOMOUS`, stored per agent in
`AgentConfig`, checked by the guardrail engine on every action. Initial
assignments:

| Agent | Mode |
| --- | --- |
| Sales | GUARDED_AUTO — but only within its customer-facing toolset |
| Pricing | RECOMMEND |
| CRO | RECOMMEND |
| CEO / Business Review | RECOMMEND |
| Google Ads | OBSERVE |
| Meta Ads | OBSERVE |

Promotion requires real operating history plus an explicit human decision
(Stage J of the roadmap). Demotion can happen any time.

## Hard limits (configurable — placeholders, never invented)

All values live in business configuration with explicit
`[TO BE PROVIDED]` placeholders until the owner sets them
(see BUSINESS_CONFIG_TODO.md → "AI & guardrail configuration"):

- `minimumAllowedPrice` (per product/config)
- `minimumGrossMargin` / `minimumContributionMargin`
- `maximumDiscountPct`
- `maximumPriceChangePct` (per change and per period)
- `maximumAdBudgetChangePct` · `maximumDailyAdSpend`
- `maximumExperimentTrafficPct`
- `highValueOrderThresholdCents` (forces human review)
- `refundApprovalThresholdCents`
- AI spend caps: `aiDailyBudget` · `aiMonthlyBudget` (breach → AI features
  disable gracefully; commerce unaffected)

Until the pricing cost model exists, margin-based rules evaluate to
"cannot verify → not allowed" for any price-affecting action — fail closed.

## What is never automated (regardless of mode)

- Large refunds; any refund above threshold
- Legal/policy changes
- Factory/manufacturing promises not in confirmed capabilities
- Major price changes beyond configured bounds
- Major spend increases beyond configured bounds
- New manufacturing capability claims

## Sales-agent guardrails (first to be enforced)

- May only call its allowlisted tools (see AI_AGENT_ARCHITECTURE.md).
- Prices only from `calculatePrice`; no invented numbers, no ad-hoc
  discounts.
- Claims about capabilities restricted to `confirmed: true` catalog data —
  unconfirmed handle types etc. route to the quote flow.
- Never promises delivery dates beyond configured production/shipping
  statements.
- Escalates rather than improvises on refunds, complaints, legal, large or
  unsupported orders.
- Customer messages are untrusted input; capability comes from tool
  permissions, not prompt compliance (red-team cases in
  AI_AGENT_ARCHITECTURE.md become CI tests).

## Approval Center (`/admin/ai-actions`, Stage E)

Shows per decision: agent · observation · recommendation · supporting
metrics · confidence · risk · proposed action · expected effect. Actions:
Approve / Reject / Modify / View evidence. Every review is logged with
reviewer, timestamp, before/after state. Executed automated changes require
a decision record, before/after state, reason, and rollback capability
where practical.

## Feature flags

`config/flags.ts` (env-overridable), all default **false**:

```
AI_SALES · AI_CUSTOMER_INTELLIGENCE · AI_PRICING_AGENT · AI_CRO_AGENT
AI_GOOGLE_ADS_AGENT · AI_META_ADS_AGENT · AI_AUTO_PRICING · AI_AUTO_ADS
EXPERIMENT_ENGINE
```

Any flag off ⇒ its surfaces disappear and its agents cannot run; the
commerce experience must be fully functional with every flag off.
