# CRO Agent (Session 11)

Authoritative specification of the conversion-rate agent. Companion
document: [EXPERIMENTATION.md](EXPERIMENTATION.md) (the deterministic engine
it proposes into).

---

## 1. What it is

`lib/ai/agents/cro/` — a **RECOMMEND-only** agent that reads deterministic
first-party conversion data and proposes fully-specified experiments, or
flags business problems that an experiment would only paper over.

```
OBSERVE (deterministic numbers)
  → HYPOTHESISE
  → PROPOSE (validated, closed-schema design)
  → AgentDecision row
  → Guardrail Engine
  → Human approval in /admin/ai-actions
  → Human creates a draft
  → Human launches
```

It never launches, measures, allocates traffic, declares a winner, edits
source code, changes pricing or checkout, or approves its own work.

---

## 2. Structural boundaries

Mirrors the Session 09 CEO agent, and asserted by
`tests/experiments-separation.test.ts`:

- **NO tools.** One `generateStructuredObject` call at the REASONING tier
  over a deterministic context. No tool registry, no `runToolConversation`,
  no execute path.
- **Writes AgentDecision rows and nothing else.** It does not import
  `lib/data/agent-action-service` (agents never approve their own work),
  does not call `createExperimentDraft`, `launchExperiment`,
  `stopExperiment`, `recordAssignment` or `markExposed`, and contains no
  pricing, checkout, catalog or ads mutation call.
- **Autonomy is clamped by policy.** `AGENT_AUTONOMY_POLICY.CRO_AGENT` is
  `{ defaultMode: RECOMMEND, maxMode: RECOMMEND }`. A tampered
  `agent_configs` row grants nothing.
- **Source permissions are closed.** `SOURCE_PERMITTED_ACTION_TYPES.CRO_AGENT`
  = `CRO_REVIEW`, `CRO_EXPERIMENT_PROPOSAL`, `CRO_EXPERIMENT_LAUNCH`. A
  "lower all prices" proposal is denied by permission, not by prompt
  wording — and `CRO_EXPERIMENT_LAUNCH` has no executor, so even that grants
  nothing.
- **Explicit trigger only.** `POST /api/admin/experiments/cro-review` behind
  the admin write guard. Page loads never call the model.

---

## 3. Inputs (the only things it can cite)

`buildCroContext()` renders a bounded, PII-free text context from:

- the Session 09 `BusinessHealthSnapshot` (funnel rates, AI sales funnel,
  attribution, customer signals, insights, opportunities)
- the Session 11 funnel **drop-off** (`modules/business-intelligence/dropoff.ts`)
- the deterministic **readouts of existing experiments**
- the **closed target registry**, with each target's control description and
  its variant-config field list
- the rules the server enforces (traffic ceiling, sample floor, plain-text
  copy, protected surfaces)

Two whitelists are built while printing and used afterwards to validate the
model's output:

- `validMetricRefs` — every `[key]` printed
- `validEvidenceRefs` — every insight / opportunity / experiment id printed

Nothing else exists to cite. "18 of 64 qualified product sessions asked
about delivery timing" can only appear in a proposal if the context actually
said so.

---

## 4. Output schema

`croReviewSchema` → `{ summary, frictionObservations[], proposals[],
experimentNotes[] }`, capped at `EXPERIMENTS.MAX_PROPOSALS_PER_REVIEW` (6).

Each proposal (`croProposalSchema`):

```
kind                  EXPERIMENT | REVIEW
title, observation, hypothesis
targetKey             (EXPERIMENT) validated against the closed registry
experimentType        closed enum, must match the target
variantSummary
variantConfig         string map, validated against the target's strict schema
primaryMetric         closed enum
secondaryMetrics[]    closed enum
guardrailMetrics[]    closed enum
proposedTrafficPct    a REQUEST; the server caps it
minimumSampleSize     may only RAISE the documented floor
supportingMetricRefs  ≥1, validated against the context
evidenceRefs          validated against the context
expectedImpact, confidence, riskLevel, limitations[]
```

The model **cannot express**: a component path, HTML/CSS/JS, a price, an
audience of its own invention, a statistical claim, or a launch.

---

## 5. EXPERIMENT vs REVIEW — the honesty rule

`kind: EXPERIMENT` is for a presentation/clarity question a copy test can
answer (unclear wording, a missing expectation, a weak call to action).

`kind: REVIEW` is for evidence pointing at a **business or product problem**
— minimum order quantity, real delivery times, a product we do not make, a
price level. Those need a human business decision and map to `CRO_REVIEW`,
never to an experiment.

> Do not try to "hide" legitimate customer objections through CRO.

This is stated in the prompt AND enforced by the mapping: a REVIEW-kind
proposal carries no design, so it can never be materialized into a running
experiment.

---

## 6. Server-side validation (what actually protects us)

Applied in `lib/ai/agents/cro/agent.ts` after the model returns:

| Check | Failure behaviour |
| --- | --- |
| metric refs ∈ `validMetricRefs` | filtered; **zero valid refs ⇒ proposal dropped** |
| evidence refs ∈ `validEvidenceRefs` | filtered silently |
| `targetKey` ∈ target registry | dropped + logged |
| `experimentType` matches the target | dropped + logged |
| `variantConfig` satisfies the target's strict schema (markup, unknown keys, oversize copy) | dropped + logged |
| `primaryMetric` ∈ closed list | schema-level rejection |
| audience | **ignored** — the server derives it from the target's routes |
| allocation | **server-built**, `min(request, cap, 50)` |
| `minimumSampleSize` | `max(model value, documented floor)` |

Nothing is repaired into something plausible; a failing proposal is dropped
and the reason is surfaced to the admin.

Dedup: `identityKey = CRO:<kind>:<targetKey>:<sorted refs>:<periodDays>`.
Pending decisions with the same identity are refreshed in place; a decision a
human has already approved/rejected/modified is **frozen** and never
overwritten by regeneration.

---

## 7. Action Center integration

CRO decisions are materialized by the same deterministic sync as CEO
decisions (`syncDecisionsToActions`, "Refresh proposed actions" in
`/admin/ai-actions` — no model call):

| CRO proposal | Action type | Risk | Execution |
| --- | --- | --- | --- |
| `EXPERIMENT` | `CRO_EXPERIMENT_PROPOSAL` | LOW | `REVIEW_ONLY` → `NOT_APPLICABLE` |
| `REVIEW` | `CRO_REVIEW` | LOW | `REVIEW_ONLY` → `NOT_APPLICABLE` |

The `CRO_EXPERIMENT_PROPOSAL` payload gained a nullable `design` field in
Session 11 (`modules/experiments/proposal.ts`), so what a human approves is
the exact, registry-validated experiment — not a paragraph that could later
be interpreted loosely.

**Approving a proposal launches nothing.** It records "yes, this concept is
approved". A human then presses *Create drafts from approved proposals*
(deterministic, idempotent, re-validated against the CURRENT registry and
traffic ceiling), and then *Launch*. Three separate acts.

---

## 8. Result interpretation

The agent may summarise a completed experiment in plain language:

> "Variant B had a higher observed add-to-cart rate and met the configured
> statistical threshold."

It may **not** say "this will always improve sales", restate or revise a
result state, or predict one. The state, the counts, the z-score and the
p-value all come from `modules/experiments` and are handed TO the model —
the prompt says so explicitly, and the model has no arithmetic authority
anywhere in the system.

---

## 9. Failure modes

| Situation | Behaviour |
| --- | --- |
| provider down | `status: "failed"`, **nothing persisted** |
| AI budget exceeded | `status: "failed"`, **nothing persisted** |
| `AI_CRO_AGENT` off | `status: "unavailable"`, nothing persisted |
| invalid model output | bounded retry, then `AI_INVALID_RESPONSE`; nothing persisted |

In every case: running experiments keep running, assignment and exposure
keep working, metrics keep computing, `/admin/experiments` keeps rendering.
**Active experiments never depend on LLM availability.**

---

## 10. Prompt

`ai_cro_experiment_review` v1.0.0 (`lib/ai/prompts/registry.ts`). Every AI
usage row records the prompt id + version and the model, so any proposal is
traceable to exactly what produced it.

Prompt rules, in short: use only the numbers given; never call an experiment
a winner; propose REVIEW for business problems; copy target keys exactly;
plain-text variants only; no dark patterns; observational language; cite at
least one real metric reference; an empty proposals array is a valid answer.

---

## 11. Deferred

- `GUARDED_AUTO` CRO (needs operating history, configured limits, and an
  explicit human decision — roadmap Stage J)
- automatic winner promotion (permanent site changes stay human)
- adaptive traffic allocation / bandits / RL (never, by design at this stage)
- price experiments (Session 12 Pricing Intelligence)
- scheduled CRO reviews (an explicit admin action today)
