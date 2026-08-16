# Pricing Intelligence (Session 12)

**Authoritative spec for `modules/pricing-intelligence`, `lib/ai/agents/pricing`,
`/admin/pricing-intelligence` and the pricing half of the Action Center taxonomy.**

The one-sentence version:

> **The Pricing Agent provides intelligence. The deterministic Pricing Engine
> keeps pricing authority.**

Session 12 adds the ability to *understand* pricing performance and to *ask a
human to look at something*. It adds no ability to change a price, and it is
built so that adding one would require deleting code and tests, not adding a
feature flag.

---

## 1. What Session 12 can and cannot do

| | |
|---|---|
| **Can** | measure the pricing funnel · compare requested / configured / purchased quantities · analyse quantity-tier performance · separate price questions from price objections · separate MOQ friction from price friction · grade pricing signals by counted evidence · report what cost/margin data is missing · raise pricing REVIEWS for a human |
| **Cannot** | set a price · compute an "optimal" price · estimate elasticity · modify price tables, tiers, MOQ or discounts · bypass a margin floor · give one customer a different price · change a checkout total · launch a price experiment · execute anything at all |

The lifecycle, unchanged from the session brief:

```
PRICING DATA → DETERMINISTIC ANALYSIS → PRICING SIGNALS → AI INTERPRETATION
  → PRICING RECOMMENDATION → GUARDRAIL EVALUATION → AI ACTION CENTER → HUMAN REVIEW
```

Execution is deferred. There is no price executor and the guardrail executor
registry is still empty.

---

## 2. Architecture

```
events / orders / order_lines / product_configurations / need profiles /
conversation_classifications          (existing first-party data, S03–S08)
        │
        ▼
lib/data/pricing-intelligence-service.ts   ← the only NEW read path
lib/data/intelligence-service.ts           ← reused, not duplicated (S08)
        │
        ▼
modules/pricing-intelligence/              ← DETERMINISTIC AUTHORITY
  tiers · funnel · demand · tier-performance · realization · moq ·
  products · breakdowns · signals · readiness · snapshot · report
  ── NO lib/ai import (asserted structurally)
  ── NO price mutation path (asserted structurally)
        │
        ▼  PricingIntelligenceSnapshot (JSON-serializable, PII-free)
        │
        ├─────────────────────────────► /admin/pricing-intelligence (no AI)
        │
        ▼
lib/ai/agents/pricing/                     ← RECOMMEND, no tools, one call
  context (builds the citation whitelists) · schema (no price field) · agent
        │
        ▼  AgentDecision rows + one pricing_reports document
        ▼
modules/guardrails  →  evaluateAgentAction()  →  /admin/ai-actions  →  HUMAN
```

`modules/pricing` (engine + cost model) is **read** by this layer and never
written by it. A test asserts neither `engine.ts` nor `cost-model.ts` mentions
pricing intelligence, and that no commerce/cart/checkout/configuration file
imports it.

---

## 3. Data sources

Only existing first-party data. **No second pricing analytics source of truth
was introduced.**

| Source | Used for |
|---|---|
| `config/products.ts` via `lib/commerce/catalog.ts` | tier ladders, MOQ, catalog prices |
| `modules/pricing` (`quoteConfiguration`) | re-pricing stored order configurations |
| `events` (`product_viewed`, `price_viewed`, `quantity_selected`, `add_to_cart`, `checkout_started`, `purchase_completed`, `quote_started`, `human_handoff_requested`) | the pricing funnel |
| `orders` + `order_lines` | purchased quantities, revenue, price realization |
| `product_configurations` | the configured demand lane, band attribution |
| `customer_need_profiles` | the requested demand lane (provenance-split) |
| `conversation_classifications` (S08) | PRICE / MOQ questions and objections |
| `customer_insights`, `product_opportunities` (S08) | evidence references |
| `config/costs.ts`, `config/guardrails.ts` | cost / margin / limit readiness |

---

## 4. Price QUESTION vs price OBJECTION

The Session 08 semantics survive every pricing metric, and the distinction is
tested end to end:

| Customer says | Recorded as | Counted in |
|---|---|---|
| "How much is 5,000?" | `PRICE` **question** | `pricing.conversations.priceQuestion` |
| "That's too expensive." | `PRICE_TOO_HIGH` **objection** | `pricing.conversations.priceObjection` |
| "What is your MOQ?" | `MOQ` **question** | `pricing.conversations.moqQuestion` |
| "500 is too many, I need 200." | `MOQ_TOO_HIGH` **objection** | `pricing.conversations.moqObjection` |

They are never summed into one "price sensitivity" figure. A price inquiry is
never treated as resistance, and asking what the minimum is never contributes
to any price metric.

Repeated questions are tracked separately (`repeatedPriceQuestion`) because
asking twice can mean the answer was unclear, not that the number was wrong —
the signal says so in its own limitations.

---

## 5. Three quantity lanes

Preserved from Session 08 and never merged:

- **REQUESTED** — what prospects *say* they want (`customer_need_profiles`),
  split again by provenance: `USER_STATED` vs `AI_INFERRED`. A model's guess is
  data about our guess and is reported in its own column.
- **CONFIGURED** — what people *build* (`product_configurations`). This is a
  live mutating row, so it reflects latest-state-in-period, not a history
  (documented S08 limitation, inherited).
- **PURCHASED** — what customers *buy* (immutable `order_lines` snapshots).

"Requested 300 · configured 500 · purchased 5,000" is **three findings**, not a
contradiction to resolve. The dashboard prints them side by side and the agent
context labels the lanes explicitly.

Buckets are derived from the REAL catalog: the distinct tier breakpoints across
all products plus a below-MOQ bucket from the strictest `minQuantity`. No
invented ranges — if the owner changes the ladder, the buckets change with it.

---

## 6. Pricing funnel

Two things differ deliberately from the Session 09 business funnel:

1. **Co-occurrence, not stage totals.** "Price view → add to cart" counts
   sessions that did *both*, over sessions that saw a price. Dividing two
   independent stage counts would overstate a pricing conversion.
2. **Real ordering.** "Handoff after price" and "quote after price" require the
   later event to have occurred *at or after* the price view (per-session
   `min`/`max(occurred_at)`). Otherwise a handoff that happened before any price
   was shown would be counted as evidence about price.

Every rate carries its `denominatorDefinition`, and percentages are suppressed
below `MIN_DENOMINATOR_FOR_PERCENTAGE` (5) instead of rendering a misleading
number.

---

## 7. Quantity-tier performance

One row per configured pricing tier (`[tier.minQty, nextTier.minQty)`), plus a
below-MOQ band.

Honest gaps, stated rather than filled:

- **`checkoutSessions` is `null`, not 0.** `checkout_started` records a cart
  value, not a product and quantity, so attributing it to a tier would require a
  guess. The UI renders "unavailable".
- **The displayed unit price is the TIER price**, before per-unit option deltas
  (material, printing). Stated on every surface that renders it.
- **Conversation attribution**: a conversation is attributed to the band of its
  session's *configured* quantity, or a `USER_STATED` requested quantity when no
  configuration exists. Conversations with neither are counted as
  `unattributedConversations` — never spread across bands.

Nothing here is causal. A tier converting better has **not** been shown to
convert *because of* its price.

---

## 8. Price realization and repricing

There are no discounts: the engine is the only price authority and no discount
mechanism exists. So "realization" is deliberately **not** a leakage metric —
inventing one would imply a leak that cannot happen.

What is computed instead is a narrow integrity check: the price actually paid
(the immutable order-line snapshot) versus what the engine would charge for that
same configuration *today*. A difference is reported as
`catalog_price_changed` — legitimate repricing, never leakage.

**Checkout repricing (the 409 `REPRICED` path) is NOT INSTRUMENTED.** The route
answers 409 and the client re-confirms, but no first-party event records it, so
the number of repricing events, confirmations and abandonments after repricing
are all unknown. Session 12 says so and lists the two events that would need to
exist, rather than deriving a figure from something else.

---

## 9. MOQ intelligence

A separate section on purpose. **A customer who wants 200 bags is not telling us
the unit price is too high** — they are telling us the minimum does not fit their
business, and lowering the unit price would not sell them anything.

Reported: below-MOQ requested quantities (stated vs inferred), below-MOQ
configurations, MOQ questions, MOQ objections, below-MOQ handoffs, below-MOQ
purchases (expected to be zero — the engine refuses to price below MOQ; a
non-zero value raises a data-quality warning), linked `lower_moq`
ProductOpportunities, and a segment breakdown.

The question it answers is *"are customers asking for quantities we don't
currently serve?"* — never *"we should lower the MOQ."* Factory feasibility is
human knowledge; every opportunity carries `humanValidationRequired: true`.

---

## 10. Price friction — the exact deterministic definition

A signal is `isPriceFriction: true` **only when at least one EXPLICIT piece of
evidence exists**:

| Explicit evidence | Signal kind |
|---|---|
| `PRICE_TOO_HIGH` objections | `PRICE_OBJECTION` |
| the same conversation asked about price more than once | `REPEATED_PRICE_QUESTION` |
| a handoff in a conversation that raised price | `HANDOFF_AFTER_PRICE` |
| a custom-quote request at or after a price view | `QUOTE_AFTER_PRICE` |
| price objections concentrated in one quantity band | `TIER_FRICTION` |

**A non-purchase alone is NOT price friction.** Sessions that saw a price and did
nothing produce a `PRICE_VIEW_NO_ACTION` signal with
`evidenceKind: "BEHAVIORAL"`, `isPriceFriction: false`, and strength capped at
`LOW` by construction. People leave for dozens of reasons and nobody in that
group said anything.

`MOQ_FRICTION` is real friction but is explicitly **not** price friction
(`route: "MOQ_REVIEW"`). `DATA_GAP` signals are not friction either.

### Signal strength (spec §21)

Three ordinal labels, from counted evidence and evidence *diversity*. There is
no probability anywhere, because there is nothing to compute one from.

| Strength | Rule |
|---|---|
| `HIGH` | ≥ 10 explicit conversations **and** ≥ 2 distinct evidence types |
| `MEDIUM` | ≥ 5 explicit conversations, **or** ≥ 3 with ≥ 2 evidence types |
| `LOW` | ≥ 3 explicit conversations |
| *(no signal)* | below 3 |

Thresholds live in `config/pricing-intelligence.ts` and are documented as
processing policy, not business data: they gate when the system *speaks*, never
what it claims.

---

## 11. Cost and margin readiness

`config/costs.ts` is entirely `[TO BE PROVIDED]`. The hard rule:

> **null is never zero, and never "no limit".**

`assessCostReadiness()` reports every input by owner-facing name and exact config
path. While inputs are missing:

- gross margin: **UNAVAILABLE** (never 0%)
- contribution margin: **UNAVAILABLE**
- minimum safe price: **UNCOMPUTABLE** (the engine's `evaluatePriceFloor` fails
  closed, unchanged from Session 02)
- profit impact of any proposal: **UNAVAILABLE**
- product profitability: **UNAVAILABLE** — and revenue is explicitly *not* used
  as a proxy for it (spec §44)

`assessPriceLimits()` does the same for
`maximumPriceDecreasePct` / `maximumPriceIncreasePct` / `maximumDiscountPct` /
`maximumMoqChangePct` / `maximumExperimentTrafficPct` in `config/guardrails.ts`.

---

## 12. Elasticity: NOT ESTIMABLE

`assessElasticity()` returns a type whose `estimable` field is the literal
`false`. **There is no code path anywhere that produces an elasticity number**,
so no model can be asked to fill one in.

The reason, in owner language rather than jargon:

> We have never shown two different prices for the same bag to similar
> customers, so there is nothing to compare. Customers who buy 10,000 bags
> differ from customers who ask about 500 in many ways at once — order size,
> business type, how they found us — so the fact that larger orders convert more
> often does not tell us what the price did.

What would have to exist first is listed explicitly: a controlled price
experiment (or another valid causal design), configured costs and a margin
policy, configured movement and traffic limits, and enough traffic to reach the
documented minimum sample per arm.

---

## 13. PricingReadiness

Deterministic answer to "what class of recommendation is even possible?"

| Class | State today | Why |
|---|---|---|
| `PRICING_REVIEW` | **AVAILABLE** when pricing evidence exists | a review changes nothing by itself |
| `SPECIFIC_PRICE_CHANGE` | **BLOCKED** | costs, margin policy and movement limits unconfigured — any number would be a guess |
| `PRICE_EXPERIMENT` | **BLOCKED** | the experiment engine deliberately cannot run price variants, plus every blocker above |
| `AUTOMATED_PRICE_CHANGE` | **NOT_SUPPORTED** | no executor, empty guarded-auto list, every business agent capped at RECOMMEND |

---

## 14. The Pricing Agent

`lib/ai/agents/pricing/` — mode **RECOMMEND**, ceiling RECOMMEND.

- **No tools.** One `REASONING` `generateStructuredObject` call over the
  deterministic snapshot context, exactly like the S09 CEO and S11 CRO agents.
- **Inputs**: the `PricingIntelligenceSnapshot` only. It does not re-read the raw
  customer corpus.
- **Output**: `{ executiveSummary, signals[], recommendations[], openQuestions[] }`.

### It cannot express a price

The strongest guarantee in the session: `pricingRecommendationSchema` has no
`proposedUnitPriceCents`, no `newPrice`, no `discountPct`, no `proposedMoq`, no
`elasticity` and no `optimalPrice`. A specific price change is not *blocked* —
it is **unrepresentable**, so no downstream layer has to be trusted to refuse
one. A test asserts the schema's key set.

### Controlled recommendation types

`PRICING_REVIEW` · `MOQ_REVIEW` · `TIER_STRUCTURE_REVIEW` ·
`PRICE_PRESENTATION_REVIEW` · `PRICE_EXPERIMENT_REVIEW` · `DATA_QUALITY`

### Server-side validation (spec §40)

Everything consequential is decided by the server, not the model:

| Model writes | Server does |
|---|---|
| `metricRefs` | filters against exactly what the context printed; **no valid ref ⇒ the whole recommendation is dropped** |
| `evidenceRefs`, `signals[].signalId` | filters against printed ids |
| `productId` | must be a real catalog product, else `null` |
| `quantityTier` | must be a real tier **of that product**, else `null` |
| `requiresCostConfiguration` / `requiresExperiment` | **overwritten** with the deterministic answer; a disagreement is logged |
| `recommendationType` | closed enum — an invented type fails our schema entirely |

If the model says "23 customers complained about price" but the context said 8,
the reference does not survive and the recommendation is dropped.

### Explicit refresh only

`POST /api/admin/pricing-intelligence/pricing-review` is the ONLY trigger. Page
loads never generate; no scheduler exists; the AI budget guard applies (one
structured call per review). Provider or budget failure persists **nothing** —
deterministic analytics and the previous review keep working.

---

## 15. Persistence

| Table | Holds |
|---|---|
| `pricing_reports` (migration 0006) | one append-only row per explicit run: period, prompt id+version, model, provider, the **exact snapshot the model saw**, the server-validated review, and the decision ids |
| `agent_decisions` | one row per recommendation, with identity-stable dedup |
| `approvals` | the pending human decision, as for every agent |

**Why a table rather than a decision row (spec §39):** the executive summary and
the signal narrative are only coherent as one document, and the dashboard must
keep showing the last good review when the provider is down. This is the same
choice, for the same reason, as `ceo_reports` in Session 09.

Dedup identity: `PRICING:<type>:<productId|all>:<tier|all>:<sorted refs>:<periodDays>d`.
Pending rows refresh in place; **human verdicts are frozen** — regeneration never
overwrites an approval or a rejection.

---

## 16. Action Center integration

Every pricing recommendation type maps to a **review-only** Session 10 action
type. `PRICE_CHANGE` and `PRICE_EXPERIMENT` are absent from the mapping table, so
a pricing recommendation cannot become an executable price action by any path.

| Recommendation type | Action type |
|---|---|
| `PRICING_REVIEW` | `PRICING_REVIEW` |
| `TIER_STRUCTURE_REVIEW` | `PRICING_REVIEW` |
| `PRICE_PRESENTATION_REVIEW` | `PRICING_REVIEW` |
| `PRICE_EXPERIMENT_REVIEW` | `PRICING_REVIEW` |
| `MOQ_REVIEW` | `MOQ_REVIEW` |
| `DATA_QUALITY` | `DATA_QUALITY_REVIEW` |

The table is duplicated in `modules/guardrails/decision-mapping.ts` (which must
not import config that could grow a `lib/ai` dependency) and a test asserts the
two agree.

### Source permissions

`SOURCE_PERMITTED_ACTION_TYPES.PRICING_AGENT` gained exactly one entry in
Session 12: **`DATA_QUALITY_REVIEW`**, a review-only type granting zero
authority. It is not a convenience — the closed recommendation taxonomy includes
a `DATA_QUALITY` class precisely so that a pricing question we *cannot answer*
("we have no manufacturing costs") routes honestly instead of being forced into
a `PRICING_REVIEW`, which would misrepresent a configuration gap as a price
problem.

`PRICE_CHANGE` / `PRICE_EXPERIMENT` remain listed from Session 10 and remain
unreachable in practice: the agent's schema has no price field and its mapping
table contains neither. They are reachable only by an explicit `HUMAN_ADMIN`
proposal — which the price floor still refuses to bless while costs are null
(tested).

### Autonomy

`AGENT_AUTONOMY_POLICY.PRICING_AGENT.defaultMode` rose `OBSERVE → RECOMMEND`
(the same treatment the CEO agent got in S09 and CRO in S11, because the agent
is now implemented and designed to recommend). The **ceiling is unchanged at
RECOMMEND**, the guarded-auto allow-list is still empty, and
`GUARDRAIL_POLICY_VERSION` was bumped to `2026-08-15.s12.1`.

---

## 17. Price experiments stay unsupported

Session 11 treats a real `PRICE_EXPERIMENT` as unsupported by the experiment
engine. Session 12 preserves that exactly:

- the experiment target registry contains only presentation surfaces —
  `product.shipping_message`, `product.primary_cta`, `homepage.hero`
- `EXPERIMENT_TYPES` contains no price type
- `PRICE_EXPERIMENT_SUPPORTED = false` in `modules/pricing-intelligence`
- no pricing-intelligence code path imports `lib/experiments` or calls
  `createExperimentDraft` / `launchExperiment`

### Why price experiments are different

A CTA-copy test changes what a sentence says. A price test changes:

- **financial outcomes** — real money, on real orders
- **cart totals and checkout** — the S07 `expectedTotalCents` drift detection and
  the 409 `REPRICED` semantics both assume ONE authoritative price per
  configuration
- **customer consistency** — a returning customer, or two people in the same
  restaurant, could see different numbers for the same bag
- **margin safety** — a variant price must be checked against a floor that does
  not exist yet

So it needs an authority-aware design (which arm's price is the *real* price at
checkout? what happens when a customer's arm changes? what does a repriced cart
mean?) that has not been written. Execution stays deferred.

### Presentation ≠ price change

`PRICE_PRESENTATION_REVIEW` is allowed and is **not** a price change:

- allowed: `"$0.42 each — $2,100 total"` vs `"$2,100 total ($0.42 each)"` — the
  same engine-computed numbers, reordered
- not allowed: a different monetary price, anywhere, ever

Session 11's `PRICING_PRESENTATION` experiment type remains presentation-only,
and the Pricing Agent cannot launch a CRO experiment (its permitted types
contain neither `CRO_EXPERIMENT_PROPOSAL` nor `CRO_EXPERIMENT_LAUNCH`).

---

## 18. No personalized pricing — a hard boundary

Nothing in this layer feeds a price. There is no per-customer, per-segment,
per-device, per-geography, per-traffic-source or per-behaviour price, and no
willingness-to-pay inference exists to build one from. Structural tests refuse
any identifier matching `priceForCustomer|priceForSegment|willingnessToPay|
personalizedPrice|customerPriceOverride`.

Segment and traffic-source rows are **descriptive only**: "cafe prospects request
smaller quantities more often" is a fact about who asks, not a licence to quote
them differently. Pricing stays product / configuration / quantity /
business-rule based. Future negotiated B2B quotes are a separate, explicit
workflow.

---

## 19. Ethical boundaries

Not implemented, and structurally refused: deceptive reference prices, fake
"was" prices, fake discounts, fake scarcity or countdowns, hidden mandatory fees,
willingness-to-pay pricing, dark-pattern urgency. The agent prompt states the
rules and the separation tests scan for the identifiers.

Owner-facing language follows spec §37: "11 qualified conversations explicitly
said the price was too high", never "price sensitivity index = 0.42"; "we have
never shown two different prices to similar customers, so there is nothing to
compare", never a bare "elasticity unavailable".

---

## 20. Admin surface

`/admin/pricing-intelligence` — behind the S08 HTTP Basic auth **and** the new
`PRICING_INTELLIGENCE` flag; either missing ⇒ 404 (fail closed).

Sections: Overview · Pricing funnel · Quantity demand (three lanes) ·
Quantity-tier performance · Pricing friction · Other observations ·
Minimum order quantity · Cost and margin readiness · What we can and cannot
decide right now · Price sensitivity · Trends · Pricing review · Data quality.

Every number renders with **no AI configured**. The only AI on the page is the
persisted review, generated exclusively by the explicit button, which is hidden
entirely when `AI_PRICING_AGENT` is off.

`POST /api/admin/pricing-intelligence/pricing-review` is guarded by
`lib/admin/write-guard.ts`: POST + authenticated admin + same-origin +
`application/json` + bounded body + strict schema (unknown keys ⇒ 422).

---

## 21. Thresholds (`config/pricing-intelligence.ts`)

| Key | Value | Meaning |
|---|---|---|
| `MIN_DENOMINATOR_FOR_PERCENTAGE` | 5 | below this, raw counts only (S08/S09 parity) |
| `MIN_TREND_BASE` | 5 | below this, an explicit trend state instead of a % |
| `MIN_SEGMENT_SAMPLE` | 5 | per segment / attribution cell |
| `MIN_EVIDENCE_FOR_SIGNAL` | 3 | below this, counts render but no signal is created |
| `MEDIUM_STRENGTH_EVIDENCE` | 5 | |
| `HIGH_STRENGTH_EVIDENCE` | 10 | plus ≥ 2 evidence types |
| `MIN_PRICE_VIEW_SESSIONS_FOR_OBSERVATION` | 20 | before the behavioural observation is reported at all |
| `MAX_RECOMMENDATIONS_PER_REVIEW` | 8 | |
| `PRICING_CONTEXT_MAX_CHARS` | 16,000 | |

**Raw metric available ≠ recommendation eligible.** Every count renders on the
dashboard regardless; the thresholds decide when a *signal* exists and therefore
when the agent has something citable.

---

## 22. Known limitations

- **Conversation-only evidence.** Price questions and objections come from AI
  sales conversations. Customers who never opened the chat are invisible to every
  conversation-level metric — stated as a limitation on every such signal.
- **Checkout is not tier-attributable** (no product/quantity on the event).
- **Repricing is not instrumented** (no first-party event for the 409 path).
- **Configured demand is latest-state-in-period**, not a history
  (`product_configurations` is a live mutating row — inherited S08 limitation).
- **Band attribution needs a configured or stated quantity**; conversations with
  neither are counted as unattributed and are absent from per-tier rates.
- **Requested quantities name no product**, so a stated quantity only attributes
  to a band when the profile also carries a `productInterest` matching a catalog
  product id.
- **Bounded loads** (5,000 rows/query, 20,000 session-event pairs) — fine at
  current volume, same posture as S08–S11, revisit at real scale.
- **Demo pricing is still active**, so every tier price analysed today is a
  placeholder. A data-quality warning says so.
- `/admin/pricing-intelligence` inherits the storefront layout chrome, like the
  S08–S11 admin pages.

---

## 23. Tests

`tests/pricing-intelligence-metrics.test.ts` (41) · `tests/pricing-agent.test.ts`
(22) · `tests/pricing-intelligence-admin.test.ts` (11) ·
`tests/pricing-intelligence-separation.test.ts` (28).

Zero credentials, zero network, zero real model calls — `FakeAiProvider` only.
The structural tests are the ones that matter most: they make "the pricing agent
cannot price anything" a property of the repository rather than a claim in a
document.
