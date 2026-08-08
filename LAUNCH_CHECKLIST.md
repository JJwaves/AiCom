# LAUNCH_CHECKLIST

Work through in order. Items marked ⛔ are hard blockers — the site must not
take real traffic until they pass.

## Infrastructure
- [ ] ⛔ Domain connected (`config/business.ts` → `DOMAIN` matches DNS)
- [ ] ⛔ SSL active (platform-managed)
- [ ] Security headers checked (CSP, X-Frame-Options, Referrer-Policy)
- [ ] 404 page tested (`/definitely-not-a-page`)

## Commerce
- [ ] ⛔ Shopify production credentials in env (`NEXT_PUBLIC_SHOPIFY_*`)
- [ ] ⛔ Variant mapping complete in `lib/commerce/shopify.ts` (no `REPLACE_ME` ids)
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
