# BUSINESS_CONFIG_TODO

Everything the business owner must provide before launch. Each item lists
**where it goes** in the codebase. Nothing here is invented — placeholders
render visibly until replaced.

## Identity

| Item | Where |
| --- | --- |
| Brand name | `config/business.ts` → `BRAND_NAME`, `DISPLAY_NAME` |
| Logo (SVG + favicon) | `app/favicon.ico`, header wordmark in `components/layout/Header.tsx` |
| Domain | `config/business.ts` → `DOMAIN` (drives canonical URLs, sitemap, JSON-LD) |
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

## Cost model (required for margins, contribution profit & price guardrails)

The structure now exists in `config/costs.ts` (Session 02) with every value
an explicit `null` placeholder. Margin math reports "unavailable" and every
price guardrail fails closed until ALL of these are provided. Do NOT let
anyone invent them. Units: integer cents; rates in basis points (290 = 2.9%).

**Session 09 makes the gap visible daily:** `/admin/business-intelligence`
shows gross profit, contribution profit (before paid media), and both
margins as **"Unavailable — configure manufacturing costs"** — listing the
exact missing inputs — until every row below is filled. Nothing substitutes
zero, nothing estimates. Classification:

- **REQUIRED FOR LAUNCH** (price guardrails fail closed without them):
  payment fee + margin policy floors.
- **REQUIRED FOR PROFIT INTELLIGENCE** (dashboards + future pricing/ads
  optimization are blind without them): every per-product manufacturing /
  size / material / printing / packaging / shipping / other-variable input.
- Not needed yet (later sessions): advertising cost feeds (Google/Meta) —
  the dashboard already labels contribution "before paid media" and never
  fabricates CAC/ROAS.

| Item | Where |
| --- | --- |
| Base manufacturing cost per bag | `config/costs.ts` → `products.<id>.baseManufacturingCentsPerUnit` |
| Per-size manufacturing deltas | `config/costs.ts` → `products.<id>.sizeAdjustmentCentsPerUnit` (every offered size id) |
| Per-material cost deltas (GSM/weight) | `config/costs.ts` → `products.<id>.materialAdjustmentCentsPerUnit` |
| Printing cost per unit (1c/2c) + setup fees | `config/costs.ts` → `products.<id>.printing.<printOptionId>` |
| Packaging cost per unit | `config/costs.ts` → `products.<id>.packagingCentsPerUnit` |
| Shipping cost basis (per unit / per order / per carton) | `config/costs.ts` → `products.<id>.shipping` |
| Other variable cost (0 is a valid confirmed value) | `config/costs.ts` → `products.<id>.otherVariableCentsPerUnit` |
| Payment processing fee (% + fixed) | `config/costs.ts` → `paymentFee` |
| Minimum gross / contribution margin + target margin | `config/costs.ts` → `marginPolicy` |

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
| Maximum experiment traffic share | `config/guardrails.ts` → `maximumExperimentTrafficPct` |
| High-value order threshold (forces human review) | `config/guardrails.ts` → `highValueOrderThresholdCents` |
| Refund approval threshold | `config/guardrails.ts` → `refundApprovalThresholdCents` (refunds stay CRITICAL and permanently non-automated regardless — this only sets the review threshold) |
| Maximum MOQ change per action | `config/guardrails.ts` → `maximumMoqChangePct` |

Magnitude-based risk escalation ("a >X% budget increase is CRITICAL") is
deliberately NOT implemented, because implementing it would mean inventing
X. It becomes possible once these values exist.
