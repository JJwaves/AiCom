# LAUNCH_CHECKLIST

Work through in order. Items marked ⛔ are hard blockers — the site must not
take real traffic until they pass.

> **Start here:** `/admin/launch-readiness` computes most of this list from
> the running system, so it cannot drift from what production actually does.
> This document covers the items no code can check — the ones that need a
> person to look at Shopify, a database provider, or a monitoring dashboard.
> `GET /api/health/ready?verbose=1` returns the same verdicts as JSON.

---

## STATUS AS OF 2026-08-17 — Product #1 production configuration: **partially unblocked, still NO-GO**

The Product #1 Production Configuration session replaced the demo catalog with
the first real launch product. **Three of Session 04's ten blockers are now
closed by data that did not exist before**, and the Shopify variant
requirement collapsed from 114 to 4 because only launch-enabled configurations
need merchandise.

| | Session 04 | Now |
| --- | --- | --- |
| Readiness | 1 READY · 18 WARNING · **10 BLOCKED** | 7 READY · 19 WARNING · **4 BLOCKED** |
| Shopify variants required | 114 (0 mapped) | **4** (0 mapped) |
| Products with real prices | 0 of 4 | **1 of 1 launch-enabled** (`pricingStatus: "LIVE"`) |
| MOQ | unconfirmed placeholder 500 | **5,000 per design, confirmed** |
| Launch-enabled products | 4 (all DEMO) | **1** (3 disabled and unreachable) |

**Closed by this session** — product data, prices and MOQ:

- [x] Product #1 defined: Custom Insulated Takeout Bag · Large 26×26×17 cm and
      Extra Large 30×30×20 cm · black/white · custom artwork printing · MOQ
      5,000/design · 5,000 and 10,000 direct-order quantities.
- [x] Real sell prices installed and marked LIVE: Large $950 / $1,500 ·
      Extra Large $1,150 / $1,900 (product subtotals).
- [x] Flat **$100 per ORDER** U.S. shipping, charged once per order as a single
      Shopify `shippingLine`, shown separately from the product subtotal, and
      verified on read-back.
- [x] Digital-proof and 15–30-day-after-approval lead-time copy on the product
      page, cart, shipping policy and FAQ.
- [x] Every demo product `launchEnabled: false` — pages 404, absent from
      listings, sitemap, AI tool results and the Shopify requirement.
- [x] US-only market; Canada copy removed from customer-facing pages.

**Still BLOCKED — all owner infrastructure or store setup:**

1. **4 Shopify variant GIDs** (Large/Black, Large/White, XL/Black, XL/White)
2. **Artwork storage** — Product #1 always prints custom artwork, so it is
   unbuyable until `ARTWORK_S3_*` exists
3. **`NEXT_PUBLIC_SITE_DOMAIN`**
4. **3 customer-facing `[TO BE PROVIDED]` values** — customer service email,
   customer service phone, and **transit time** (production time is now real;
   transit is not, because no carrier is contracted)

Plus, unchanged and still required before real traffic: production
`DATABASE_URL` with backups, Shopify credentials + webhook secret, admin
credentials, Shopify shipping/tax/payment verification, and
`NEXT_PUBLIC_DEMO_PRICING=false` in the production environment (the catalog
says LIVE; the flag is the owner's second signal, and until both agree the
storefront keeps the demo notice and withholds the offer from structured data).

**Not blocking, but visible:** all six Product #1 photography slots are empty
and render labelled placeholders. Owner/supplier assets only — no AI-generated
product shots. The exact list is in BUSINESS_CONFIG_TODO → "Product #1".

**Still unavailable, deliberately:** profit analytics. The supplier quotes in
CNY and this codebase has no FX model, so `config/costs.ts` stays null and
margin/POAS keep reporting "unavailable" rather than a fabricated number.
Missing costs never block a sale.

---

## STATUS AS OF 2026-08-17 — Production Launch Session 04: **NO-GO** (superseded above)

Session 04 attempted to configure and validate a real production environment.
**No production environment exists yet, and no owner values were supplied**,
so nothing in the Commerce, Artwork, Analytics, Monitoring or Operations
sections below could be closed. Verdict: **NO-GO — production blockers
remain.**

Measured on a real `next build` + `next start` with `NODE_ENV=production`
(not a dev server, not a test fixture):

| | |
| --- | --- |
| `/api/health/live` | 200 `{"status":"ok"}` |
| `/api/health/ready` | **503 `not_ready`** |
| Readiness counts | 1 READY · 18 WARNING · **10 BLOCKED** (all 10 mandatory) |
| Shopify merchandise map | 0 of **114** required variants mapped |
| Products with real prices | **0 of 4** (all `pricingStatus: "DEMO"`) |

**The ten blockers — every one is owner data or owner infrastructure, none is
an engineering gap:**

1. Shopify not configured (`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_API_TOKEN`)
2. 114 of 114 Shopify variants unmapped
3. No `DATABASE_URL` — no production Postgres exists
4. 4 of 4 products still on demo prices
5. MOQ still the unconfirmed placeholder of 500
6. No artwork storage — every printed product is unbuyable
7. No admin credentials
8. No `NEXT_PUBLIC_SITE_DOMAIN`
9. 4 customer-facing `[TO BE PROVIDED]` values (verified rendering on
   `/contact`, `/about` and `/shipping-policy` in production HTML)
10. Database unreachable

**What WAS verified to work, on the production build** (fail-closed
behaviour — the safety properties, not the sale):

- `POST /api/checkout` → **503**, log `COMMERCE_NOT_CONFIGURED`. **No `MOCK-*`
  order was minted.** This is the single most important guard and it holds.
- Unsigned Shopify webhook → 503, writes nothing.
- Artwork upload with storage unset → 503 `UNAVAILABLE`; never pretends to
  succeed.
- Admin with credentials unset → **404** on `/admin/*` and `/api/admin/*`;
  with credentials set → 401 unauthenticated, 401 wrong password, 200 correct.
- `robots.txt` refuses crawling entirely while the domain is unset.
- `/api/health/ready?verbose=1` leaks no secret value (only variable NAMES).
- No third-party analytics script loads (none is configured).
- Homepage, product page and configurator: no horizontal overflow at 375px.

**Three production bugs were found and fixed** (see CLAUDE.md §Session 04):
the readiness page called an unconfigured Shopify "partially configured";
`sitemap.xml` published 21 URLs on `example.com`; and
`NEXT_PUBLIC_DEMO_PRICING=false` over a still-DEMO catalog hid the demo-price
warning *and* published demo prices to search engines as real
`AggregateOffer` values.

**Do not tick anything below from this session.** Every unticked ⛔ is still
unticked.

---

## Infrastructure
- [ ] ⛔ `NEXT_PUBLIC_SITE_DOMAIN` set to the live domain (BUILD-TIME — requires a redeploy). Unset, robots.txt refuses crawling entirely rather than advertising a sitemap at a placeholder domain
- [ ] ⛔ Domain connected and DNS resolving
- [ ] ⛔ SSL active (platform-managed)
- [ ] Security headers checked (CSP, X-Frame-Options, Referrer-Policy)
- [ ] 404 page tested (`/definitely-not-a-page`)

## Database (first-party data)
- [ ] ⛔ Production `DATABASE_URL` set to a real Postgres instance (managed Postgres recommended; PGlite is dev/test-only and the app now refuses to start database access in production without `DATABASE_URL` — db/client.ts)
- [ ] ⛔ Migrations applied to the production database BEFORE first traffic: run `npm run db:migrate` with the production `DATABASE_URL` as an explicit deploy step (the app never runs DDL against an external database at request time)
- [ ] ⛔ Verified the deployed environment is NOT on the embedded PGlite fallback: with `DATABASE_URL` unset the production app must fail loudly at first database use (actionable `[db] DATABASE_URL is not set` error in server logs) — never silently store data on instance disk
- [ ] Migration process documented in the deploy pipeline (schema changes: `npm run db:generate` in development → review SQL in `db/migrations/` → `npm run db:migrate` at deploy)
- [ ] `npm run db:seed` never pointed at production (it writes DEMO-labeled data and refuses external databases unless forced — leave it that way)
- [ ] ⛔ Pooled / serverless-safe connection string in use (Neon `-pooler`, Supabase port 6543 + `pgbouncer=true`, PgBouncer, or the platform's pooled URL). A direct connection exhausts `max_connections` under ordinary serverless traffic, and the symptom is intermittent 503s that look like an application bug
- [ ] ⛔ Database backups / point-in-time recovery enabled on the production Postgres — **BagDirect does not back up the database and cannot query whether you do**. Record the retention window
- [ ] ⛔ A restore has actually been TESTED into a scratch environment (an untested backup is a hypothesis)

## AI Packaging Expert (only if enabling AI_SALES for customers)
- [ ] ⛔ Edge/platform rate limiting in front of `/api/ai/chat` (and the S07 companion `/api/cart/line`) — the built-in token buckets are per-instance application guards, not a distributed limiter (docs/AI_SALES_AGENT.md)
- [ ] Verify the S07 AI commerce boundary on the production build: AI add-to-cart requires explicit intent, repriced adds/checkouts require re-confirmation, checkout URLs are provider-generated only, and no purchase event fires before order creation (docs/AI_COMMERCE_INTEGRATION.md)
- [ ] ⛔ AI budget caps set (`AI_DAILY_BUDGET_USD` / `AI_MONTHLY_BUDGET_USD`) AND `config/ai-pricing.ts` filled with current provider rates — caps over unpriced models fail closed and block every call
- [ ] ⛔ Model ids verified against the live account: `npm run ai:smoke` (model names age; the defaults are not guaranteed valid forever)
- [ ] ⛔ Escalation delivery wired to a real destination (BUSINESS_CONFIG_TODO) — today handoffs are recorded in the DB, not sent anywhere
- [ ] Chat verified end-to-end on the production build with flags on, and verified ABSENT (no UI, 503 API) with flags off

## Admin surface (Session 08 — only if enabling AI_CUSTOMER_INTELLIGENCE)
- [ ] ⛔ `ADMIN_USER` + `ADMIN_PASSWORD` set to strong values (long random password) — while unset every /admin and /api/admin path is a 404 by design; never reuse other credentials
- [ ] ⛔ Admin served over HTTPS only (Basic auth sends credentials per request — TLS is the transport protection)
- [ ] Verify /admin/customer-intelligence answers 404 with the flag off, 401-challenge with wrong credentials, and renders with correct ones on the production build
- [ ] Verify production intelligence shows REAL data only (`npm run db:seed` demo rows must never reach the production database — existing DB checklist item)
- [ ] Review CUSTOMER_INTELLIGENCE thresholds in `config/customer-intelligence.ts` (documented defaults: 3 evidence / 5 denominator / 5 trend base / batch 25) before relying on the report for decisions

## Business intelligence (Session 09 — only if enabling AI_BUSINESS_INTELLIGENCE)
- [ ] Same admin auth prerequisites as above (shared surface — no separate credentials)
- [ ] Verify /admin/business-intelligence answers 404 with the flag off and renders deterministic metrics WITHOUT any AI configuration on the production build
- [ ] Review BUSINESS_INTELLIGENCE thresholds in `config/business-intelligence.ts` (documented defaults: 5 denominator / 5 trend base / 5 segment sample) before relying on the dashboard for decisions
- [ ] Understand profitability stays "Unavailable — configure manufacturing costs" until `config/costs.ts` is filled (see Commerce item below); never expect $0 placeholders
- [ ] CEO reviews cost real AI spend (REASONING tier) — generate them deliberately; model pricing in `config/ai-pricing.ts` is required for spend metrics + budget caps

## AI Action Center (Session 10 — only if enabling AI_ACTION_CENTER)
- [ ] Same admin auth prerequisites as above (shared surface — no separate credentials)
- [ ] ⛔ HTTPS is mandatory here specifically: these are the first admin MUTATION routes, and HTTP Basic credentials travel on every request
- [ ] Verify /admin/ai-actions answers 404 with the flag off, and that approve/reject/modify are rejected cross-origin (403) and for non-JSON content types (415) on the production build
- [ ] Understand what approval means: it records YOUR decision. No executor exists for any business action type, so nothing changes a price, ad budget, product, or payment. Do not read "Approved" as "done"
- [ ] Guardrail limits in `config/guardrails.ts` are all `[TO BE PROVIDED]` — actions needing them show "missing configuration" and can never be execution-eligible. Fill them only before any GUARDED_AUTO promotion is considered (BUSINESS_CONFIG_TODO)
- [ ] Any change to `config/guardrails.ts` or the action taxonomy must bump `GUARDRAIL_POLICY_VERSION` (stored evaluations reference it)
- [ ] Known limitation accepted: single shared admin identity — every `reviewedBy` reads as the configured `ADMIN_USER`; per-user RBAC is deferred

## Experiments (Session 11 — only if enabling EXPERIMENT_ENGINE)
- [ ] Same admin auth prerequisites as above (shared surface — no separate credentials); HTTPS is mandatory (launch/stop are admin MUTATION routes)
- [ ] ⛔ Set `GUARDRAIL_LIMITS.maximumExperimentTrafficPct` in `config/guardrails.ts` BEFORE running experiments in production. While it is null the launch route REFUSES in production (it never assumes 100%); the 50% development ceiling applies only when `NODE_ENV !== "production"`
- [ ] ⛔ Any change to `config/guardrails.ts` must bump `GUARDRAIL_POLICY_VERSION`
- [ ] Understand the rendering trade-off: with `EXPERIMENT_ENGINE_ENABLED=true`, `/` and `/products/[slug]` render dynamically instead of statically. **Toggling the flag requires a rebuild/redeploy** — a build made with the flag off will never enrol anyone
- [ ] Review the minimum sample: `EXPERIMENTS.DEFAULT_MINIMUM_SAMPLE_PER_VARIANT` is a conservative development default (1,000 exposed sessions per arm), NOT a power calculation. Raise it per experiment if you want more certainty; it can never be lowered
- [ ] Verify /admin/experiments answers 404 with the flag off, and that launch/stop/archive are rejected cross-origin (403) and for non-JSON content types (415) on the production build
- [ ] Read every variant's copy yourself before approving: it is customer-facing, and it must not contain a delivery promise, price, guarantee, certification or claim the factory cannot honour
- [ ] Understand what a result means: no winner is declared below the minimum sample, "no clear winner" is a real answer, and a `VARIANT_WIN` changes nothing on the site — promoting a winner is a human source/config change
- [ ] Only if enabling `AI_CRO_AGENT`: the agent needs the AI runtime + provider key + budget caps (see the AI section). Experiments keep running, measuring and reporting when the CRO agent is off or the provider is down

## Pricing intelligence (Session 12 — only if enabling PRICING_INTELLIGENCE)
- [ ] Same admin auth prerequisites as above (shared surface — no separate credentials); HTTPS is mandatory (the review route is an admin MUTATION route)
- [ ] Understand what the dashboard can and cannot tell you TODAY: it measures pricing behaviour from real data, but with `config/costs.ts` unfilled it cannot tell you whether any price is profitable, what a safe price is, or how demand responds to price. It says so on every affected card rather than showing a zero
- [ ] ⛔ Before acting on ANY pricing conclusion: replace demo prices (`config/products.ts` + `NEXT_PUBLIC_DEMO_PRICING=false`). Until then every tier price analysed is a placeholder, and the dashboard's DEMO_PRICING_ACTIVE warning says exactly that
- [ ] ⛔ Before any specific price change is even representable as safe: fill the cost model AND `marginPolicy` in `config/costs.ts` AND `maximumPriceDecreasePct` / `maximumPriceIncreasePct` in `config/guardrails.ts` (bumping `GUARDRAIL_POLICY_VERSION`). Until then `SPECIFIC_PRICE_CHANGE` reads BLOCKED and the price floor refuses to verify anything
- [ ] Know that there is no elasticity figure anywhere in this system and there will not be one until a controlled price experiment exists. Any number claiming to be one did not come from this platform
- [ ] Keep MOQ and price separate when reading the dashboard: below-minimum demand is a quantity finding routed to MOQ review, never evidence that the unit price is too high
- [ ] Verify /admin/pricing-intelligence answers 404 with the flag off, and that the review route is rejected cross-origin (403) and for non-JSON content types (415) on the production build
- [ ] Only if enabling `AI_PRICING_AGENT`: the agent needs the AI runtime + provider key + budget caps (see the AI section). Every number on the dashboard is computed without it, and a provider outage leaves the last review visible

## Google Ads intelligence (Session 13 — only if enabling GOOGLE_ADS_INTELLIGENCE)
- [ ] Same admin auth prerequisites as above (shared surface — no separate credentials); HTTPS is mandatory (the sync, connection-test and review routes are admin MUTATION routes)
- [ ] ⛔ Set the five required `GOOGLE_ADS_*` server variables (see `.env.example` + BUSINESS_CONFIG_TODO). Use a Google account with READ access only — this integration cannot write, so nothing more is needed
- [ ] ⛔ Never put a Google Ads credential in a `NEXT_PUBLIC_*` variable, and never commit one. They are read server-side only, are redacted out of every persisted error, and appear in no prompt, log line, database column or browser response
- [ ] Press "Test connection" first and confirm the returned CURRENCY and TIME ZONE match the account you expect — every downstream figure depends on both, and neither is ever assumed
- [ ] Confirm the account is NOT a Google Ads test account (the page flags it). Test accounts serve no real ads, so their figures are structural
- [ ] Know that sync is MANUAL: there is no scheduler, so "weekly reporting" means pressing "Sync Google Ads" weekly. Freshness advances only on a COMPLETE sync, and a failed sync leaves the previous data visible with its own timestamp rather than showing zeros
- [ ] Understand what the dashboard can and cannot tell you TODAY: Google's conversions are NOT your orders and Google's conversion value is NOT your revenue — both lenses are shown side by side and neither corrects the other. **POAS requires the cost model** (`config/costs.ts`) AND orders carrying a cost snapshot AND a matching currency AND adequate attribution coverage; until all four hold it reads UNAVAILABLE or PARTIAL, and revenue ROAS is never profitability
- [ ] Before drawing per-campaign conclusions, check the attribution coverage section. Below 50% matched, first-party CAC and ROAS report PARTIAL — fix tracking templates before blaming a campaign
- [ ] If the ad account currency differs from your order currency, CAC and ROAS report UNAVAILABLE rather than wrong. There is no exchange-rate model and none will be invented
- [ ] Verify /admin/google-ads-intelligence answers 404 with the flag off, and that all three routes are rejected cross-origin (403) and for non-JSON content types (415) on the production build
- [ ] Only if enabling `AI_GOOGLE_ADS_AGENT`: the agent needs the AI runtime + provider key + budget caps (see the AI section). Every number on the dashboard is computed without it; syncing never spends AI tokens; a provider outage leaves the last review visible
- [ ] Confirm nothing in this platform can change your Google Ads account: there is no executor, no mutation provider, and the ad-spend limits in `config/guardrails.ts` are still `null` (which BLOCKS, and never means "no limit")

## Unit economics (Session 13.5 — `config/costs.ts`)
- [ ] Understand the split: **missing costs never block a sale.** Customers can price, cart and check out with every value null. What is blocked is profit analytics, POAS and any future price action
- [ ] Collect the real numbers using the fill-in template in BUSINESS_CONFIG_TODO → "Cost model". Nothing may be an industry average, a competitor's price, or an AI estimate — a guessed cost reports a number that looks true
- [ ] Enter them as integer cents / basis points and **bump `COST_MODEL_VERSION`**; every stored order cost snapshot references it
- [ ] Supply BOTH minimum (hard floor) and target (objective) margins for gross and contribution. They are different numbers with different consequences; a target below its own minimum is rejected by validation
- [ ] Confirm the customer shipping charge basis. `not_collected` is today's structural fact (checkout collects no shipping); changing it to a flat charge makes shipping economics PARTIAL until orders record a real shipping charge
- [ ] Run `npm test` after editing — invalid configuration (negative costs, a fee ≥ 100%, an unreachable margin, unordered tiers, a missing size/print option) fails loudly rather than being normalised
- [ ] Check "Cost and margin readiness" on /admin/business-intelligence: every row Configured, every capability Ready
- [ ] Expect profit to appear only for orders placed AFTER the configuration exists. Earlier orders report HISTORICAL_COST_UNAVAILABLE — today's costs are deliberately never applied backwards
- [ ] Know what is NOT modelled: refunds, discounts (structurally absent), overhead/salaries/rent/tax, freight rate shopping, currency conversion, negotiated quote economics

## Commerce — Shopify production (Session 02)

Architecture: `docs/SHOPIFY_PRODUCTION.md`. **Engineering is complete; every
item below is owner data or an operational step.** Nothing here is ticked by
code.

**Shopify configuration**
- [ ] ⛔ `SHOPIFY_STORE_DOMAIN` set (`your-store.myshopify.com`, server-only)
- [ ] ⛔ `SHOPIFY_ADMIN_API_TOKEN` set — custom app, scope `write_draft_orders` (server-only, never `NEXT_PUBLIC_*`)
- [ ] Verify the production guard: with these UNSET and `NODE_ENV=production`, `/api/checkout` must answer **503** and the log must say "COMMERCE IS NOT CONFIGURED". It must NEVER return a `MOCK-*` order.

**Merchandise mapping**
- [ ] ⛔ Shopify products created (one per BagDirect product)
- [ ] ⛔ Shopify variants created for every purchasable product · size · material · color
- [ ] ⛔ `config/shopify.ts → SHOPIFY_MERCHANDISE_MAP` filled — run `validateMerchandiseMap()` until it reports `complete: true` with zero `error` issues (`requiredMerchandiseKeys()` prints the exact list). Ships EMPTY.
- [ ] Preflight each mapped variant id resolves in the Shopify admin (a typo'd-but-valid GID sells the wrong bag)

**Pricing**
- [ ] ⛔ Real product prices loaded; `pricingStatus: "LIVE"`; `NEXT_PUBLIC_DEMO_PRICING=false` — **only after real prices are entered**, never before
- [ ] ⛔ Real MOQ confirmed (`MOQ_CONFIRMED: true`)
- [ ] Cost model filled in `config/costs.ts` (no `null` inputs) — see "Unit economics" above. NOT a checkout blocker: missing costs never block a sale.
- [ ] Verify the Shopify checkout total equals the BagDirect total exactly (a mismatch aborts checkout by design — if it fires, the mapping or the store currency is wrong)

**Webhooks**
- [ ] ⛔ `SHOPIFY_WEBHOOK_SECRET` set (Settings → Notifications → Webhooks; shown once)
- [ ] ⛔ Webhooks registered → `POST https://<domain>/api/webhooks/shopify`, JSON, API version matching `SHOPIFY_API_VERSION`:
      `orders/create` · `orders/paid` · `orders/cancelled` · `refunds/create`
- [ ] Verify a forged/unsigned webhook is rejected **401** and writes nothing
- [ ] Verify the endpoint is reachable from the public internet (not behind admin auth — `proxy.ts` guards `/admin` and `/api/admin` only)

**Store configuration (Shopify's responsibility — verify, don't assume)**
- [ ] ⛔ US shipping profile configured; rates appear at the draft-order invoice checkout after entering an address
- [ ] ⛔ Taxes configured in Shopify for the US states you have nexus in
- [ ] ⛔ Payment gateway enabled and in live mode
- [ ] Confirmation emails reviewed (Shopify sends them; BagDirect does not)
- [ ] **US-only soft launch** — Canada shipping/tax/customs is NOT configured or tested (Session 02 §39)

**End-to-end test order (real store, TEST payment — see docs/SHOPIFY_PRODUCTION.md §14)**
- [ ] Test order placed and PAID; BagDirect order flips `pending_payment` → `paid`
- [ ] Exactly ONE `purchase_completed` event exists for it
- [ ] Re-send the webhook from the Shopify admin → nothing changes (idempotency)
- [ ] Partial refund → `refunded_total_cents` updates, status stays `paid`
- [ ] Full refund → status becomes `refunded`, order leaves revenue
- [ ] Cancel a test order → status becomes `cancelled`, order leaves revenue
- [ ] Mobile checkout tested end-to-end (375px)

## Artwork storage (Session 02)

Architecture: `docs/ARTWORK_STORAGE.md`.

- [ ] ⛔ S3-compatible bucket created and **PRIVATE** (no public read, no listing)
- [ ] ⛔ `ARTWORK_S3_ENDPOINT` / `_REGION` / `_BUCKET` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` set (server-only)
- [ ] ⛔ CORS on the bucket allows `PUT` from your production origin with the `Content-Type` header (the browser uploads directly)
- [ ] Upload smoke test: each accepted format (PNG, JPG, PDF, AI, EPS) uploads, verifies and attaches to a cart line
- [ ] Verify **SVG is refused** with the actionable message (policy decision — Session 02 §25)
- [ ] Verify a file renamed to `.png` but containing something else is refused and the object deleted
- [ ] Verify that with storage UNSET, the uploader says so and never pretends to succeed
- [ ] Verify the artwork reaches the ORDER LINE: `artworks.order_line_id` is set on a paid multi-line order
- [ ] Decide retention for abandoned uploads (`listAbandonedArtwork()` identifies them; automated cleanup is DEFERRED)
- [ ] Note: **quote artwork is still metadata-only** — the quote form does not use durable storage yet (Session 02 §30)

## Product #1 — Custom Insulated Takeout Bag

- [x] Exactly one product is `launchEnabled: true`; every demo entry is disabled and 404s
- [x] Sizes, colours, construction, MOQ, quantity tiers and prices are owner-confirmed
- [x] `pricingStatus: "LIVE"` on the launch product
- [ ] ⛔ `NEXT_PUBLIC_DEMO_PRICING=false` in the production environment (build-time). Both signals must agree before a price is treated as live
- [ ] ⛔ Four Shopify variants created and mapped (see Commerce below)
- [ ] Six product photographs installed (owner/supplier assets only)
- [ ] Confirm with the factory that the digital-proof turnaround stated on the site matches reality before the first order

### Shipping — flat $100 per order (US only)

- [x] The charge is attached to the ORDER as a single Shopify `shippingLine`, never per line
- [x] It is read back from the draft order and verified; a doubled charge aborts the checkout
- [x] It is shown separately from the product subtotal on the product page, in the cart and at checkout
- [x] It is recorded as a CUSTOMER CHARGE (`shippingPolicy.customerCharge`), never as supplier freight cost
- [ ] ⛔ Confirm in the Shopify admin that no ADDITIONAL shipping rate is applied on top of the draft order's shipping line — the customer must be charged $100 once, not $100 plus a profile rate
- [ ] Decide what happens when real freight exceeds $100 (this is a commercial decision, not a code change)

## Content
- [ ] ⛔ Policies reviewed by owner + legal (`reviewed` flag set on each PolicyPage)
- [ ] ⛔ Privacy policy reviewed
- [ ] ⛔ Returns policy reviewed (custom-product terms)
- [ ] Factory information verified on /about
- [ ] Real product images installed — Product #1 needs six owner/supplier shots (`hero-black`, `white`, `base-colors`, `size-guide`, `xl-print-example`, `artwork-proof`); see BUSINESS_CONFIG_TODO → "Product #1". **No AI-generated product photography**
- [ ] Factory photos installed (FactoryBand slots)
- [ ] ⛔ Fake/demo content removed — search the repo for "demo", "placeholder", "[TO BE PROVIDED]", "REPLACE_ME". `/admin/launch-readiness` scans customer-facing business configuration for `[TO BE PROVIDED]` and BLOCKS on any that a customer would see

## Analytics & ads (Session 03 — docs/ANALYTICS_PRODUCTION.md)
> Every id below is **build-time inlined**: changing one requires a redeploy.
> A purchase fires ONLY from a server-confirmed PAID order — never from a
> created checkout, a redirect, `?placed=1`, or the AI.
- [ ] `NEXT_PUBLIC_GA4_ID` (or `NEXT_PUBLIC_GTM_ID`) set; GA4 verified in DebugView
- [ ] ⛔ If using GTM: GA4 and Google Ads tags configured **inside GTM** to trigger on the `purchase` dataLayer event (there is no `window.gtag` in a GTM install)
- [ ] `NEXT_PUBLIC_GOOGLE_ADS_ID` **and** `NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL` both set — an id without a label cannot address a conversion and is reported as not configured
- [ ] Google Ads conversion verified in Goals → Conversions (tag diagnostic updates faster than the conversion count)
- [ ] Google Ads tracking template / final URL suffix set so campaign identity reaches first-party attribution: `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}` — auto-tagging (`gclid`) stays ON
- [ ] Meta Pixel verified (Events Manager → Test Events), if Meta is in scope
- [ ] Meta Conversions API — **DEFERRED, not implemented.** The Pixel emits an `eventID` for future dedup; `META_ACCESS_TOKEN`/`META_DATASET_ID` are read by no code today
- [ ] ⛔ Purchase deduplication verified: refresh the confirmation page and confirm no second purchase in any platform
- [ ] ⛔ Understood and accepted: browser conversion tracking **undercounts** — a buyer who closes the tab on Shopify's page never fires it. BagDirect's own `purchase_completed` is complete regardless. To close the gap, configure Shopify's own customer-events tracking against the SAME conversion action
- [ ] Consent banner verified: declining blocks every tag; "Analytics only" loads GA4 and NOT the ad platforms

## Monitoring & alerting (Session 03 — docs/OBSERVABILITY.md)
- [ ] Error tracking configured: `SENTRY_DSN` **or** `ERROR_WEBHOOK_URL`. Unconfigured, server errors reach the platform log only
- [ ] ⛔ **Alerts configured in your monitoring provider.** Nothing in this repository can guarantee a person reads an error. At minimum: checkout error spike, `COMMERCE_NOT_CONFIGURED`, Shopify webhook failures, `WEBHOOK_GAP_REPAIRED`, database failures, readiness 503, AI provider failure / budget exhausted, artwork upload failures
- [ ] Uptime monitor pointed at `/api/health/live` (NOT `/api/health/ready` — a readiness failure should page, not restart)
- [ ] `/api/health/ready` returns 200 in production
- [ ] `RATE_LIMIT_IP_SALT` set to a long random string (unset = ephemeral per-process key; network-scoped durable limits degrade to per-instance)
- [ ] `RATE_LIMIT_DURABLE` left unset or `true` in production
- [ ] ⛔ **Platform / WAF rate-limit rules configured** (Vercel Firewall or your CDN). This is the only layer that refuses a request before it costs a function invocation; nothing in the repository substitutes for it. Suggested rules in docs/OBSERVABILITY.md §6

## Operations (Session 03 — docs/PRODUCTION_OPERATIONS.md)
- [ ] `HUMAN_HANDOFF_WEBHOOK_URL` set (Slack workflow, Zapier/Make, email automation, helpdesk intake). Unset, escalations are stored at `/admin/handoffs` but **nobody is notified**
- [ ] `QUOTE_WEBHOOK_URL` set — otherwise a B2B quote request is logged and never read
- [ ] `/admin/handoffs` reachable and a test escalation delivered end to end
- [ ] `read_orders` scope added to the Shopify Admin token (required by reconciliation; reinstalling the app issues a NEW token — update `SHOPIFY_ADMIN_API_TOKEN` and redeploy)
- [ ] Reconciliation run once from `/admin/launch-readiness`; confirmed it repairs zero orders in a healthy system
- [ ] ⛔ **One real (or Shopify test-mode) order placed end to end**: shipping shown, tax shown, payment completes, webhook arrives, order becomes `paid`, exactly one `purchase_completed`, artwork attached to the right order line
- [ ] ⛔ **One refund or cancellation performed in Shopify** and confirmed to reconcile in BagDirect
- [ ] ⛔ Shopify US shipping profile verified as covering the products
- [ ] ⛔ Shopify tax settings verified
- [ ] Feature flags set to the soft-launch matrix (docs/PRODUCTION_OPERATIONS.md §10). Note: `EXPERIMENT_ENGINE_ENABLED` changes render mode — toggling it requires a **rebuild**

## Search
- [ ] Google Search Console connected + domain verified
- [ ] Sitemap submitted (`/sitemap.xml`)
- [ ] robots.txt checked (`/robots.txt` — /lp/ and /cart disallowed)
- [ ] Google Merchant Center connected; feed contains only fixed-price purchasable configs
- [ ] Feed prices/availability match on-site values

## Performance
- [ ] Core Web Vitals tested (mobile Lighthouse: Perf > 90, A11y > 90, SEO > 95, BP > 90)
- [ ] Images optimized (real photos served via next/image, sized correctly)
