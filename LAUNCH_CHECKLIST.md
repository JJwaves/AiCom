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
