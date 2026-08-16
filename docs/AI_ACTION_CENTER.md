# AI_ACTION_CENTER

**Status: IMPLEMENTED (Session 10).** The owner's review surface for
everything the AI wants to do. Authoritative for the action model, approval
workflow and execution boundary; the deterministic policy layer it sits on
is docs/GUARDRAILS.md.

Route: `/admin/ai-actions` (+ `/admin/ai-actions/[id]`), behind the Session
08 admin auth and the `AI_ACTION_CENTER` flag.

## What it answers

1. What does the AI want to do? → title + structured action + action type
2. Why? → the agent's observation and recommendation
3. On what evidence? → server-resolved insight/opportunity rows + metric refs
4. How risky? → policy-derived risk (LOW/MEDIUM/HIGH/CRITICAL)
5. What rules apply? → the guardrail evaluation, rule by rule, HARD vs SOFT
6. Does it need my approval? → yes, for everything today
7. **Can the system actually do it yet?** → almost always no; approval
   records a decision, it does not execute
8. What did I decide before? → approved / rejected / modified history

## Concept separation (never one status field)

| Concept | Where it lives | Meaning |
| --- | --- | --- |
| **AgentDecision** | `agent_decisions` (S03/S09) | The AI's recommendation and reasoning. |
| **ProposedAction** | `agent_actions` (S10) | The structured business change being proposed. |
| **GuardrailEvaluation** | `guardrail_evaluations` (S10) | The deterministic policy verdict, with policy version + limits snapshot. |
| **Approval** | `approvals` (S03) + the action's own review fields | The human verdict. |
| **Execution** | `agent_actions.executionStatus` | Whether a mutation actually happened. Nothing reaches EXECUTED in Session 10. |

## Action model

A proposed action is never an arbitrary JSON blob. Each type in the closed
registry (`modules/guardrails/actions.ts`) has a **strict** zod payload
schema — unknown keys are validation errors, so a model cannot smuggle
`riskLevel`, `approvalStatus`, or any authorization field into a payload.
Unknown action types fail closed.

**Review-only** (`executionSupport: REVIEW_ONLY` — approving means "yes,
investigate this"; nothing is ever executed):
`PRICING_REVIEW` · `PRODUCT_REVIEW` · `MOQ_REVIEW` · `CRO_REVIEW` ·
`MARKETING_REVIEW` · `CUSTOMER_EXPERIENCE_REVIEW` · `OPERATIONS_REVIEW` ·
`AI_COST_REVIEW` · `DATA_QUALITY_REVIEW` · `SALES_REVIEW` ·
`CRO_EXPERIMENT_PROPOSAL`

They share one payload shape (a question plus its evidence):
`{ title, observation, question, expectedImpact?, limitations[], periodDays?, metricRefs[], evidenceRefs[] }`.

**Representable but not executable** (`NOT_IMPLEMENTED` — a real business
change with no executor): `PRICE_CHANGE` · `PRICE_EXPERIMENT` · `MOQ_CHANGE`
· `AD_BUDGET_CHANGE` · `AD_PAUSE` · `AD_RESUME` · `AD_CREATIVE_TEST` ·
`CRO_EXPERIMENT_LAUNCH` · `AI_COST_CHANGE`

**Never automated** (CRITICAL, permanently human-only): `REFUND` ·
`MANUFACTURING_CHANGE`

Action TYPE and EXECUTION SUPPORT are separate axes on purpose:
`PRICE_EXPERIMENT` is representable today with
`executionStatus = NOT_SUPPORTED`.

### Source permissions

Every action records `sourceAgent`, `sourceDecisionId`, `createdBy`,
`createdAt`, its evidence references, its policy-derived risk and its
guardrail result. **The source does not determine permission** — a CEO
recommendation is not more authorized for coming from a high-level agent:

| Source | May propose |
| --- | --- |
| `CEO_AGENT` | review-only types + `CRO_EXPERIMENT_PROPOSAL` |
| `PRICING_AGENT` | `PRICING_REVIEW`, `PRICE_CHANGE`, `PRICE_EXPERIMENT`, `MOQ_REVIEW` |
| `CRO_AGENT` | `CRO_REVIEW`, `CRO_EXPERIMENT_PROPOSAL`, `CRO_EXPERIMENT_LAUNCH` |
| `GOOGLE_ADS_AGENT` / `META_ADS_AGENT` | `MARKETING_REVIEW`, ad types |
| `HUMAN_ADMIN` | any type — still fully guardrail-evaluated |

A CEO agent asking for a `PRICE_CHANGE` is denied
(`source_not_permitted_for_action_type`) and stored as GUARDRAIL_BLOCKED.
The Sales agent is absent from this table entirely (see "Tool separation").

## Status model

**Approval lifecycle** (`agent_actions.status`):
`PROPOSED` → `GUARDRAIL_BLOCKED` | `PENDING_APPROVAL` → `APPROVED` |
`REJECTED` | `SUPERSEDED`

**Execution lifecycle** (`agent_actions.executionStatus`, independent):
`NOT_APPLICABLE` (review-only) · `NOT_SUPPORTED` (no executor) · `READY` ·
`EXECUTING` · `EXECUTED` · `FAILED` · `ROLLED_BACK`

In Session 10 every action ends at `NOT_APPLICABLE` or `NOT_SUPPORTED`.
Approving does not change the execution status.

## Approval workflow

```
CEO review (S09)  →  pending AgentDecision rows
       │  "Refresh proposed actions"  (deterministic, no model call)
       ▼
ProposedAction  →  evaluateAgentAction()  →  guardrail_evaluations row
       ▼
PENDING_APPROVAL  ──approve──▶ APPROVED   (decision recorded, nothing runs)
       ├──────────reject───▶ REJECTED
       └──────────modify───▶ SUPERSEDED + new revision (re-evaluated)
```

**Approve / Reject.** Records the verdict on the action, mirrors it onto the
decision-level `approvals` row and `agent_decisions.approvalStatus` (so the
Session 09 CEO dedup keeps freezing human-reviewed identities), and appends
an `ai_action_approved` / `ai_action_rejected` history event.

**Modify.** The admin's payload takes the SAME road as an agent's: strict
schema validation, then a full re-evaluation. It inherits no verdict and
bypasses no rule — an edited action that violates a hard rule is stored as
`GUARDRAIL_BLOCKED`. The original is preserved (`SUPERSEDED`, with
`supersededByActionId`), the revision carries `originActionId` and
`revision + 1`, and `createdBy = admin:<user>` records who changed it.
Payloads are never edited in place.

**Evidence may narrow, never grow.** A modification may drop `metricRefs` /
`evidenceRefs` but cannot introduce references the original did not carry
(422 `INVALID`), so a human edit cannot launder fabricated evidence.

## Evidence validation

References are resolved server-side (`lib/data/action-evidence.ts`) against
real `customer_insights` / `product_opportunities` rows before anything is
displayed. Resolved refs render the persisted title/type/status/evidence
count; unresolved refs are shown as **unavailable**, never reconstructed.
The Action Center cannot display a fabricated number as validated evidence:
the numbers come from rows, not from the proposal payload.

This builds on the Session 09 guarantee that the CEO agent could only cite
references the deterministic context actually printed.

## Missing configuration UX

When a business value needed to evaluate an action safely is absent, the UI
says so verbatim — e.g. *"Cannot be approved for automated execution —
missing configuration: config/costs.ts → marginPolicy.minimumGrossMarginBps"*
— listing the exact config path. Missing configuration is **never** rendered
as PASS or as `0`, and never silently omitted.

## Admin authentication + write safety

Same auth as Sessions 08/09 — HTTP Basic from `ADMIN_USER` /
`ADMIN_PASSWORD`, challenged in `proxy.ts` and re-checked in every page and
route; unset credentials ⇒ 404. **No second auth system was created.**

`reviewedBy` is **server-derived** (`adminIdentity()` returns the configured
`ADMIN_USER` after the credentials verify). A client-supplied `reviewedBy`
is not an accepted field at all — the strict body schema rejects the whole
request (422).

Because Basic credentials are sent automatically by the browser, every
mutation route additionally requires (`lib/admin/write-guard.ts`):

1. `POST` (no state change behind a link or an `<img>`)
2. authenticated admin (404 unconfigured / 401 wrong)
3. same-origin `Origin` (or `Referer`); an absent one is treated as hostile
4. `content-type: application/json` — blocks HTML form posts outright
5. a bounded body (413 over the limit) and a strict zod schema (422)

This is a deliberate, tested set of controls, not a claim of full security
compliance. **Known limitation:** Basic auth carries ONE shared operator
identity, so every review reads as the single configured admin. Per-user
RBAC and a per-person audit trail are deferred.

## Idempotency and concurrent review

Every state transition runs inside a transaction with `SELECT … FOR UPDATE`
on the action row and requires the caller's `expectedStateVersion` to match
`agent_actions.stateVersion` (incremented on each transition).

- **Double-clicked Approve** → the second request gets `409 CONFLICT` with
  the current status. Exactly one verdict, one approval event.
- **Two admins, one stale page** → admin B's reject on a stale version gets
  409; admin A's approval stands. History is never rewritten.
- **Sync** is idempotent by a partial unique index
  (`agent_actions_root_decision_idx` on `source_decision_id WHERE
  origin_action_id IS NULL`), so even a concurrent double-run cannot create
  a duplicate root action for one decision.

## Execution boundary

`modules/guardrails/executors.ts` is an empty registry — deliberately. There
are **no dummy executors** that pretend to change things.

Before any executor may be registered it must provide, and be tested for:

1. a schema-validated action at a specific revision
2. a fresh guardrail evaluation (never a cached/inherited verdict)
3. the required human approval, recorded with a server-derived identity
4. an idempotency key (`idempotencyKeyFor(actionId, revision)`) so a retry
   cannot apply twice
5. captured before/after state
6. an audit event on success AND on failure
7. rollback metadata where the underlying system permits it
8. `executionStatus` transitions: `READY → EXECUTING → EXECUTED | FAILED`
   (`→ ROLLED_BACK`)

**Permanent invariant:** no future agent may call a pricing, ads, catalog or
payment mutation directly. The path is always
`Agent → ProposedAction → Guardrail → Approval → Executor`.

## Tool separation — customer transactions vs business management

| | CUSTOMER TRANSACTION TOOLS | BUSINESS MANAGEMENT ACTIONS |
| --- | --- | --- |
| Examples | `searchProducts`, `calculatePrice`, `saveCustomerNeed`, `addConfiguredProductToCart` | `PRICING_REVIEW`, `AD_BUDGET_CHANGE`, `REFUND` |
| Who acts | The Sales agent, on behalf of one customer, in-session | Business agents proposing changes to the business |
| Authority model | Permission-tiered typed tools + server-minted context + price-free schemas + **customer confirmation** | Guardrail Engine + **owner approval** |
| Effect | Reversible, customer-visible, already server-validated | Would change the business; today, nothing executes |

The two systems are structurally separate and tested as such: no commerce or
sales file imports `modules/guardrails` or the action service, and no sales
tool name appears in the action taxonomy. Existing cart/checkout flows are
NOT routed through the Action Center.

## First-party events

Action history lives in the append-only `agent_action_events` table:
`ai_action_proposed` · `ai_action_guardrail_blocked` · `ai_action_approved` ·
`ai_action_rejected` · `ai_action_modified`, each with a server-derived
actor.

These are **admin** events and deliberately do NOT go into the `events`
table: that taxonomy is the customer journey (every row requires a session)
and its rows feed third-party analytics copies. Business-action payloads
stay first-party only and are never sent to third-party analytics.

## Session 11 — CRO decisions enter here too

`syncDecisionsToActions` now materializes PENDING decisions from BOTH the CEO
and CRO agents (still deterministic, still no model call, still idempotent at
the database level):

| CRO proposal kind | Action type | Risk | Execution |
| --- | --- | --- | --- |
| `EXPERIMENT` | `CRO_EXPERIMENT_PROPOSAL` (carries the validated design) | LOW | `REVIEW_ONLY` → `NOT_APPLICABLE` |
| `REVIEW` | `CRO_REVIEW` (business/product question) | LOW | `REVIEW_ONLY` → `NOT_APPLICABLE` |

Any other agent type maps to nothing — a new agent gets no action taxonomy by
accident.

**Approving a CRO_EXPERIMENT_PROPOSAL still executes nothing.** It records
"yes, this concept is approved". Turning that into live traffic takes two
further explicit human acts on `/admin/experiments`: *Create drafts from
approved proposals* (deterministic, idempotent, re-validated against the
CURRENT target registry and traffic ceiling) and *Launch*. The executor
registry remains empty — see docs/EXPERIMENTATION.md §19.

## Session 12 — pricing decisions enter here too

`syncDecisionsToActions` now materializes PENDING decisions from the CEO, CRO
**and Pricing Intelligence** agents. Every pricing recommendation type maps to
a REVIEW-ONLY action type:

| Pricing recommendation type | Action type | Risk | Execution |
| --- | --- | --- | --- |
| `PRICING_REVIEW` | `PRICING_REVIEW` | LOW | `REVIEW_ONLY` → `NOT_APPLICABLE` |
| `TIER_STRUCTURE_REVIEW` | `PRICING_REVIEW` | LOW | `REVIEW_ONLY` → `NOT_APPLICABLE` |
| `PRICE_PRESENTATION_REVIEW` | `PRICING_REVIEW` | LOW | `REVIEW_ONLY` → `NOT_APPLICABLE` |
| `PRICE_EXPERIMENT_REVIEW` | `PRICING_REVIEW` | LOW | `REVIEW_ONLY` → `NOT_APPLICABLE` |
| `MOQ_REVIEW` | `MOQ_REVIEW` | LOW | `REVIEW_ONLY` → `NOT_APPLICABLE` |
| `DATA_QUALITY` | `DATA_QUALITY_REVIEW` | LOW | `REVIEW_ONLY` → `NOT_APPLICABLE` |

`PRICE_CHANGE` and `PRICE_EXPERIMENT` are deliberately **absent from that
table**, so no pricing recommendation can become an executable price action by
any mapping — and the agent's output schema has no price field to carry one
anyway (docs/PRICING_INTELLIGENCE.md §14).

A human admin may still propose `PRICE_CHANGE` directly. It is evaluated, and
today it always lands as PENDING_APPROVAL with `executionEligible: false`,
`executionStatus: NOT_SUPPORTED`, `price_floor_unverified` violated, and
missing configuration naming `config/costs.ts → marginPolicy.*` plus
`config/guardrails.ts → GUARDRAIL_LIMITS.maximumPrice{Decrease,Increase}Pct`.
Approving it records the owner's decision and changes no price.

## Known limitations

- Single shared admin identity (Basic auth); no per-user RBAC or per-person
  audit trail.
- Magnitude-based risk escalation is not implemented — it would require
  inventing thresholds. Missing limits block automated execution instead.
- The Action Center inherits the storefront layout chrome, like the S08/S09
  admin pages.
- Modification is a JSON payload editor, not a per-field form. It is
  validated and re-evaluated server-side, so an invalid edit is refused —
  but it expects an operator comfortable with the structured payload.
- Sync materializes actions from **pending** CEO decisions only; an already
  reviewed recommendation is history, not a pending question.
- Bounded loads (500 rows) — same posture as S08/S09; revisit at real volume.
