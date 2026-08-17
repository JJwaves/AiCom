# BUSINESS_CONFIG_TODO

Everything the business owner must provide before launch. Each item lists
**where it goes** in the codebase. Nothing here is invented — placeholders
render visibly until replaced.

## Identity

| Item | Where |
| --- | --- |
| Brand name | `config/business.ts` → `BRAND_NAME`, `DISPLAY_NAME` |
| Logo (SVG + favicon) | `app/favicon.ico`, header wordmark in `components/layout/Header.tsx` |
| Domain | **`NEXT_PUBLIC_SITE_DOMAIN`** env var (drives canonical URLs, sitemap, robots.txt, JSON-LD, admin deep links). BUILD-TIME — a change needs a redeploy. Unset, launch readiness BLOCKS and robots.txt refuses crawling |
| Factory location | `config/business.ts` → `FACTORY_LOCATION` (shown on /about) |
| Shipping origin | `config/business.ts` → `SHIPPING_ORIGIN` |
| Customer service email / phone | `config/business.ts` (shown on /contact) |

## Product & manufacturing truth

| Item | Where |
| --- | --- |
| Supported bag sizes + exact dimensions | `config/products.ts` → each product's `sizes` |
| Custom dimension limits (min/max W×H×G) | `config/products.ts` + quote-form guidance |
| GSM / material options (real weights) | `config/products.ts` → `materials` (gsm is `null` until provided) |
| Available colors (and Pantone policy) | `config/products.ts` → `colors` |
| Handle types actually supported | `config/products.ts` → `handles` (`confirmed: false` items are hidden from purchase paths) |
| Printing capabilities (1c/2c/full, sides) | `config/products.ts` → `printOptions` |
| Printing setup fees (if any) | Add as explicit line item — currently no setup fee is shown; do not launch with hidden fees |
| MOQ per product | `config/products.ts` → `minQuantity`; global default in `config/business.ts` → `MOQ` |
| Quantity tiers | `config/products.ts` → `quantityPresets` + `pricingTiers` |
| **Price per configuration** | `config/products.ts` → `pricingTiers`, `priceDeltaCents`. Then set `pricingStatus: "LIVE"` and `NEXT_PUBLIC_DEMO_PRICING=false`. **Site shows "demo pricing" notices until this happens.** |
| Production lead time | `config/business.ts` → `STANDARD_PRODUCTION_TIME` |
| Artwork proof process (SLA, revision count) | `/how-it-works` copy + `config/faq.ts` |

## Logistics

| Item | Where |
| --- | --- |
| US shipping rules/rates | `config/shipping.ts` → `rateSource` + carrier or freight-table integration |
| Canada shipping rules/rates | same |
| Import/duty handling for CA orders | `app/shipping-policy/page.tsx` copy |
| Handling days | `config/shipping.ts` → `handlingDays` |

## Legal (must be reviewed by owner + legal advisor)

| Item | Where |
| --- | --- |
| Return policy (custom-product eligibility windows) | `app/return-policy/page.tsx` — set `reviewed` on `PolicyPage` after review |
| Defect policy (inspection window, photo requirements) | same |
| Shipping policy | `app/shipping-policy/page.tsx` |
| Privacy policy | `app/privacy/page.tsx` |
| Terms of service | `app/terms/page.tsx` |

## Assets

| Item | Where |
| --- | --- |
| Factory photos (production line, printing, QC, packing, warehouse) | `FactoryBand` slots in `components/landing/sections.tsx` |
| Product photography (white background, dimensions graphic, print close-up, use cases, handle detail, capacity, texture, cartons) | `config/products.ts` → `images[].src` (slots are pre-labeled) |
| Certifications (only real ones) | Add a section to `/about` — do not fabricate |

## Commerce & money

| Item | Where |
| --- | --- |
| Shopify store + Storefront API token | `.env` → see `.env.example` |
| Variant mapping (size×material×color → Shopify variants) | `lib/commerce/shopify.ts` TODOs |
| Pricing-tier metafield (`b2b.pricing_tiers`) | Shopify admin + `lib/commerce/shopify.ts` |
| Tax settings | Shopify admin |
| Payment methods (cards, Shop Pay, Apple/Google Pay, PayPal) | Shopify admin |
| Artwork file storage (S3/Shopify Files) for uploaded logos | `app/api/quote/route.ts` + checkout flow — currently filenames/notes travel with the order; binary storage is a launch task |
| Quote intake destination | `.env` → `QUOTE_WEBHOOK_URL` |

## Marketing

| Item | Where |
| --- | --- |
| GTM / GA4 / Google Ads IDs + purchase label | `.env` |
| Meta Pixel ID / CAPI token / dataset | `.env` (token is server-only) |
| Merchant Center feed decision (which SKUs are feed-eligible) | see README → "Google Merchant Center" |

## Cost model (Session 13.5 — required for profit intelligence & price guardrails)

The full architecture is `docs/UNIT_ECONOMICS.md`. The structure lives in
`config/costs.ts` with every value an explicit `null` `[TO BE PROVIDED]`.
Margin math reports "unavailable" and every price guardrail fails closed
until these are provided. **Do NOT let anyone invent them** — not from
industry averages, not from an AI estimate, not from a competitor's prices.
A missing cost reports "unavailable"; a guessed cost reports a number that
looks true.

Units: **integer cents**; rates in **integer basis points** (290 = 2.90%).
Any change here **must bump `COST_MODEL_VERSION`** — every stored order cost
snapshot references it so past figures stay explainable.

**Where you will see the gap:** `/admin/business-intelligence` and
`/admin/pricing-intelligence` both show a "Cost and margin readiness" panel
listing every row below as Configured / Missing / Invalid, and what each gap
blocks. `/admin/google-ads-intelligence` shows POAS as unavailable with the
same list.

### Classification

- **REQUIRED FOR CURRENT SALES — nothing here.** The storefront prices, carts
  and checks out correctly today; the cost model is invisible to customers and
  **missing costs never block a sale**. (Real *sell* prices are a separate
  item — see "Price per configuration" and `NEXT_PUBLIC_DEMO_PRICING`.)
- **REQUIRED FOR PROFIT INTELLIGENCE** — manufacturing / size / material /
  printing + setup / packaging (per unit and per order) unlock **gross profit
  and gross margin**. Adding shipping basis, the payment fee and fulfilment
  handling unlocks **contribution profit before paid media**. Until then both
  are reported unavailable — never zero, never estimated — and revenue is
  never used as a proxy for profit.
- **REQUIRED FOR POAS** — everything above, plus real Google Ads spend in a
  compatible currency and adequate attribution coverage (see "Google Ads
  integration"). Revenue ROAS is NOT profitability.
- **REQUIRED BEFORE PRICE ACTIONS** — everything above **plus** the margin
  FLOORS below **plus** `config/guardrails.ts → maximumPriceDecreasePct /
  maximumPriceIncreasePct`. Until all exist, `/admin/pricing-intelligence`
  reports `SPECIFIC_PRICE_CHANGE: BLOCKED` and the deterministic price floor
  refuses to verify any price.
- **REQUIRED BEFORE GUARDED ADS AUTOMATION** — see "Guardrail limits" below;
  none of it is unlocked by costs alone.

### What each value means

| Item | Where | Scope |
| --- | --- | --- |
| Base manufacturing cost per bag | `config/costs.ts` → `products.<id>.baseManufacturingCentsPerUnit` | per unit |
| Factory quantity breaks (OPTIONAL) | `config/costs.ts` → `products.<id>.manufacturingTiers` — omit the key entirely if the factory quotes one price at every volume. If present it is authoritative and a quantity below the first tier stays uncostable. **Not assumed to match the sell-price tiers.** | per unit |
| Per-size manufacturing deltas | `config/costs.ts` → `products.<id>.sizeAdjustmentCentsPerUnit` (every offered size id) | per unit |
| Per-material cost deltas (GSM/weight) | `config/costs.ts` → `products.<id>.materialAdjustmentCentsPerUnit` | per unit |
| Printing cost per unit | `config/costs.ts` → `products.<id>.printing.<printOptionId>.centsPerUnit` | per unit |
| Printing setup / plate / screen fee | `config/costs.ts` → `products.<id>.printing.<printOptionId>.setupFeeCents` | **per line** (one artwork = one setup) |
| Packaging cost per bag | `config/costs.ts` → `products.<id>.packagingCentsPerUnit` | per unit |
| Packaging cost per order (master carton / pallet) | `config/costs.ts` → `orderCosts.packagingCentsPerOrder` — counted as COGS | **per order** |
| Fulfilment handling per order (pick / pack) | `config/costs.ts` → `orderCosts.handlingCentsPerOrder` — a variable selling cost, not COGS | **per order** |
| Shipping cost basis (what freight actually costs you) | `config/costs.ts` → `products.<id>.shipping` — `per_unit`, `per_order` or `per_carton` | varies |
| Customer shipping charge (what you collect) | `config/costs.ts` → `shippingPolicy.customerCharge` — currently `not_collected`, which is a fact about checkout, not a guess. Change it only together with an order-model change that records a real shipping charge | per order |
| Other variable cost per unit (0 is a valid confirmed answer) | `config/costs.ts` → `products.<id>.otherVariableCentsPerUnit` | per unit |
| Payment processing % + fixed fee | `config/costs.ts` → `paymentFee.percentBps` / `paymentFee.fixedCents` — the fixed fee is charged **once per transaction** | per order |
| Minimum gross margin (**hard floor**) | `config/costs.ts` → `marginPolicy.minimumGrossMarginBps` |  |
| Minimum contribution margin (**hard floor**) | `config/costs.ts` → `marginPolicy.minimumContributionMarginBps` |  |
| Target gross margin (objective, **never a floor**) | `config/costs.ts` → `marginPolicy.targetGrossMarginBps` |  |
| Target contribution margin (objective, **never a floor**) | `config/costs.ts` → `marginPolicy.targetContributionMarginBps` |  |

**Minimum vs target.** A MINIMUM is a hard safety boundary: below it, a future
automated or approved price action is blocked. A TARGET is a business
objective: below it generates a review, not a violation. They are different
numbers with different consequences — please supply both, and do not set a
target below its own minimum (validation rejects that).

### Owner input template — fill this in, one copy per product

Take this to your factory, freight forwarder and payment processor. Leave a
blank blank: an unanswered line is more useful than a guessed one.

```text
Product: ______________________________   (id in config/products.ts: __________)

MANUFACTURING (base size, base material)
  Base cost:                    _____ cents/unit

  Volume breaks? (only if the factory really quotes them)
    1,000 units:                _____ cents/unit
    5,000 units:                _____ cents/unit
   10,000 units:                _____ cents/unit
   (below the smallest break we will report "unavailable" — we will not guess)

SIZE ADJUSTMENTS (cents/unit vs the base size — 0 is a valid answer)
  Small:  _____    Medium: _____    Large: _____    XL: _____

MATERIAL ADJUSTMENTS (cents/unit vs the base material)
  Standard: _____        Heavy duty: _____

PRINTING
  No logo:        _____ cents/unit   setup _____ cents
  1-colour print: _____ cents/unit   setup _____ cents
  2-colour print: _____ cents/unit   setup _____ cents

PACKAGING
  Per bag:                      _____ cents/unit
  Per order (carton/pallet):    _____ cents/order

FULFILMENT
  Handling per order:           _____ cents/order

FREIGHT (what it COSTS you — pick one basis)
  [ ] per unit:                 _____ cents/unit
  [ ] per order:                _____ cents/order
  [ ] per carton:               _____ cents/carton, _____ units/carton

OTHER VARIABLE COST
  Per unit (0 if none):         _____ cents/unit
```

Once, for the whole business:

```text
PAYMENT PROCESSOR
  Percentage:                   _____ bps      (2.9%  = 290)
  Fixed fee per transaction:    _____ cents    ($0.30 = 30)

SHIPPING CHARGED TO THE CUSTOMER
  [ ] We do not charge shipping separately        (today's state)
  [ ] Flat: _____ cents/order
  [ ] We don't know yet
  Rule / notes: _______________________________________________

MARGIN POLICY
  Minimum gross margin (hard floor):        _____ %
  Minimum contribution margin (hard floor): _____ %
  Target gross margin (objective):          _____ %
  Target contribution margin (objective):   _____ %
```

Convert percentages to basis points when entering them (30% = 3000).

## Database & first-party data (Session 03)

| Item | Where |
| --- | --- |
| Production Postgres connection string | `.env` → `DATABASE_URL` (then run `npm run db:migrate` at deploy) |
| Consent policy review for first-party analytics | The storefront stores its own behavioral events (`/api/events`, `bd_sid`/`bd_aid` cookies) independently of the GA4/Meta consent gate; review with legal and either update the privacy policy/banner copy or set `NEXT_PUBLIC_FIRST_PARTY_EVENTS=false` |

## AI & guardrail configuration (for the AI-platform roadmap)

| Item | Where (now real — Session 04) |
| --- | --- |
| AI provider choice + API key | `.env` → `AI_PROVIDER` (default `anthropic`) + `ANTHROPIC_API_KEY` (server-only) |
| AI runtime on/off | `.env` → `AI_RUNTIME_ENABLED` (default false; nothing runs until true) |
| AI model routing per workload | `.env` → `AI_MODEL_LOW_COST` / `AI_MODEL_STANDARD` / `AI_MODEL_REASONING` (defaults in `lib/ai/config.ts`) |
| AI daily / monthly budget caps | `.env` → `AI_DAILY_BUDGET_USD` / `AI_MONTHLY_BUDGET_USD` — **requires** model pricing below, else calls fail closed |
| **AI model pricing (per 1M tokens)** | `config/ai-pricing.ts` — every value a `null` placeholder; copy current provider rates (file documents the procedure). Without it, per-call cost records stay null and budget caps cannot be enforced |

| Item | Where (planned) |
| --- | --- |
| **Escalation destination (email/Slack/phone for human handoff)** | The S05 Sales Agent already RECORDS structured handoffs (conversation `system` messages, `human_handoff_requested` events) — but nothing DELIVERS them yet. Provide the destination + wire delivery before enabling AI_SALES for real customers, or watch the DB manually |
| AI configuration confirmation thresholds (S06) | No numeric cost-impact thresholds exist yet, deliberately (no invented economics). Today the sales prompt applies a behavioral policy: clearly-requested small changes commit directly; changes with substantial cost impact preview + propose an apply chip first. If the owner wants hard rules ("quantity increases over $X require the chip"), define them as config and wire them into the prompt/tool layer |
| Confirmed factory capabilities list (what the sales agent may claim) | `config/products.ts` `confirmed` flags + capability notes |
| ~~Admin users + auth method for `/admin/*`~~ **RESOLVED S08** | HTTP Basic from env: set `ADMIN_USER` + `ADMIN_PASSWORD` (`.env`); unset ⇒ every admin path 404s (fail closed). See docs/CUSTOMER_INTELLIGENCE.md + LAUNCH_CHECKLIST "Admin surface" |

## Customer intelligence (Session 08)

| Item | Where |
| --- | --- |
| Customer Intelligence on/off | `.env` → `AI_CUSTOMER_INTELLIGENCE_ENABLED` (default false; admin surface 404s while off). AI classification additionally needs the AI runtime + key above |
| Evidence / denominator / trend / segment thresholds | `config/customer-intelligence.ts` — documented conservative defaults (insight ≥3 evidence, % needs ≥5 denominator, trend needs ≥5 previous base, segments ≥5 per cell, batch 25). Review before relying on the dashboard for decisions; they gate when the system SPEAKS, not what it claims |
| Volume-group boundaries | `config/customer-intelligence.ts` `VOLUME_GROUPS` — derived from the current 500 MOQ + quantity presets; revisit if MOQ or presets change |

## Business intelligence (Session 09)

| Item | Where |
| --- | --- |
| Business Intelligence on/off | `.env` → `AI_BUSINESS_INTELLIGENCE_ENABLED` (default false; `/admin/business-intelligence` 404s while off). Deterministic metrics need only this flag + admin auth; CEO review generation additionally needs the AI runtime + key |
| Reporting thresholds | `config/business-intelligence.ts` — documented conservative defaults (% needs ≥5 denominator, trend needs ≥5 previous base, segments ≥5 per cell, ≤10 recommendations per review). They gate when the system SPEAKS, not what it claims |
| Cost model (see above) | Profitability metrics stay "Unavailable — configure manufacturing costs" until `config/costs.ts` is complete; the dashboard lists the missing inputs verbatim |
| AI model pricing | `config/ai-pricing.ts` (see AI section) — AI spend metrics show unavailable/partial while calls are unpriced; an unpriced call is never $0 |

## Experimentation (Session 11)

| Item | Where |
| --- | --- |
| Experiment engine on/off | `.env` → `EXPERIMENT_ENGINE_ENABLED` (default false; `/admin/experiments` and every experiment API route 404 while off, no assignment or exposure happens, and the storefront renders its normal control experience). **Toggling requires a redeploy** — the flag decides whether the hosting pages render dynamically |
| CRO agent on/off | `.env` → `AI_CRO_AGENT_ENABLED` (default false). Requires the AI runtime + provider key; experiments run, measure and report perfectly well without it |
| **Maximum experiment traffic share** | `config/guardrails.ts` → `maximumExperimentTrafficPct` — **REQUIRED before production experiments.** While it is null the launch route refuses in production and names this path; a documented 50% ceiling applies only in non-production. It is never interpreted as 100% |
| Minimum sample per arm | `config/experiments.ts` → `DEFAULT_MINIMUM_SAMPLE_PER_VARIANT` (1,000 exposed sessions). A deliberately conservative DEVELOPMENT DEFAULT, not a power calculation — a real minimum detectable effect needs a baseline conversion rate and an effect size you have not provided yet. An experiment may raise it; nothing lowers it |
| Significance threshold | `config/experiments.ts` → `SIGNIFICANCE_ALPHA` (0.05, two-sided). Documented method and its limitations: docs/EXPERIMENTATION.md §13 |
| Variant copy review | Human. Every variant is customer-facing text you approve in `/admin/ai-actions` before it can become a draft — it must not contain a delivery promise, price, guarantee or capability claim the factory cannot honour |

## Pricing intelligence (Session 12)

Pricing analytics run today with **zero** configuration — the funnel,
quantity lanes, tier performance, MOQ friction and evidence-graded signals
are all computed from real first-party data. What is missing is everything
needed to turn an observation into a *number*.

| Item | Where | Blocks |
| --- | --- | --- |
| Pricing dashboard on/off | `.env` → `PRICING_INTELLIGENCE_ENABLED` (default false; `/admin/pricing-intelligence` and its route 404 while off) | the surface |
| Pricing agent on/off | `.env` → `AI_PRICING_AGENT_ENABLED` (default false). Requires the AI runtime + provider key; every number on the dashboard works without it | the AI review only |
| **Manufacturing / printing / setup / packaging / freight cost** | `config/costs.ts` → `products.<id>.*` (**already listed under "Cost model"**) | margin, profit impact, minimum safe price, any specific price change |
| **Payment processing fee** | `config/costs.ts` → `paymentFee` | contribution margin |
| **Minimum gross margin** | `config/costs.ts` → `marginPolicy.minimumGrossMarginBps` | the price floor (fails closed while null) |
| **Minimum contribution margin** | `config/costs.ts` → `marginPolicy.minimumContributionMarginBps` | the price floor |
| Target contribution margin | `config/costs.ts` → `marginPolicy.targetContributionMarginBps` | evaluating a proposed price against a goal |
| **Maximum price decrease / increase per change** | `config/guardrails.ts` → `maximumPriceDecreasePct` / `maximumPriceIncreasePct` | any specific price change |
| Maximum MOQ change per action | `config/guardrails.ts` → `maximumMoqChangePct` | any specific MOQ change |
| Shipping subsidy rules, if any | Not modelled yet — `config/costs.ts → products.<id>.shipping` records the REAL freight cost even when shipping is advertised as free. Tell us if a subsidy rule exists so it can be represented explicitly rather than hidden in a cost | contribution accuracy |
| Future price-experiment limits | `config/guardrails.ts` → `maximumExperimentTrafficPct` **plus** a separate authority-aware design (docs/EXPERIMENTATION.md §24). The experiment engine deliberately cannot run price variants today | any price test |
| Real sell prices | `config/products.ts` + `NEXT_PUBLIC_DEMO_PRICING=false` (**already listed**). Until then every pricing conclusion is about a placeholder price list, and the dashboard says so | the meaning of every pricing metric |

Two things Session 12 will never do, whatever you configure: estimate price
elasticity from observational data (there is no controlled price variation to
estimate it from), and change a price by itself (no executor exists and none
may be registered until the full contract in docs/AI_ACTION_CENTER.md is
satisfied).

## Google Ads integration (Session 13)

Split deliberately into what is needed to CONNECT, what is needed for the
data to be USEFUL, and what stays unavailable regardless.

### Required to connect (server-only env — see `.env.example`)

- [ ] `GOOGLE_ADS_DEVELOPER_TOKEN` — from the Google Ads API Center. A
      test-mode token cannot read a production account.
- [ ] `GOOGLE_ADS_CLIENT_ID` + `GOOGLE_ADS_CLIENT_SECRET` — a Google Cloud
      OAuth 2.0 client.
- [ ] `GOOGLE_ADS_REFRESH_TOKEN` — issued for a Google account with **read**
      access to the Ads account (scope `.../auth/adwords`). This integration
      can only read, so a read-only account is sufficient and is what you
      should use.
- [ ] `GOOGLE_ADS_CUSTOMER_ID` — the account being reported on.
- [ ] `GOOGLE_ADS_LOGIN_CUSTOMER_ID` — **only** if that account sits under a
      manager (MCC): the MANAGER's id.

**Do not invent these.** While they are unset the dashboard reads
NOT_CONNECTED, which is never interpreted as $0 spend, and nothing else in
the platform is affected.

### Required for the spend intelligence to mean anything

- [ ] A **production** Google Ads account with real serving history. A
      Google Ads *test* account returns no real data, and the dashboard
      flags it explicitly so no decision is made from structural numbers.
- [ ] Campaigns actually running, with tracking templates that carry the
      campaign into the landing URL. Without `{campaignid}` (⇒ EXACT match)
      or a `utm_campaign` matching the campaign name (⇒ MAPPED), real visits
      are UNMATCHED: account-level figures stay correct, but per-campaign
      first-party revenue is understated, and the coverage section says by
      how much.

### Still unavailable regardless of the above

- **Profit on ad spend (POAS).** Requires the cost model in
  `config/costs.ts`. Until it is filled, revenue ROAS is shown and is
  explicitly NOT called profitability — a campaign with ROAS 4 can still
  lose money on every order.
- **Any automated advertising action.** Budget changes, pausing and
  resuming need the ad-spend limits below, a separate mutation provider,
  and the full executor contract. Session 13 ships none of them.

## Guardrail limits (Session 10 — `config/guardrails.ts`)

Every value below ships as an explicit `null` `[TO BE PROVIDED]`. The
Guardrail Engine treats a `null` limit as **MISSING CONFIGURATION**, never
as "no limit": the affected action can still be reviewed and approved by
you, but it can never become eligible for automated execution, and
`/admin/ai-actions` names the exact missing config path on the card
("Cannot be approved for automated execution — missing configuration:
config/guardrails.ts → GUARDRAIL_LIMITS.maximumDailyAdSpendCents").

**Nothing here blocks today's recommendation-only mode.** These values are
prerequisites for a future GUARDED_AUTO promotion (roadmap Stage J), not
for using the Action Center now. Do not invent them.

Units: integer cents, or percent as a whole number (10 = 10%). Any change
to this file **must bump `GUARDRAIL_POLICY_VERSION`** — stored guardrail
evaluations reference it so past verdicts stay explainable.

### Currently required

| Item | Where | Status |
| --- | --- | --- |
| Admin credentials for the Action Center | `.env` → `ADMIN_USER` / `ADMIN_PASSWORD` | Same surface as S08/S09 — no separate credentials |
| Action Center on/off | `.env` → `AI_ACTION_CENTER_ENABLED` (default false; the surface 404s while off). The Guardrail Engine itself always runs | — |

### Required before GUARDED_AUTO (never before then, never invented)

| Item | Where |
| --- | --- |
| Minimum gross / contribution margin | `config/costs.ts` → `marginPolicy` (**already listed under "Cost model"** — the guardrail engine reads the SAME config as the pricing engine; it is not duplicated) |
| Maximum price decrease / increase per change | `config/guardrails.ts` → `maximumPriceDecreasePct` / `maximumPriceIncreasePct` |
| Maximum discount an automated action may apply | `config/guardrails.ts` → `maximumDiscountPct` |
| Maximum campaign budget change per action | `config/guardrails.ts` → `maximumCampaignBudgetChangePct` |
| Maximum total daily ad spend | `config/guardrails.ts` → `maximumDailyAdSpendCents` |
| Maximum new-campaign test budget | `config/guardrails.ts` → `maximumNewCampaignTestBudgetCents` |
| Maximum experiment traffic share | `config/guardrails.ts` → `maximumExperimentTrafficPct` — **also required for HUMAN-launched experiments in production** (Session 11, see "Experimentation" above); the rest of this list is GUARDED_AUTO-only |
| High-value order threshold (forces human review) | `config/guardrails.ts` → `highValueOrderThresholdCents` |
| Refund approval threshold | `config/guardrails.ts` → `refundApprovalThresholdCents` (refunds stay CRITICAL and permanently non-automated regardless — this only sets the review threshold) |
| Maximum MOQ change per action | `config/guardrails.ts` → `maximumMoqChangePct` |

Magnitude-based risk escalation ("a >X% budget increase is CRITICAL") is
deliberately NOT implemented, because implementing it would mean inventing
X. It becomes possible once these values exist.


---

## Production Launch Session 02 — commerce and artwork inputs (2026-08-16)

**Every item here is data only you can supply. The engineering is complete and
tested; nothing below is waiting on code.** Architecture:
`docs/SHOPIFY_PRODUCTION.md`, `docs/ARTWORK_STORAGE.md`. Operational order:
`LAUNCH_CHECKLIST.md` → "Commerce — Shopify production".

### Shopify store

| what | where | notes |
|---|---|---|
| Store domain | `SHOPIFY_STORE_DOMAIN` | `your-store.myshopify.com` — no `https://`, no path. Server-only. |
| Admin API access token | `SHOPIFY_ADMIN_API_TOKEN` | Custom app → Admin API, scope **`write_draft_orders`**. Server-only, never `NEXT_PUBLIC_*`. |
| Webhook signing secret | `SHOPIFY_WEBHOOK_SECRET` | Shown once when you create the first webhook. Without it, paid orders are NOT reconciled (the endpoint fails closed). |

**Until both of the first two exist, production checkout answers 503 by
design.** That is the guard working, not a bug.

**No Storefront token is needed.** Shopify's Storefront cart cannot express a
custom line price, so the architecture does not use it. The
`NEXT_PUBLIC_SHOPIFY_*` variables from earlier sessions are **gone**.

### Shopify products and variants — the big one

You must create, in Shopify, one product per BagDirect product and one variant
per purchasable **size × material × color** combination, then paste each
variant's GID into `config/shopify.ts → SHOPIFY_MERCHANDISE_MAP`:

```ts
export const SHOPIFY_MERCHANDISE_MAP: Record<MerchandiseKey, string> = {
  "p-custom-takeout|m|standard|white": "gid://shopify/ProductVariant/44123456789012",
  // …one line per required key
};
```

`requiredMerchandiseKeys()` prints the exact list. `validateMerchandiseMap()`
tells you what is missing, mistyped or duplicated — it must report
`complete: true` with zero errors before launch.

Notes that will save you time:
- **Custom colors are excluded** — they route to custom quotes and can never
  be checked out, so they need no variant.
- Each product's own sizes and materials apply (e.g. `p-heavy-duty` has no
  Small and only the heavy material).
- **The Shopify variant PRICE does not matter.** BagDirect sends its own price
  as a `priceOverride` on every line, and verifies it came back unchanged. Set
  the variant prices to anything sane; they are never charged.
- What DOES matter on the variant: its **shipping profile**, its **tax
  settings** and whether it **requires shipping** — Shopify uses those.
- A duplicate mapping (two configurations → one variant) is an ERROR, because
  one of them would sell the wrong bag.

### Shopify store configuration (Shopify's job, your verification)

- [ ] US shipping profile with real rates — the draft-order invoice checkout
      rates the order from the customer's address. **BagDirect does not
      calculate shipping and does not claim to.**
- [ ] Tax configuration for the states you have nexus in. **There is no custom
      tax engine.**
- [ ] Payment gateway live
- [ ] Confirmation email template reviewed (Shopify sends it, not BagDirect)
- [ ] **US-only for now.** Canada shipping/tax/customs is unconfigured and
      untested — do not enable CA until it is.

### Webhook registration

Settings → Notifications → Webhooks (or the Admin API). All four, JSON, API
version matching `SHOPIFY_API_VERSION` (currently `2026-07`):

| topic | URL |
|---|---|
| `orders/create` | `https://<your-domain>/api/webhooks/shopify` |
| `orders/paid` | same |
| `orders/cancelled` | same |
| `refunds/create` | same |

### Artwork object storage

An S3-compatible bucket — Cloudflare R2, AWS S3, Backblaze B2, DO Spaces or
MinIO all work.

| variable | notes |
|---|---|
| `ARTWORK_S3_ENDPOINT` | e.g. `https://<account>.r2.cloudflarestorage.com` |
| `ARTWORK_S3_REGION` | `auto` for R2, the real region for S3 |
| `ARTWORK_S3_BUCKET` | |
| `ARTWORK_S3_ACCESS_KEY_ID` | |
| `ARTWORK_S3_SECRET_ACCESS_KEY` | |

Two configuration requirements that are easy to miss:

1. **The bucket must be PRIVATE.** No public read, no listing. Artwork is
   served only through short-lived server-signed URLs.
2. **CORS must allow `PUT` from your production origin, with the
   `Content-Type` header.** The browser uploads directly to the bucket; without
   this, every upload fails.

**Until this is configured, artwork upload is unavailable and says so** — and
printed products therefore cannot be ordered. That is correct: a paid order
whose logo went nowhere is worse than a refused one. Plain (no-logo) bags sell
fine without it.

### Decisions already made for you (change only deliberately)

- **SVG is rejected.** It is an executable document and a stored-XSS risk once
  artwork is durably stored and opened by staff. PDF/AI/EPS carry vector
  artwork, so nothing a printer needs is lost.
- **25 MB limit** — unchanged from before.
- **Abandoned-upload cleanup is manual.** `listAbandonedArtwork()` identifies
  uploads with no order and no quote; automated deletion is deferred.

### Still true, still blocking, from earlier sessions

- **Real prices.** Demo pricing notices stay visible until real prices are
  loaded AND `NEXT_PUBLIC_DEMO_PRICING=false`. Do not flip the flag first.
- **MOQ confirmation.**
- **`config/costs.ts`** — every value still `null`. Missing costs never block a
  sale; they block profit analytics and future price actions.
- **Production `DATABASE_URL`** + `npm run db:migrate` (migration `0009` is new
  this session).


---

## Production Launch Session 03 — operational configuration

Everything below is owner input. The mechanisms exist; the values do not, and
this session did not invent any of them.

### Required before real traffic

| Item | Where | Consequence if missing |
| --- | --- | --- |
| **Site domain** | `NEXT_PUBLIC_SITE_DOMAIN` | Canonical URLs, sitemap and structured data would point at a placeholder domain. robots.txt refuses crawling until it is set. **BLOCKS launch** |
| **`read_orders` Shopify scope** | Shopify admin → your custom app → API scopes, then reinstall (this issues a NEW `SHOPIFY_ADMIN_API_TOKEN`) | Lost-webhook reconciliation cannot read Shopify and records a `failed` run |
| **Platform / WAF rate-limit rules** | Vercel Firewall, or your CDN | Application limits still cost a function invocation per request. This is the only layer that refuses traffic before that |
| **Production alerts** | Your monitoring provider | Nothing in the repository can guarantee a person reads an error. Suggested rules: `docs/OBSERVABILITY.md` §4 |
| **Database backups / PITR + a tested restore** | Your Postgres provider | BagDirect does not back up the database and cannot query whether you do |
| **Pooled connection string** | `DATABASE_URL` | Serverless connection exhaustion; the symptom is intermittent 503s that look like an application bug |

### Strongly recommended

| Item | Where | Consequence if missing |
| --- | --- | --- |
| **Escalation delivery** | `HUMAN_HANDOFF_WEBHOOK_URL` (falls back to `QUOTE_WEBHOOK_URL`) | AI escalations are stored at `/admin/handoffs` but nobody is notified — a customer asking for a human waits until someone opens the page |
| **Error tracking** | `SENTRY_DSN` or `ERROR_WEBHOOK_URL` | Server errors reach the platform log only |
| **Rate-limit identity key** | `RATE_LIMIT_IP_SALT` | Network-scoped durable limits degrade to per-instance and reset on every deploy |
| **Google Ads conversion** | `NEXT_PUBLIC_GOOGLE_ADS_ID` **and** `NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL` | Paid traffic cannot be optimised toward purchases. Both are required — an id alone cannot address a conversion |
| **GA4** | `NEXT_PUBLIC_GA4_ID` or `NEXT_PUBLIC_GTM_ID` | Orders are still recorded in full by BagDirect; only the Google Analytics copy is missing |

### Owner verification — nobody but a person can close these

These never turn green on their own, and `/admin/launch-readiness` says so
explicitly rather than quietly counting them as done.

- [ ] **One real (or Shopify test-mode) order** placed end to end: shipping
      shown, tax shown, payment completes, webhook arrives, order becomes
      `paid`, exactly one `purchase_completed`, artwork on the right line.
- [ ] **One refund or cancellation** performed in Shopify and confirmed to
      reconcile in BagDirect.
- [ ] **Shopify US shipping profile** verified as covering the products.
- [ ] **Shopify tax settings** verified.
- [ ] **`npm run ai:smoke`** run with production credentials, if AI Sales is
      being enabled. It was NOT run in this session — no credentials were
      present, and inventing a passing result would be worse than reporting
      none.
- [ ] **Policy pages** reviewed. This codebase deliberately does not write
      legal copy.

### Optional tuning (defaults are fine)

| Variable | Default | What it does |
| --- | --- | --- |
| `ARTWORK_MAX_UPLOADS_PER_SESSION` | 25 | Objects one anonymous session may create |
| `ARTWORK_UPLOAD_WINDOW_HOURS` | 24 | The allowance window |
| `RATE_LIMIT_DURABLE` | on in production | The shared cross-instance limiter |

### Still true, still blocking, from earlier sessions

- **Real prices**, then `NEXT_PUBLIC_DEMO_PRICING=false`. Do not flip the flag
  first.
- **MOQ confirmation** (`MOQ_CONFIRMED: true`).
- **`SHOPIFY_MERCHANDISE_MAP`** — still empty; an unmapped configuration
  cannot be bought.
- **`config/costs.ts`** — every value still `null`. Missing costs never block a
  sale; they block profit analytics and future price actions.
- **Production `DATABASE_URL`** + `npm run db:migrate` (migration `0010` is new
  this session).
