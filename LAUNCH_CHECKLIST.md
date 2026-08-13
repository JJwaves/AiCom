# LAUNCH_CHECKLIST

Work through in order. Items marked ⛔ are hard blockers — the site must not
take real traffic until they pass.

## Infrastructure
- [ ] ⛔ Domain connected (`config/business.ts` → `DOMAIN` matches DNS)
- [ ] ⛔ SSL active (platform-managed)
- [ ] Security headers checked (CSP, X-Frame-Options, Referrer-Policy)
- [ ] 404 page tested (`/definitely-not-a-page`)

## Database (first-party data)
- [ ] ⛔ Production `DATABASE_URL` set to a real Postgres instance (managed Postgres recommended; PGlite is dev/test-only and the app now refuses to start database access in production without `DATABASE_URL` — db/client.ts)
- [ ] ⛔ Migrations applied to the production database BEFORE first traffic: run `npm run db:migrate` with the production `DATABASE_URL` as an explicit deploy step (the app never runs DDL against an external database at request time)
- [ ] ⛔ Verified the deployed environment is NOT on the embedded PGlite fallback: with `DATABASE_URL` unset the production app must fail loudly at first database use (actionable `[db] DATABASE_URL is not set` error in server logs) — never silently store data on instance disk
- [ ] Migration process documented in the deploy pipeline (schema changes: `npm run db:generate` in development → review SQL in `db/migrations/` → `npm run db:migrate` at deploy)
- [ ] `npm run db:seed` never pointed at production (it writes DEMO-labeled data and refuses external databases unless forced — leave it that way)
- [ ] Database backups/point-in-time recovery enabled on the production Postgres

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

## Commerce
- [ ] ⛔ Shopify production credentials in env (`NEXT_PUBLIC_SHOPIFY_*`)
- [ ] ⛔ Variant mapping complete in `lib/commerce/shopify.ts` (no `REPLACE_ME` ids)
- [ ] ⛔ Mock-catalog read fallback removed from `lib/commerce/catalog.ts` once the Shopify mapping is verified (it exists so an early env switch can't empty the storefront; launch must serve the real catalog only)
- [ ] Cost model filled in `config/costs.ts` (no `null` inputs) so margins compute and price guardrails can verify — see BUSINESS_CONFIG_TODO "Cost model"
- [ ] ⛔ Real product prices loaded; `pricingStatus: "LIVE"`; `NEXT_PUBLIC_DEMO_PRICING=false`
- [ ] ⛔ Real MOQ confirmed (`MOQ_CONFIRMED: true`)
- [ ] ⛔ Real shipping costs (rate source configured or Shopify shipping profiles)
- [ ] ⛔ Taxes configured in Shopify (US states + CA)
- [ ] ⛔ Payment gateway enabled and in live mode
- [ ] Mobile checkout tested end-to-end
- [ ] US test order placed and refunded
- [ ] Canada test order placed and refunded
- [ ] Confirmation emails tested
- [ ] Artwork upload tested (each format: PNG, JPG, PDF, SVG, AI, EPS)
- [ ] Artwork storage wired (files persist and attach to orders)

## Content
- [ ] ⛔ Policies reviewed by owner + legal (`reviewed` flag set on each PolicyPage)
- [ ] ⛔ Privacy policy reviewed
- [ ] ⛔ Returns policy reviewed (custom-product terms)
- [ ] Factory information verified on /about
- [ ] Real product images installed (all `images[].src` slots in `config/products.ts`)
- [ ] Factory photos installed (FactoryBand slots)
- [ ] ⛔ Fake/demo content removed — search the repo for "demo", "placeholder", "[TO BE PROVIDED]", "REPLACE_ME"

## Analytics & ads
- [ ] GA4 verified (page_view + ecommerce events in DebugView)
- [ ] Google Ads purchase conversion verified
- [ ] Enhanced Conversions verified
- [ ] Meta Pixel verified (Events Manager test events)
- [ ] Meta CAPI verified (server events arriving, `META_ACCESS_TOKEN` server-only)
- [ ] ⛔ Purchase event deduplication verified (one purchase → one event in each platform)
- [ ] Consent banner verified: declining blocks tags; accepting loads them

## Search
- [ ] Google Search Console connected + domain verified
- [ ] Sitemap submitted (`/sitemap.xml`)
- [ ] robots.txt checked (`/robots.txt` — /lp/ and /cart disallowed)
- [ ] Google Merchant Center connected; feed contains only fixed-price purchasable configs
- [ ] Feed prices/availability match on-site values

## Performance
- [ ] Core Web Vitals tested (mobile Lighthouse: Perf > 90, A11y > 90, SEO > 95, BP > 90)
- [ ] Images optimized (real photos served via next/image, sized correctly)
