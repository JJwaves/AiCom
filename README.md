# BagDirect — B2B storefront for custom non-woven takeout bags

A high-conversion, factory-direct e-commerce storefront selling custom
non-woven takeout bags to US/CA restaurants, cafes and food businesses.
The funnel is: **ad → landing page → configurator → price → cart → checkout**.

## Architecture

- **Next.js 16 (App Router) + TypeScript + Tailwind v4.** Server components by
  default; client components only where interaction demands it (configurator,
  cart, forms, analytics).
- **Commerce abstraction** (`lib/commerce/`): the UI talks to a
  `CommerceProvider` interface. `mock` serves the seed catalog in
  `config/products.ts`; `shopify` activates automatically when
  `NEXT_PUBLIC_SHOPIFY_*` env vars exist and hands checkout to Shopify's
  secure checkout (no custom card handling, ever). All catalog reads go
  through `lib/commerce/catalog.ts` (provider-backed, with a loud mock
  fallback while the Shopify mapping is incomplete).
- **Config-first**: brand, products, pricing tiers, shipping, FAQ and landing
  pages are data files under `config/` — no business values hard-coded in
  components.
- **Pricing module** (`modules/pricing/`): pure, integer-cent tier math
  (`engine.ts`) plus the factory cost model (`cost-model.ts`, fed by
  `config/costs.ts` placeholders — margins report "unavailable" and price
  floors fail closed until real economics are provided). Unit tested.
- **Server-authoritative checkout** (`app/api/checkout/route.ts`): the
  browser proposes, the server re-prices every cart line with the engine
  before any checkout/order is created; drift answers 409 REPRICED.
- **Attribution** (`lib/attribution/`): first-party first/last-touch UTM +
  gclid/gbraid/wbraid/fbclid capture, persisted, attached to checkout as
  order metadata. Unit tested.
- **Analytics** (`lib/analytics/track.ts`): one typed event model pushed to a
  dataLayer; consent-gated; buffered before consent; purchase dedup by
  transaction id. GTM/GA4/Meta load from env IDs in
  `components/analytics/AnalyticsProvider.tsx`. Selected events also
  dual-write first-party via `lib/analytics/first-party.ts` → `/api/events`
  (explicit GA4→platform mapping table; beacon-batched; disable with
  `NEXT_PUBLIC_FIRST_PARTY_EVENTS=false`).
- **Database** (`db/` + `lib/data/`): Postgres via Drizzle ORM — the AI
  data foundation (sessions, first-party events, customers, orders, quotes,
  need profiles, conversations, AI-ops tables). **Zero setup in dev/tests:**
  with `DATABASE_URL` unset, an embedded PGlite Postgres lives at
  `.data/pglite` (gitignored) and migrations apply automatically.
  Production sets `DATABASE_URL` and runs `npm run db:migrate` at deploy
  (`db:generate` emits migrations from `db/schema.ts`; `db:seed` writes
  clearly-labeled DEMO data, dev only). All access goes through the
  validated services in `lib/data/` — see `docs/DATABASE_SCHEMA.md`.
- **Design system**: Cobalt theme (OKLCH tokens in `app/globals.css`),
  Space Grotesk / Inter / JetBrains Mono via `next/font`.

```
app/                 routes (see Information architecture below)
components/
  analytics/  forms/  landing/  layout/  product/
config/              business.ts · products.ts · costs.ts · shipping.ts · faq.ts · landing-pages.ts
db/                  schema.ts (Drizzle) · client.ts (Postgres/PGlite) · migrations/ · seed.ts
lib/
  analytics/  attribution/  cart/  commerce/  data/ (DB service boundary)  validation/  format.ts
modules/
  pricing/           engine.ts (tier math) · cost-model.ts (costs/margins/price floor)
tests/               vitest unit tests
types/               commerce domain types
```

## AI-platform direction

BagDirect is evolving into an AI-native factory-direct commerce platform
(AI Packaging Expert, customer intelligence, guarded automation). The
storefront above is the foundation and keeps working unchanged. Start with
[CLAUDE.md](CLAUDE.md), then the doc set under [docs/](docs/):
system audit, target architecture, database schema, AI agent architecture,
guardrails, roadmap, and the owner's master spec. Development sessions are
driven by the prompt files in [prompts/](prompts/).

## Local setup

Requires **Node 20+** (built on Node 22).

```bash
npm install
cp .env.example .env.local   # optional — everything runs on mock data without it
npm run dev                  # http://localhost:3000
```

Commands:

| Command | What |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run start` | serve the build |
| `npm test` | vitest unit tests (pricing, attribution, validation, shipping) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint |

## Environment variables

See [.env.example](.env.example) — Shopify (public Storefront token +
server-only Admin/webhook secrets), demo-pricing guard, GTM/GA4/Google Ads,
Meta Pixel/CAPI, and the quote-intake webhook. **Never commit real values;
never expose `META_ACCESS_TOKEN` or `SHOPIFY_ADMIN_API_TOKEN` to the client.**

## Shopify configuration

1. Create the store; add products mirroring `config/products.ts` (size ×
   material × color as variants).
2. Add a JSON metafield `b2b.pricing_tiers` per product:
   `[{"minQty":500,"unitPriceCents":62}, …]`.
3. Create a Storefront API access token; set the two `NEXT_PUBLIC_SHOPIFY_*`
   vars. The provider switches over automatically.
4. Complete the variant-id mapping marked `TODO(shopify)` in
   `lib/commerce/shopify.ts`.
5. Print option, artwork filename/notes and quantity travel as line-item
   properties; attribution travels as cart attributes → order attributes.

## Analytics configuration

Set the IDs in `.env.local`. Events fire only after consent (banner is
non-blocking and honest). The event model is in `lib/analytics/track.ts` —
GA4 ecommerce-compatible names (`view_item`, `add_to_cart`, `begin_checkout`,
`purchase`, …) plus funnel events (`product_config_started`, `select_size`,
`upload_artwork`, `request_custom_quote`, …). Wire GTM tags to read from the
dataLayer; purchase events carry `transaction_id`, `value`, `currency`,
`items` and an `event_id` for browser/server dedup.

## Google Merchant Center

Only fixed-price, directly purchasable configurations belong in the feed.
Quote-only products (custom dimensions/colors) must be excluded. Build the
feed from `config/products.ts` (or Shopify once live) with id, title,
description, link, image_link, price, availability, brand, condition,
shipping. Keep feed values identical to on-site values; product structured
data on product pages already omits price while demo pricing is active.

## Product & pricing configuration

Everything lives in `config/products.ts`:

- `pricingTiers` — ascending `{minQty, unitPriceCents}`; the engine picks the
  tier, adds per-unit option deltas (material, printing), and reports savings
  vs the base tier.
- `pricingStatus: "DEMO" | "LIVE"` + `NEXT_PUBLIC_DEMO_PRICING` — demo prices
  render with a visible notice and are excluded from structured data. **Do
  not launch with DEMO pricing.**
- `minQuantity` — below it the configurator routes to Request Custom Pricing.

## Adding landing pages

Add an entry to `config/landing-pages.ts` (content, FAQ, product link), then:

- Organic page: create `app/<slug>/page.tsx` following any existing one
  (3 lines of config → `LandingTemplate`).
- Ad variant: add an alias to `LP_ALIASES` — `/lp/<alias>` renders the same
  content in ad mode (minimal nav, one CTA, noindex).

UTM/click-id params are captured on any entry page automatically.

## Reorder (post-MVP)

Order metadata already records product, configuration, artwork ref, pricing
and attribution per line. Reorder = replaying a stored `ProductConfiguration`
into the cart; accounts (Shopify customer accounts) unlock order history and
saved artwork. `app/account/page.tsx` is the stub.

## Email automation hooks

Order confirmation and shipping notices come from Shopify. Artwork-proof
lifecycle (received → proof ready → approved → production → shipped),
reorder reminders and abandoned-cart flows should be wired via a provider
(Klaviyo / Shopify Email / Postmark / Resend) against Shopify webhooks —
verify webhook signatures with `SHOPIFY_WEBHOOK_SECRET`.

## Testing

`npm test` covers the money paths: tier selection (boundaries), option
deltas, quote math, custom-quote routing, the server checkout re-quote
(tamper → 409, invalid configs → 422), cost/margin math and its fail-closed
behavior with unconfigured costs, artwork validation (type, size, spoofed
MIME), quote-form schema, US/CA postal detection, and first/last-touch
attribution merging. UI flows (configurator, cart, checkout handoff, UTM
persistence, mobile layout, 404, SEO metadata, analytics events) are
verified in-browser; add Playwright for regression coverage as a follow-up.

## Deployment

Any Node host (Vercel is zero-config). Set env vars in the platform, run
`npm run build`. Before real traffic: work through
[LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) — it gates on real prices, real
policies, verified tracking and test orders. Business inputs still needed
are indexed in [BUSINESS_CONFIG_TODO.md](BUSINESS_CONFIG_TODO.md).
