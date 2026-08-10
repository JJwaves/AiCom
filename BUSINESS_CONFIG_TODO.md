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

| Item | Where (planned) |
| --- | --- |
| AI provider choice + API keys | `.env` (`AI_PROVIDER`, `AI_API_KEY_*`) |
| AI daily / monthly budget caps | guardrail config |
| `minimumAllowedPrice` / `minimumGrossMargin` / `minimumContributionMargin` | guardrail config |
| `maximumDiscountPct` / `maximumPriceChangePct` | guardrail config |
| High-value order threshold (forces human review) | guardrail config |
| Refund approval threshold | guardrail config |
| Escalation destination (email/Slack/phone for human handoff) | escalation config |
| Confirmed factory capabilities list (what the sales agent may claim) | `config/products.ts` `confirmed` flags + capability notes |
| Admin users + auth method for `/admin/*` | auth config (Stage B+) |
