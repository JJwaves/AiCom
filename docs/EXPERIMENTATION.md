# Experimentation — the Experiment Engine (Session 11)

Authoritative specification of BagDirect's controlled-experiment system.
Companion document: [CRO_AGENT.md](CRO_AGENT.md) (who proposes experiments).

---

## 1. Core principle

**The experiment system is deterministic. The AI is not part of it.**

The LLM may identify friction, interpret metrics, form a hypothesis, propose
an experiment, and explain a finished result in words.

Deterministic software owns:

| Concern | Owner |
| --- | --- |
| eligibility | `modules/experiments/eligibility.ts` |
| traffic allocation | `modules/experiments/allocation.ts` |
| variant assignment | `modules/experiments/assignment.ts` (pure hash) |
| exposure logging | `lib/experiments/server.ts` + `experiment_assignments.exposed_at` |
| metric calculation | `lib/data/experiment-metrics-service.ts` (SQL) |
| sample counts | `lib/data/experiment-service.ts` |
| experiment status | `modules/experiments/lifecycle.ts` |
| statistical result | `modules/experiments/statistics.ts` |
| winner determination | `modules/experiments/results.ts` |

`modules/experiments` imports **neither `lib/ai` nor `db/`** — a structural
rule asserted by `tests/experiments-separation.test.ts`. A model cannot
influence an assignment, a count, or a verdict, and it never invents a
result.

---

## 2. Lifecycle

```
OBSERVATION  (deterministic funnel / drop-off / customer signals)
   ↓
HYPOTHESIS  (CRO agent, or a human)
   ↓
EXPERIMENT PROPOSAL  → AgentDecision row
   ↓
GUARDRAIL EVALUATION  → CRO_EXPERIMENT_PROPOSAL action (modules/guardrails)
   ↓
HUMAN APPROVAL  → /admin/ai-actions
   ↓
DRAFT EXPERIMENT  → "Create drafts from approved proposals" (deterministic)
   ↓
EXPLICIT HUMAN LAUNCH  → POST /api/admin/experiments/[id]/launch
   ↓
TRAFFIC ASSIGNMENT → EXPOSURE → DETERMINISTIC MEASUREMENT
   ↓
RESULT  →  WINNER / INCONCLUSIVE / INSUFFICIENT DATA
```

**Approval ≠ launch ≠ permanent change.** Three separate human acts.

Statuses: `draft → approved → running → stopped → decided → archived`
(`modules/experiments/lifecycle.ts` holds the transition table). Only
`running` enrols traffic. Every transition is idempotent: re-issuing the
transition an experiment is already in is a no-op success.

---

## 3. Experiment types

Supported taxonomy (`modules/experiments/types.ts`):

`HERO_COPY` · `CTA_COPY` · `SHIPPING_MESSAGE` · `PRICING_PRESENTATION` ·
`FAQ_PLACEMENT` · `PRODUCT_IMAGE` · `CONFIGURATOR_UI` ·
`LANDING_PAGE_VARIANT`

A type is only usable where a **target** registers it, and Session 11
registers three targets covering three types (§4). The remaining types are
declared so the vocabulary is stable, not because a surface exists.

**Deliberately NOT supported**, and named so a proposal is refused by name:
`PRICE_EXPERIMENT`, `CHECKOUT_EXPERIMENT`. Price authority belongs to
`modules/pricing` and Session 12 Pricing Intelligence.

---

## 4. Target registry (the closed allow-list)

A surface is experimentable **only** by appearing in
`modules/experiments/targets.ts`. Unknown target ⇒ fail closed everywhere:
agent output validation, guardrail payload validation, draft creation,
launch, and render.

| targetKey | Type | Surface | Rendered by |
| --- | --- | --- | --- |
| `product.shipping_message` | SHIPPING_MESSAGE | Product configurator, next to Add to cart | `components/product/ProductConfigurator.tsx` |
| `product.primary_cta` | CTA_COPY | Add-to-cart button label + helper line (desktop and sticky mobile bar) | `components/product/ProductConfigurator.tsx` |
| `homepage.hero` | HERO_COPY | Homepage hero headline / sub-headline / button label | `app/page.tsx` |

Each target declares: the one experiment type it accepts, its strict variant
schema, a `targetVersion` (snapshotted per experiment), the routes it renders
on, the component that renders it, its **protected fields**, and a
`describeControl()` used for the launch-time snapshot.

### Protected surfaces (§4 of the session spec)

Never experimentable, and structurally impossible because no target exists:

- checkout payment internals
- pricing authority (`modules/pricing`, `config/costs.ts`)
- authentication and admin surfaces
- privacy / consent controls
- factory capability and delivery claims
- deterministic product validation
- the 409 REPRICED drift path

CRO experiments may change **presentation**. They may not change **commerce
authority**.

---

## 5. Safe variant model

A variant is a CLOSED, strictly-typed record of presentation VALUES that an
existing component already knows how to render. There is no code path
anywhere in the repository that turns experiment data into markup.

```ts
HeroCopyVariant        { headline, subheadline?, ctaLabel? }
CtaCopyVariant         { ctaLabel, helperText? }
ShippingMessageVariant { message, placement: "above_cta" | "below_cta" }
```

Schemas are `.strict()` (unknown keys are errors, never stripped) and every
text field runs through `safeText`, which refuses angle brackets, braces,
backslashes, backticks, template interpolation, `javascript:` / `data:` URLs,
inline event handlers, HTML entities and control characters.

**No AI-generated HTML, JavaScript, React, or CSS is storable or renderable.**

---

## 6. Control source of truth

The control arm renders the application's **own current UI, with no override
at all**. Experiments never duplicate a page; they override only explicitly
allowed presentation fields for the non-control arm.

`experiments.control_json` stores a launch-time *snapshot* of what the
control looked like (`describeControl()`), purely so a historical report
stays interpretable if the base site changes later (§12). It is never
rendered.

With the experiment engine disabled, or with no running experiment, the page
renders exactly as it did before Session 11.

---

## 7. Assignment

`assignVariant({ experimentId, salt, sessionId, allocation })` is a **pure
function**: FNV-1a over `experimentId|salt|sessionId` → a bucket in
`[0, 10000)` → the arm that owns that bucket in the normalized (control-first)
allocation.

Consequences:

- **Sticky by construction.** The same session always resolves to the same
  arm, before any row exists. The `experiment_assignments` row is a *record*
  of the assignment, not its source of truth, so a lost write can never move
  a customer between arms.
- **No flicker, no re-randomisation per page view.**
- **Arms are independent across experiments** — the per-experiment
  `assignment_salt` prevents "always the variant session".

An existing assignment always wins, so editing an allocation mid-flight can
never reassign anyone.

---

## 8. Traffic split

`traffic_split_json` stores WHOLE PERCENTS per arm and must total exactly
100. Validation (`validateAllocation`) rejects: totals ≠ 100, negatives,
duplicate keys, a missing control arm, zero variant traffic, and more than
control + one variant (Session 11 MVP — multi-arm needs a
multiple-comparison correction that is deliberately not implemented).

The **non-control share** is the fraction of eligible traffic the experiment
takes, and it is capped:

```
config/experiments.ts → resolveTrafficCap()
  1. GUARDRAIL_LIMITS.maximumExperimentTrafficPct when the owner set it
  2. otherwise, NON-PRODUCTION ONLY: EXPERIMENTS.DEV_ONLY_MAX_TRAFFIC_PCT (50)
  3. otherwise (production, limit unset): BLOCKED, naming the config path
```

A `null` limit is **never** read as "no limit" and never as 100%. In
production a missing limit blocks the launch outright.

---

## 9. Eligibility

Selectors (`audienceSchema`) are deliberately few and first-party:

- route prefix
- first-touch traffic source / medium
- campaign
- device category (`any | mobile | desktop`)
- new vs returning (`any | new | returning`)

**Ambiguity never enrols.** If a selector is set and the corresponding
context value is unknown, the session is excluded — an unknown device is not
a desktop. No sensitive personal characteristic is expressible: the schema
has no field for one, and unknown keys are validation errors.

Excluded unconditionally: `/admin` and `/api/admin` paths, and obvious
automation (a small user-agent check — deliberately not a bot-defence
system).

---

## 10. Server-side resolution, exposure, and the cost of both

`lib/experiments/server.ts` resolves targets during the **server render** of
the page that hosts the surface, so the HTML the browser receives already
contains the right arm. No client-side swap ⇒ no flicker, no layout shift,
no hydration mismatch, and no bias in the metric being measured.

**Documented consequences:**

1. **Reading the session cookie makes the hosting page dynamically
   rendered.** With `EXPERIMENT_ENGINE` off, the engine reads nothing at all
   and pages stay static exactly as before Session 11. With it on, `/` and
   `/products/[slug]` render on demand. **Toggling the flag requires a
   rebuild/redeploy** — like every other server flag in this repo.
   (`cookies()`/`headers()` are called before the database lookup and
   outside the defensive try/catch on purpose: querying first would
   short-circuit during the build and silently prerender the page, and
   catching Next's dynamic-usage signal would do the same.)

2. **Enrolment requires an existing first-party session.** Session rows are
   minted by persisting API routes (`/api/events`), not by page renders, and
   a Server Component cannot set a cookie. A brand-new browser's very first
   render sees control and is not enrolled; from the next navigation onward
   it is eligible. This costs sample, **not validity** — non-enrolment
   happens strictly before any arm is chosen, so it cannot differ between
   control and variant.

3. **Failure degrades to control.** Any error inside resolution logs and
   renders the normal page (same posture as first-party event persistence).

### Assignment vs exposure

| | Meaning | Counted from |
| --- | --- | --- |
| assignment | this session belongs to this arm | `experiment_assignments` row |
| exposure | this session actually rendered the surface | `exposed_at is not null` |

`exposed_at` is stamped exactly ONCE per (experiment, session), and the
first-party `experiment_exposed` event is emitted exactly then — so repeat
page views never inflate the denominator, and there is no database write per
page view. Both counts are reported separately in the admin UI.

---

## 11. Metrics

Every metric is an existing first-party event name — the numerator is a
deterministic SQL query, never an AI-inferred conversion.

- **Primary** (may declare a winner): `configurator_started`, `price_viewed`,
  `add_to_cart`, `checkout_started`, `purchase_completed`
- **Secondary** (reported only): `ai_chat_started`, `artwork_uploaded`,
  `quote_started`, `quote_submitted`, `ai_product_recommended`,
  `human_handoff_requested`
- **Guardrail** (must not degrade): `purchase_completed`, `checkout_started`,
  `add_to_cart`, `quote_started`, `human_handoff_requested`

Definitions, applied identically everywhere:

- **Denominator** = distinct EXPOSED sessions in the arm. Assigned-but-never-
  exposed sessions are excluded — they never saw the thing being tested.
- **Numerator** = distinct exposed sessions with ≥1 event of the metric name
  **at or after** that session's exposure timestamp. A conversion before
  exposure is not credited to the variant; repeat conversions in one session
  count once.

**Deliberately absent guardrail metrics**, because no deterministic
per-session source exists: checkout error rate (no error event is recorded),
AI failure rate (server logs / `ai_usage`, not session-scoped), and
contribution profit (`config/costs.ts` is unconfigured, and an unavailable
metric is never turned into an experiment guardrail).

### Funnel drop-off

`modules/business-intelligence/dropoff.ts` gives CRO the sequential view:
product views → configurator starts → price views → cart adds → checkout
starts → purchases, each step with an explicit denominator and the raw
counts alongside the rate. Ordering is the site's funnel, **not** proof a
session passed through the earlier step (sessions can enter mid-funnel).

---

## 12. Minimum sample

`EXPERIMENTS.DEFAULT_MINIMUM_SAMPLE_PER_VARIANT = 1000` exposed sessions per
arm.

This is a deliberately conservative **development default**, not a power
calculation — a real minimum detectable effect needs a baseline conversion
rate and an effect size the owner has not provided
(`BUSINESS_CONFIG_TODO.md`). An experiment may **raise** it; nothing can
lower it (`effectiveMinimumSample`). No winner may be declared below it —
enforced in `results.ts`, not in a prompt.

---

## 13. Statistical method

**Two-proportion z-test, two-sided, pooled standard error.**

```
p̂1 = c1/n1,  p̂2 = c2/n2,  p̄ = (c1+c2)/(n1+n2)
SE  = sqrt( p̄(1−p̄)(1/n1 + 1/n2) )
z   = (p̂2 − p̂1) / SE
p   = 2(1 − Φ(|z|))            Φ via Abramowitz & Stegun 7.1.26
significant ⟺ |z| ≥ 1.959964   (α = 0.05)
```

**Assumptions**

- The unit is an exposed SESSION, and sessions are treated as independent.
  Two browsers or a cookie clear count twice; we do not model that.
- The metric is BINARY per exposed session ("converted at least once after
  exposure"). Revenue is not modelled at all.
- Assignment is deterministic-by-hash — the closest practical substitute for
  randomisation; unbiased with respect to the metric, but not a random draw.
- Normal approximation requires every cell (conversions and non-conversions
  in each arm) to reach `MIN_EXPECTED_COUNT_PER_CELL = 5`.

**Minimum-sample behaviour** — below the threshold the engine reports
`RUNNING` (or `STOPPED`) and produces **no** z, p-value, or winner.

**Limitations (deliberate, documented, not worked around)**

- No sequential-testing / always-valid correction. Peeking inflates false
  positives, which is exactly why the sample gate exists.
- No multiple-comparison correction — control + one variant, one primary
  metric. Secondary and guardrail metrics never declare a winner.
- No Bayesian posterior, no confidence intervals on lift, no power analysis.
- The LLM never computes, adjusts, or overrides anything here.

---

## 14. Result states

| State | Meaning |
| --- | --- |
| `INVALID` | the stored configuration no longer validates — do not trust the numbers |
| `RUNNING` | still enrolling; the minimum sample per arm is not met |
| `STOPPED` | a human ended it before the minimum sample was met |
| `INSUFFICIENT_DATA` | sample met, but the test's preconditions are not |
| `CONTROL_WIN` | \|z\| ≥ critical and control converts better |
| `VARIANT_WIN` | \|z\| ≥ critical and the variant converts better |
| `NO_CLEAR_WINNER` | thresholds met, difference not significant |

**Inconclusive is a valid result.** No experiment is forced to produce a
winner, and every readout renders its caveats next to the numbers.

---

## 15. Overlap rules

**One RUNNING experiment per target**, enforced by a partial unique index
(`experiments_running_target_idx`) — a race loses at the database, not at a
hopeful pre-check. Launching a second experiment on a busy target returns
`409 TARGET_BUSY`.

Different targets may run simultaneously. Two experiments on the same page
but different targets are independent by construction (per-experiment salt);
interaction effects between them are **not** modelled and are a known
limitation at this scale.

---

## 16. Launch / stop

### Launch (explicit, human, guarded)

`POST /api/admin/experiments/[id]/launch` — the only path to live traffic.
The CRO agent has no route to it (asserted structurally). Preconditions:

1. the stored configuration still validates against the target registry;
2. the traffic ceiling resolves (§8);
3. the allocation fits under that ceiling;
4. the Guardrail Engine allows a `HUMAN_ADMIN` `CRO_EXPERIMENT_LAUNCH` for
   this configuration — the verdict, policy version, limits snapshot and
   missing configuration are snapshotted onto the row;
5. no other experiment is running on the same target.

Idempotent: launching a running experiment returns success and writes
nothing. Guarded by `stateVersion` under a row lock, so a double-click or a
stale second admin gets `409 CONFLICT`.

**There is no executor.** `modules/guardrails/executors.ts` is still empty —
see §19.

### Stop

`POST /api/admin/experiments/[id]/stop`. Stopping prevents new assignment and
exposure and **deletes nothing**: assignments, exposure events and
conversions are preserved, and the deterministic readout at stop time is
frozen onto `result_json` (evaluated *as stopped*) so later configuration
changes cannot rewrite what was concluded. Previously assigned sessions see
the normal control experience again from their next page view — the override
only exists while the experiment is running. Idempotent.

---

## 17. Snapshotting (historical stability)

Persisted at creation/launch so a report stays interpretable years later:
`control_json` (control snapshot), `variants_json` (validated variant
config), `traffic_split_json`, `audience_json`, `target_key` +
`target_version`, `primary_metric` + `secondary_metrics_json` +
`guardrail_metrics_json`, `minimum_sample_size`, `assignment_salt`,
`policy_version` + `policy_snapshot_json`, and the append-only
`experiment_events` timeline.

A stopped experiment additionally carries its frozen `result_json`.

---

## 18. Feature flags

| Flag | Effect when OFF |
| --- | --- |
| `EXPERIMENT_ENGINE` | no resolution, no assignment, no exposure, control experience everywhere; `/admin/experiments` and every experiment API route 404; pages render statically as before |
| `AI_CRO_AGENT` | no CRO proposals can be generated; everything above still works |

Commerce is fully functional with every flag off. Experiments are additive.

---

## 19. Execution boundary

`CRO_EXPERIMENT_LAUNCH` remains a registered action type with
`executionSupport: NOT_IMPLEMENTED` and `executionStatus: NOT_SUPPORTED`,
and `GUARDRAIL_LIMITS.maximumExperimentTrafficPct` is still
`[TO BE PROVIDED]`.

Session 11 therefore ships **a secure human-admin launch route, not an
executor** (the session spec's explicit fallback). Reasons, recorded:

- The executor registry stays empty, so the Session 10 invariant holds
  system-wide: **approving an action executes nothing.**
- An executor would be permanently blocked anyway while the traffic limit is
  unset — a registered-but-unusable executor is exactly the "fake executor"
  the doctrine forbids.
- A launch is a human decision with an audit trail
  (`experiment_events.launched` + the guardrail verdict snapshot), not an
  autonomous capability.

Registering a real `CRO_EXPERIMENT_LAUNCH` executor later requires the full
contract in [AI_ACTION_CENTER.md](AI_ACTION_CENTER.md) **and** a configured
`maximumExperimentTrafficPct`.

---

## 20. Winner promotion boundary

A `VARIANT_WIN` **does not** change the site. Session 11 never modifies base
content or configuration automatically. Promoting a winner is a human change
to the source/config, optionally preceded by a
`CUSTOMER_EXPERIENCE_REVIEW` / `CRO_REVIEW` action recording the intent.

Stopping a winning experiment returns everyone to control — which is the
honest state until a human makes the change permanent.

---

## 21. Ethical CRO boundary

CRO optimises **clarity**, not deception. The following are prohibited, in
the prompt AND by construction (the variant schemas cannot express most of
them):

- fake scarcity, countdowns, or any false urgency
- fabricated social proof, reviews, or customer counts
- hidden fees or misleading price comparisons
- pre-selected paid upgrades
- obscured cancel / back behaviour
- delivery promises, prices, guarantees or certifications the business
  cannot honour

And a rule that matters more than any of them: **a legitimate customer
objection is never "solved" by hiding it.** When the evidence points at a
business or product problem — MOQ too high, a product we do not make, real
delivery times — the CRO agent must raise a `CRO_REVIEW`, not a copy test
designed to obscure it (see [CRO_AGENT.md](CRO_AGENT.md) §5).

---

## 22. Pricing-experiment boundary

Session 11 connects **no** pricing mutation to CRO:

- no price or checkout target is registered;
- `PRICE_EXPERIMENT` / `CHECKOUT_EXPERIMENT` are named as unsupported;
- `SOURCE_PERMITTED_ACTION_TYPES.CRO_AGENT` excludes `PRICE_CHANGE` and
  `PRICE_EXPERIMENT`;
- `modules/experiments` and `lib/experiments` import neither
  `modules/pricing` nor `config/costs` (asserted by tests).

Price experiments belong to Session 12 Pricing Intelligence.

---

## 23. Known limitations

- **First render of a brand-new browser is not enrolled** (§10.2).
- **Visitor type (new vs returning) is not yet deterministically known**, so
  a `visitor`-targeted audience never enrols. The selector exists; the signal
  does not.
- **Enabling the flag requires a redeploy** for the hosting pages to become
  dynamic (§10.1).
- **Interaction between concurrent experiments on different targets is not
  modelled.**
- **No sequential testing** — read results at the threshold, not
  continuously (§13).
- **`/admin/experiments` inherits the storefront layout chrome** and the
  bounded-load posture of S08–S10 (500 rows).
- **The draft form is a JSON design editor**, not a per-field builder. It is
  fully validated server-side, but it expects an operator comfortable with
  the structured payload (same posture as the S10 Modify control).
- Exposure is written during a Server Component render; in dev, React's
  double-render can call it twice — the `exposed_at` dedup makes that a
  no-op.
