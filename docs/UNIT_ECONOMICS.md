# UNIT ECONOMICS

**Authoritative specification for BagDirect's business cost model, profit
definitions and margin policy (Session 13.5).**

Everything in this document is DETERMINISTIC. No LLM participates in any
calculation described here, and no code path in `modules/pricing` may import
`lib/ai` — asserted structurally in `tests/unit-economics-separation.test.ts`.

---

## 1. The ladder

One model, four levels, each with its own name and its own availability:

```
SELL PRICE                             what the customer pays
  ↓ − PRODUCT COGS                     manufacturing · printing · setup · packaging
GROSS PROFIT
  ↓ − VARIABLE SELLING / FULFILMENT    payment processing · shipping subsidy
                                        · handling · other variable
CONTRIBUTION PROFIT BEFORE PAID MEDIA
  ↓ − ATTRIBUTED AD SPEND              period / campaign level only
CONTRIBUTION PROFIT AFTER PAID MEDIA
```

The names are load-bearing. **Contribution profit before paid media is never
shortened to "profit" and never called "net profit"** — advertising is a real
cost that simply is not attributable at order level. Nothing here is
overhead-, salary-, rent- or tax-aware either; this is contribution
accounting, not a P&L.

## 2. The hard rule

**A cost is measured, or it is missing. It is never estimated.**

`config/costs.ts` ships with every business value `null` — an explicit
`[TO BE PROVIDED]` placeholder. A `null`:

- is **not zero**. "We don't know what a bag costs" is not "a bag is free".
- is **not an error**. Null is the documented unconfigured state;
  `validateCostModel` treats only PRESENT-and-WRONG values as errors.
- **blocks profit analytics, never a sale** (§7 below).

Industry averages are forbidden. Not 20%, not 30%, not "typical for
non-woven". A guessed cost is worse than a missing one: a missing cost reports
"unavailable"; a guessed cost reports a number that looks true.

## 3. Cost architecture

| File | Role |
| --- | --- |
| `config/costs.ts` | THE cost configuration. Owner-supplied values only. |
| `modules/pricing/cost-model.ts` | Types + line costing + payment fee + shipping subsidy + margin policy + price floor. |
| `modules/pricing/unit-economics.ts` | Order-level assembly: the ladder above, plus POAS. |
| `modules/pricing/snapshot.ts` | Freezing an order's economics at order time. |
| `modules/pricing/validate.ts` | Config validation — fails loudly, never normalises. |
| `modules/pricing/readiness.ts` | The owner-facing "what's missing and what does it block?" view. |

Consumers: `modules/business-intelligence` (order/period profitability),
`modules/pricing-intelligence` (readiness + price floor), and
`modules/google-ads-intelligence` (POAS). None of them re-derives cost math.

## 4. Cost categories: per unit, per line, per order

Collapsing these scopes silently multiplies or divides real money, so the
model keeps them apart.

| Scope | Costs | Applied |
| --- | --- | --- |
| **Per unit** | manufacturing (base ± size ± material, or a quantity tier), printing ink/labour, packaging, other variable | × line quantity |
| **Per line** | printing setup (screens/plates) | once per line — one line is one artwork |
| **Per order** | order packaging (master carton/pallet), fulfilment handling, the payment processor's FIXED fee, the shipping subsidy | **exactly once**, whatever the line count |

`orderCosts.packagingCentsPerOrder` is COGS (it is part of preparing the
goods). `orderCosts.handlingCentsPerOrder` is a variable SELLING cost (it is
incurred because the order exists). That distinction is why the first affects
gross profit and the second does not.

`0` is a valid CONFIRMED answer for any of these ("we do not incur this") —
which is precisely why an absent value is not read as zero.

## 5. Product COGS

```
Product COGS = manufacturing + printing + printing setup
             + per-unit packaging + per-order packaging
```

Dimensions implemented, all from the REAL configurator:

- `baseManufacturingCentsPerUnit` — reference size, base material
- `sizeAdjustmentCentsPerUnit` — one entry per offered size id
- `materialAdjustmentCentsPerUnit` — GSM/weight differences
- `printing[printOptionId]` — `{ centsPerUnit, setupFeeCents }` for each of
  the product's real print options (`none` / `one-color` / `two-color`)
- `packagingCentsPerUnit`

**Printing sides are deliberately NOT modelled.** The configurator has no
side selector, so a "front/back" cost dimension would be a manufacturing
capability the business does not offer. If sides are added to the product
model, the cost model follows — not before.

### Quantity-tier manufacturing cost

`manufacturingTiers` is OPTIONAL:

```ts
manufacturingTiers: [
  { minQty: 1_000,  centsPerUnit: /* … */ },
  { minQty: 5_000,  centsPerUnit: /* … */ },
  { minQty: 10_000, centsPerUnit: /* … */ },
]
```

- **Key absent** ⇒ the factory quotes one unit cost at every volume;
  `baseManufacturingCentsPerUnit` applies.
- **Key present** ⇒ tiers are authoritative. The highest tier the quantity
  reaches wins, and a quantity **below the first tier is a MISSING input**, not
  a silent fallback to the base rate. A factory quote that starts at 1,000
  units says nothing about 500.

**Factory cost tiers are NOT assumed to equal the storefront's sell-price
tiers** (`config/products.ts`). They are two different business facts.

## 6. Payment processing cost

```
paymentFee = round(orderRevenueCents × percentBps / 10_000) + fixedCents
```

Integer-safe: one rounding operation (half-up), once per ORDER. The fixed fee
is per TRANSACTION — applying it per line is the most expensive arithmetic
mistake available in this model and is pinned by tests. Either input `null`
⇒ the fee is `null`, and contribution profit becomes unavailable.

No processor's rates are hard-coded. Stripe/Shopify/anyone else's numbers are
owner input.

## 7. Shipping economics

Three distinct quantities:

| Term | Meaning | Source |
| --- | --- | --- |
| **Actual shipping cost** | what the carrier/factory charges BagDirect | `products.<id>.shipping` (per unit / per order / per carton) |
| **Customer shipping charge** | what the customer pays for shipping | `shippingPolicy.customerCharge` |
| **Shipping subsidy** | the economic cost BagDirect bears | derived |

```
shippingSubsidy = max(actualShippingCost − customerShippingCharge, 0)
shippingMargin  = max(customerShippingCharge − actualShippingCost, 0)
```

The subsidy **never goes negative**. Profiting on shipping is a different
fact, preserved separately in `shippingMarginCents` rather than smuggled in as
a negative cost. `shippingMargin` is reported but deliberately **not added to
contribution profit**, because the shipping charge is not part of recorded
order revenue — adding it would credit money the revenue metric never counted.

### What is measurable today

`customerCharge` is `{ kind: "not_collected" }`, and that is a **structural
fact, not an assumption**: `orders` has no shipping column, `createOrder` sets
`totalCents = subtotalCents`, and the storefront says "shipping calculated at
checkout" because `config/shipping.ts` has no rate source. So today:

```
shippingSubsidy = actualShippingCost − 0 = actualShippingCost
```

The other two bases:

- `flat_per_order` — supported, but since orders record no shipping charge it
  is a CONFIGURED CONSTANT applied to every order, so shipping economics (and
  therefore contribution) are reported **PARTIAL**, not AVAILABLE.
- `unavailable` — the owner does not know. Shipping subsidy and contribution
  profit are **UNAVAILABLE**. Gross profit is unaffected.

Real per-order shipping charging requires an order-model change (a shipping
charge column) alongside this config. Freight rate shopping, dimensional
weight and zone tables remain deferred.

### Per-order freight in a multi-line order

A `per_order` freight basis is ONE charge **per product per order**. Two lines
of the same product are one shipment and are charged once; two different
products each carry their own quoted per-order freight. `per_unit` and
`per_carton` scale with the line and accumulate normally (carton rounding
stays per line — separate lines are separate artwork and are packed apart).

## 8. Gross profit and gross margin

```
Gross Profit  = Product Revenue − Product COGS
Gross Margin  = Gross Profit / Product Revenue      (reported in basis points)
```

Zero or negative revenue ⇒ margin is `null` (UNAVAILABLE). **Never NaN, never
Infinity, never 0.** A margin is never partially calculated with an unknown
COGS component silently omitted: any missing COGS input makes gross profit
UNAVAILABLE for that order.

## 9. Contribution profit before paid media

```
Contribution Profit Before Paid Media
  = Gross Profit
  − Payment Processing Cost
  − Shipping Subsidy
  − Fulfilment Handling
  − Other Variable Costs

Contribution Margin Before Paid Media
  = Contribution Profit Before Paid Media / Revenue
```

Paid media is **not** subtracted here, and the field name says so.

## 10. Contribution profit after paid media, ROAS and POAS

```
Contribution Profit After Paid Media
  = Contribution Profit Before Paid Media − Attributed Paid Media Spend
```

Computed at **period / campaign** level only. Order-level ad allocation is
deliberately absent: the system cannot deterministically say which order a
given dollar of spend produced.

```
ROAS = Revenue                              / Ad Spend
POAS = Contribution Profit Before Paid Media / Ad Spend
```

**These are different measurements and are never merged or relabelled.** A
campaign can post ROAS 5.0 and POAS 0.6 — that gap is the entire reason both
exist. `AdEfficiency` has no field named merely `roas` or `poas`; the fields
are `firstPartyRoas`, `googleReportedRoas` and `profitOnAdSpend`, so a
careless destructure cannot turn one into the other.

`postAdContributionCents` is the same comparison in currency instead of as a
ratio. It may be negative — that is the finding, not an error.

### POAS availability

POAS needs four things; the absence of any one makes it UNAVAILABLE rather
than approximate:

1. **Contribution profit** for the attributed orders — costs configured AND
   recorded on those orders.
2. **Real ad spend** to divide by. Zero spend ⇒ the ratio is undefined, not 0.
3. **Compatible currency.** USD product economics and CAD ad spend cannot be
   divided; there is no FX model and none is invented. Mismatch ⇒ UNAVAILABLE.
4. **Attribution coverage.** Below `GOOGLE_ADS.MIN_ATTRIBUTION_COVERAGE_PCT`,
   or when only some attributed orders carry a cost snapshot, POAS is
   **PARTIAL** with the coverage stated.

Denominator: Google Ads cost for the period, in the account's currency.
Numerator: contribution profit before paid media on BagDirect orders whose
session arrived from a Google Ads click (first-party attribution — never
Google-reported conversions).

## 11. Availability is per level

Each level carries its own status, because the inputs differ:

| Missing input | Gross profit | Contribution |
| --- | --- | --- |
| manufacturing / printing / setup / packaging (unit or order) | UNAVAILABLE | UNAVAILABLE |
| payment fee | **AVAILABLE** | UNAVAILABLE |
| fulfilment handling | **AVAILABLE** | UNAVAILABLE |
| customer shipping charge = `unavailable` | **AVAILABLE** | UNAVAILABLE |
| customer shipping charge = `flat_per_order` | AVAILABLE | **PARTIAL** |

Knowing what a bag costs to make does not tell you what the processor charged.
Pretending both levels share one availability is exactly the dishonesty this
model exists to prevent.

## 12. Rounding

- All money is **integer cents**. All rates are **integer basis points**
  (1 bps = 0.01%).
- The only division in the cost path is the payment percentage: rounded
  half-up (`Math.round`) **once per order**.
- Margins are reported in bps via `Math.round(profit × 10_000 / revenue)`.
- Price floors round **UP** (`Math.ceil`) so a floor is never breached by a
  rounding cent.
- Floating-point dollars never appear. Tests assert integrality across the
  whole breakdown.

## 13. Currency

Costs, revenue and ad spend must share a currency. There is **no FX model** in
Session 13.5. Mixed-currency orders ⇒ profitability UNAVAILABLE. Ad currency ≠
order currency ⇒ every cross-lens ratio, including POAS, UNAVAILABLE.

## 14. Historical cost snapshots

Historical order economics must not depend on today's configuration.

`orders.cost_model_version` + `orders.cost_snapshot_json` +
`order_lines.cost_snapshot_json` (migration `0008_order_cost_snapshots`) record
what an order ACTUALLY cost under the cost model in force when it was placed.

Rules:

1. **Forward only.** Old orders are never back-filled with fabricated
   historical costs.
2. **Capture never blocks a sale.** With costs unconfigured — the shipped
   state — capture returns null, the order is written without a snapshot, and
   checkout is unaffected. Any capture failure is swallowed and logged.
3. **No snapshot ⇒ `HISTORICAL_COST_UNAVAILABLE`.** Not zero profit, and not
   today's costs wearing a historical date.
4. **`costModelVersion` is stamped on every snapshot**, so "which cost
   configuration produced this number?" stays answerable. Bump
   `COST_MODEL_VERSION` in `config/costs.ts` on every change.

`computeProfitability` takes `historicalCostBasis`:

- **`SNAPSHOT_ONLY`** (default, and what the dashboard uses) — accounting
  truth. Orders without a snapshot are reported, not costed.
- **`CURRENT_CONFIG_SCENARIO`** — clearly labelled "what would these orders
  look like under today's costs?". Its notes say so explicitly. It is an
  illustration, never accounting truth.

Per-product performance uses the same rule at line level.

## 15. Multi-line orders and allocation

Order-level economics are exact for multi-line orders: setup once per line,
order packaging / handling / payment fixed fee / shipping subsidy once per
order, revenue never double counted.

**Per-line contribution is deliberately absent** (`LineEconomics` has no such
field). No deterministic allocation rule exists for splitting a per-order
payment fee or shipping subsidy across products, and inventing one would make
per-product profitability a guess. Per-line **gross** profit is available and
is what `computeProductPerformance` reports.

An uncostable line makes the WHOLE order uncosted. Partially costing an order
would understate its costs.

## 16. Margin policy

One home: `config/costs.ts → marginPolicy`. `config/guardrails.ts`
deliberately does NOT duplicate margin floors — the guardrail engine reads the
same config the pricing engine does.

| Field | Meaning |
| --- | --- |
| `minimumGrossMarginBps` | **FLOOR.** Hard safety boundary. |
| `minimumContributionMarginBps` | **FLOOR.** Hard safety boundary. |
| `targetGrossMarginBps` | **TARGET.** Business objective. |
| `targetContributionMarginBps` | **TARGET.** Business objective. |

**Minimum and target are not the same concept and never collapse.** Below the
minimum, a future automated or approved price action must be BLOCKED. Below
target is a review signal and **not** a violation. `minimumAllowedPriceCents`
consults floors only — a target is never used as a floor.

`evaluateMarginAgainstPolicy` returns five states: `BELOW_MINIMUM`,
`BELOW_TARGET`, `AT_OR_ABOVE_TARGET`, `NO_TARGET`, `UNAVAILABLE`. An unknown
margin or an unconfigured floor is UNAVAILABLE — never "compliant".

All four values ship `null`. **This session chose none of them.**

## 17. Price floor

`minimumAllowedPriceCents(costs, paymentFee, policy)` returns the smallest line
total satisfying every CONFIGURED floor:

```
gross floor:        P − productCost ≥ g·P          ⇒ P ≥ productCost / (1 − g)
contribution floor: P − nonFeeCost − (P·f + F) ≥ m·P ⇒ P ≥ (nonFeeCost + F) / (1 − f − m)
```

(`g`, `m` = minimum margins; `f` = payment percentage; `F` = fixed fee — all
in bps/cents. `Math.ceil` so the floor is never breached by a cent.)

Returns `null` — meaning "cannot be computed" — when costs are unconfigured,
when no floor is configured, or when a floor is arithmetically unsatisfiable
(`f + m ≥ 100%`). **Callers must treat null as fail-closed, never as "no
floor".**

`evaluatePriceFloor` fails closed on every one of those cases.
`modules/guardrails/evaluate.ts` calls it for every price-affecting action.

**Nothing in the customer path calls it.** Normal checkout of engine-computed
catalog prices does not pass through this gate — it applies to DEVIATIONS from
the engine price. A structural test asserts the checkout route never
references it.

## 18. Cost configuration never blocks a sale

Missing cost data means **profit analytics unavailable**. It does not mean a
customer cannot buy.

- The pricing engine returns the same sell price with every cost `null`.
- The configurator, cart, checkout and the 409 REPRICED path are untouched.
- No commerce file imports `assessCostReadiness`, `isCostModelConfigured` or
  `evaluatePriceFloor` (asserted).
- Order creation captures a snapshot best-effort and swallows any failure.

Only future price/action safety fails closed.

## 19. Configuration validation

`validateCostModel(model, products)` reports ERRORs (must be corrected) and
WARNINGs (internally consistent, but this value can never apply). Nothing is
repaired silently — a negative cost clamped to zero would flow into margins
and price floors looking exactly like a real one.

Errors include: negative or fractional cents; a payment fee ≥ 100%; a margin
< 0% or ≥ 100%; a target margin below its own minimum; a minimum contribution
margin that the payment fee makes unreachable; unordered or duplicate
manufacturing tiers; an empty tier array; a cost entry for an unknown product;
a catalog product with no cost entry; a missing size/material/print option the
product actually offers; a non-positive units-per-carton; a blank version
stamp.

`null` is never an error.

## 20. Admin readiness

`/admin/business-intelligence` and `/admin/pricing-intelligence` both render
the shared, **read-only** `CostReadinessPanel`. It shows every cost/margin
input as Configured / Partly configured / Missing / Invalid, and what each
gap blocks:

```
Manufacturing cost              Missing
Printing cost                   Missing
Printing setup cost             Missing
Packaging cost (per unit)       Missing
Packaging cost (per order)      Missing
Fulfilment handling (per order) Missing
Shipping cost basis             Missing
Customer shipping charge        Configured
Payment processing fee          Missing
Minimum gross margin            Missing
Minimum contribution margin     Missing
Target gross margin             Missing
Target contribution margin      Missing

Profit Intelligence (gross)                 Unavailable
Contribution profit before paid media       Unavailable
POAS (profit on ad spend)                   Unavailable
Price action safety (minimum safe price)    Unavailable
```

There is deliberately **no cost editor**. `config/costs.ts` stays the single
authority; a second config source is exactly the failure mode to avoid.

## 21. What this session did NOT do

No new agent. No storefront price change. No MOQ change. No discounts. No
price mutations. No Google Ads mutations. No `GUARDED_AUTO`. No executor. No
autonomy-ceiling change. No AI cost estimation of any kind.

Existing agents may READ the newly available deterministic metrics; none of
them gained authority over anything.

## 22. Limitations

- **Every production value is still `null`.** Profit intelligence, POAS and
  the minimum safe price are all unavailable until the owner fills
  `config/costs.ts`. See `BUSINESS_CONFIG_TODO.md` for the fill-in template.
- **Orders placed before this session carry no cost snapshot**, so their profit
  stays `HISTORICAL_COST_UNAVAILABLE` forever, by design.
- **Refunds are not modelled.** No refund economics enter contribution
  calculations, and no refund rate is invented. Deferred until the order model
  supports real refunds.
- **Discounts are structurally absent**, not configured to zero: the pricing
  engine is the only price authority and no discount mechanism exists.
- **Overhead, salaries, rent, tax and duty are out of scope.** This is
  contribution accounting.
- **Freight is a configured basis, not a rate shop.** No carrier integration,
  no dimensional weight, no zone tables.
- **No FX model.** Mixed currencies report unavailable.
- **Negotiated quote economics** are not modelled — quotes carry a sell-side
  snapshot only.

## 23. Owner configuration process

1. Collect real numbers from the factory, freight forwarder and payment
   processor using the template in `BUSINESS_CONFIG_TODO.md`.
2. Enter them in `config/costs.ts` as integer cents / basis points.
3. Bump `COST_MODEL_VERSION`.
4. Run `npm test` — validation errors and inconsistent margin policy fail
   loudly.
5. Check `/admin/business-intelligence` → "Cost and margin readiness". Every
   row should read Configured and every capability Ready.
6. Profit appears for orders placed AFTER the configuration exists. Earlier
   orders keep reporting `HISTORICAL_COST_UNAVAILABLE` — that is correct.
