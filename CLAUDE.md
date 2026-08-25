@AGENTS.md

# CLAUDE.md — Project Memory

Persistent context for every development session. Read this first, then the
documents relevant to your phase. Do not depend on prior conversation
context existing.

**Long-term vision & specification: [docs/MASTER_PROMPT.md](docs/MASTER_PROMPT.md)**
— the owner's authoritative product/architecture spec (upgrade prompt §1–46
+ multi-session prompt pack). Execution is phase-by-phase per
`docs/AI_PLATFORM_ROADMAP.md`; each phase re-reads its relevant spec
sections. It is a vision document, not a single-session to-do list.

**Product catalog and launch scope: [docs/PRODUCT_CATALOG.md](docs/PRODUCT_CATALOG.md)**
— which products exist, which are sellable, what the customer may choose, and
how Product #1's four prices are produced.

**All architecture docs live in `docs/`** (audit, architecture, database
schema, AI agents, guardrails, roadmap, master prompt). Development
sessions are driven by the prompt files in `prompts/` — read
`prompts/00-INDEX.md`.

## Product

AI-native factory-direct B2B commerce platform.
- Initial market: **United States only** (Canada is not served during the soft
  launch — no rate, no customs handling, no CAD pricing).
- Initial customers: restaurants, takeout businesses, catering, bakeries and
  food delivery.
- Initial product: **Custom Insulated Takeout Bag** — the ONE launch-enabled
  product (`config/products.ts`). PP laminated / non-woven / aluminium foil,
  Large 26×26×17 cm and Extra Large 30×30×20 cm, black or white, custom
  artwork printing, MOQ 5,000/design, orderable at 5,000 or 10,000.
- Primary conversion: online purchase. Secondary: custom quote request.

## Core architecture rule

**The LLM provides intelligence. The application provides authority.**

AI may: understand, recommend, explain, summarize, analyze, communicate,
propose. Deterministic software controls: pricing, minimum margin,
payments, authentication, permissions, manufacturing rules, ad spending
limits, refund authorization, agent autonomy, approvals.

## Development rules

- Do not rewrite working code unnecessarily.
- Do not invent factory capabilities, prices, costs, or customer insights.
- Do not expose secrets (server tokens never in client code or prompts).
- Store structured data whenever practical; first-party data is
  authoritative, third-party tags get copies.
- Use feature flags for new AI systems; commerce must work with all flags off.
- Financially meaningful agent actions must pass the Guardrail Engine.
- Preserve first-party attribution (immutable first touch).
- Optimize contribution profit, not vanity metrics.
- Build incrementally; modular monolith; no over-engineering before real
  customer validation.
- Money is integer cents everywhere; format at the presentation edge.
- Run `npm test` + `npm run typecheck` + `npm run build` before finishing a
  session; update this file and the relevant architecture docs.

## Current project stage

**PRODUCT #1 PRODUCTION CONFIGURATION COMPLETE (2026-08-17) — the storefront
now sells a REAL product at REAL owner-confirmed prices. Launch verdict is
still NO-GO, but for four owner-infrastructure reasons instead of ten, and the
Shopify variant requirement dropped from 114 to 4.**

This was a narrowly scoped production-configuration session, not launch
engineering: replace the demo insulated-takeout-bag catalog with the first real
BagDirect soft-launch product, and let launch readiness stay BLOCKED wherever
owner configuration is genuinely still missing.

**1. ONE LAUNCH-ENABLED PRODUCT, AND THE OTHERS ARE UNREACHABLE.**
`Product.launchEnabled` is the new switch, and `lib/commerce/catalog.ts` — the
one facade every catalog read goes through — serves launch-enabled products
only. That single lever makes a disabled product invisible everywhere at once:
its page 404s, it is absent from listings, the sitemap, landing pages, AI tool
results and the cart, and checkout rejects its id as an unknown product. The
three seed products are KEPT (catalog architecture for future products) and
still carry DEMO pricing — which is exactly why they must not be reachable.
`listAllCatalogProducts()` is the deliberate exception: cost-model validation
must still see every entry that exists in the file.

**2. THE FOUR CONFIRMED PRICES COME OUT OF THE EXISTING ENGINE, IN WHOLE
CENTS.** No new pricing concept was added. `SizeOption` gained
`priceDeltaCents`, so `unit = tier(quantity) + size delta` reproduces all four
numbers exactly: tiers 5,000 → 19¢ and 10,000 → 15¢, Extra Large +4¢ at every
tier. Large $950 / $1,500 · Extra Large $1,150 / $1,900 — product subtotals,
shipping separate. **The supplier's historic XL job implies $0.185/bag; the MVP
sells $0.19 rather than introducing a fractional-cent monetary authority for
one price**, and that decision is recorded in `config/products.ts` and
BUSINESS_CONFIG_TODO rather than left for someone to rediscover.

**3. THE CUSTOMER CHOOSES FOUR THINGS, AND THE REST ARE SPECIFICATIONS.**
Size, colour, quantity, artwork. The three-layer construction is
`Product.specifications` — rendered, never selectable — because the factory
does not offer alternatives and a picker would invent a capability. There is
ONE print option and therefore no print-colour-count selector: real printing
cost depends on production colour separation, which internal review decides, so
asking the customer to price it would be asking them to price something nobody
can determine at configure time. There is no material selector (one entry) and
no handle is offered, because none is factory-confirmed.

**4. THE ORDERABLE QUANTITIES ARE A CLOSED SET, ENFORCED IN THE ENGINE.**
`allowCustomQuantity: false` removes the free-text quantity input, and
`requiresCustomQuote` refuses anything that is not exactly 5,000 or 10,000 —
in the engine both the configurator and `/api/checkout` call, so a hand-crafted
request cannot buy a quantity nobody priced. Below MOQ, above 10,000, off-tier,
a custom size (5,000-piece minimum) and any other colour all route to
`/request-quote`.

**5. SHIPPING IS $100 ONCE PER ORDER, AND THE STRUCTURE ENFORCES IT.** It rides
the Shopify draft order as a single `shippingLine` attached to the ORDER, so a
six-configuration B2B order pays $100 rather than $600 — that is not a comment,
it is where the field lives. The draft order is read back and the shipping
total VERIFIED like every other amount, so a doubled charge aborts the
checkout. It is shown separately from the product subtotal on the product page,
in the cart and at Shopify. It is recorded in `config/costs.ts` as
`shippingPolicy.customerCharge: flat_per_order` — the money COLLECTED — while
`products.*.shipping`, the freight COST, stays null. The two are different
facts and the model already had a place for each.

**6. NO CNY VALUE ENTERED THE USD COST MODEL.** The factory quotes ¥0.67/bag
(Large) and ¥0.81/bag (XL) plus ¥310/¥400 plate fees per production colour.
Those are recorded as a COMMENT in `config/costs.ts` and asserted by test to
appear nowhere in the configured values. BagDirect's revenue is USD and the
unit-economics architecture deliberately has no FX model: ¥0.81 read as 81¢
against a 23¢ sell price invents a catastrophic loss; read as 0.81 of anything
it invents a currency. Profit analytics correctly stay "unavailable", and
missing costs still never block a sale.

**7. A BUG THE BROWSER PASS FOUND: a stored configuration outlived its
catalog.** Replacing the catalog invalidated every persisted
`product_configurations` row, and `resolveCurrentConfiguration` returned them
verbatim — so the configurator looked up a print option that no longer existed,
silently stopped requiring artwork, and left **Add to cart enabled on an
unbuyable configuration** (checkout would have refused it, but only after the
customer filled everything in). `reconcileConfiguration(product, stored)` now
falls back to the catalog default for any retired option on both the read and
the patch path, and reports which fields moved. Six regression tests.

**8. READINESS SCOPES TO WHAT IS ACTUALLY BEING LAUNCHED.**
`requiredMerchandiseKeys()` reads `LAUNCH_PRODUCTS`, so the Shopify requirement
is 2 sizes × 1 material × 2 colours = **4 variants, not 114** — demanding
merchandise for products that cannot be sold reported a blocker that blocked
nothing. Product checks scope the same way, and a new `product.launch_scope`
check states the scope explicitly. **Readiness was not made green**: it went
10 BLOCKED → 4 BLOCKED (Shopify variants, artwork storage, domain, three
customer-facing placeholders), and `product.pricing_live` stays BLOCKED until
the owner also sets `NEXT_PUBLIC_DEMO_PRICING=false` — evidence AND assertion,
unchanged from PL-S04.

**9. AI SALES KNOWS THE REAL PRODUCT AND CANNOT OVERSTATE IT.** The persona
prompt (v1.3.0) states the launch facts and the must-not-claim list; the
catalog tool now exposes `allowCustomQuantity`, `specifications` and the
dimension UNIT (never assumed — this product is centimetres, the seed catalog
is inches); `getShippingEstimate` returns the flat charge as `mode:"flat"` and
an unserved market as `mode:"unavailable"` rather than quoting the US rate, and
carries no delivery date in any mode. No tool permission was widened.

**10. BROWSER-VERIFIED (desktop + 375 px).** Real prices with no demo badge;
Large 5,000 $950 → $1,050 with shipping; XL 10,000 $1,900 → $2,000; a
two-configuration cart charging $2,850 + **one** $100 shipping = $2,950; a
Canadian postcode refused rather than quoted; every disabled product 404;
`/products` listing exactly one product; artwork required and Add to cart
correctly disabled; no console errors; nothing overflowing at 375 px.

Tests: **1496 passing** (was 1424; +72, including `tests/product-one.test.ts`),
typecheck clean, lint clean, build clean.

**Next step is still not a coding session.** It is the four owner blockers —
BUSINESS_CONFIG_TODO → "THE SHORT LIST", now shorter.

---

## Previous stage — Production Launch Session 04

**PRODUCTION LAUNCH SESSION 04 "Production Configuration + E2E Validation"
COMPLETE (2026-08-17) — VERDICT: NO-GO. PRODUCTION BLOCKERS REMAIN.**

Session 04's job was to configure a real production environment and prove one
real order end to end. It could not, for one reason: **no production
environment exists and no owner values were supplied.** There is no production
Postgres, no Shopify store, no object storage, no domain, no real prices, no
confirmed MOQ, no admin credentials. Ten mandatory readiness checks are
BLOCKED and **every one of them is owner data or owner infrastructure — not a
single one is an engineering gap.**

What the session did instead, and what it is worth: it ran the whole system
the way production runs it — a real `next build` served by `next start` with
`NODE_ENV=production` — and verified the FAIL-CLOSED behaviour that decides
whether a broken launch is safe or expensive. `POST /api/checkout` answered
503 and minted no `MOCK-*` order. An unsigned webhook was refused. Artwork
upload with no storage said so rather than pretending. `/admin/*` was 404 with
credentials unset, 401 with them set and wrong, 200 with them right.
`/api/health/ready` answered 503 and leaked no secret value. `robots.txt`
refused crawling. Nothing overflowed at 375px.

**That exercise found three real production bugs, all invisible from a dev
server or a test fixture, and all now fixed with regression tests:**

1. **Readiness told the owner the wrong thing about Shopify.** With nothing
   configured in production, `resolveCommerceConfiguration()` THROWS (it
   refuses to fall back to mock), so `describeCommerceReadiness()` reported
   `misconfigured` and the launch page rendered "Shopify is **partially**
   configured" — sending the owner to hunt a half-set variable that did not
   exist. The accurate "not configured" message existed but was unreachable in
   the only environment it was written for. `misconfigured` now carries a
   `reason` (`not_configured` / `partial` / `invalid`) and the page names the
   actual problem.
2. **`sitemap.xml` published 21 URLs on `example.com`.** Session 03's
   domain-is-configuration decision was implemented in `robots.ts` and missed
   in `sitemap.ts`, which still built its base from `BUSINESS.DOMAIN` — the
   placeholder accessor that exists only so `next build` survives. Verified by
   fetching the path from the production build. `robots.txt`'s `Disallow: /`
   stops neither a direct fetch nor a manual Search Console submission. The
   sitemap now publishes nothing when the domain is unknown.
3. **`NEXT_PUBLIC_DEMO_PRICING=false` over a still-DEMO catalog published fake
   prices as real ones.** Setting the flag before replacing the prices — the
   exact ordering the checklist warns about — removed the "Demo pricing" badge
   from the configurator AND emitted `AggregateOffer lowPrice 0.33 /
   highPrice 0.62` into the product page's structured data, where search
   engines and Merchant Center read it as a real offer. The JSON-LD gate
   ignored `pricingStatus` entirely; the configurator required both signals to
   agree before warning; the homepage panel warned unconditionally and would
   have kept warning after real prices went live. All three now use
   `showsDemoPricing(product)` = evidence OR assertion.

Tests: **1424 passing** (was 1409), typecheck clean, lint clean, build clean.

**Next step is not a coding session.** It is BUSINESS_CONFIG_TODO → "THE SHORT
LIST", ten items, in order. When those exist, re-run this session.

---

## Previous stage — Production Launch Session 03

**PRODUCTION LAUNCH SESSION 03 "Operational Hardening" COMPLETE (2026-08-16)
— the four P1 operational risks are closed: an authoritative purchase now
reaches the ad platforms, unexpected failures reach a person, an abusive
stranger cannot spend the owner's money, a customer asking for a human is
actually escalated, a permanently-lost webhook is recoverable, and the owner
has one page that computes whether this system can safely take a sale.**

**1. THE PURCHASE IS THE PAID ORDER, AND THE BROWSER IS ASKED NOTHING.** The
confirmation page fired `purchase` whenever the URL said `?placed=1` and a
matching object sat in `sessionStorage`. Both are browser state: the parameter
could be typed, the stored object was written BEFORE any payment existed, and
a customer who abandoned the Shopify checkout could still reach a page
reporting a sale. Both inputs are gone (asserted repo-wide). The path is now
`Shopify paid order → signed webhook → markOrderPaid → GET
/api/orders/confirmation → analytics`. The confirmation endpoint is
SESSION-SCOPED (an order id is not an authorization model — ids travel in
URLs, history and screenshots), answers a non-existent order and someone
else's order IDENTICALLY (no existence oracle), mints no session (a GET that
writes is a write amplifier), and returns no cost, margin, attribution,
session id, customer id or email. `/api/checkout` now returns BagDirect's own
order id — remembered as a PENDING INTENTION, never a purchase — and no copy
of the order.

**2. GA4 + GOOGLE ADS + META, CONSENT-AWARE AND DEDUPLICATED.** All three
receive COPIES of a transaction whose truth already exists in
`purchase_completed`. Consent has TWO axes now: `analytics` gates GA4,
`advertising` gates the ad platforms — "Analytics only" is a real choice
honoured all the way down. Every destination gets the same `transaction_id`
(Shopify's order id), so a refresh cannot inflate revenue even if the code
runs twice; a local `localStorage` guard stops the repeat being SENT, because
"the vendor will deduplicate it" is a claim about someone else's system.
Google Ads needs BOTH `NEXT_PUBLIC_GOOGLE_ADS_ID` and
`NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL` — an id alone cannot address a
conversion and is reported as NOT configured. **The reliability limitation is
documented, not hidden**: browser conversion tracking undercounts because it
needs the buyer to come back; BagDirect's own `purchase_completed` is complete
regardless, and docs/ANALYTICS_PRODUCTION.md tells the owner to close the gap
with Shopify's own customer events against the SAME conversion action. **Meta
CAPI is DEFERRED and said so** — the Pixel already emits an `eventID` equal to
the transaction id, so it becomes a server-side change only. **The Google Ads
reporting provider gained NO write path** (asserted): the conversion is a
gtag send from the browser, and `lib/google-ads` still contains no mutation
and no conversion-upload API.

**3. ANALYTICS CAN NEVER TOUCH COMMERCE.** `lib/analytics/conversions.ts`
imports no `lib/data`, no `db/`, no `lib/commerce` (asserted). Every vendor
branch is individually try/caught. The client purchase module makes exactly
ONE `fetch`, a GET to the confirmation endpoint. If GA4, Ads and Meta all
fail, the order is still complete, paid, fulfilled and counted.

**4. RATE LIMITING IS THREE LAYERS, AND THE CODE OWNS TWO.** Layer 1 is the
per-instance token bucket (cheap, synchronous, refuses obvious abuse before
any I/O). Layer 2 is a DURABLE Postgres fixed-window counter — one atomic
`INSERT … ON CONFLICT DO UPDATE … RETURNING`, so concurrent instances cannot
both read "under the limit". Postgres and not Redis because production already
requires one, so a shared counter costs one table and zero new vendors,
credentials, failure modes or bills. **Layer 0 — platform/WAF — is OWNER
CONFIGURATION and is a stated launch requirement**: nothing here pretends a
per-instance memory limiter is globally sufficient on Vercel. `/api/events`
(the endpoint the audit named as unbounded), `/api/configuration`,
`/api/cart/line`, `/api/quote`, `/api/checkout`, both artwork routes,
`/api/ai/chat` and admin writes all route through ONE policy table
(`lib/rate-limit/policy.ts`) with a route CLASS: PUBLIC_LOW_COST /
PUBLIC_DB_WRITE / PUBLIC_EXTERNAL_COST / AUTHENTICATED. **The NETWORK scope is
checked BEFORE `sessionFromRequest`** (asserted) — a cookie-dropping caller
would otherwise force a session-row write per request just by arriving. **A
store outage NEVER opens the gate**: it degrades to the per-instance limit and
logs `DURABLE_UNAVAILABLE`; there is no path in which a database failure
grants unlimited Anthropic spend, and `assertWithinAiBudget` remains the hard
financial backstop underneath.

**5. A RAW IP IS NEVER PERSISTED.** Rate limiting needs to tell two callers
apart, not to know who they are, so the network identity becomes a keyed
HMAC-SHA256 the moment it is read; only the digest reaches a counter key, a
log line or the durable store. Exactly ONE file reads `x-forwarded-for`
(asserted). With `RATE_LIMIT_IP_SALT` unset the key is ephemeral per process —
network-scoped durable limits degrade to per-instance, and nothing persisted
can be correlated to a person even in principle. Both modes documented.

**6. CHECKOUT AND ARTWORK ABUSE ARE BOUNDED WITHOUT BREAKING B2B.** Checkout
is limited per CHECKOUT (8/min/session), not per line — a purchasing manager
ordering six configurations sends one request. Artwork gained two PRE-upload
controls, because every Session 02 control was a check performed AFTER the
caller consumed storage: the signed PUT now covers **Content-Length** as well
as key and content type (a URL issued for a 40 KB logo cannot upload 25 MB;
Content-Length is a forbidden header in `fetch`, so the browser sets it from
the body and the caller cannot forge it), and a per-session ALLOWANCE
(`ARTWORK_MAX_UPLOADS_PER_SESSION`, default 25/24h) bounds the TOTAL objects
one anonymous session can create — which a rate limiter does not, since it
bounds the rate.

**7. ESCALATIONS REACH A HUMAN, AND SAY SO HONESTLY.** Session 05 persisted a
handoff as a `system` message inside a conversation: queryable, and invisible.
Now there is a `human_handoffs` row with a delivery lifecycle, `/admin/handoffs`
with retry and mark-handled, and outbound delivery to
`HUMAN_HANDOFF_WEBHOOK_URL` (falling back to `QUOTE_WEBHOOK_URL`) — a generic
JSON POST because the owner's stack is unknown and one webhook reaches Slack,
Zapier, email automation and helpdesks without embedding any of them.
**PERSISTENCE IS PRIMARY**: the row is written BEFORE any delivery attempt and
a failure updates the row rather than throwing, so the assistant may
truthfully say a request was RECORDED and never that a human was NOTIFIED.
The payload carries the id, reason, summary, the customer's question,
voluntarily-supplied contact details and an admin deep link — **no
transcript, no need profile, no secret, no session identity** (asserted).

**8. A LOST WEBHOOK IS RECOVERABLE.** Shopify retries for ~48 hours and then
stops; an endpoint down for that window loses the payment's notification
permanently and the order sits at `pending_payment` forever. `POST
/api/admin/commerce/reconcile` reads a bounded window of Shopify orders (one
GraphQL **query**; no mutation is defined in that file or importable from it,
asserted) and repairs through **the SAME reconciliation service the webhook
uses** — including the one row-locked `transitioned` flag — so a repaired
order is indistinguishable from a webhook one and there is no second
order-processing implementation. **IDEMPOTENT by construction**: an order a
webhook already handled reports `alreadyConsistent`, a second sweep repairs
nothing, and a webhook arriving after a repair fires nothing. Refund totals
are **SET** by the sweep (Shopify's running `totalRefunded`) and **ADDED** by
the webhook (one refund event) — accumulating a cumulative figure is exactly
the double-count a naive version ships. Runs are recorded; `truncated` and
`failed` are honest states, never "found nothing". Requires the **`read_orders`**
Shopify scope, and nothing broader. **No cron** — deliberate.

**9. HEALTH: LIVENESS AND READINESS ARE DIFFERENT QUESTIONS.**
`/api/health/live` does nothing but answer — a liveness probe touching the
database would tell the platform to RESTART the app when the DATABASE was
down, turning degradation into an outage in a loop. `/api/health/ready` runs
the deterministic readiness service plus one `select 1`. It makes **NO
external API call** (asserted by test): an uptime poller would otherwise burn
Shopify's rate limit forever, and a vendor's slow minute would read as
BagDirect being down. It **never depends on AI, Google Ads, CRO, pricing
intelligence or customer intelligence** — those are optional enhancements.
200 ready / 200 degraded / 503 not_ready. No secret at any verbosity
(asserted against real credential values).

**10. LAUNCH READINESS IS COMPUTED, NOT REMEMBERED.**
`modules/launch-readiness` evaluates COMMERCE · DATABASE · PRODUCT · ARTWORK ·
AI · ANALYTICS · ADMIN · MONITORING · OPERATIONS · BUSINESS_CONFIG with no AI
and no network, and `/admin/launch-readiness` renders it owner-first
("12 Shopify variants are unmapped", with `SHOPIFY_MERCHANDISE_MAP` as small
grey text). **Only MANDATORY checks can block** — the rule is applied once,
centrally, so an optional check computing BLOCKED is downgraded and commerce
stays sellable with every AI flag off. **WARNING is a first-class state**: it
is where everything lives that needs a HUMAN — Shopify tax settings, a backup
policy, a real test order, alert rules, the platform WAF, `npm run ai:smoke`
— and those NEVER self-resolve.

**11. THE AI BUDGET SHARP EDGE IS SURFACED BEFORE A CUSTOMER FINDS IT.**
`assertWithinAiBudget` fails closed when budgets are set and the active model
has no price in `config/ai-pricing.ts` (unchanged, and correct). That used to
surface at the worst moment: the first customer to open the chat got the
unavailable message and the owner heard it from them. Readiness now reports
`AI_BUDGET_CONFIG_INVALID` naming the unpriced models. **No provider price was
invented** — `config/ai-pricing.ts` is still 100% `null`.

**12. STRUCTURED LOGGING, CORRELATION IDS AND ERROR TRACKING.** One JSON line
per event with a closed `subsystem` list, so an alert rule can filter on a
field instead of grepping a prefix. **Two redaction mechanisms**: fields are
scalars (a credentials object cannot be passed), and both secret-looking
NAMES and known credential SHAPES (`shpat_`, `sk-ant-`, AWS key ids,
`Bearer …`, Google refresh tokens) are stripped wherever they appear —
including inside a provider's own error text, which is where credentials
actually leak from. A correlation id (`x-request-id`) follows checkout →
Shopify → order → webhook → artwork and returns to the browser. Error tracking
is a TRANSPORT, not an SDK (`SENTRY_DSN` envelope ingest, or
`ERROR_WEBHOOK_URL`), works unconfigured, and what it does NOT do — browser
capture, source maps, tracing — is stated rather than implied. **Expected
business outcomes are not errors**: below MOQ, 409 REPRICED, unmapped
configuration, rate-limited callers are the system working, and reporting them
would train the owner to ignore the channel.

**13. THE DOMAIN BECAME CONFIGURATION.** `example.com` was hard-coded and five
surfaces built URLs from it — canonical metadata, sitemap, robots.txt, and two
JSON-LD blocks. Launched as-is that publishes structured data pointing at a
domain the owner does not own, which is worse than publishing none because
search engines act on it. Now `NEXT_PUBLIC_SITE_DOMAIN`; unset, readiness
BLOCKS and **robots.txt refuses crawling entirely**, while `next build` keeps
working — missing owner input must never make the build impossible.

**14. `[TO BE PROVIDED]` CANNOT REACH LAUNCH UNNOTICED.** A deterministic scan
over customer-facing business configuration BLOCKS on any placeholder a
customer would read. **No legal or business copy was written** (§43).

Migration `0010_operational_hardening.sql` (additive): `rate_limit_counters`,
`human_handoffs`, `commerce_reconciliation_runs`. **NO AI authority change** —
no new agent, no new tool, no autonomy, executor registry still EMPTY, every
guardrail limit still null, Google Ads still read-only, no price/ad/refund
executor. **1409 tests (1262 → 1409: 147 new).** Docs: new
`docs/PRODUCTION_OPERATIONS.md`, `docs/ANALYTICS_PRODUCTION.md`,
`docs/OBSERVABILITY.md`.

**REMAINING BLOCKERS ARE OWNER DATA AND OWNER CONFIGURATION, NOT ENGINEERING:**
Shopify credentials + the `read_orders` scope + webhook registration; the
merchandise map; artwork storage credentials; real prices; MOQ confirmation;
`NEXT_PUBLIC_SITE_DOMAIN`; business placeholders; a pooled `DATABASE_URL` with
backups and a tested restore; platform/WAF rate-limit rules; monitoring alert
rules; and a verified real test order and refund. **`/admin/launch-readiness`
is the exact list, computed.** Next: Production Launch Session 04 — Production
Configuration + End-to-End Soft Launch Validation (do not start
automatically).

**PRODUCTION LAUNCH SESSION 02 "Real Commerce Termination" COMPLETE
(2026-08-16) — a real customer can now configure a real product, get the
engine's price, upload artwork that survives the browser, pay on Shopify, and
have an authoritative BagDirect order created from the payment. The four
launch blockers are closed; what remains is owner data, not engineering.**

**1. PRODUCTION CANNOT USE MOCK COMMERCE.** `resolveCommerceConfiguration()`
(`lib/commerce/config.ts`) THROWS rather than degrading, mirroring
`db/client.ts`: production with missing OR partial Shopify configuration
produces a loud actionable error naming the variables (never their values),
and `/api/checkout` answers 503. **Partial configuration fails in EVERY
environment** — half-set credentials always mean Shopify was intended. The
mock provider itself refuses to run with `NODE_ENV=production` even if
imported directly, and `MOCK-` ids are minted in exactly ONE file (asserted).
What this prevents is specific: mock checkout would have written Order rows,
fired the authoritative `purchase_completed` and marked sessions converted
while charging nobody — fake revenue that BI, profitability, POAS and ad
attribution would all have reported as real. **Browser-verified against a real
production build: 503 + "COMMERCE IS NOT CONFIGURED", no MOCK order.**

**2. SHOPIFY IS REAL — AND IT IS A DRAFT ORDER, NOT A STOREFRONT CART.**
`gid://shopify/ProductVariant/REPLACE_ME` is gone. Shopify's Storefront cart
API **cannot express a custom line price**, and a BagDirect price is
`tier(qty) + material delta + print delta` — inexpressible as one variant
price without ~1,700 variants encoding arithmetic this codebase already owns.
So checkout calls `draftOrderCreate` with an explicit `priceOverride` per line
(Admin GraphQL `2026-07`, centralized in `config/shopify.ts`; an unsupported
env pin throws), then **READS THE DRAFT ORDER BACK AND VERIFIES IT** — unit
price, line total, quantity, currency and subtotal — and any divergence
DELETES the draft and fails visibly. The customer never reaches a Shopify
checkout showing a price BagDirect did not compute. Money crosses as integer
cents ↔ 2-decimal string; an unparseable amount is a verification failure,
never a rounded guess. Mutations are NEVER retried (a retried
`draftOrderCreate` = two invoices for one cart); the Admin token is attached
in exactly ONE file.

**3. CATALOG AUTHORITY IS BAGDIRECT'S, AND THAT IS WHAT DELETED THE DANGEROUS
FALLBACK.** `config/products.ts` defines what exists, which options are legal
and which tiers apply; Shopify is merchandise + checkout + payment and has no
representation for any of it. Both providers serve the same catalog, so
`lib/commerce/catalog.ts` no longer hops through a provider AT ALL — there is
no remote catalog read to fail, so there is nothing to fall back from, and
"Shopify is down" can never become "show the customer demo products" (§8).
Consequences, all deliberate: the storefront renders without Shopify, a
catalog read needs no credential, and `next build` prerenders product pages
with commerce unconfigured. `listProducts()` returning `[]` is gone.

**4. MERCHANDISE MAPPING IS DETERMINISTIC AND EMPTY.**
`product · size · material · color` → a Shopify variant GID, via a strict
exact-match table in `config/shopify.ts`. Print option and quantity change the
PRICE, not the item, so they travel as line attributes. **No fuzzy matching,
no AI matching, no default variant, no nearest match** — an unmapped
configuration fails BEFORE Shopify is called and returns a 409 routing to the
custom-quote flow, because shipping the wrong physical bag is worse than
failing a checkout. `validateMerchandiseMap()` errors on unknown keys,
duplicate variants and malformed GIDs; `requiredMerchandiseKeys()` prints
exactly what the owner must fill (custom colors excluded — quote-only).
**The table ships EMPTY: the mechanism is implementation, the ids are owner
data.**

**5. PAYMENT TRUTH IS SHOPIFY'S, DELIVERED BY WEBHOOK.** `/api/webhooks/shopify`
handles `orders/create` · `orders/paid` · `orders/cancelled` · `refunds/create`.
**Order of operations IS the security model**: read the RAW body (never
`req.json()` first — parse-then-stringify changes the bytes Shopify signed),
verify the HMAC (`timingSafeEqual`, logs nothing, fails CLOSED with no
secret), and only THEN parse and touch the database — asserted structurally,
because anyone who could forge this endpoint could mint revenue.
**Idempotency keys on the SUBJECT (order id / refund id), NOT the delivery
id** — a merchant re-sending from the admin gets a new delivery id for the
same business fact, which would process that payment twice; the claim is a
UNIQUE insert so concurrent deliveries cannot both see "not processed yet",
and a failed claim is RELEASED so the retry is real work.

**6. THE ORDER ROW IS CREATED BEFORE PAYMENT, AS `pending_payment`.** It is the
only place the exact server-priced lines, the immutable configuration
snapshots, the artwork links, the attribution and the cost snapshot exist
together; its id travels to Shopify as `_bd_order_id` and returns on the paid
order, so **reconciliation is a LOOKUP, not a reconstruction** from display
attributes. `pending_payment` joined `EXCLUDED_ORDER_STATUSES`, so an
abandoned checkout is honest abandoned-checkout data and never revenue. This
is the ONE place "persistence is additive to commerce" does not apply.
**`purchase_completed` fires from ONE flag** — the `transitioned` boolean
`markOrderPaid` flips inside a row-locked transaction — so a replay, an
`orders/paid` after an already-paid `orders/create`, or two concurrent
deliveries all do nothing. It never fires because a checkout URL was created,
a browser redirected, a customer returned, or the AI asked. Shopify's grand
total (shipping + tax) is deliberately NOT copied over `orders.totalCents`,
which stays the BagDirect subtotal every margin divides by.

**7. ARTWORK IS DURABLE, SERVER-VERIFIED, AND LINKED TO AN ORDER LINE.**
`URL.createObjectURL` is gone (asserted repo-wide). The server mints the
artwork id and therefore the object KEY (`artwork/{id}/{safeName}` — the
browser cannot name, guess or traverse to another object; the request schema
is `.strict()`), SIGNS the content type, and **refuses to trust the upload
until it independently HEADs the object and reads its magic bytes** — an SVG
renamed `.png` does not survive, and a failed file is deleted and marked
`rejected`. Bytes go browser → S3-compatible storage directly (25 MB through a
serverless route handler is not viable); zero new dependencies — SigV4 is ~80
lines of `node:crypto`. **`artworks.order_line_id` is explicit**, because
`order_id` alone cannot answer "which artwork belongs to this line?" on a
multi-line order, and inference from filename/email/session is not
determinism. Checkout additionally verifies the artwork belongs to THIS
session. Missing storage never pretends to succeed (503, "choose No logo") —
**browser-verified**. Session 03.5 privacy semantics preserved and extended to
`storage_key`.

**8. SVG IS REJECTED — a decision, not an oversight.** An SVG is an executable
document; once artwork is durably stored and served back to staff, a stored
SVG is stored XSS. Sanitisation is an ongoing commitment with a live bypass
literature; rejection costs one "export as PDF" click and PDF/AI/EPS all carry
vector artwork.

**9. PRICING AUTHORITY IS UNCHANGED.** `Client config → server validation →
deterministic engine → authoritative cart line` holds byte-for-byte; `409
REPRICED` semantics are untouched; storefront tier prices are asserted
identical; the Shopify provider never imports `modules/pricing` and never
computes a price — it restates one and verifies it came back. Cost
configuration still never blocks a sale.

Migration `0009_production_commerce.sql` (additive): `orders` +
`refunded_total_cents` / `paid_at` / `cancelled_at` and a **UNIQUE**
`(provider, provider_order_id)` index; `artworks` + `order_line_id` /
`storage_key` / `storage_provider` / `checksum`; new
`provider_webhook_events`. **NO AI change** — no agent, no tool, no autonomy,
no executor, `GUARDRAIL_POLICY_VERSION` unchanged, executor registry still
EMPTY, every guardrail limit still null, Google Ads still read-only.
**1262 tests (1072 → 1262: 190 new).** Docs: new `docs/SHOPIFY_PRODUCTION.md`
+ `docs/ARTWORK_STORAGE.md`.

**REMAINING LAUNCH BLOCKERS ARE ALL OWNER DATA:** Shopify store domain + Admin
API token + webhook secret + webhook registration; the merchandise map
(`config/shopify.ts`, empty); artwork storage credentials + a private bucket
with CORS; real prices (demo notices stay until `NEXT_PUBLIC_DEMO_PRICING=false`);
MOQ confirmation; US shipping profile and tax configuration in Shopify; and a
real test order proving shipping/tax/payment actually work — **none of which
this session could invent, and none of which it did.** Next: Production Launch
Session 03 — Tracking, Monitoring, Abuse Protection + Operational Hardening
(do not start automatically).

**Session 13.5 "Business Cost Model + Margin Policy" COMPLETE (2026-08-16) —
the platform now has a complete, deterministic, configurable unit-economics
model, and STILL knows none of the numbers. `modules/pricing` is the one cost
authority (NO `lib/ai` import, NO `db/` import, NO fetch — asserted
structurally), and `config/costs.ts` remains 100% `null` `[TO BE PROVIDED]`:
this session implemented the model, the owner supplies the values, and a
structural test scans the file for any numeric literal so an "industry
average" cannot be slipped in. **THREE COST SCOPES, and order-level costs are
applied EXACTLY ONCE**: per-unit (manufacturing ± size ± material or a
quantity tier, printing ink, packaging, other variable), per-line (printing
setup — one screen per artwork), per-order (order packaging [COGS], fulfilment
handling [selling cost], the processor's FIXED fee, the shipping subsidy). A
`per_order` freight basis is additionally deduplicated PER PRODUCT, because
two lines of the same product are one shipment — a real double-count that the
multi-line tests now pin. **SHIPPING SUBSIDY, NOT SHIPPING COST**: `subsidy =
max(actualFreight − customerShippingCharge, 0)`, never negative — profiting on
shipping is preserved SEPARATELY in `shippingMarginCents` and deliberately NOT
added to contribution, because the charge is not inside recorded order
revenue; `customerCharge: not_collected` is a STRUCTURAL fact (orders have no
shipping column; `totalCents = subtotalCents`), not an assumption. **THE
LADDER IS FOUR NAMED LEVELS**: sell price → −product COGS → GROSS PROFIT →
−variable selling/fulfilment → CONTRIBUTION PROFIT BEFORE PAID MEDIA →
−attributed ad spend → CONTRIBUTION PROFIT AFTER PAID MEDIA; nothing is ever
called "net profit". **AVAILABILITY IS PER LEVEL** — `UnitEconomics` carries
`grossStatus` and `contributionStatus` separately, so a missing payment fee
leaves gross AVAILABLE and contribution UNAVAILABLE rather than hiding both.
Margins are integer bps and are `null` — never NaN, never Infinity, never 0 —
on zero revenue. **MINIMUM ≠ TARGET**: `minimumGrossMarginBps` /
`minimumContributionMarginBps` are hard floors that block a price action;
`targetGrossMarginBps` (new) / `targetContributionMarginBps` are objectives
whose shortfall is a REVIEW signal, and `minimumAllowedPriceCents` consults
floors only. All four ship `null` — this session chose no margin value.
**HISTORICAL PROFIT COMES FROM A SNAPSHOT, NEVER FROM TODAY'S COSTS APPLIED
BACKWARDS**: migration 0008 adds `orders.cost_model_version` +
`orders.cost_snapshot_json` + `order_lines.cost_snapshot_json`, written
FORWARD ONLY and best-effort (capture failure never blocks an order); an order
without one reports `HISTORICAL_COST_UNAVAILABLE`, and a clearly-labelled
`CURRENT_CONFIG_SCENARIO` basis exists but is never the dashboard default.
**POAS IS REAL NOW, AND STILL UNAVAILABLE**: `POAS = contribution profit
before paid media ÷ ad spend` beside `ROAS = revenue ÷ ad spend` — separate
fields, separate formulas, no field named merely `roas` or `poas`; it requires
contribution profit AND real spend AND compatible currency AND adequate
attribution coverage, and any gap yields UNAVAILABLE or PARTIAL rather than an
approximation. `validateCostModel` fails LOUDLY on present-and-wrong values
(negative costs, fractional cents, fee ≥ 100%, margin < 0% or ≥ 100%, target
below its own minimum, unreachable contribution floor, unordered/duplicate
tiers, unknown product, missing size/print option, bad carton size) and never
normalises them; `null` is not an error. A shared READ-ONLY
`CostReadinessPanel` on `/admin/business-intelligence` +
`/admin/pricing-intelligence` shows every input Configured/Missing/Invalid and
what it unlocks — **there is no cost editor; `config/costs.ts` stays the single
authority**. **COST CONFIGURATION NEVER BLOCKS A SALE**: browser-verified a
real checkout completing with every cost null, no commerce file imports cost
readiness, and the checkout route is asserted never to reference the price
floor. NO new agent, NO storefront price change, NO MOQ change, NO discounts,
NO price/ads mutations, NO GUARDED_AUTO, NO executor, NO autonomy change —
`GUARDRAIL_POLICY_VERSION` is unchanged. 1072 tests (966 → 1072: 106 new).
Next milestone: Session 14 "Google Ads Recommendation Agent + Guarded Action
Preparation" (do not start automatically) — or, worth more, the owner filling
`config/costs.ts`.**

**Session 13 "Google Ads Read-Only Intelligence" COMPLETE (2026-08-15) — the
platform can now SEE what advertising costs, without acquiring any power over
it. The read-only invariant is STRUCTURAL, not promised: `lib/google-ads`
has ONE URL builder and it appends the LITERAL `/googleAds:search` (the
method is not a parameter, so no `:mutate` endpoint can be CONSTRUCTED
anywhere in the repo), there is no exported `request(method, path, body)`,
GAQL — the only reachable query language — has no mutation verb, the
transport refuses any query not starting with SELECT, and
`GoogleAdsReportingProvider` exposes exactly three read methods
(`status`/`getAccountInfo`/`getCampaignDailyMetrics`). Adding campaign
mutation requires DELETING A TEST. `modules/google-ads-intelligence` is the
deterministic advertising-analytics authority with NO `lib/ai` import, NO
`lib/google-ads` import and NO `fetch` — it reads PERSISTED daily snapshots,
so a dashboard render is never an API call and an outage cannot change a
number. **Google's numbers and ours are separate TYPES, not separate
labels**: `GoogleNativeTotals` has no `orders`/`revenueCents` field,
`GoogleAdsFunnel` has no `googleConversions`/`googleConversionValueCents`
field, and `AdEfficiency` has no field named merely `cac` or `roas` — so
`googleReportedCostPerConversionCents` can never become
`firstPartyCostPerOrderCents` by a careless destructure, and the two are
displayed side by side with a discrepancy view that reports the gap and its
five standing causes instead of "correcting" either side. Attribution has
THREE honest tiers and no fuzzy one — EXACT (`utm_campaign` = campaign id),
MAPPED (normalized name), UNMATCHED (revenue still counts account-wide,
under no campaign); `gclid` is a BOOLEAN "this was a paid click" and is never
stored, rendered, serialized or sent to a model; two campaigns normalizing to
the same name make BOTH unmatchable rather than a coin flip. Reporting days
stay on the ACCOUNT's calendar (a UTC period maps to the account-days it
OVERLAPS, inclusively, and the page prints the zone and the exact range).
**NOT_CONNECTED / SYNC_FAILED / STALE / PARTIAL are four states and none of
them is zero** — freshness advances only on a COMPLETE sync, a failed sync
leaves prior rows and their timestamp untouched, and credentials removed while
data remains still shows the data, saying it is frozen. Sync is IDEMPOTENT
(`UNIQUE(account, campaign, day)` upsert ⇒ syncing twice cannot double spend;
Google's RESTATEMENT of a recent day UPDATES in place, never appends).
CAC/ROAS carry named denominators (first-party CAC = spend ÷ BagDirect orders
attributed to a Google Ads click, NOT Google conversions); currency mismatch
BLOCKS every cross-lens ratio (no FX model, none invented); **POAS is
UNAVAILABLE** while `config/costs.ts` is null — revenue ROAS is never called
profitability. Migration 0007 adds `ad_accounts` / `ad_campaign_daily_metrics`
/ `google_ads_sync_runs` / `google_ads_reports`; **no table stores a
credential**, and the conversion columns are prefixed `google_` precisely so
they can never read as orders. The Google Ads Agent
(`lib/ai/agents/google-ads`, RECOMMEND) has NO tools, NO Google access at all,
makes ONE REASONING structured call over the PII-free snapshot, and **its
output schema cannot express a mutation** — no `proposedDailyBudgetCents`, no
`budgetChangePct`, no `newStatus`, no `pause`, no `bidCents`, no
`keywordText`, no `adCopy` — so "raise Campaign X to $500/day" is unwritable
rather than filtered; server-side every metric/evidence/signal ref is
validated against exactly what the context printed (none surviving ⇒ dropped)
and `campaignId` against the campaigns the snapshot contained.
`GUARDRAIL_POLICY_VERSION` → `2026-08-15.s13.1`; GOOGLE_ADS_AGENT default
autonomy OBSERVE → RECOMMEND (ceiling unchanged); one permission added
(`DATA_QUALITY_REVIEW`, review-only). **`AD_BUDGET_CHANGE`/`AD_PAUSE`/
`AD_RESUME`/`AD_CREATIVE_TEST` are ABSENT from the mapping table, the executor
registry is still EMPTY, and their limits are still `null` — so even a
HUMAN_ADMIN proposal is execution-ineligible with the missing configuration
named.** Search terms and keywords are deliberately NOT ingested (declared,
not faked). `/admin/google-ads-intelligence` behind the S08 auth + the new
`GOOGLE_ADS_INTELLIGENCE` flag (agent generation additionally behind
`AI_GOOGLE_ADS_AGENT`); three write-guarded routes (test-connection / sync /
ads-review); syncing never spends AI tokens. Session 09's metrics were
EXTENDED, not rewritten — `attribution.adSpendIntegrated` stays `false` and a
separate `adSpend` section carries its own availability. 966 tests (763 → 966: 203 new). Next
milestone: Session 14 "Google Ads Recommendation Agent + Guarded Action
Preparation" (do not start automatically).**

**Session 12 "Pricing Intelligence Agent" COMPLETE (2026-08-15) — the
platform can now UNDERSTAND its own pricing without acquiring any power over
it. `modules/pricing-intelligence` (no `lib/ai` import, no price-mutation
path, asserted structurally) is the deterministic pricing-analytics
authority: a pricing funnel built on CO-OCCURRENCE and REAL EVENT ORDERING
(price→cart counts sessions that did both; "handoff after price" requires the
handoff to actually come after), quantity bands derived from the REAL tier
ladder + MOQ (never invented ranges), the S08 three quantity lanes preserved
and provenance-split (requested [stated vs inferred] / configured /
purchased — "requested 300 · configured 500 · purchased 5,000" is three
findings, not a contradiction), per-tier performance with checkout reported
as UNAVAILABLE rather than 0 (the event carries no product/quantity) and
conversations attributed by configured-or-stated quantity, a price-realization
integrity check (paid snapshot vs today's engine quote ⇒ `catalog_price_changed`,
never "leakage" — there are no discounts), MOQ intelligence kept strictly
SEPARATE from price, and evidence-graded signals. **Price friction requires
someone to have SAID something**: a signal is `isPriceFriction` only with
EXPLICIT evidence (objection / repeated price question / handoff after price /
quote after price); sessions that saw a price and left produce a BEHAVIORAL
signal capped at LOW and flagged `isPriceFriction: false`. Strength is a
documented count-and-diversity rule (HIGH needs ≥10 conversations AND ≥2
evidence types), never a probability. **Elasticity is NOT ESTIMABLE and no
code path produces a coefficient** — `assessElasticity()` returns
`estimable: false` as a literal type, with an owner-language reason and the
exact preconditions. Cost/margin readiness names every unfilled
`config/costs.ts` path; null is never zero, margin is UNAVAILABLE, and
revenue is never used as a proxy for profit. `PricingReadiness`:
PRICING_REVIEW AVAILABLE · SPECIFIC_PRICE_CHANGE BLOCKED · PRICE_EXPERIMENT
BLOCKED · AUTOMATED_PRICE_CHANGE NOT_SUPPORTED. The Pricing Agent
(`lib/ai/agents/pricing`, RECOMMEND) has NO tools, makes ONE REASONING
structured call over the PII-free snapshot, and **its output schema CANNOT
EXPRESS A PRICE** — no `proposedUnitPriceCents`, no discount, no MOQ, no
optimal price — so "lower it to $0.37" is unwritable rather than filtered.
Server-side it validates every metric/evidence/signal ref against exactly
what the context printed (none surviving ⇒ dropped), validates `productId`
against the real catalog and `quantityTier` against that product's real
tiers, and RECOMPUTES `requiresCostConfiguration`/`requiresExperiment`.
Persistence: append-only `pricing_reports` (migration 0006, the exact
snapshot the model saw) + identity-deduped AgentDecisions with human verdicts
frozen → review-only actions (`PRICING_REVIEW`/`MOQ_REVIEW`/
`DATA_QUALITY_REVIEW`) in the Action Center. **`PRICE_CHANGE` and
`PRICE_EXPERIMENT` are absent from the mapping table, the executor registry
is still EMPTY, and the experiment engine still cannot run price variants.**
`GUARDRAIL_POLICY_VERSION` → `2026-08-15.s12.1`; PRICING_AGENT default
autonomy OBSERVE → RECOMMEND (ceiling unchanged); one permission added
(`DATA_QUALITY_REVIEW`, review-only). `/admin/pricing-intelligence` behind
the S08 auth + the new `PRICING_INTELLIGENCE` flag; deterministic analytics
need zero AI configuration. 763 tests. Next milestone: Session 13 "Google Ads
Read-Only Intelligence".**

**Session 11 "Experiment Engine + CRO Agent" COMPLETE (2026-08-12) — a
controlled experimentation system in which the AI proposes and DETERMINISTIC
software decides. `modules/experiments` (no `lib/ai`, no `db/` import) owns
eligibility, allocation, assignment, exposure semantics, metric definitions,
the sample gate and the statistical result: a CLOSED target registry (3
presentation surfaces — product.shipping_message / product.primary_cta /
homepage.hero, each naming its rendering component and its protected
fields), CLOSED typed variant schemas (`safeText` refuses angle brackets,
braces, template interpolation, `javascript:`/`data:` URLs and inline
handlers — no HTML/JS/CSS is storable or renderable anywhere), PURE
FNV-1a assignment (sticky before a row exists; the row is a record, not the
source of truth; per-experiment salt keeps arms independent), fail-closed
eligibility (an unknown device is not a desktop; admin and bot traffic never
enrol), allocations validated to total exactly 100 and capped by
`resolveTrafficCap()` (a null `maximumExperimentTrafficPct` BLOCKS in
production naming the config path, applies a documented 50% ceiling in
non-production, and is NEVER read as 100%), and a two-sided two-proportion
z-test with 7 explicit result states — RUNNING / INSUFFICIENT_DATA /
CONTROL_WIN / VARIANT_WIN / NO_CLEAR_WINNER / STOPPED / INVALID.
**No winner below 1,000 exposed sessions per arm** (a documented development
floor an experiment may raise, never lower). Resolution happens during the
SERVER render (no flicker, no hydration mismatch); ASSIGNMENT ≠ EXPOSURE
(`exposed_at` stamped once ⇒ one `experiment_exposed` event per session, no
write per page view); conversions count only at/after exposure, once per
session. The CRO agent (`lib/ai/agents/cro`, RECOMMEND) has NO tools, one
REASONING structured call, and its output is registry- and
reference-validated (unknown target / mismatched type / markup / fabricated
metric ref ⇒ DROPPED; audience, allocation and sample floor are server-
derived) → AgentDecision → `CRO_EXPERIMENT_PROPOSAL` or `CRO_REVIEW` in the
Action Center. A business/product problem routes to REVIEW, never to a copy
test that hides an objection. **Launch is an EXPLICIT HUMAN admin route, not
an executor — `modules/guardrails/executors.ts` is still EMPTY** — guardrail-
evaluated (verdict + policy version + missing configuration snapshotted onto
the row), traffic-capped, idempotent, `stateVersion`-guarded, one running
experiment per target (DB unique index), audited in `experiment_events`.
Stopping deletes nothing and freezes the readout. A VARIANT_WIN changes no
site content — promotion stays a human source change. Migration 0005;
`/admin/experiments` behind the S08 auth + `EXPERIMENT_ENGINE`. 661 tests.
Next milestone: Session 12 "Pricing Intelligence Agent".**

**Session 10 "Central Guardrail Engine + AI Action Center" COMPLETE
(2026-08-12) — the system-wide safety and approval layer every future AI
action passes through. `modules/guardrails` is the ONE authority: a CLOSED
proposed-action taxonomy (20 types, strict per-type zod payloads — unknown
type, unknown key, or smuggled `riskLevel`/`approvalStatus` all fail
closed), a PURE `evaluateAgentAction()` (no lib/ai, no db/, no clock, no
randomness ⇒ reproducible from input + `GUARDRAIL_POLICY_VERSION`),
autonomy modes CLAMPED to per-agent policy ceilings (every business agent
= RECOMMEND, so a tampered `agent_configs` row grants nothing),
deterministic risk LOW/MEDIUM/HIGH/CRITICAL (a model's claim is metadata
only), HARD vs SOFT rules (HARD blocks either the PROPOSAL or EXECUTION
forever; no bypass semantic exists), and missing configuration reported by
exact config path — never as PASS or 0. Persistence: `agent_actions`
(status ⟂ executionStatus), append-only `guardrail_evaluations` (policy
version + limits snapshot) and `agent_action_events` (migration 0004).
`/admin/ai-actions` behind the S08 auth + `AI_ACTION_CENTER`: approve /
reject / modify with server-derived `reviewedBy`, `stateVersion` +
row-lock concurrency (double-click and stale reviewer ⇒ 409), immutable
proposals (modification = SUPERSEDED original + re-evaluated revision),
server-resolved evidence, and same-origin + JSON-only CSRF protection on
the first admin mutation routes. **The executor registry is EMPTY:
approving records the owner's decision and mutates no price, ad, product,
or payment.** 512 tests. Next milestone: Session 11 "Experiment Engine +
CRO Agent".**

**Session 09 "Business Intelligence + CEO Recommendation Agent" COMPLETE
(2026-08-12) — the business-level intelligence layer: DETERMINISTIC
metrics (`modules/business-intelligence`, no lib/ai import) with an
explicit AVAILABLE/PARTIAL/UNAVAILABLE availability model — revenue/
orders/AOV/units, funnel + denominator-honest rates, AI sales + AI cost
(unpriced calls never $0), profitability (gross + contribution BEFORE
paid media — UNAVAILABLE while config/costs.ts is null: "Unavailable —
configure manufacturing costs", never zero, never estimated), segments,
first-party attribution (no CAC/ROAS — no ad spend exists), explicit
trend states (NEW_ACTIVITY/LOW_BASELINE, never +∞%) → ONE
BusinessHealthSnapshot → CEO agent (RECOMMEND permanently: NO tools, one
REASONING structured-output call, metric/evidence references
server-validated against the exact context sent, fabricated refs
dropped) → pending AgentDecision rows (identity-stable dedup, human
verdicts frozen) + append-only `ceo_reports` (period/prompt/model/
snapshot versioning) → `/admin/business-intelligence` behind the S08
auth + `AI_BUSINESS_INTELLIGENCE` flag: deterministic dashboard works
with AI off/down; CEO review generates ONLY from the explicit admin
button. MEASURE→SYNTHESIZE→EXPLAIN→RECOMMEND, never execute. Next
milestone: Session 10 "Guardrails + AI Action Center" — DONE, see above.**

## Current architecture (2026-08-15, post-Session 13)

Working B2B storefront, verified end-to-end (see
docs/CURRENT_SYSTEM_AUDIT.md + its Session-02 resolution note):
- Next.js 16.3 App Router · React 19 · TS · Tailwind v4 · zod · vitest (1072 tests)
  · Drizzle ORM + Postgres (PGlite embedded dev/test, node-postgres prod).
- **Database (Session 03; +1 table S08; +1 S09; +3 S10; +1 S11; +1 S12; +4 S13):**
  `db/schema.ts` (31 tables: sessions, events, customers, businesses,
  orders+lines, quotes, artworks, configurations, conversations+messages,
  conversation_classifications (S08), ceo_reports (S09),
  pricing_reports (S12), need profiles,
  ai_usage, agent_decisions, approvals, agent_configs, agent_actions +
  guardrail_evaluations + agent_action_events (S10), insights,
  opportunities, experiments + experiment_assignments +
  experiment_events (S11), ad_accounts + ad_campaign_daily_metrics +
  google_ads_sync_runs + google_ads_reports (S13)) + additive SQL migrations
  in `db/migrations/` (0000–0008; 0008 adds order/line COST SNAPSHOT columns,
  S13.5).
  `DATABASE_URL` unset ⇒ embedded PGlite at `.data/pglite` self-migrates
  (zero-setup dev; tests use `memory://`); set ⇒ real Postgres, migrations
  applied explicitly via `npm run db:migrate`. **`NODE_ENV=production`
  without `DATABASE_URL` fails loudly at first DB use (S03.5)** — the
  embedded fallback is dev/test-only, never a silent production store.
  ALL access goes through
  zod-validated services in `lib/data/*` — future AI tools call these,
  never SQL. Client state unchanged as cache: `config/*.ts`, localStorage
  (cart `bd_cart_v1`, attribution `bd_attribution_v1`, consent
  `bd_consent_v1`), sessionStorage (mock-order confirmation payload).
- **Server session identity:** httpOnly cookies `bd_sid` (session) +
  `bd_aid` (durable anonymous id), minted by persisting API routes,
  rolling 1y, no login required. Attribution snapshots live on the session
  row — first touch immutable, last touch campaign-only updates (same
  `mergeAttribution` code as the client, now server-side).
- **First-party events:** `track()` keeps its GA4 dataLayer output
  byte-identical and dual-writes through the explicit GA4→platform mapping
  table (`lib/analytics/first-party.ts`) → beacon-batched `/api/events` →
  taxonomy-validated rows (dedup by clientEventId). `purchase` is
  deliberately server-authoritative (`purchase_completed` written at order
  creation). Kill switch: `NEXT_PUBLIC_FIRST_PARTY_EVENTS=false`.
- **CustomerNeedProfile with provenance:** one per session, every field
  optional, per-field `{source, confidence?, updatedAt}`; rank
  USER_STATED > ORDER_DATA > CONFIGURATOR > SYSTEM_DERIVED > AI_INFERRED
  gates overwrites (tested). Live writers: quote form (USER_STATED), mock
  checkout (ORDER_DATA). Unknown stays unknown — vague quantities are not
  parsed into numbers.
- **AI-ops data (live):** AiUsage (+ totals for budget caps; S04 added
  prompt_id/prompt_version columns, migration 0001), AgentDecision with
  typed AgentAction schema, Approval auto-created pending, AgentConfig
  (missing row ⇒ OBSERVE fail-safe), CustomerInsight (sourceRefs ≥ 1
  enforced), ProductOpportunity (humanValidationRequired always true),
  Experiment + sticky assignments.
- **AI runtime `lib/ai` (Session 04 — foundation, no agents, no UI, OFF by
  default):** server-only module (docs/AI_RUNTIME.md is authoritative).
  Provider abstraction with the Anthropic adapter implemented on the
  official SDK (openai/gemini interface-ready, selecting them fails loudly);
  `AiRuntime` facade = flags → env config → workload router
  (LOW_COST/STANDARD/REASONING → haiku-4-5/sonnet-5/opus-5, env-overridable)
  → budget guard → provider call (timeout, normalized AiError codes) →
  AiUsage row (non-fatal, loudly logged). Versioned prompt registry (infra
  prompts only; usage rows trace prompt+model). Structured output =
  provider-constrained JSON + OUR zod validation, bounded 1-retry.
  Budget guard fails CLOSED (caps+unpriced model ⇒ config error; totals
  outage ⇒ AI_BUDGET_EXCEEDED check_failed). Typed tool registry:
  permission tiers READ/CUSTOMER_WRITE/COMMERCE/FINANCIAL_RESTRICTED/
  ADMIN_RESTRICTED, server-minted ToolExecutionContext, zod in+out
  validation, sha256-hashed audit logs, loop limits (tool calls/model
  calls/duration end turns with a status). Sales toolset (8 after S05):
  searchProducts, getProductDetails, calculatePrice + getQuantityPricing
  (engine delegation — output schemas structurally exclude cost/margin/
  floor), getShippingEstimate (honest), saveCustomerNeed (AI_INFERRED
  provenance, session from context), recommendProduct (catalog-validated,
  S05), requestHumanHelp (structured escalation, S05). `config/flags.ts`
  all-default-OFF; `config/ai-pricing.ts` null placeholders (budgets
  unenforceable until filled — documented). FakeAiProvider ships for
  tests; no credentials or network in tests/build.
- **AI Sales Agent "AI Packaging Expert" (Session 05 — OFF by default;
  docs/AI_SALES_AGENT.md is authoritative):** `lib/ai/agents/sales/`
  orchestrates: active-conversation resolve (active OR escalated resumes;
  ended never) → raw transcript persistence → provenance-labeled context
  (profile + rolling summary, ≤2.4k chars) → versioned `ai_sales_agent`
  v1.0.0 prompt → runToolConversation (STANDARD) → tool+assistant rows →
  LOW_COST evidence-validated extraction → LOW_COST summary every 6
  messages (derived view on conversations.summaryJson) → normalized
  SalesAgentResult (reply + recommendedProductId/Path + needsHuman +
  handoffReason + conversationStatus; frontend never parses prose).
  USER_STATED is EARNED: only the server extractor grants it, requiring
  model-quoted evidence verbatim in the customer's actual message +
  value-evidence consistency (numbers must match a complete number;
  hedged "about 5,000" demotes to AI_INFERRED; fabricated quotes DROPPED;
  priceSensitivity/purchaseIntent always AI_INFERRED). Escalation =
  structured handoff (reason enum, requirement summary, voluntary contact,
  profile snapshot) persisted as a system message row + conversation
  escalated (NOT ended) + human_handoff_requested event; delivery
  destination is owner config (recorded, not yet sent anywhere).
  `/api/ai/chat`: POST {message} only (identity = bd_sid cookie; body
  ≤16KB, message ≤2000 chars), per-session (6/min) + per-IP (20/min)
  in-memory token buckets (`lib/rate-limit.ts`; per-instance — edge
  limiting is a LAUNCH_CHECKLIST item), every AI failure → 503 fixed
  customer-safe copy (codes only in server logs); GET history returns
  user/assistant rows only (system/tool rows never leak). UI:
  `components/ai/PackagingExpertLauncher` (server gate: both flags + key
  or renders NOTHING) → `PackagingExpertChat` (floating widget, history,
  quick prompts, loading/error/retry, escalation banner, recommendation
  chip, a11y log/labels/Escape, mobile width). Events: ai_chat_started,
  ai_message_sent (props only, never transcript), ai_product_recommended,
  human_handoff_requested. Optional `npm run ai:smoke` verifies configured
  model ids against the live account + one real LOW_COST call
  (credential-gated; never in tests/build).
- **Shared configuration state (Session 06 —
  docs/AI_CONFIGURATOR_INTEGRATION.md is authoritative):**
  `lib/configuration/` = pure catalog validation + patch semantics
  (validation.ts: 5 patchable fields — artwork/customDimensions
  structurally excluded), pure reducer (store.ts: revision, dirtyFields
  field-merge, lastChange), React provider (context.tsx: mount restore,
  700ms debounced sync, flushSync before add-to-cart), sync bus
  (chat↔configurator across React trees + configurator presence), ONE
  server application path (server.ts) over the S03 row
  (`product_configurations.version` = revision;
  `updateConfigurationChecked` = SELECT…FOR UPDATE + expectedRevision).
  `/api/configuration`: POST full-config sync (last-write-wins) or patch
  apply (revalidated; 409 STALE_REVISION), GET session restore; strict
  zod (unknown patch keys = loud 422, never stripped). Three new sales
  tools (8→11): getCurrentConfiguration (READ, customer-visible view),
  updateConfiguration (CUSTOMER_WRITE, partial patch, structured
  rejections with alternatives, revision-checked), suggestConfigurationUpdate
  (READ, validates+prices, writes nothing → apply chip).
  SalesAgentResult now carries configurationUpdate (server-validated
  config the UI applies — never model text) + suggestedActions; sales
  context injects the live configuration each turn; assistant messages
  stamp configSnapshotJson; prompt v1.1.0 adds COMMIT-vs-PREVIEW +
  confirmation policy + no-artwork-fabrication rules. Both manual sync
  and AI commits write CONFIGURATOR-rank need evidence
  (needUpdateFromConfiguration mirrors checkout's ORDER_DATA mapping);
  USER_STATED still only via the S05 evidence extractor. Events:
  ai_configuration_proposed/updated/rejected (+ conversations.outcome now
  stamps quote_started/checkout_started/purchased from their routes).
  UI: configurator restores on reload, AI changes highlight ~6s
  ("Updated by Packaging Expert") + aria-live announcements; chat shows
  "✓ Configurator updated" chips + tappable suggestion chips; mobile
  launcher/panel lift above the sticky Add-to-Cart bar when a
  configurator is mounted.
- **AI Sales × Cart/Checkout (Session 07 —
  docs/AI_COMMERCE_INTEGRATION.md is authoritative):** the cart stays
  client-side (`bd_cart_v1`) and `/api/checkout` stays the only order
  authority — S07 adds a validated channel INTO them.
  `lib/commerce/cart-line.ts` = ONE server path turning the authoritative
  shared configuration (at `expectedRevision`) into an engine-priced cart
  line; `expectedTotalCents` is /api/checkout-style drift detection ONLY
  (`repriced` requires fresh customer confirmation; `stale_configuration`
  returns current state; artwork/custom-quote rules match the manual
  button). Four sales tools (11→15; sales = READ+CUSTOMER_WRITE+COMMERCE):
  addConfiguredProductToCart (COMMERCE, explicit-intent commit),
  suggestAddToCart (READ → "Add to cart" chip; taps re-validate via
  `/api/cart/line`), getCartSummary (READ over the server-minted client
  cart snapshot), startCheckout (COMMERCE, EMPTY strict input → validated
  "Continue to checkout" action the CUSTOMER taps). Chat POST carries a
  STRICT price-free cart snapshot (client prices = 422); context injects
  the engine-priced cart view; SalesAgentResult/wire gain cartAdd +
  checkoutAction + ADD_TO_CART suggested actions. The client applies
  validated lines via the SAME `useCart().addLine` as manual and checks
  out via the NEW shared `lib/cart/checkout-client.ts` (cart page
  refactored onto it) — REPRICED shows "Confirm & continue at $X" and is
  never auto-accepted. Orders: `aiAssisted` + `conversationId` stamped at
  creation via `lib/data/ai-assistance.ts` (conservative: a sales
  conversation AND ≥1 material ai_* commerce event; widget-loaded ≠
  assisted); purchase_completed carries an aiAssisted prop. Outcomes:
  `cart_added` added with funnel ranking (purchased > checkout_started >
  cart_added/quote_started — never downgrades). Events: +3 taxonomy names
  (ai_add_to_cart_proposed/requested, ai_checkout_requested); generic
  add_to_cart/checkout_started gain optional addedVia/trigger "ai_chat"
  props. Prompt v1.2.0 (explicit-intent list + non-examples, reprice
  confirmation, dual "add and checkout" intent, shipping/tax =
  "calculated at checkout"). Security structural + red-team-tested: no
  price/discount/config/url tool inputs (STRICT schemas), no
  markOrderPaid/applyDiscount/capturePayment/createCheckout tools,
  checkout URLs only from the provider via `/api/checkout`, purchase
  events only at order creation.
- **Customer Intelligence (Session 08 — docs/CUSTOMER_INTELLIGENCE.md is
  authoritative):** `modules/customer-intelligence` = the DETERMINISTIC
  authority (closed question/objection/request taxonomies, catalog-support
  verdicts supported|custom_quote_path|unsupported from the REAL catalog,
  the qualified-conversation rule, conversation-deduplicated aggregation,
  three-lane demand requested[stated vs inferred split]/configured/
  purchased, funnel/segment/attribution/association metrics, threshold-
  gated identity-stable insight+opportunity generation) — it has NO lib/ai
  import. `lib/ai/agents/customer-intelligence/` = LOW_COST labeling only
  (`ai_customer_intelligence_classifier` v1.0.0, agentType
  customer_intelligence, closed enums, messageIds verified against the
  transcript sent, one idempotent row per conversation in
  `conversation_classifications` [migration 0002] keyed by
  classifierVersion+sourceUpdatedAt) + explicit batch processing (cap 25;
  budget/provider failures leave rows PENDING, invalid output marks ONE
  row failed and continues, flags-off touches nothing). All DB access via
  `lib/data/intelligence-service.ts` (::float8 aggregates). Insights:
  types CUSTOMER_QUESTION/OBJECTION_PATTERN/DEMAND_PATTERN/PRODUCT_GAP/
  MOQ_SIGNAL/SHIPPING_SIGNAL/PRICING_SIGNAL/SEGMENT_PATTERN/
  CONVERSION_PATTERN; valueJson.identityKey = TYPE:dimension:periodDays
  (one row ever — candidate/validated update in place, dismissed/archived
  resurrect only on GROWN evidence); statuses +dismissed (S08).
  Opportunities: lower_moq + unsupported_product, created `proposed` only,
  validated/rejected are human-frozen, humanValidationRequired always
  true. Admin: `/admin/customer-intelligence` (+ per-insight/opportunity
  evidence drill-downs with bounded excerpts, missing-evidence honesty) +
  `/api/admin/customer-intelligence/*` (process, status routes) behind
  HTTP Basic (`ADMIN_USER`/`ADMIN_PASSWORD` via `proxy.ts` + per-route
  re-checks; unset ⇒ 404 fail-closed) + the flag; /admin
  robots-disallowed. Thresholds in `config/customer-intelligence.ts`
  (documented: insight ≥3 evidence, % ≥5 denominator, trend ≥5 base,
  segment ≥5/cell, association ≥10pp). Qualified conversation (the
  denominator, deterministic): funnel outcome OR escalation OR a
  qualifying session event (price_viewed/add_to_cart/checkout_started/
  purchase_completed/quote_*/ai_product_recommended/
  ai_configuration_updated/ai_add_to_cart_requested/ai_checkout_requested/
  human_handoff_requested) OR quantity/productInterest at USER_STATED/
  CONFIGURATOR/ORDER_DATA provenance — AI_INFERRED alone never qualifies.
- **Business Intelligence + CEO Agent (Session 09 —
  docs/BUSINESS_INTELLIGENCE.md is authoritative):**
  `modules/business-intelligence` = the DETERMINISTIC business-metrics
  authority (NO lib/ai import): typed Metric availability
  AVAILABLE/PARTIAL/UNAVAILABLE (unavailable carries reason+missingInputs,
  NEVER value 0), revenue from orders.totalCents (multi-line never double
  counted; cancelled/refunded excluded+reported; per-currency exact,
  headlines single-currency only — no invented FX), funnel (distinct
  sessions/stage, purchases from the orders table, rates with documented
  denominators), AI sales (S07 conservative aiAssisted) + AI cost
  (unpriced calls counted → PARTIAL/UNAVAILABLE, never $0; by
  provider/model/agent), profitability reconstructed per order from the
  S02 cost model (gross = revenue − product COGS; contribution BEFORE
  paid media = − all variable costs, payment fee per ORDER; per-product =
  gross only; all-null config/costs.ts ⇒ "Unavailable — configure
  manufacturing costs" listing missing inputs), segments (businessType),
  first-party attribution (first/last touch, landing pages, no click ids,
  NO CAC/ROAS), trends (TREND/NEW_ACTIVITY/LOW_BASELINE/NO_ACTIVITY —
  previous-zero never +∞%), deterministic data-quality warnings → ONE
  BusinessHealthSnapshot (JSON-serializable, PII-free). CEO agent
  `lib/ai/agents/ceo` (RECOMMEND permanently): NO tools — one REASONING
  `generateStructuredObject` over the snapshot context (prompt
  `ai_ceo_business_review` v1.0.0); controlled enums (confidence+risk
  LOW/MEDIUM/HIGH, 9 action categories granting zero authority); server
  validates every supportingMetricRef/evidenceRef against the exact
  context sent (fabricated refs filtered, ref-less recommendations
  dropped+logged); persists pending AgentDecisions (approvalRequired
  always true, executionStatus stays none; identityKey =
  category+refs+periodDays dedup — pending rows update in place via
  `updateDecisionRecommendation`, human-reviewed rows frozen) + one
  append-only `ceo_reports` row (period, prompt+version, model, provider,
  exact snapshot, validated review, decision ids; migration 0003).
  Failure = failure: budget/provider errors persist NOTHING; the last
  good report stays visible. Admin: `/admin/business-intelligence`
  (period 1/7/30/90+custom; overview/funnel/AI/profitability/signals/
  trends/products/segments/attribution/CEO review/data quality;
  owner-friendly copy) + POST
  `/api/admin/business-intelligence/ceo-review` (the ONLY generation
  trigger) behind S08 HTTP Basic (same credentials, no second auth
  system) + `AI_BUSINESS_INTELLIGENCE` flag, fail-closed 404.
  Deterministic dashboard requires zero AI configuration. Config:
  `config/business-intelligence.ts` thresholds; services
  `lib/data/business-intelligence-service.ts` (::float8 aggregates) +
  `lib/data/ceo-report-service.ts`.
- **Guardrail Engine + AI Action Center (Session 10 — docs/GUARDRAILS.md +
  docs/AI_ACTION_CENTER.md are authoritative):** `modules/guardrails` is
  THE central safety layer, with NO `lib/ai` and NO `db/` import.
  actions.ts = the CLOSED taxonomy: 11 review-only types (`*_REVIEW` +
  CRO_EXPERIMENT_PROPOSAL — approving means "yes, investigate"), 9
  representable-but-unexecutable types (PRICE_CHANGE/PRICE_EXPERIMENT/
  MOQ_CHANGE/AD_BUDGET_CHANGE/AD_PAUSE/AD_RESUME/AD_CREATIVE_TEST/
  CRO_EXPERIMENT_LAUNCH/AI_COST_CHANGE) and 2 never-automated CRITICAL
  types (REFUND, MANUFACTURING_CHANGE); every type has a STRICT zod
  payload schema (unknown keys are errors, so no authorization field can
  be smuggled) plus source permissions — CEO_AGENT may propose review
  types only, so "lower all prices 90%" is `source_not_permitted_for_
  action_type`. evaluate.ts = the pure `evaluateAgentAction({source,
  actionType, payload, autonomyMode, modelSuggestedRiskLevel?,
  priceContext?})` → `{allowed, executionEligible, approvalRequired,
  riskLevel, violatedRules[{id,severity HARD|SOFT,blocks PROPOSAL|
  EXECUTION}], missingConfiguration[], reason, executionSupport,
  executionState, limitsSnapshot, policyVersion}`: unknown agent/type,
  malformed payload, unknown mode, OBSERVE, and evaluator exceptions all
  DENY; autonomy is clamped `min(stored, AGENT_AUTONOMY_POLICY ceiling)`;
  HIGH/CRITICAL always need a human (`MAX_UNATTENDED_RISK_LEVEL=MEDIUM`);
  price-affecting types reuse `evaluatePriceFloor` + `COST_MODEL.
  marginPolicy` (NOT duplicated) and fail closed while costs are null.
  executors.ts = an EMPTY registry (no dummy executors; the future
  contract is documented). decision-mapping.ts maps the 9 CEO categories
  → review types (informational recommendations create nothing).
  `config/guardrails.ts` = policy version + 10 `null` `[TO BE PROVIDED]`
  limits + autonomy defaults/ceilings + an EMPTY guarded-auto allow-list.
  Persistence `lib/data/agent-action-service.ts` over migration 0004:
  `agent_actions` (status PROPOSED/GUARDRAIL_BLOCKED/PENDING_APPROVAL/
  APPROVED/REJECTED/SUPERSEDED ⟂ executionStatus NOT_APPLICABLE/
  NOT_SUPPORTED/READY/…; revision + originActionId lineage; stateVersion
  concurrency; partial unique index = one root action per decision),
  append-only `guardrail_evaluations` (policy version + limits snapshot)
  and `agent_action_events` (proposed/blocked/approved/rejected/modified,
  server-derived actor — deliberately NOT the customer `events` taxonomy,
  which requires a session and feeds third-party copies). Blocked
  proposals are STORED and shown, never swallowed. Admin:
  `/admin/ai-actions` (+ `/[id]` detail: observation, recommendation,
  server-resolved evidence with unresolved refs named as unavailable,
  structured payload, full evaluation with rules/limits, history,
  revisions) behind the S08 HTTP Basic + `AI_ACTION_CENTER`, fail-closed
  404; POST `/api/admin/ai-actions/{sync,[id]/review,[id]/modify}` — the
  first admin MUTATION routes, guarded by `lib/admin/write-guard.ts`
  (POST + auth + same-origin + `application/json` + bounded body + strict
  zod). `reviewedBy` is server-derived (`adminIdentity()`); a client
  sending reviewedBy/riskLevel/approvalStatus gets 422. Modification
  preserves the original (SUPERSEDED) and RE-EVALUATES a new revision (no
  inherited verdict; evidence refs may narrow, never grow). Sync is
  deterministic — it reads pending CEO decisions, no model call.
- **Experiment Engine + CRO Agent (Session 11 — docs/EXPERIMENTATION.md +
  docs/CRO_AGENT.md are authoritative):** `modules/experiments` is the
  DETERMINISTIC measurement authority, with NO `lib/ai` and NO `db/` import
  (asserted structurally, like S08/S09/S10). targets.ts = the CLOSED
  registry of experimentable surfaces (product.shipping_message,
  product.primary_cta, homepage.hero — each declares its one experiment
  type, strict variant schema, targetVersion, routes, rendering component,
  protected fields and `describeControl()`); variants.ts = CLOSED typed
  records (HeroCopy/CtaCopy/ShippingMessage) whose `safeText` refuses
  markup, braces, template interpolation, `javascript:`/`data:` URLs, inline
  handlers and control characters — there is no code path anywhere turning
  experiment data into markup; allocation.ts = whole-percent arms totalling
  exactly 100, control required, MVP capped at control + one variant;
  assignment.ts = PURE FNV-1a bucketing (deterministic, sticky before
  persistence, per-experiment salt); eligibility.ts = route/source/campaign/
  device/visitor selectors where AMBIGUITY NEVER ENROLS, plus admin/bot
  exclusion; statistics.ts = two-sided two-proportion z-test (pooled SE,
  α=0.05, A&S 7.1.26 normal CDF, min 5 per cell) with its assumptions and
  limitations documented in code; results.ts = the 7 result states and the
  minimum-sample gate; proposal.ts = THE one experiment-design schema shared
  by the CRO agent, the guardrail payload and draft creation.
  `config/experiments.ts` holds processing policy + `resolveTrafficCap()`
  (owner limit → non-production-only 50% dev ceiling → BLOCKED in
  production; null is never 100%). Runtime: `lib/experiments/server.ts`
  resolves targets during the SERVER render (flag off ⇒ reads nothing and
  pages stay static; flag on ⇒ `/` and `/products/[slug]` become dynamic, so
  toggling needs a redeploy), enrols only sessions that already have a
  first-party `bd_sid` (a brand-new browser's first render sees control —
  costs sample, not validity), records ASSIGNMENT and EXPOSURE separately
  (`experiment_assignments.exposed_at` stamped once ⇒ exactly one
  `experiment_exposed` event per session), and degrades to control on any
  error. `lib/data/experiment-metrics-service.ts` counts distinct exposed
  sessions with the metric event AT OR AFTER exposure (pre-exposure
  conversions are never credited; repeats count once) over closed
  primary/secondary/guardrail metric lists — "checkout error rate", "AI
  failure rate" and contribution profit are deliberately ABSENT because no
  deterministic per-session source exists. `modules/business-intelligence/
  dropoff.ts` adds the sequential drop-off view with explicit denominators.
  CRO agent `lib/ai/agents/cro` (RECOMMEND): NO tools, one REASONING
  `generateStructuredObject` over a PII-free context that prints the
  deterministic numbers AND the closed target list; server validation drops
  proposals with an unknown target, a mismatched type, a variant config that
  fails the target's strict schema, or no surviving metric reference, and
  the SERVER derives audience (from the target's routes), allocation
  (`min(request, cap, 50)`) and the sample floor; identity-stable dedup with
  human verdicts frozen; kind=REVIEW routes business/product problems to
  `CRO_REVIEW` instead of an objection-hiding copy test. Persistence
  (migration 0005): `experiments` EXTENDED additively (S03 columns kept;
  `controlJson` = launch snapshot, `trafficSplitJson` = whole percents),
  `experiment_assignments` + `exposedAt`, new append-only
  `experiment_events`; partial unique indexes give ONE running experiment
  per target and one experiment per approved action. Admin:
  `/admin/experiments` (+ `/[id]`: what is being tested, how many saw it,
  what happened, can we trust it, provenance + timeline) behind the S08
  HTTP Basic + `EXPERIMENT_ENGINE`, fail-closed 404; POST
  `/api/admin/experiments/{create,materialize,cro-review,[id]/launch,
  [id]/stop,[id]/archive}` behind `lib/admin/write-guard.ts`. **Launch is a
  human admin route, NOT an executor** — the guardrail executor registry
  remains EMPTY — and every launch is guardrail-evaluated with its verdict,
  policy version and missing configuration snapshotted onto the row.
- **Pricing Intelligence + Pricing Agent (Session 12 —
  docs/PRICING_INTELLIGENCE.md is authoritative):**
  `modules/pricing-intelligence` is the DETERMINISTIC pricing-analytics
  authority, with NO `lib/ai` import and NO price-mutation path (both asserted
  structurally). tiers.ts derives quantity BANDS from the REAL catalog
  (`[tier.minQty, nextTier.minQty)` + a below-MOQ band from `minQuantity`) and
  catalog-wide buckets from the distinct tier breakpoints — no invented
  ranges; funnel.ts counts CO-OCCURRENCE over documented denominators
  (price→cart = sessions that did BOTH, over sessions that saw a price) and
  enforces real ORDERING for "after price" (per-session min/max
  `occurred_at`), plus the conversation-level PRICE/MOQ counts where a
  QUESTION is never an OBJECTION; demand.ts keeps the S08 three lanes
  separate with the requested lane provenance-split (USER_STATED vs
  AI_INFERRED; CONFIGURATOR/ORDER_DATA excluded so nothing double-counts);
  tier-performance.ts aggregates per band (checkout = `null` "unavailable",
  never 0 — the event carries no product/quantity; conversations attributed by
  configured-then-stated quantity, the rest counted as `unattributed`);
  realization.ts re-quotes stored order configurations against today's engine
  (a difference is `catalog_price_changed`, NEVER leakage — no discount
  mechanism exists) and reports checkout repricing as NOT INSTRUMENTED naming
  the two events that would be needed; moq.ts is its own section because
  wanting 200 bags is a QUANTITY problem, not a price one; signals.ts grades
  evidence — `isPriceFriction` requires EXPLICIT evidence (objection /
  repeated price question / handoff after price / quote after price /
  tier-concentrated objections), a price-view-then-nothing pattern is
  BEHAVIORAL, capped at LOW, and explicitly NOT friction, MOQ friction routes
  to MOQ_REVIEW and a product gap produces no pricing signal at all; strength
  is LOW/MEDIUM/HIGH from counted evidence AND evidence diversity (HIGH needs
  ≥10 conversations and ≥2 types), never a probability; readiness.ts names
  every unfilled `config/costs.ts` / `config/guardrails.ts` path (null is
  never zero and never "no limit"), returns `assessElasticity()` with
  `estimable: false` as a LITERAL type (no code path anywhere produces a
  coefficient) and the four-class `PricingReadiness` (PRICING_REVIEW
  AVAILABLE · SPECIFIC_PRICE_CHANGE BLOCKED · PRICE_EXPERIMENT BLOCKED ·
  AUTOMATED_PRICE_CHANGE NOT_SUPPORTED) → ONE PricingIntelligenceSnapshot
  (JSON-serializable, PII-free). `config/pricing-intelligence.ts` holds the
  documented thresholds + the CLOSED recommendation taxonomy and its
  review-only action mapping. Data access: `lib/data/pricing-intelligence-service.ts`
  (4 new READ queries: session/product event facts with first+last timestamps,
  quantity-bearing events, priced order lines) — everything else reuses the S08
  bounded reads, so there is no second pricing analytics source of truth.
  Pricing Agent `lib/ai/agents/pricing` (RECOMMEND): NO tools, ONE REASONING
  `generateStructuredObject` over a bounded PII-free context that prints the
  ENFORCEMENT RULES FIRST (truncation-safe) then cost truth, elasticity,
  signals and readiness before the long tables; prompt
  `ai_pricing_intelligence_review` v1.0.0. **The output schema cannot express
  a price** — no `proposedUnitPriceCents`, no `discountPct`, no `proposedMoq`,
  no `optimalPrice` — so a specific price change is UNREPRESENTABLE, not
  merely refused. Server-side: metric/evidence/signal refs filtered against
  exactly what the context printed (none surviving ⇒ recommendation DROPPED),
  `productId` validated against the real catalog and `quantityTier` against
  that product's real tiers (else null), and
  `requiresCostConfiguration`/`requiresExperiment` RECOMPUTED (a model
  disagreement is logged, never honoured). Persistence: append-only
  `pricing_reports` (migration 0006 — period, prompt+version, model, provider,
  the exact snapshot, the validated review, decision ids) + identity-deduped
  AgentDecisions (`PRICING:<type>:<product|all>:<tier|all>:<refs>:<days>d`,
  pending rows refresh in place, human verdicts frozen). Guardrails:
  `GUARDRAIL_POLICY_VERSION` → `2026-08-15.s12.1`, `PRICING_AGENT` default
  autonomy OBSERVE → RECOMMEND (ceiling unchanged at RECOMMEND, allow-list
  still empty), ONE permission added (`DATA_QUALITY_REVIEW` — review-only, so
  a "we have no costs" finding routes honestly instead of masquerading as a
  price problem), `mapPricingDecisionToAction` + `syncDecisionsToActions` now
  covering ceo/cro/pricing. **`PRICE_CHANGE` and `PRICE_EXPERIMENT` are absent
  from the mapping table** and remain executor-less; the experiment engine
  still cannot run price variants. Admin: `/admin/pricing-intelligence` +
  POST `/api/admin/pricing-intelligence/pricing-review` behind the S08 auth +
  the new `PRICING_INTELLIGENCE` flag (agent generation additionally behind
  `AI_PRICING_AGENT`), `lib/admin/write-guard.ts` on the mutation route;
  deterministic analytics render with zero AI configuration and a provider
  outage leaves the previous review visible.
- **Google Ads Read-Only Intelligence (Session 13 —
  docs/GOOGLE_ADS_INTELLIGENCE.md is authoritative):** four layers, each
  unable to cross the next. `lib/google-ads` is the ONLY door to Google and
  it opens one way: `client.ts` has a single URL builder appending the
  LITERAL `/googleAds:search` (the method is not a parameter ⇒ no `:mutate`
  URL is constructible anywhere), no exported `request(method, path, body)`,
  a SELECT-only guard, `queries.ts` holding the CLOSED two-query set
  (`customer` identity; `campaign` × `segments.date` with impressions/clicks/
  cost_micros/conversions/conversions_value — no click_view, no audience, no
  per-person field), `auth.ts` (env credentials + OAuth refresh + a
  module-private token cache with no exported reader), `errors.ts` (10
  normalized codes + `redact()` stripping bearer/ya29/1// tokens, secrets and
  developer tokens from anything persisted, logged or displayed) and
  `reporting-provider.ts` (the interface exposes exactly `status` /
  `getAccountInfo` / `getCampaignDailyMetrics`, plus
  `FakeGoogleAdsReportingProvider` with a byte-identical surface). Money
  converts ONCE at the boundary: `cost_micros → round(micros/10_000)` cents
  (rounded, not truncated — sub-cent spend is real), `conversions_value` (a
  DOUBLE in currency units) → `round(v*100)`. `lib/data/google-ads-service.ts`
  owns the three tables with an IDEMPOTENT upsert on
  `(adAccountId, campaignId, date)` — running a sync twice cannot double
  spend, and a Google RESTATEMENT overwrites that day in place rather than
  appending. `lib/google-ads/sync.ts` is the explicit admin operation
  (account identity FIRST so a credential failure costs no reporting quota,
  then the bounded report; SUCCESS / PARTIAL / FAILED, and only SUCCESS
  advances `lastSuccessfulSyncAt`). `modules/google-ads-intelligence` is the
  DETERMINISTIC authority with NO `lib/ai`, NO `lib/google-ads` and NO
  `fetch` (all asserted structurally): dates.ts (account-calendar day math —
  a UTC period maps to the account-days it OVERLAPS; `Intl` does DST),
  connection.ts (CONNECTED / NOT_CONNECTED / CONFIGURATION_INVALID /
  NEVER_SYNCED + FRESH / STALE / PARTIAL / SYNC_FAILED / NOT_CONNECTED, from
  documented thresholds), native.ts (Google's lens; every rate `null` on a
  zero or sub-minimum denominator, never 0 and never Infinity),
  attribution.ts (the paid-traffic test + EXACT/MAPPED/UNMATCHED matching,
  ambiguous names refusing, NO fuzzy tier, NO gclid→campaign resolution),
  firstparty.ts (our lens, reusing the S08/S09 bounded reads — no second
  source of truth), efficiency.ts (four separately-NAMED concepts + the
  currency gate + POAS permanently UNAVAILABLE), discrepancy.ts (both sides
  + five standing causes, never a correction), campaigns.ts (one row, two
  lenses, plus match quality and the click→session/session→conversation/
  conversation→order quality chain), signals.ts (count-based observations,
  each with a limitation, never a root-cause diagnosis), spend.ts (the
  narrow `adSpend` section S09's snapshot and the CEO context consume) →
  ONE GoogleAdsIntelligenceSnapshot (JSON-serializable, PII-free,
  credential-free). `config/google-ads.ts` centralizes the API VERSION
  (`v25`, `SUPPORTED_API_VERSIONS`; an unsupported `GOOGLE_ADS_API_VERSION`
  throws rather than silently falling back), sync/quota bounds (30-day
  default lookback, 180-day max range, 10k rows, 50 pages, 30s timeout),
  freshness thresholds, and the CLOSED 7-type recommendation taxonomy with
  its REVIEW-ONLY action mapping. Google Ads Agent `lib/ai/agents/google-ads`
  (RECOMMEND): NO tools, NO Google access, ONE REASONING
  `generateStructuredObject` over a bounded context that prints the
  ENFORCEMENT RULES and the connection/profit truth FIRST (truncation-safe);
  prompt `ai_google_ads_review` v1.0.0. Persistence: append-only
  `google_ads_reports` + identity-deduped AgentDecisions
  (`GOOGLE_ADS:<type>:<campaign|account>:<refs>:<days>d`, pending rows
  refresh in place, human verdicts frozen) → `MARKETING_REVIEW` /
  `DATA_QUALITY_REVIEW` in the Action Center. Admin:
  `/admin/google-ads-intelligence` + POST
  `/api/admin/google-ads/{test-connection,sync,ads-review}` behind the S08
  auth + the new `GOOGLE_ADS_INTELLIGENCE` flag and
  `lib/admin/write-guard.ts`; the connection test accepts NO parameters, so a
  client cannot ask the platform to probe an arbitrary Google Ads account.
- `lib/commerce` — provider abstraction; `mock` active, `shopify`
  Storefront skeleton env-gated (variant mapping TODO, needs real store).
  **All catalog reads go through `lib/commerce/catalog.ts`** (provider-
  backed; loud mock fallback while the Shopify mapping is incomplete —
  checkout never falls back). Client components receive catalog data as
  props from server components, never by importing `config/products`.
- `modules/pricing` — **the sole pricing AND unit-economics authority**
  (docs/UNIT_ECONOMICS.md is authoritative; no `lib/ai`, no `db/`, no fetch):
  `engine.ts` (tier kernel, unchanged Session-01 math), `cost-model.ts`
  (per-unit/per-line/per-order cost scopes, optional factory quantity tiers,
  `paymentFeeCents` [one fixed fee per TRANSACTION],
  `computeShippingEconomics` [subsidy = max(actual − charged, 0), never
  negative; shipping margin preserved separately],
  `evaluateMarginAgainstPolicy` [BELOW_MINIMUM / BELOW_TARGET /
  AT_OR_ABOVE_TARGET / NO_TARGET / UNAVAILABLE], `minimumAllowedPriceCents`
  [FLOORS only — a target is never a floor], `evaluatePriceFloor` fail-closed
  guardrail), `unit-economics.ts` (the order-level ladder: gross profit →
  contribution before paid media → contribution after paid media + POAS;
  order-level costs applied exactly ONCE; per-level availability; NO per-line
  contribution because no allocation rule exists), `snapshot.ts` (forward-only
  order cost snapshots stamped with `costModelVersion`), `validate.ts` (config
  validation that fails loudly and never normalises), `readiness.ts` (the
  owner-facing Configured/Missing/Invalid view + `isCostModelConfigured`, THE
  one completeness definition), `calculatePrice()` facade. Costs live in
  `config/costs.ts` — **every value is a `null` `[TO BE PROVIDED]`
  placeholder**; margins report "unavailable", price floors fail closed, and
  **missing costs never block a sale**. Cost/margin figures are server-only —
  never sent to the browser, a prompt or an analytics event.
- `/api/checkout` — **server-side re-quote**: validates every cart line
  against the live catalog (ids, artwork requirement, custom-quote
  routing), re-prices with the engine, answers 409 REPRICED on any drift
  (client cart self-corrects and asks the user to confirm again), 422 on
  invalid lines, then calls `createCheckout` on the active provider. Mock
  orders: the route returns the server-priced payload; the client persists
  it for the confirmation page.
- `lib/analytics/track.ts` — typed dataLayer events, consent-gated,
  purchase dedup. `lib/attribution` — first/last touch. Both client-side.
- `/api/quote` — validated quote intake → `QUOTE_WEBHOOK_URL` or log.
- Design system: Hallmark Cobalt theme (OKLCH tokens in `app/globals.css`).
- Docs: README, BUSINESS_CONFIG_TODO, LAUNCH_CHECKLIST, plus the AI-platform
  set (below). Placeholder brand "BagDirect"; demo pricing visibly flagged
  via `NEXT_PUBLIC_DEMO_PRICING`.

## Completed in Session 01 (2026-08-08, two passes)

First pass — the doc set:

- Full repository audit → `docs/CURRENT_SYSTEM_AUDIT.md` (implemented /
  partial / missing / risks / KEEP-REFACTOR-ADD-DEFER classification).
- Architecture direction → `docs/ARCHITECTURE.md` (current + target +
  invariants + decision log).
- Data design → `docs/DATABASE_SCHEMA.md` (current no-DB state + full
  planned schema: commerce spine, events, conversations,
  CustomerNeedProfile, AgentDecision/Approval/AgentConfig, AiUsage,
  experiments).
- AI design → `docs/AI_AGENT_ARCHITECTURE.md` (provider layer, model
  router, typed tool rules, sales toolset, injection posture, escalation).
- Safety design → `docs/GUARDRAILS.md` (evaluateAgentAction, autonomy
  modes, hard limits, never-automated list, feature flags).
- Rollout → `docs/AI_PLATFORM_ROADMAP.md` (Stages A–J ↔ session map).
- `BUSINESS_CONFIG_TODO.md` extended with cost-model + AI/guardrail config.

Second pass (same day) — verification + structure:

- Independent full-source re-verification of every audit claim (all held);
  three new code-level findings added to the audit: catalog reads
  bypassing the commerce provider (8 files), configurator state living in
  component-local `useState` (no shared store yet), stale mock-fallback
  comment in `lib/commerce/shopify.ts`.
- Doc set relocated from repo root into `docs/` (git mv, history kept);
  all cross-references updated; README points at the AI-platform docs.
- `docs/AI_AGENT_ARCHITECTURE.md` extended with a full per-agent
  specification (responsibility / inputs / outputs / tools / prohibited /
  autonomy / data access / guardrails / audit) for all 7 planned agents.
- `docs/AI_PLATFORM_ROADMAP.md` gained the owner-spec stage-number
  mapping (0–17 ↔ A–J); CustomerNeedProfile gained `desiredCapacity`.
- `prompts/` created: 00-INDEX + 13 session prompts (02–13 pending),
  each referencing CLAUDE.md + docs instead of duplicating specs.
- No application code changed in either pass (audit-only by design);
  baseline re-confirmed green before and after (39 tests / typecheck /
  lint / build).

## Completed in Session 02 (2026-08-08) — Commerce Stabilization + Pricing

1. **`modules/pricing` boundary** — `lib/pricing/engine.ts` moved (git mv,
   math byte-identical) to `modules/pricing/engine.ts`; new
   `cost-model.ts` (cost breakdown, margins, `minimumAllowedPriceCents`,
   `evaluatePriceFloor`) + `calculatePrice()` facade in `index.ts`. All
   engine imports now go through `@/modules/pricing`.
2. **Cost model config** — `config/costs.ts`: per-product manufacturing /
   size / material / printing+setup / packaging / shipping-basis / other
   costs, payment fee (bps + fixed), margin policy (min gross, min + target
   contribution). ALL values `null` placeholders — nothing invented.
   Unconfigured ⇒ margins "unavailable" + price floor fails closed
   (verified by tests).
3. **Server-authoritative checkout** — new `/api/checkout`
   (`lib/validation/checkout.ts` schema): re-validates + re-prices every
   line server-side; 409 REPRICED on drift (cart self-corrects, user
   re-confirms), 422 on invalid/custom-quote/missing-artwork lines, 400 on
   malformed JSON; margin telemetry logged server-side only. Cart client
   (`app/cart/cart-client.tsx`, server shell `app/cart/page.tsx`) now
   checks out through the route; the mock provider no longer writes
   sessionStorage (the client persists the server-priced payload).
4. **Catalog reads unified** — new `lib/commerce/catalog.ts`
   (list/get/getById/hero) used by home, products list/detail, cart shell,
   sitemap, request-quote page, LandingTemplate; `PricingDemo` and
   `QuoteClient` take props from server components. Only the mock provider
   and test fixtures import `config/products` now. The stale Shopify
   "falls back to mock" comment became a real, loudly-logged read fallback
   (checkout deliberately has none).
5. **Tests 39 → 59** — `tests/cost-model.test.ts` (fixture math, fail-
   closed, floor boundary at floor−1, shipping bases, partial-config
   detection), `tests/checkout-route.test.ts` (200 server-priced order,
   409 tamper, 422 artwork/MOQ/custom/unknown-ids, 400 malformed). All
   green + typecheck + lint + production build.
6. **Browser-verified on the production build**: configure → cart →
   tampered localStorage price ($10) → checkout → 409 + cart self-corrects
   to $540.00 → checkout → order confirmation renders the SERVER-priced
   order; network shows 409→200; server log shows the fail-closed margin
   telemetry.

## Completed in Session 03 (2026-08-09) — AI Data Foundation

1. **Database + ORM** — Drizzle + Postgres dialect: PGlite embedded for
   dev/test (self-migrating, `.data/pglite` / `memory://`), node-postgres
   for prod (`DATABASE_URL`, explicit `npm run db:migrate`). One schema,
   one migration set (`0000_data_foundation.sql`, 20 tables). New scripts:
   `db:generate` / `db:migrate` / `db:seed` (seed = DEMO-labeled, refuses
   external DBs). `serverExternalPackages` for pglite/pg in next.config.
2. **`lib/data` service boundary** — 13 modules (session, request-session,
   event, customer, customer-need, configuration, conversation, order,
   quote, ai-usage, agent, insight, experiment, privacy), every input
   zod-validated, ids via `newId()` prefixed hex. `db/client.ts` throws if
   imported client-side.
3. **Server sessions + attribution** — `/api/events`, `/api/checkout`,
   `/api/quote` mint/refresh `bd_sid`/`bd_aid` httpOnly cookies; unknown or
   malformed client ids are never trusted; `session_started` emitted once
   per session; server-side merge preserves immutable first touch
   (unit-tested).
4. **Event dual-write** — GA4 dataLayer untouched; explicit mapping table
   (view_item→product_viewed, select_size→configurator_updated{option:size},
   begin_checkout→checkout_started, request_custom_quote/quote_form_started
   →quote_started{trigger}, purchase→null=server-side, view_cart/select_item
   /add_shipping_info/add_payment_info→dataLayer-only) in
   `lib/analytics/first-party.ts`; beacon/keepalive batched, exception-safe,
   never blocks UX; `/api/events` validates taxonomy + bounded scalar props,
   dedups on clientEventId, 413s oversized bodies.
5. **Commerce persistence** — mock checkout success now writes Order +
   OrderLine config snapshots + authoritative `purchase_completed` +
   `convertedAt` + checkout-sourced configuration row + ORDER_DATA need
   profile; quote submission writes Quote + Customer/Business upserts +
   Artwork metadata + USER_STATED need profile; ALL wrapped non-fatal —
   commerce never fails on a data-layer error (loud logs instead).
   Shopify redirects persist nothing (order rows arrive with webhooks,
   future session).
6. **Tests 59 → 102** (all green + typecheck + lint + prod build): need-
   profile provenance precedence, first-touch immutability, event
   validation/dedup, events route (cookies, attribution stripping, 400/413/
   422), conversation transcript round-trip + cascade delete, configuration
   versioning, checkout order persistence (+ nothing-persisted-on-409),
   quote persistence (+ "about 5000" never parsed), AiUsage totals,
   AgentDecision/Approval atomicity, insight sourceRefs enforcement,
   sticky experiment assignment, GA4 mapping table.
7. **Browser-verified on `next dev`**: full configure→cart→checkout→
   confirmation flow unchanged (order MOCK-MSMSG34E, $2,100 server-priced);
   database captured the entire funnel (25 events incl. server
   purchase_completed linked to the order row), the order + line snapshot,
   the checkout configuration, and the ORDER_DATA-enriched profile.

## Completed in Session 03.5 (2026-08-09) — Data Foundation Hardening

Fixes for the Session 03 independent audit (rated MOSTLY CLEAN). No
architecture changes, no new AI features — hardening only.

1. **Production database safety** — `db/client.ts` now REFUSES the
   embedded-PGlite fallback when `NODE_ENV=production` and `DATABASE_URL`
   is missing/empty: actionable error (names the env var + `npm run
   db:migrate`), no credentials in the message, failure not cached (env
   fix + retry works). Dev/test embedded behavior unchanged. Build-safe:
   only dynamic API routes touch the DB, so `next build` never trips it.
2. **AI usage aggregate overflow** — `aiUsageTotalsSince()` result casts
   changed `::int` → `::float8` (sum of int4 columns accumulates as
   bigint; the old int4 cast threw "integer out of range" past 2^31−1 ≈
   $2,147 of cost micros in a window). float8 parses as a JS number on
   both drivers and is integer-exact to 2^53. Interface unchanged; int4
   row columns unchanged (per-call values can't overflow them).
3. **Privacy deletion hardened** (`lib/data/privacy.ts`) — semantics now:
   session delete = one browser trail dies (cascade), commerce records
   survive detached and UNredacted; customer delete = the person dies —
   identity row + their sessions (same cascade) + cross-session need
   profiles/conversations linked by customerId — and surviving commerce
   records are redacted: quote payload PII **now including
   `artworkFileName`**, artwork `fileName` → "[deleted]" + `storageUrl`/
   `notes` nulled (fileType/sizeBytes/status kept). Businesses are
   companies, not people — never deleted. All in one transaction.
4. **Launch checklist** — new "Database (first-party data)" section: prod
   `DATABASE_URL` ⛔, `npm run db:migrate` before traffic ⛔, verify
   no-PGlite-fallback ⛔, migration pipeline documented, seed kept away
   from prod, backups.
5. **Tests 102 → 116** — `tests/db-client.test.ts` (production refusal,
   empty-URL, no cached failure, lazy real-PG init, no credential leak,
   dev/test fallback), ai-ops large-aggregate + empty-window totals,
   `tests/privacy.test.ts` (6 cases driving the real quote route: session
   cascade vs. commerce survival, customer redaction incl. filenames,
   cross-session cleanup, second-customer isolation, unknown-id no-op).

## Completed in Session 04 (2026-08-10) — AI Provider Infrastructure + Tool Architecture

Runtime foundation only — no agents, no customer-facing AI, no autonomous
actions. Everything OFF until `AI_RUNTIME_ENABLED=true` + a provider key.
**Security boundaries (structural, tested):** AI cannot override or set any
price (pricing tools delegate to the engine; outputs exclude cost/margin/
floor fields), cannot access admin secrets (server env unreachable from
tools; keys never in prompts or logs), cannot modify ads, issue refunds, or
change manufacturing rules (no such tools exist; FINANCIAL_RESTRICTED /
ADMIN_RESTRICTED tiers are granted to no agent and rejected from
customer-facing registries), and cannot invent authorization (contexts are
server-minted).

1. **Provider layer** — `lib/ai/providers`: minimal `AIProvider` interface
   (generateText / generateStructured / generateToolStep — single-shot;
   the loop is provider-agnostic in runtime.ts), Anthropic adapter on
   `@anthropic-ai/sdk` (new dependency) with injectable fetch, SDK-level
   timeout + conservative retries, vendor errors normalized to AiError
   (RATE_LIMITED/PROVIDER_UNAVAILABLE/TIMEOUT/CONFIGURATION/…), refusal
   stop-reason handled. Vendor blocks round-trip opaquely. IMPLEMENTED:
   anthropic · INTERFACE-READY, DEFERRED: openai, gemini (typed loud error).
2. **Config & flags** — `lib/ai/config.ts` (server-only, throws in browser;
   zod-parsed env: provider, keys, per-workload models, budgets, timeout,
   loop limits); `config/flags.ts` (AI_RUNTIME, AI_SALES, … all default
   OFF, `<FLAG>_ENABLED=true|1` to enable); `.env.example` documented.
3. **Router** — `selectModel(config, workload)`: deterministic env-config
   mapping, defaults haiku-4-5 / sonnet-5 / opus-5.
4. **Prompts** — versioned registry (id + semver + purpose + strict {{var}}
   templates); AiUsage rows carry prompt_id/prompt_version (schema +
   migration `0001_ai_usage_prompt.sql`, additive).
5. **Usage + budget** — every provider call (success AND failure) records
   through `recordAiUsage` non-fatally with loud logging; cost from
   `config/ai-pricing.ts` (null placeholders, maintenance documented, no
   invented prices); `assertWithinAiBudget` before every call: no caps ⇒
   proceed; over ⇒ AI_BUDGET_EXCEEDED; caps+unpriced model ⇒ config error
   (fail closed); totals outage ⇒ check_failed (fail closed).
6. **Structured outputs** — sanitizer produces provider JSON Schema, full
   zod re-validation on our side is the authority; bounded retry (default
   1) with a corrective registry prompt; refusals never retry.
7. **Tool architecture** — `ToolDefinition` (zod in+out, permission,
   server execute), `ToolRegistry` pipeline (exists → permitted → validate
   → execute → validate → audit-log with input hash, never content),
   server-minted `ToolExecutionContext` (LLM can't invent authorization),
   `AGENT_TOOL_PERMISSIONS` map (sales = READ+CUSTOMER_WRITE; ads = none),
   loop limits config-driven. Six sales tools (see architecture bullet);
   `createSalesToolRegistry()` refuses restricted tools structurally.
8. **Runtime facade** — `AiRuntime.generateText / generateStructuredObject
   / runToolConversation` + `isAiRuntimeAvailable()` no-throw probe.
9. **Tests 116 → 198** (all green; zero credentials, zero network):
   config/flags/factory/router/prompts, mocked-fetch Anthropic adapter
   (+ every error class + timeout), structured parsing/sanitizer/cost,
   budget guard (real DB, int4-overflow totals, fail-closed outage),
   registry mechanics + all six tools (engine-delegation equality,
   cost-field exclusion, provenance gate, no-session failure), end-to-end
   FakeAiProvider runs (exit criteria: whitelisted tool end-to-end with
   usage rows; injection red-team: modifyPrice/issueRefund →
   unknown_tool/permission_denied with zero side effects; all three loop
   limits; budget wiring).
10. **Docs** — new docs/AI_RUNTIME.md; AI_AGENT_ARCHITECTURE +
    ARCHITECTURE + BUSINESS_CONFIG_TODO + .env.example updated.

## Completed in Session 05 (2026-08-10) — AI Sales Agent Core

The first customer-facing AI capability, built on the S04 runtime. OFF by
default; commerce verified unaffected with every flag off.

1. **PREREQUISITE FIX — CustomerNeedProfile concurrency** (S03/S04 audit
   debt): `applyNeedProfileUpdate` now wraps read-merge-write in a
   transaction holding `SELECT … FOR UPDATE` on the profile row; creation
   races resolve via the sessionId unique index + ON CONFLICT DO NOTHING +
   re-lock; added per-field confidence support. Chosen over optimistic
   version-retry (same guarantee + a retry loop for a low-contention row)
   and over SQL jsonb-merge (would fork the tested TS rank gate into SQL).
   Concurrent disjoint writers, provenance-under-concurrency (both arrival
   orders), and creation races are tested
   (tests/need-profile-concurrency.test.ts). No schema change.
2. **Sales Agent runtime** — `lib/ai/agents/sales/` (agent/context/
   extraction/summarize), provider-independent (FakeAiProvider in every
   test), normalized SalesAgentResult; conversation lifecycle on the S03
   conversation service (+ findActiveConversation,
   markConversationEscalated — escalated conversations stay open,
   updateConversationSummary).
3. **Versioned sales persona** — `ai_sales_agent` v1.0.0 in the prompt
   registry ({{context}} var): progressive discovery, confirmed-only
   capability claims, no fabricated materials/dates/certifications/prices,
   DEMO pricing labeled, pricing-tool authority, escalation triggers,
   injection posture. Plus `ai_sales_need_extraction` and
   `ai_sales_summary` v1.0.0 (LOW_COST tier). AiUsage rows trace every
   call to prompt+version.
4. **Evidence-validated extraction (USER_STATED vs AI_INFERRED)** — model
   proposes {field, value, kind, evidence, confidence}; SERVER validates:
   USER_STATED only when quoted evidence occurs verbatim in the actual
   message AND the value is consistent with it (complete-number match for
   numerics — "5,000" states 5000 never 500; topic keyword for booleans;
   substring for strings). Fabricated quotes dropped entirely; honest
   interpretations + hedged numbers demote to AI_INFERRED;
   priceSensitivity/purchaseIntent permanently AI_INFERRED; per-candidate confidence
   stored per field. saveCustomerNeed tool remains hard-coded AI_INFERRED —
   the model has NO path to claim USER_STATED.
5. **Two new tools (toolset 6→8)** — recommendProduct (READ,
   catalog-validated; hallucinated ids rejected; ai_product_recommended
   event) and requestHumanHelp (CUSTOMER_WRITE; structured handoff with
   reason enum/requirement summary/customer question/voluntary contact/
   profile snapshot persisted as a system message; conversation
   escalated-not-ended; human_handoff_requested event; delivery = owner
   config, deferred).
6. **Chat API `/api/ai/chat`** — POST {message} only; server-resolved
   bd_sid identity (client cannot supply customerId/agentType/price);
   413/400/422 validation; per-session + per-IP token buckets
   (lib/rate-limit.ts, in-memory, documented per-instance limitation +
   LAUNCH_CHECKLIST edge requirement); every AI failure → 503 with ONE
   fixed customer-safe sentence (provider internals never cross); GET
   history filters to user/assistant rows (system handoffs + tool rows
   never reach clients); rolling cookies preserved.
7. **AI Packaging Expert UI** — server-gated launcher (both flags + key or
   nothing renders) + client widget: history restore, quick prompts,
   loading/error/retry, escalation banner, "Configure this bag →"
   recommendation chip, aria-live log + labels + Escape, mobile layout,
   Hallmark Cobalt tokens. Mounted in app/layout.tsx.
8. **Events & metrics groundwork** — ai_chat_started / ai_message_sent
   (bounded props, never transcript content) / ai_product_recommended /
   human_handoff_requested; AiUsage rows carry conversationId+agentType →
   per-conversation cost is computable once ai-pricing is filled. No
   dashboard, no invented conversion attribution.
9. **Tests 198 → 252** (all green; zero credentials/network): concurrency
   (6), extraction evidence/adversarial/contradiction (13), agent
   end-to-end incl. injection red-team + loop limits + failure modes (19),
   chat route validation/gating/rate/leak checks (12), rate limiter (4);
   S04 toolset assertions updated for the two new tools.
10. **Optional live smoke** — `npm run ai:smoke` (scripts/ai-smoke-test.ts):
    skips cleanly without credentials; verifies all three configured model
    ids via the provider models API (404 ⇒ actionable error + account model
    list) before ONE real LOW_COST call; never part of npm test / build.
11. **Docs** — new docs/AI_SALES_AGENT.md (authoritative); AI_RUNTIME
    (concurrency RESOLVED, 8 tools, sales prompts), AI_AGENT_ARCHITECTURE
    (status, toolset, implemented conversation flow), ARCHITECTURE (S05
    layer + 3 decision-log entries), DATABASE_SCHEMA (locking + S05
    conversation semantics), BUSINESS_CONFIG_TODO (escalation delivery),
    LAUNCH_CHECKLIST (new AI section), README (ai:smoke), .env.example.

## Completed in Session 06 (2026-08-10) — AI Sales × Product Configurator

ONE shared authoritative configuration state — invariant 1 realized. The
known issue "six useState hooks local to ProductConfigurator" is RESOLVED.

1. **`lib/configuration/` domain layer** — validation.ts (pure, isomorphic:
   `defaultConfiguration` shared by UI+server, `applyConfigurationPatch`
   all-or-nothing partial patches with structured `PatchIssue[]`+available
   alternatives, `validateFullConfiguration`, `describeConfiguration`;
   below-MOQ + custom color stay LEGAL custom-quote states, matching the
   UI's historical behavior), store.ts (pure reducer: SET_* actions,
   LOAD_SERVER_CONFIGURATION with revision gate + field-level dirty merge
   so a customer's in-flight click never gets visually clobbered,
   SYNC_ACKNOWLEDGED value-compare, RESET), context.tsx (React provider:
   GET restore on mount, 700ms debounced POST persistence that never
   blocks clicks and silently retries, sync-bus subscription, flushSync
   before add-to-cart), sync-bus.ts (typed pub/sub bridging the layout-
   mounted chat and page-mounted configurator + presence registry).
2. **Server application path** — server.ts `resolveCurrentConfiguration` /
   `applyConfigurationPatchForSession` / `syncConfigurationForSession`
   over configuration-service's new `updateConfigurationChecked`
   (transaction + SELECT…FOR UPDATE + expectedRevision compare → stale
   writes return current state, never clobber) and
   `getLatestActiveConfiguration`. Prices via `sellPriceFor` — engine
   sell side only. CONFIGURATOR-rank need evidence on every apply
   (need-mapping.ts mirrors checkout's ORDER_DATA field mapping).
3. **`/api/configuration`** — POST {productId, config} (UI snapshot sync,
   deliberately last-write-wins) | {productId, patch, expectedRevision?}
   (tapped suggestion; full revalidation; 409 STALE_REVISION with current
   state; 422 UNSUPPORTED_OPTION with issues; 404 unknown product), GET
   restore (no session minting). Strict zod patch schema — price/artwork/
   admin keys are loud errors, not stripped.
4. **ProductConfigurator refactor** — six useState hooks → the shared
   store (UI-local state stays local: custom-qty echo, postal, shipping
   msg, added-flash); behavior + analytics byte-identical; adds session
   restore, AI-change highlight (~6s "Updated by Packaging Expert" badge
   + accent ring), sr-only aria-live announcements ("Packaging Expert
   updated quantity to 10,000."), flushSync on add-to-cart.
5. **Three configuration tools (registry 8→11)** — getCurrentConfiguration
   (READ; customer-visible view: labels, quantity, artwork status,
   revision, engine price, requiresCustomQuote; cost/margin/floor/source
   structurally excluded), updateConfiguration (CUSTOMER_WRITE; partial
   patch of the 5 option fields ONLY — no artwork/customDimensions/price
   inputs exist; applied|rejected(issues+alternatives)|stale_revision|
   unknown_product), suggestConfigurationUpdate (READ; validates+prices a
   hypothetical, writes nothing, returns label/patch/basedOnRevision/
   productPath/preview for the apply chip). Events:
   ai_configuration_updated/rejected/proposed (taxonomy +2).
6. **Agent + chat wiring** — sales context injects the live configuration
   ("Current configuration (live, revision N)… never ask them to repeat
   it"); SalesAgentResult + /api/ai/chat carry configurationUpdate
   (validated config+revision+changedFields+changeSummary+price) and
   suggestedActions; assistant rows stamp configSnapshotJson; prompt
   ai_sales_agent v1.1.0 (COMMIT vs PREVIEW: "make it 10,000" commits,
   "what would 10,000 cost?" prices only; small clear changes apply
   directly, substantial-cost changes preview+propose; never change
   unrequested fields; relay rejection alternatives; reconcile on
   stale_revision; artwork only via the uploader).
7. **Chat UI** — publishes server-validated updates on the sync bus (the
   configurator applies through the reducer), renders "✓ Configurator
   updated" chips (changeSummary + engine total + "(demo pricing)") and
   suggestion apply-chips (POST through /api/configuration; stale →
   honest "no longer matches" copy; off-page → link to configurator);
   mobile launcher bottom-24 + panel bottom-[9.5rem] when a configurator
   is mounted so the sticky Add-to-Cart CTA is never covered.
8. **Conversation outcomes (S03/S05 debt)** —
   `markConversationOutcomeForSession` stamps quote_started/
   checkout_started/purchased from the quote/checkout routes without
   ending conversations; purchased never downgrades; escalated preserved.
   Decided: quotes never point configurationId at the live row (it keeps
   mutating) — embedded payloads remain the quote truth.
9. **Tests 252 → 317** (all green; zero credentials/network):
   configuration-store (validation rules, reducer, stale-revision gate,
   field-merge race, artwork preservation), configuration-route (sync/
   patch/restore/cross-session isolation/CONFIGURATOR-vs-USER_STATED
   provenance/cart-consistency), ai-configuration-tools (all three tools,
   partial-patch preservation, structured rejections, stale protection,
   price/artwork injection red-team, event emission, provenance),
   ai-sales-agent "shared configuration flow" (commit/suggest/stale/
   red-team turns, context injection, configSnapshot), chat-route wire
   signals, conversation outcome stamping.
10. **Browser-verified (desktop + 375px mobile)** on `next dev` with a
    scripted localhost mock of the provider Messages API
    (ANTHROPIC_BASE_URL env; zero real credentials, zero app-code
    changes, .env.local removed after): flags-off manual flow + no
    launcher; "Make it 10,000 bags" → visible configurator update +
    badge/ring highlight + aria-live + $3,700.00 re-price; suggestion
    chip "Update to 25,000 bags · $8,250.00 (demo)" → tap → visible
    update to 25,000/$8,250; manual click → agent sees it next turn;
    reload restoration (incl. an S03-era row restored by cookie);
    cart line = shared state (Large·Black·No logo·10,000×$0.37=$3,700);
    provider-down → the one customer-safe sentence; mobile launcher/
    panel clear the sticky CTA.
11. **Docs** — new docs/AI_CONFIGURATOR_INTEGRATION.md (authoritative);
    ARCHITECTURE (S06 module row, invariant 1 "enforced since S06", 5
    decision-log entries), AI_SALES_AGENT (11 tools, v1.1.0 prompt, S06
    result/UI/outcomes, limitations updated), AI_AGENT_ARCHITECTURE
    (toolset ✅, flow + config sync), AI_RUNTIME (toolset table),
    DATABASE_SCHEMA (revision semantics, live writers, outcome stamping,
    configSnapshotJson, taxonomy +2), CURRENT_SYSTEM_AUDIT (risk 6 +
    REFACTOR item RESOLVED), BUSINESS_CONFIG_TODO (confirmation
    thresholds item). No schema/migration changes — S03's tables already
    carried version/source/configSnapshotJson.

## Completed in Session 07 (2026-08-11) — AI Sales × Cart / Checkout

The first full AI-assisted purchase path (§44), OFF by default; manual
commerce browser-verified byte-identical with every flag off.

1. **`lib/commerce/cart-line.ts`** — ONE server validation path behind
   every AI-path cart addition (tool commit AND chip tap): loads the
   AUTHORITATIVE shared configuration, verifies `expectedRevision` (S06
   guard extended to commerce), enforces manual-parity add rules (artwork
   required, custom-quote routing), re-prices with the engine, and treats
   `expectedTotalCents` as drift detection only → `repriced` with both
   totals (never a silent add at a changed price). The prepared line is
   byte-equivalent to a manual add (same config/optionSummary/engine
   prices — asserted in tests).
2. **`/api/cart/line`** — the chip-tap endpoint: STRICT body (injected
   price/config keys = loud 422), session-scoped, 200 prepared / 409
   REPRICED / 409 STALE_CONFIGURATION / 422 ARTWORK·QUOTE / 404; emits
   `ai_add_to_cart_requested{via:chip}` + stamps `cart_added`.
3. **Four commerce tools (registry 11→15; sales grants COMMERCE)** —
   addConfiguredProductToCart (explicit customer intent only; structured
   price_changed/stale/blocked outcomes), suggestAddToCart (no-write
   "Add to cart" button proposal), getCartSummary (engine-priced view of
   the client-reported cart; honest "unavailable" without a snapshot),
   startCheckout (EMPTY strict input; validates readiness and surfaces a
   customer-confirmed CONTINUE_TO_CHECKOUT action — with the mock
   provider a checkout IS an order, so tap-to-confirm is structural).
4. **Cart visibility** — chat POST gains a bounded STRICT **price-free**
   cart snapshot (ids/quantities/hasArtwork, ≤50 lines; client prices are
   a 422, never data); server-minted into ToolExecutionContext; context
   block renders the engine-priced cart ("Cart (N lines)…" /
   "Cart: empty."); MAX_CONTEXT_CHARS 2400→3200.
5. **Client execution through the manual paths** — validated `cartAdd`
   payloads apply via the SAME `useCart().addLine` the configurator uses
   (+ generic add_to_cart event with addedVia:"ai_chat"); NEW
   `lib/cart/checkout-client.ts` is the ONE client checkout submission
   (cart page refactored onto it); the chat's "Continue to checkout · $X"
   runs it, shows REPRICED as "Prices were updated … Confirm & continue
   at $Y" (cart corrected to server numbers, second explicit tap), and
   navigates only to the app's order page or the provider URL returned by
   `/api/checkout`. Chips: real buttons, loading/disabled states,
   role="status" announcements; mobile keeps the S06 offsets.
6. **Attribution & outcomes** — `lib/data/ai-assistance.ts` defines
   material assistance conservatively (sales conversation + ≥1 of
   ai_product_recommended / ai_configuration_updated /
   ai_add_to_cart_requested / ai_checkout_requested); order creation
   stamps `aiAssisted` + links `conversationId` (linked whenever a
   conversation exists; assisted only when material) and
   purchase_completed carries an aiAssisted prop. Conversation outcome
   `cart_added` added with funnel ranking (purchased > checkout_started >
   cart_added/quote_started); escalated preserved. Taxonomy +3:
   ai_add_to_cart_proposed / ai_add_to_cart_requested{via,outcome} /
   ai_checkout_requested{outcome}.
7. **Prompt `ai_sales_agent` v1.2.0** — cart & checkout contract:
   explicit-intent-only with counted examples AND non-examples ("looks
   good"/"how much" never add), read-then-add (revision + shown total),
   reprice → state new price + wait for confirmation, stale → reconcile,
   artwork/quote routing, "add it and take me to checkout" as dual
   intent, getCartSummary for cart questions (never guess), duplicate-add
   honesty, shipping/tax = "calculated at checkout" only.
8. **Security (structural, red-team-tested)** — no tool input carries a
   usable price/discount/config/artwork/URL (STRICT schemas →
   invalid_input); markOrderPaid/applyDiscount/capturePayment/
   createCheckout/setShippingCost/setTax don't exist (unknown_tool, zero
   side effects); "add this for $1" → server re-quote wins; checkout
   destinations are provider-generated only; purchase events fire ONLY at
   authoritative order creation (tested: none from AI actions).
9. **Tests 317 → 352** (all green; zero credentials/network):
   tests/cart-line.test.ts (prepare statuses, manual-equivalence,
   /api/cart/line contract + injection, outcome ranking, aiAssisted
   attribution + purchase-prop), tests/ai-cart-tools.test.ts (4 tools,
   permission tiers, injection red-team, §44 flow, weak-language no-op,
   ADD_TO_CART action lift, cart context injection, chat-route wire +
   strict snapshot); S04–S06 toolset/permission assertions updated.
10. **Browser-verified (desktop + 375px mobile)** on `next dev` with the
    S06-style scripted provider mock (ANTHROPIC_BASE_URL; no credentials,
    no app-code changes, .env.local removed after): "Make it 10,000 large
    black bags with no logo" → config sync; "Add it to my cart." →
    "✓ Added to your cart" chip (Large·Black·No logo·10,000×$0.37=
    $3,700.00 demo) + badge + identical cart-page line; "add at the old
    price" → price_changed relayed, nothing added; "Checkout please" →
    "Continue to checkout · $3,700.00 (demo)" → tap → order
    MOCK-MSPBCD9Q; tampered cart price → visible REPRICED confirm →
    corrected order; mobile flow no-overlap; provider-down single safe
    sentence with manual commerce intact; flags-off manual two-line order
    (AI line preserved beside manual line).
11. **Docs** — new docs/AI_COMMERCE_INTEGRATION.md (authoritative);
    ARCHITECTURE (S07 module row, invariant 2 extended, 4 decision-log
    entries), AI_SALES_AGENT (15 tools, v1.2.0, wire shape, S07 UI/
    metrics/limitations), AI_AGENT_ARCHITECTURE (toolset ✅, flow,
    red-team), AI_RUNTIME (toolset table), AI_CONFIGURATOR_INTEGRATION
    (S07 cross-ref), DATABASE_SCHEMA (taxonomy, outcomes, aiAssisted
    semantics), LAUNCH_CHECKLIST (+/api/cart/line edge limiting, S07
    boundary verification), prompts/00-INDEX statuses. No schema/migration
    changes — S03's orders.aiAssisted/conversationId columns were waiting.

## Completed in Session 08 (2026-08-12) — Customer Intelligence Engine

The first intelligence layer + the first admin surface. OBSERVE→CLASSIFY→
AGGREGATE→REPORT only; commerce verified untouched (all S02–S07 tests
green, no commerce file modified).

1. **Schema (migration `0002_customer_intelligence.sql`, additive)** —
   new `conversation_classifications` (one row per conversation: status
   classified|failed, classifierVersion, promptId/promptVersion/model,
   questions/objections/unsupportedRequests JSON with per-message
   evidence, userMessageCount, sourceUpdatedAt; UNIQUE(conversationId);
   CASCADE with its conversation so privacy deletion rides the S03.5
   cascade) + `product_opportunities` gains opportunityType/valueJson/
   periodStart/periodEnd.
2. **`modules/customer-intelligence/`** — deterministic authority with NO
   lib/ai import: taxonomy.ts (14 question themes, 12 objection types,
   request kinds, support verdicts, insight/opportunity types, outcome
   groups, CLASSIFIER_VERSION), catalog-support.ts (real-catalog matching;
   custom color/size/capacity/below-MOQ = custom_quote_path, never gaps;
   short option ids match whole words only), qualified.ts (THE deterministic
   denominator), period.ts ([start,end) windows, safePercentage/safeTrendPct
   — null under documented minimums), aggregate.ts (corpus load,
   conversation-level dedup with separate mention counts, three demand
   lanes, funnel from events+orders, segments, attribution [click ids
   never surfaced], descriptive associations), insights.ts +
   opportunities.ts (template-filled candidates from real counts; stable
   identityKey; dismissed/archived resurrect only on grown evidence;
   opportunities created `proposed` only, human decisions frozen),
   report.ts (everything the admin page renders + conservative
   lost-opportunity view).
3. **AI classification (`lib/ai/agents/customer-intelligence/`)** —
   classifier.ts: LOW_COST `generateStructuredObject` with closed-enum zod
   schema; labels pointing at messages we didn't send are DROPPED
   (logged); request phrases lowercased+deduped; prompt
   `ai_customer_intelligence_classifier` v1.0.0 (registry) with explicit
   question-vs-objection contract. process.ts: explicit idempotent
   batches (never page-load; cap 25) — reprocess only when version
   changed / new messages / previous failure; budget/provider/rate/timeout
   ⇒ abort batch leaving rows PENDING; invalid output ⇒ that row failed
   (errorCode), batch continues; flags-off/config ⇒ `unavailable`, zero
   writes. AiUsage stamped per call (agentType customer_intelligence).
4. **`lib/data/intelligence-service.ts`** — all intelligence DB access:
   corpus queries (conversations/messages/profiles/orders/configurations/
   sessions), GROUP BY event counts + FILTER order counts (::float8),
   classification upsert + needs-classification detection, and
   `resolveEvidenceRefs` (bounded excerpts; deleted rows counted as
   missing, never reconstructed). insight-service extended: getInsight/
   getOpportunity, updateInsightMetrics/updateOpportunityMetrics
   (regeneration paths; opportunity status/humanValidationRequired
   untouchable), INSIGHT_STATUSES +dismissed.
5. **Admin auth (FIRST admin surface; decision in ARCHITECTURE.md)** —
   HTTP Basic from `ADMIN_USER`/`ADMIN_PASSWORD`: `proxy.ts` (Next 16
   middleware) challenges /admin + /api/admin; `lib/admin/auth.ts`
   (edge-safe, constant-time compare) re-checked inside EVERY page and
   route; env unset ⇒ 404 everywhere (fail closed, tests included);
   /admin robots-disallowed, pages noindex.
6. **Admin UI + API** — `/admin/customer-intelligence`: period selector
   (7/30/90 + custom ?from/?to), classification status + "Process new
   conversations" button (the ONLY AI trigger), overview cards,
   AI-assisted funnel (session-distinct; purchases from the conservative
   order flag), questions/objections tables (counts, mentions,
   denominator-honest percentages, gated trends), three-lane demand,
   product gaps + custom-quote-path requests, conservative lost
   opportunities, opportunities + insights with status chips + evidence
   drill-down pages, segments/associations (sample-gated), honest empty
   states quoting real thresholds. API: POST process (runs classification
   batch, then deterministic insight+opportunity generation — works with
   AI unavailable), POST insights/[id]/status, POST
   opportunities/[id]/status (the only path to validated/rejected).
7. **Config** — `config/customer-intelligence.ts` (documented policy
   thresholds + VOLUME_GROUPS derived from the real 500 MOQ + presets);
   `.env.example` +AI_CUSTOMER_INTELLIGENCE_ENABLED +ADMIN_USER/
   ADMIN_PASSWORD; flag already existed (S04).
8. **Tests 352 → 415** (all green; zero credentials/network; fixtures
   test-only): taxonomy/catalog-support/qualified/period math (17),
   classifier + processing failure modes incl. fabricated-messageId drop,
   idempotency, budget/provider aborts, flags-off (10), aggregation —
   dedup(4 mentions=1 conversation), question-vs-objection fixtures
   (Restaurant B/D), period filtering, demand-lane separation, funnel,
   gated associations, trends, attribution without click ids, suppressed
   percentages (12), insights/opportunities — thresholds, identity dedup,
   dismissed suppression+resurrection, human-frozen statuses,
   evidence-vs-refs enforcement (10), privacy — cascade + missing-evidence
   honesty + bounded excerpts (4), admin — fail-closed auth, flag gating,
   graceful AI-less processing, status routes (10).
9. **Docs** — new docs/CUSTOMER_INTELLIGENCE.md (authoritative);
   ARCHITECTURE (admin-surface note, module map, 4 decision-log entries),
   DATABASE_SCHEMA (S08 writer + classification table + privacy note),
   AI_AGENT_ARCHITECTURE (agent #2 implemented), AI_RUNTIME (prompt),
   GUARDRAILS (CI autonomy row), AI_PLATFORM_ROADMAP (Stage D ✅),
   prompts/00-INDEX (08 ✅, 09 next), LAUNCH_CHECKLIST (admin section),
   BUSINESS_CONFIG_TODO (admin auth RESOLVED + CI thresholds), .env.example.

## Completed in Session 09 (2026-08-12) — Business Intelligence + CEO Recommendation Agent

The business-level intelligence layer + the second admin surface.
MEASURE→SYNTHESIZE→EXPLAIN→RECOMMEND only; storefront/commerce verified
untouched (all S02–S08 tests green, no commerce file modified).

1. **Schema (migration `0003_business_intelligence.sql`, additive)** —
   new `ceo_reports` (one append-only row per explicit generation run:
   periodStart/End/Days, promptId+version, model, provider, snapshotJson
   [the exact deterministic snapshot the model saw], reviewJson
   [server-validated output], decisionIdsJson). Decision documented: a
   dedicated table, NOT AgentDecision — a review is a versioned document;
   recommendations are individual decision rows.
2. **`modules/business-intelligence/`** — deterministic authority with NO
   lib/ai import: availability.ts (Metric<T> AVAILABLE/PARTIAL/UNAVAILABLE
   + denominator-honest ratio; metricValue() returns null, never 0),
   trend.ts (explicit states, MIN_TREND_BASE gate), revenue.ts (orders
   table = truth; multi-line dedup; cancelled/refunded excluded+reported;
   single-currency headline rule), funnel.ts (distinct sessions/stage +
   4 documented-denominator rates; purchases from orders), ai-metrics.ts
   (S07-conservative AI sales + spend by provider/model/agent; unpriced
   calls → PARTIAL/UNAVAILABLE, never $0; cost-per metrics inherit
   availability), profitability.ts (order-level reconstruction via the
   S02 cost model; gross vs contribution-BEFORE-paid-media precisely
   named; per-ORDER payment fee; isCostModelFullyConfigured static
   check), products.ts (per-product performance + GROSS-only profit —
   fee allocation would be invented), segments.ts (businessType only),
   attribution.ts (first/last touch, campaign, landing page; click ids
   never surfaced; adSpendIntegrated:false — no CAC/ROAS), snapshot.ts
   (BusinessHealthSnapshot + 7 deterministic data-quality warning codes),
   report.ts (dashboard assembly; CEO narrative = persisted report only,
   with staleness note).
3. **CEO agent (`lib/ai/agents/ceo/`)** — schema.ts (zod review schema;
   controlled confidence/risk/category enums; ordinal confidence encoding
   documented as sort-key-only), context.ts (bounded PII-free snapshot
   rendering that BUILDS the validMetricRefs/validEvidenceRefs whitelists
   from exactly what it prints), agent.ts (flags→snapshot→context→ONE
   REASONING structured call→server-side ref validation [invalid refs
   filtered; ref-less recommendations dropped+logged]→AgentDecision
   persistence with identity dedup→ceo_reports row; budget/provider
   failures return failed/unavailable and persist NOTHING). Prompt
   `ai_ceo_business_review` v1.0.0 registered (numbers-only-from-context,
   availability respect, observational language, ref-copying contract,
   recommendation-only stance). agent-service gained
   `updateDecisionRecommendation` (pending+unexecuted rows only).
4. **Admin** — `/admin/business-intelligence` (S08 auth + flag,
   fail-closed 404; periods 1/7/30/90 + custom; owner-friendly metric
   cards with reasons as hints — "Unavailable — configure manufacturing
   costs", never $0; funnel/AI/profitability/signals/trends/products/
   segments/attribution sections; CEO review renders the persisted
   report + "Generate your first CEO Review" empty state) + POST
   `/api/admin/business-intelligence/ceo-review` (strict body; 404/401/
   413/400/422; AI failures → honest 503 while deterministic metrics
   stay up). New flag `AI_BUSINESS_INTELLIGENCE` (+ .env.example).
5. **Config** — `config/business-intelligence.ts` (documented policy
   thresholds: %≥5 denominator, trend≥5 base, segment≥5, ≤10
   recommendations/review, context ≤16k chars, 5k row bounds).
6. **Tests 415 → 451** (all green; zero credentials/network;
   FakeAiProvider only): availability/ratio/trend semantics, revenue
   (multi-line dedup, mixed-currency unavailability, cancelled exclusion,
   0-orders AOV honesty), funnel denominators, segments, attribution
   (click-id absence), snapshot assembly + data-quality codes, §46
   cost-config suite (all-null ⇒ revenue AVAILABLE + every profit metric
   UNAVAILABLE with reasons and NO value property; test-only configured
   model ⇒ exact gross/contribution math incl. one-fee-per-order and
   PARTIAL mixed coverage; production placeholders untouched), AI cost
   availability tiers, CEO agent (report+decision persistence, no-tools
   structural check, fabricated-ref dropping, dedup update-in-place,
   human-verdict freezing, budget/provider fail-safety with prior report
   surviving, flags-off unavailability, PII-free context against seeded
   email/name/artwork/message content), admin route gates + strict
   validation + deterministic-report-without-AI.
7. **Docs** — new docs/BUSINESS_INTELLIGENCE.md (authoritative);
   ARCHITECTURE (module rows + 3 decision-log entries), DATABASE_SCHEMA
   (ceo_reports + service table), AI_AGENT_ARCHITECTURE (agent #7
   implemented), AI_RUNTIME (prompt), GUARDRAILS (CEO autonomy row),
   AI_PLATFORM_ROADMAP (Stage E core ✅, Action Center → S10),
   prompts/00-INDEX (09 ✅, 10 next), LAUNCH_CHECKLIST (+BI section),
   BUSINESS_CONFIG_TODO (launch-vs-profit-intelligence cost split + BI
   section), .env.example.

## Completed in Session 10 (2026-08-12) — Guardrail Engine + AI Action Center

The system-wide safety/approval layer. Recommendation → structured action
→ deterministic evaluation → risk → human approve/reject/modify →
approved-action record. **Execution stays deferred: no executor exists.**
Storefront/commerce verified untouched (every S02–S09 test green; no
commerce file modified).

1. **Schema (migration `0004_guardrails_action_center.sql`, additive)** —
   `agent_actions` (source, decision link, closed actionType, validated
   payload, revision/originActionId/supersededByActionId lineage, status
   ⟂ executionStatus, policy risk + modelSuggestedRisk metadata,
   server-derived reviewedBy/reviewedAt/reviewNotes, stateVersion,
   partial unique index `(source_decision_id) WHERE origin_action_id IS
   NULL` = sync idempotency at the DB level), append-only
   `guardrail_evaluations` (policy version, applied autonomy mode,
   allowed/executionEligible/approvalRequired, violated rules, missing
   config, limits snapshot) and append-only `agent_action_events`;
   `approvals` gained a nullable `action_id` so the S03/S09 decision-level
   approval spine records WHICH revision the human reviewed (no second
   approval model).
2. **`modules/guardrails/`** — the deterministic authority, no `lib/ai`
   and no `db/` import: types.ts (sources/modes/risk/rule severity/
   execution states/GuardrailDecision), actions.ts (20-type closed
   registry with strict per-type schemas, base risk, execution support,
   required limits, source→type permissions), evaluate.ts (the pure
   evaluator), executors.ts (EMPTY registry + the documented future
   executor contract), decision-mapping.ts (CEO category → review type,
   uncategorized ⇒ null).
3. **`config/guardrails.ts`** — `GUARDRAIL_POLICY_VERSION`, 10 `null`
   `[TO BE PROVIDED]` limits, per-agent `{defaultMode, maxMode}` (all
   business agents capped at RECOMMEND), EMPTY
   `GUARDED_AUTO_ALLOWED_ACTION_TYPES`, `MAX_UNATTENDED_RISK_LEVEL=MEDIUM`.
   Margin floors are NOT duplicated — `config/costs.ts → marginPolicy`
   stays the single home and the engine calls the same
   `evaluatePriceFloor`.
4. **`lib/data/agent-action-service.ts`** — proposeAction (evaluates and
   stores, blocked included), reviewAction and modifyAction (transaction +
   `SELECT … FOR UPDATE` + `stateVersion` check ⇒ 409 on double-click or
   stale reviewer), syncDecisionsToActions (deterministic, idempotent, no
   model call), plus reads for the admin surface.
   `lib/data/action-evidence.ts` resolves evidence refs against real
   insight/opportunity rows; unresolved refs are reported, never
   reconstructed.
5. **Admin** — `/admin/ai-actions` + `/admin/ai-actions/[id]` (S08 auth +
   `AI_ACTION_CENTER` flag, fail-closed 404) and POST
   `/api/admin/ai-actions/sync|[id]/review|[id]/modify` behind
   `lib/admin/write-guard.ts` (POST + auth + same-origin Origin/Referer +
   `application/json` + bounded body + strict schema — the CSRF answer to
   browser-auto-sent Basic credentials). `lib/admin/auth.ts` gained
   `adminIdentity()`: server-derived `reviewedBy`, never client-supplied.
   BI page links through to the Action Center when the flag is on.
6. **Tests 451 → 512** (all green; zero credentials/network/AI provider):
   guardrails-engine (fail-closed matrix, determinism, limits snapshot,
   autonomy clamping, source permissions, policy-vs-model risk, missing
   config, price-floor fail-closed, empty executor registry, null-limit
   assertion, no-lib/ai structural check, CEO category coverage),
   ai-actions-workflow (propose/blocked/OBSERVE/clamped, CEO sync
   idempotency, approve/reject + decision mirroring, double-click and
   stale-reviewer conflicts, modification lineage + re-evaluation +
   invented-evidence refusal, evidence resolution), ai-actions-admin
   (404/401/flag gates, cross-origin 403, form-post 415, no-Origin 403,
   strict bodies, red team: reviewedBy/riskLevel/approvalStatus/
   executionStatus rejection, server-recomputed risk, 409 staleness,
   approval ≠ execution, blocked action unapprovable),
   guardrails-separation (15 sales tools unchanged, no commerce/sales file
   imports the guardrail layer, no mutation/network call anywhere in it,
   CEO agent still tool-free and cannot approve).
7. **Docs** — docs/GUARDRAILS.md rewritten as the IMPLEMENTED spec; new
   docs/AI_ACTION_CENTER.md (authoritative); ARCHITECTURE (module map +
   admin note + 5 decision-log entries), DATABASE_SCHEMA (three tables +
   services), AI_AGENT_ARCHITECTURE (autonomy clamping + CEO approval
   path + tool separation), AI_PLATFORM_ROADMAP (Stage E complete),
   prompts/00-INDEX (10 ✅, 11 next), LAUNCH_CHECKLIST (+Action Center
   section), BUSINESS_CONFIG_TODO (+Guardrail limits, split into
   currently-required vs required-before-GUARDED_AUTO), .env.example.

## Completed in Session 11 (2026-08-12) — Experiment Engine + CRO Agent

Observation → hypothesis → proposal → guardrail → human approval → explicit
human launch → assignment → deterministic measurement → result. **The AI
proposes and explains; software decides.** Storefront/commerce verified
untouched (every S02–S10 test green; no commerce file modified).

1. **`modules/experiments/`** — the deterministic authority (no `lib/ai`, no
   `db/`): types.ts (8 experiment types + 2 named-as-unsupported deferred
   ones, 7 result states, closed primary/secondary/guardrail metric lists,
   protected surfaces), variants.ts (`safeText` + 3 strict variant schemas),
   targets.ts (the CLOSED 3-target registry), allocation.ts, assignment.ts
   (pure FNV-1a), eligibility.ts (ambiguity never enrols; admin/bot
   excluded), statistics.ts (two-proportion z-test + documented assumptions
   and limitations), results.ts (states + minimum-sample gate),
   proposal.ts (THE shared design schema), lifecycle.ts.
2. **`config/experiments.ts`** — processing policy (minimum sample 1,000/arm
   as a documented DEVELOPMENT default, α=0.05, min 5 per cell, MVP 2 arms)
   + `resolveTrafficCap()`: owner limit → non-production-only 50% ceiling →
   BLOCKED in production naming `config/guardrails.ts →
   GUARDRAIL_LIMITS.maximumExperimentTrafficPct`. Never 100%.
3. **Schema (migration `0005_experiment_engine.sql`, additive)** —
   `experiments` gains experimentType/targetKey/variantKey/targetVersion/
   audienceJson/secondaryMetricsJson/assignmentSalt/policyVersion+snapshot/
   sourceDecisionId+sourceActionId/createdBy/launched*/stopped*/archivedAt/
   stateVersion + `UNIQUE(target_key) WHERE status='running'` and
   `UNIQUE(source_action_id)`; `experiment_assignments` gains `exposed_at`;
   new append-only `experiment_events`. Two S03 semantics pinned down (the
   table had no runtime, so no data migrated): `controlJson` = launch-time
   control SNAPSHOT, `trafficSplitJson` = whole percents totalling 100.
4. **Runtime** — `lib/experiments/server.ts` (server-side resolution +
   sticky assignment + once-per-session exposure + `experiment_exposed`
   event; reads NOTHING while the flag is off; degrades to control on any
   error), `lib/experiments/readout.ts`, `lib/experiments/materialize.ts`
   (approved proposal → DRAFT, re-validated against the CURRENT registry and
   cap, idempotent), `lib/data/experiment-service.ts` (row-locked
   `stateVersion` transitions, idempotent launch/stop, DB-level overlap
   rule), `lib/data/experiment-metrics-service.ts` (post-exposure-only,
   once-per-session conversions), `modules/business-intelligence/dropoff.ts`.
5. **Storefront integration (narrow, 3 targets)** — `ProductConfigurator`
   accepts `experiments` (shipping message + CTA label/helper; defaults null
   ⇒ the pre-S11 UI byte-for-byte), and the homepage hero reads an optional
   headline/sub/CTA override. Nothing about pricing, validation, cart
   payloads or button behaviour is experimentable.
6. **CRO agent** — `lib/ai/agents/cro/{schema,context,agent}.ts` + prompt
   `ai_cro_experiment_review` v1.0.0. RECOMMEND, no tools, one structured
   call; server-side validation drops unknown targets, mismatched types,
   markup/unknown-key variant configs and fabricated references, and derives
   audience/allocation/sample-floor itself. kind=REVIEW keeps business
   problems out of objection-hiding copy tests.
7. **Guardrails/Action Center integration** — `GUARDRAIL_POLICY_VERSION` →
   `2026-08-12.s11.1`; `CRO_EXPERIMENT_PROPOSAL` gained a nullable
   registry-validated `design`; `CRO_EXPERIMENT_LAUNCH` gained a nullable
   `experimentId` (still NOT_IMPLEMENTED); `CRO_AGENT` default autonomy
   OBSERVE → RECOMMEND (ceiling unchanged, allow-list still empty);
   `mapCroDecisionToAction` + `mapAgentDecisionToAction`;
   `syncDecisionsToActions` now covers ceo AND cro decisions.
8. **Admin** — `/admin/experiments` + `/[id]` and POST
   `/api/admin/experiments/{create,materialize,cro-review,[id]/launch,
   [id]/stop,[id]/archive}` behind the S08 auth + `EXPERIMENT_ENGINE` and
   `lib/admin/write-guard.ts`. Actors are server-derived; a client sending a
   status, an actor or a traffic number gets 422.
9. **Tests 521 → 661** (all green; zero credentials/network/AI provider):
   experiments-engine (variant markup rejection, closed registry, allocation
   + cap, assignment determinism/independence/distribution, eligibility
   ambiguity, z-test fixtures incl. 1000/50 vs 1000/80 and 100/5 vs 100/7,
   all 7 result states, zero baseline, design validation, lifecycle),
   experiments-runtime (draft creation, launch idempotency + policy
   snapshot + stale CONFLICT + TARGET_BUSY + parallel targets, stop
   idempotency/preservation/return-to-control, flag-off = no writes, no
   session / bot / admin exclusion, stickiness + single exposure event,
   assignment vs exposure counts, post-exposure-only metrics, deterministic
   readout, INVALID on registry drift), experiments-admin (404/401/flag
   gates, cross-origin 403, no-Origin 403, form-post 415, strict bodies,
   launch/stop through the routes, materialize idempotency + approval gate),
   cro-agent (context whitelists + no PII, structured call with no tools,
   fabricated-ref drop, unknown target drop, markup drop, traffic clamp,
   sample floor, REVIEW routing, price-experiment refusal, dedup + frozen
   verdicts, Action Center mapping, provider/budget/flag failure = nothing
   persisted), experiments-separation (no lib/ai or db in
   modules/experiments, no clock/randomness in assignment or statistics,
   CRO cannot launch/stop/assign/approve, commerce untouched, no
   price/checkout target, executor registry still empty, launchExperiment
   called only from the admin route).
10. **Docs** — new docs/EXPERIMENTATION.md + docs/CRO_AGENT.md; updated
    ARCHITECTURE (module map + 6 decision-log entries), DATABASE_SCHEMA
    (experiments section rewritten + experiment_events), AI_AGENT_ARCHITECTURE
    (CRO agent spec = IMPLEMENTED), GUARDRAILS (S11 additions),
    AI_ACTION_CENTER (CRO decisions), BUSINESS_INTELLIGENCE (drop-off),
    AI_PLATFORM_ROADMAP (Stage F complete), prompts/00-INDEX (11 ✅, 12
    next), LAUNCH_CHECKLIST (+Experiments section), BUSINESS_CONFIG_TODO
    (+Experimentation), .env.example.

## Completed in Session 12 (2026-08-15) — Pricing Intelligence Agent

PRICING DATA → DETERMINISTIC ANALYSIS → SIGNALS → AI INTERPRETATION →
RECOMMENDATION → GUARDRAILS → ACTION CENTER → HUMAN. **The agent explains
pricing; the engine still owns it.** Storefront/commerce verified untouched
(every S02–S11 test green; no commerce, cart, checkout, configuration or
`modules/pricing` file modified; product page prices byte-identical).

1. **`modules/pricing-intelligence/`** — the deterministic authority (no
   `lib/ai`, no price mutation): types.ts (signal kinds, strengths, evidence
   kinds, readiness, the elasticity refusal type), tiers.ts (catalog-derived
   bands + buckets), funnel.ts (co-occurrence + real ordering + PRICE/MOQ
   question-vs-objection counts), demand.ts (three lanes, provenance-split),
   tier-performance.ts (per-band, checkout `null`, conversation attribution),
   realization.ts (engine re-quote + repricing NOT INSTRUMENTED),
   moq.ts, products.ts (margin UNAVAILABLE, revenue ≠ profit), breakdowns.ts
   (segments/attribution/AI-sales — descriptive only), signals.ts (the
   explicit-evidence rule + strength rules), readiness.ts (cost/limit
   readiness, `assessElasticity`, `PricingReadiness`), snapshot.ts, report.ts.
2. **`config/pricing-intelligence.ts`** — documented thresholds (% ≥5
   denominator, signal ≥3 explicit conversations, MEDIUM ≥5, HIGH ≥10 with ≥2
   evidence types, behavioural observation ≥20 price-view sessions) + the
   CLOSED 6-type recommendation taxonomy and its review-only action mapping.
3. **Schema (migration `0006_pricing_intelligence.sql`, additive)** — ONE new
   table `pricing_reports`, mirroring `ceo_reports`. **No table stores a
   price**; every other pricing number is read from existing rows.
4. **Data access** — `lib/data/pricing-intelligence-service.ts` (session and
   product event facts with min/max `occurred_at`, quantity-bearing events,
   priced order lines) + `lib/data/pricing-report-service.ts`. The S08 reads
   are reused, not duplicated.
5. **Pricing Agent** — `lib/ai/agents/pricing/{schema,context,agent}.ts` +
   prompt `ai_pricing_intelligence_review` v1.0.0. No tools, one structured
   call, a schema with no price field, server-validated refs and scope, and
   server-recomputed prerequisites. Provider/budget failure persists NOTHING.
6. **Guardrails / Action Center** — `GUARDRAIL_POLICY_VERSION` →
   `2026-08-15.s12.1`; `PRICING_AGENT` default OBSERVE → RECOMMEND;
   `+DATA_QUALITY_REVIEW` permission (review-only, justified);
   `mapPricingDecisionToAction` + `PRICING_RECOMMENDATION_TO_ACTION_TYPE`;
   `syncDecisionsToActions` covers ceo/cro/pricing.
7. **Admin** — `/admin/pricing-intelligence` (overview, funnel, three lanes,
   tier table, friction, other observations, MOQ, cost/margin readiness,
   readiness classes, price sensitivity, trends, review, data quality) + POST
   `/api/admin/pricing-intelligence/pricing-review` behind the S08 auth, the
   new `PRICING_INTELLIGENCE` flag and `lib/admin/write-guard.ts`.
8. **Tests 661 → 763** (all green; zero credentials/network/real model):
   pricing-intelligence-metrics (41 — catalog-derived bands, funnel
   co-occurrence + ordering + suppression, question≠objection for PRICE and
   MOQ, three-lane separation + provenance exclusion, multi-line orders,
   cancelled exclusion, checkout-unavailable, band attribution, realization +
   repricing, MOQ, the non-purchase-is-not-friction rule, strength grading,
   product-gap routing, null-cost/limit availability, elasticity refusal,
   readiness, snapshot assembly + trend states + PII-freedom, segment gating),
   pricing-agent (22 — context whitelists, one no-tools call, fabricated
   metric/evidence/signal drops, unknown product and tier removal,
   prerequisite override, price-unrepresentable, closed-enum rejection,
   limitation requirement, dedup + frozen verdicts, Action Center mapping,
   provider/flag/budget failure), pricing-intelligence-admin (11 — fail-closed
   auth, both flag gates, cross-origin 403, no-Origin 403, form-post 415,
   strict bodies, deterministic report without AI, honest 503),
   pricing-intelligence-separation (28 — no lib/ai, no mutation, no optimal
   price, no elasticity coefficient, no personalized pricing, no tools,
   schema key set, closed taxonomy, mapping-table agreement, commerce
   untouched, costs and limits still null, empty executor registry,
   HUMAN_ADMIN price change still floor-blocked, no price experiment target,
   ethical-boundary scan).
9. **Docs** — new docs/PRICING_INTELLIGENCE.md (authoritative); updated
   ARCHITECTURE (module row + admin row + 6 decision-log entries),
   DATABASE_SCHEMA (`pricing_reports` + the "no table stores a price" note),
   AI_AGENT_ARCHITECTURE (agent #4 = IMPLEMENTED), AI_RUNTIME (prompt),
   GUARDRAILS (Session 12 additions + autonomy table + flags),
   AI_ACTION_CENTER (pricing decisions), BUSINESS_INTELLIGENCE (sibling
   layer), EXPERIMENTATION (§24 why price experiments are different),
   AI_PLATFORM_ROADMAP (Stage G ✅ with the honest caveats),
   prompts/00-INDEX (12 ✅, 13 next), LAUNCH_CHECKLIST (+pricing section),
   BUSINESS_CONFIG_TODO (three-way cost split + a pricing section),
   .env.example.

## Completed in Session 13 (2026-08-15) — Google Ads Read-Only Intelligence

READ → INGEST → RECONCILE → MEASURE → INTERPRET. Never MUTATE → OPTIMIZE →
EXECUTE. Storefront/commerce verified untouched (every S02–S12 test green;
no commerce, cart, checkout, configuration or `modules/pricing` file
modified; product page prices byte-identical; a test asserts Google Ads code
appears under `/admin` only).

1. **`lib/google-ads/`** — the READ-ONLY adapter: `auth.ts` (5 required env
   vars + optional manager id + optional version pin; OAuth refresh with a
   module-private token cache), `client.ts` (ONE literal `:search` endpoint,
   pagination, 10 normalized error codes, request-id preserved, bodies
   discarded), `queries.ts` (the CLOSED query set + `YYYY-MM-DD` validation
   as the injection guard), `reporting-provider.ts` (three read methods,
   live + fake), `sync.ts` (idempotent explicit sync + connection test),
   `errors.ts` (redaction), `credential-snapshot.ts` (the non-secret bridge
   to the deterministic module).
2. **`modules/google-ads-intelligence/`** — the deterministic authority (no
   `lib/ai`, no `lib/google-ads`, no `fetch`): types, dates, connection,
   native, attribution, firstparty, efficiency, discrepancy, campaigns,
   signals, spend, snapshot, report.
3. **`config/google-ads.ts`** — API version + supported list, sync/quota
   bounds, freshness thresholds, reporting minimums, the CLOSED 7-type
   recommendation taxonomy and its review-only mapping, and the
   `SEARCH_TERMS_INGESTED`/`KEYWORDS_INGESTED` `false` constants that make a
   deferral a declaration rather than an empty table.
4. **Schema (migration `0007_google_ads_intelligence.sql`, additive)** —
   `ad_accounts` (currency + time zone, never assumed),
   `ad_campaign_daily_metrics` (`UNIQUE(account, campaign, date)`),
   `google_ads_sync_runs` (append-only audit, redacted messages),
   `google_ads_reports`. **No table stores a credential.**
5. **Google Ads Agent** — `lib/ai/agents/google-ads/{schema,context,agent}.ts`
   + prompt `ai_google_ads_review` v1.0.0. No tools, no Google access, one
   structured call, a schema with no budget/status/bid/keyword/ad field,
   server-validated refs and campaign scope.
6. **Guardrails / Action Center** — `GUARDRAIL_POLICY_VERSION` →
   `2026-08-15.s13.1`; `GOOGLE_ADS_AGENT` default OBSERVE → RECOMMEND;
   `+DATA_QUALITY_REVIEW` permission; `mapGoogleAdsDecisionToAction` +
   `GOOGLE_ADS_RECOMMENDATION_TO_ACTION_TYPE`; `syncDecisionsToActions`
   covers ceo/cro/pricing/google_ads. The four executable ad types stay
   registered, unmapped, executor-less and limit-blocked.
7. **Business Intelligence** — a SEPARATE `adSpend` section on
   `BusinessHealthSnapshot` + two citable CEO metric refs. S09 semantics
   unchanged; `attribution.adSpendIntegrated` stays `false`.
8. **Admin** — `/admin/google-ads-intelligence` (connection & sync, both
   lenses, funnel, campaigns, coverage, discrepancy, customer signals,
   trends, review, data quality, sync history) + three write-guarded routes.
9. **Tests 763 → 966** (203 new; all green; zero credentials, zero network, zero
   real model): google-ads-adapter (47 — credential status without values,
   API-version refusal + the no-scattered-literal scan, micros rounding,
   response normalization + dropped rows, account-calendar dates and DST,
   the closed query set + injection refusal, the `:search`-only endpoint,
   headers, pagination, all 9 error classes, OAuth-failure redaction),
   google-ads-sync (20 — first sync, idempotency, restatement, per-campaign/
   per-day rows, window filtering, failed-sync isolation, PARTIAL, oversized
   range refused before quota, all five freshness states, connection test),
   google-ads-metrics (49 — native aggregation, null-never-zero rates,
   mixed-currency null, paid-traffic identification, EXACT/MAPPED/no-fuzzy/
   ambiguous matching, first-party counting + cancelled exclusion + unmatched
   revenue, CAC/ROAS with denominators, PARTIAL on low coverage, the currency
   gate, **the six §64 semantic-boundary assertions**, credentials-removed-
   with-data, discrepancy, snapshot PII-freedom, BI ad-spend availability),
   google-ads-readonly (33 — no mutate service, no mutation writer, no
   generic request(), exactly one `:search` endpoint, SELECT-only GAQL, the
   three-method interface, analytics/agent cannot reach the adapter, no
   blended CAC, no profiling, no tools, the schema key set, the closed
   taxonomy, mapping-table agreement, empty executor registry, HUMAN_ADMIN
   budget change still blocked, commerce untouched, admin-only surface, and
   the suite's own offline guarantees), google-ads-agent (22), google-ads-admin
   (32 — fail-closed auth, both flag gates, cross-origin 403, no-Origin 403,
   form-post 415, GET 403, strict bodies, the client cannot name the account,
   honest NOT_CONFIGURED/NOT_CONNECTED, 503 without AI).
10. **Browser-verified** on `next dev` (desktop + 375px mobile): the honest
    NOT_CONNECTED state with every figure absent rather than zero; both
    buttons returning their honest messages; then — with the DEV database
    seeded through the REAL sync path using `FakeGoogleAdsReportingProvider`
    (no credential, no network) — campaign metrics rendering with Google's
    and BagDirect's numbers visibly distinct, match quality per campaign, the
    discrepancy view, coverage, the account-timezone note, and sync history.
    That pass caught a real inconsistency (credentials removed while data
    remains showed "Unavailable" cards above a populated campaign table),
    which was FIXED and locked in with a regression test. Storefront
    unaffected; no console errors; no horizontal overflow; tables scroll
    inside their own containers. Seed data removed afterwards.
11. **Docs** — new docs/GOOGLE_ADS_INTELLIGENCE.md (authoritative); updated
    ARCHITECTURE (module row + 6 decision-log entries), DATABASE_SCHEMA (the
    four tables + the no-credential and no-orders-column notes),
    AI_AGENT_ARCHITECTURE (agent #5 = IMPLEMENTED, read-only), AI_RUNTIME
    (prompt), GUARDRAILS (Session 13 additions), AI_ACTION_CENTER (Google Ads
    decisions), BUSINESS_INTELLIGENCE (the ad-spend section + why S09 did not
    change), AI_PLATFORM_ROADMAP (Stage H1 ✅, H2 next), prompts/00-INDEX
    (13 ✅), LAUNCH_CHECKLIST (+Google Ads section), BUSINESS_CONFIG_TODO
    (connect / useful / still-unavailable split), .env.example.

## Completed in Session 13.5 (2026-08-16) — Business Cost Model + Margin Policy

SELL PRICE → DETERMINISTIC COST MODEL → GROSS PROFIT → VARIABLE SELLING COSTS
→ CONTRIBUTION PROFIT BEFORE PAID MEDIA → ATTRIBUTED AD SPEND → CONTRIBUTION
PROFIT AFTER PAID MEDIA. **The model is complete; the numbers are still the
owner's to supply.** Storefront/commerce verified untouched (every S02–S13
test green; product page prices byte-identical; a real checkout completed in
the browser with every cost `null`).

### Audit verdict on the existing model

- **KEEP** — the S02 cost-model kernel: integer cents + bps, the
  missing-input collector, `productCostCents`, the `minimumAllowedPriceCents`
  derivations, `evaluatePriceFloor`'s fail-closed posture, S09's `Metric<T>`
  availability model, and the guardrail engine already reading
  `config/costs.ts → marginPolicy` rather than duplicating it.
- **EXTEND** — cost scopes (per-unit / per-line / per-order), optional factory
  quantity tiers, order packaging + fulfilment handling, shipping SUBSIDY
  semantics, `targetGrossMarginBps`, a cost-model version stamp.
- **REPLACE** — only the ambiguity: freight was subtracted as a raw cost with
  no notion of what the customer pays, and one status covered both profit
  levels.
- **DEFER** — refunds, discounts (structurally absent), overhead/salaries/
  tax, freight rate shopping, FX, negotiated quote economics, printing SIDES
  (the configurator has no side selector — modelling one would invent a
  manufacturing capability).

1. **`modules/pricing/cost-model.ts` (extended)** — three cost scopes;
   `ManufacturingTier[]` OPTIONAL (key absent ⇒ base applies everywhere; key
   present ⇒ authoritative, and below the first tier is a MISSING input, never
   a silent fallback — and factory breaks are never assumed to match the
   storefront's sell tiers); `OrderCostConfig` (`packagingCentsPerOrder` =
   COGS, `handlingCentsPerOrder` = variable selling cost);
   `CustomerShippingChargeBasis` (`not_collected` / `flat_per_order` /
   `unavailable`); `paymentFeeCents()` (round half-up ONCE per order + ONE
   fixed fee); `computeShippingEconomics()` (subsidy ≥ 0, shipping margin
   preserved separately and never folded into contribution);
   `evaluateMarginAgainstPolicy()` (5 states, minimum ≠ target);
   `computeLineCosts()` carrying `shippingScope` so order assembly can
   deduplicate per-order freight.
2. **`modules/pricing/unit-economics.ts` (new)** — `computeOrderUnitEconomics`
   assembles the ladder for a whole order: order-level costs applied exactly
   once, `per_order` freight deduplicated per product, per-level availability
   (`grossStatus` / `contributionStatus`), integer-bps margins that are `null`
   on zero revenue, per-line GROSS economics and **no per-line contribution
   field at all** (§31 — no allocation rule exists, so none is invented).
   `computePaidMediaEconomics` produces POAS and post-ad contribution.
3. **`modules/pricing/snapshot.ts` (new)** — `captureOrderCostSnapshot` /
   `economicsFromSnapshot` / `HISTORICAL_COST_UNAVAILABLE`. Forward only,
   best-effort, version-stamped.
4. **`modules/pricing/validate.ts` (new)** — `validateCostModel` with ERROR vs
   WARNING. `null` is never an error; a present-and-wrong value always is, and
   is never repaired into something plausible.
5. **`modules/pricing/readiness.ts` (new)** — `assessCostReadiness`
   (16 categories × 4 capabilities) and `isCostModelConfigured`, THE single
   completeness definition that S09's `isCostModelFullyConfigured` and S12's
   `assessCostReadiness` both now delegate to.
6. **`config/costs.ts`** — `COST_MODEL_VERSION`, `orderCosts`,
   `shippingPolicy`, `targetGrossMarginBps`. **Every business value is still
   `null`**, and `tests/unit-economics-separation.test.ts` scans the file for
   any numeric literal so no average can be slipped in.
7. **Schema (migration `0008_order_cost_snapshots.sql`, additive)** —
   `orders.cost_model_version`, `orders.cost_snapshot_json`,
   `order_lines.cost_snapshot_json`. `createOrder` captures best-effort and
   swallows failures; with costs unconfigured it writes nothing and the order
   is unaffected.
8. **Business Intelligence** — `profitability.ts` rebuilt on the unit-economics
   model with `historicalCostBasis` (`SNAPSHOT_ONLY` default /
   `CURRENT_CONFIG_SCENARIO` labelled), separate gross/contribution coverage,
   and `ordersWithoutCostSnapshot` / `ordersWithoutContribution` surfaced.
   `products.ts` costs lines from their own snapshots. S09 availability
   semantics unchanged.
9. **Pricing Intelligence** — readiness extended for the new inputs and the
   completeness verdict delegated; `SPECIFIC_PRICE_CHANGE` still BLOCKED,
   `AUTOMATED_PRICE_CHANGE` still NOT_SUPPORTED, the Pricing Agent's schema
   still cannot express a price.
10. **Google Ads Intelligence** — real POAS: `AdEfficiency` gained
    `contributionBeforePaidMediaCents`, `profitOnAdSpend` and
    `postAdContributionCents`; `GoogleAdsFunnel`/`CampaignFirstParty` gained
    `contributionBeforePaidMediaCents` (null, never 0) and
    `ordersWithContribution`. Four gates (costs · spend · currency · coverage)
    each downgrade to UNAVAILABLE or PARTIAL rather than approximating. ROAS
    and POAS remain separate fields. Read-only boundary untouched.
11. **Admin** — shared read-only `components/admin/cost-readiness.tsx` on
    `/admin/business-intelligence` and `/admin/pricing-intelligence`; a "Did
    the advertising make money?" section on `/admin/google-ads-intelligence`.
    No cost editor anywhere.
12. **Tests 966 → 1072** (106 new; zero credentials/network/AI provider):
    `unit-economics` (58 — the null-config state, the $10,000/$5,700/$4,300
    fixture ladder, payment-fee rounding + one fee per order, all five
    shipping-subsidy cases, per-level availability, multi-line with
    per-product freight dedup, quantity tiers incl. fail-closed below the
    first tier, minimum-vs-target across all five verdicts, zero-revenue
    safety, snapshots + immutability under a later config change, ROAS-vs-POAS
    and the six Google Ads POAS availability cases),
    `cost-config-validation` (27 — 15 invalid-value classes, `null` is not an
    error, the readiness view in both the null and fully-configured states,
    INVALID blocking capabilities), `unit-economics-separation` (21 — no
    lib/ai, no db, no fetch, no estimated-cost field, no numeric literal in
    config/costs.ts, commerce never gates on cost readiness, checkout never
    calls the price floor, storefront tier prices asserted unchanged, no new
    agent/executor/action type, every ceiling still RECOMMEND, every guardrail
    limit still null, no sales tool exposes cost data, contribution never
    unqualified, ROAS/POAS never aliased). Existing S09 profit-math tests now
    run on the labelled scenario basis and gained snapshot-semantics coverage.
13. **Browser-verified** on `next dev` (desktop + 375px mobile): the honest
    all-missing readiness panel with the version stamp on both admin pages;
    POAS/contribution unavailable on the Google Ads page with the 32 blocking
    paths listed; `HISTORICAL_COST_UNAVAILABLE` on every profit card with
    "6 of 6 orders carry no cost snapshot"; **a real checkout completing with
    every cost null** (order MOCK-MSW6LT63); storefront tier prices unchanged
    ($0.62 → $0.33); no console errors; no page-level horizontal overflow
    (wide tables scroll inside their own containers).
14. **Docs** — new `docs/UNIT_ECONOMICS.md` (authoritative, 23 sections);
    updated ARCHITECTURE (module row + decisions 55–61), DATABASE_SCHEMA
    (order cost snapshots), BUSINESS_INTELLIGENCE (profitability rebuilt),
    PRICING_INTELLIGENCE (§24), GOOGLE_ADS_INTELLIGENCE (§22 POAS), GUARDRAILS
    (S13.5 additions — no autonomy change), BUSINESS_CONFIG_TODO (cost-model
    section rewritten with the four-way classification and a fill-in owner
    template), LAUNCH_CHECKLIST (+Unit economics section).

## Completed in Production Launch Session 03 (2026-08-16) — Tracking, Monitoring, Abuse Protection + Operational Hardening

**Purchase / conversion tracking**
- `lib/commerce/order-confirmation.ts` — the ONE read path for a confirmation.
  `isOrderPaid` is `paidAt !== null` for Shopify (written only by
  `markOrderPaid`, inside a row-locked transaction, from an HMAC-verified
  webhook); the mock branch is dev-only and reported `demo: true`.
- `GET /api/orders/confirmation?order=…` — session-scoped, 404-identical for
  unknown and foreign orders, mints no session, returns no cost/margin/
  attribution/identity.
- `app/order-status/page.tsx` rewritten: polls the server, shows an honest
  "confirming payment" state, fires the purchase only on a paid answer.
  `?placed=1` and the `sessionStorage` order copy are gone (asserted).
- `lib/analytics/purchase.ts` — pending-order intention, exactly-once guard,
  `firePurchase` refuses an unpaid order.
- `lib/analytics/conversions.ts` — GA4 / Google Ads / Meta delivery, per-axis
  consent, per-vendor try/catch, no commerce imports.
- `lib/analytics/track.ts` gained two-axis consent (`setConsent`).
- `AnalyticsProvider` loads gtag for GA4 and/or Ads (each gated by its own
  axis) and runs the pending-purchase check on mount.
- `/api/checkout` returns BagDirect's order id and no order payload.

**Rate / abuse protection**
- `lib/rate-limit/` — `bucket.ts` (per-instance, moved), `identity.ts` (keyed
  HMAC network digest), `policy.ts` (route classes + limits), `store.ts`
  (durable Postgres fixed window + memory + resolution), `index.ts`
  (`enforceRateLimit`, layered, scope-selectable), `http.ts` (the one 429).
- Wired: `/api/events`, `/api/configuration`, `/api/cart/line`, `/api/quote`,
  `/api/checkout`, `/api/artwork/upload`, `/api/artwork/[id]/complete`,
  `/api/ai/chat`, admin writes. Network scope always before session minting.
- Artwork: signed `Content-Length` + per-session allowance
  (`config/artwork.ts`, `countArtworkForSession`).

**Human escalation**
- `human_handoffs` table + `lib/data/handoff-service.ts` +
  `lib/escalation/delivery.ts` + `/admin/handoffs` (+ retry / mark-handled
  routes). The escalation tool persists first, delivers second, and never
  fails on delivery.

**Shopify reconciliation**
- `lib/commerce/shopify-orders.ts` (read-only query, `read_orders` scope),
  `reconcileOrderSnapshot` in the existing reconciliation service,
  `setOrderRefundTotal` (absolute, never accumulating),
  `lib/commerce/reconciliation.ts` (bounded sweep + run records),
  `commerce_reconciliation_runs`, `POST /api/admin/commerce/reconcile`.

**Health / monitoring / readiness**
- `lib/observability/{logger,correlation,error-tracking}.ts`.
- `/api/health/live`, `/api/health/ready`.
- `modules/launch-readiness/` (types, checks, placeholders, report) and
  `/admin/launch-readiness`.
- `config/site.ts` — canonical domain; `robots.txt` refuses crawling unset.

**Boundaries preserved (asserted in `tests/operational-hardening-separation.test.ts`)**
- Google Ads reporting remains structurally read-only, with no
  conversion-upload path; the Ads conversion is a browser gtag send.
- The reconciliation reader defines no mutation; repairs route through the
  same service as the webhook.
- Executor registry still empty; no price, ad, refund or payment tool.
- `markOrderPaid` is callable from exactly two files.
- The purchase event is fired from exactly one module, and only on `paid`.
- Analytics imports no order/checkout/database code; the confirmation
  endpoint is GET-only and session-minting-free.
- Exactly one file reads `x-forwarded-for`; the durable store never sees a
  request.

**1409 tests (1262 → 1409).** New suites: `purchase-tracking`,
`analytics-conversions`, `rate-limit-architecture`, `escalation-delivery`,
`reconciliation`, `health-readiness`, `observability`, `artwork-abuse`,
`operational-hardening-separation`.

## Completed in Production Launch Session 04 (2026-08-17) — Production Configuration + E2E Validation

**LAUNCH VERDICT: NO-GO — PRODUCTION BLOCKERS REMAIN.**

Not a feature session. The question was "can BagDirect safely accept a small
amount of real customer traffic?" The answer is no, and the reason is
singular: **no production environment has been created and no owner values
have been supplied.** Every blocker below is data or infrastructure only the
owner can provide.

### Production environment — what exists

**Nothing.** There is no hosting platform configured (no Vercel/Netlify/Docker
config in the repo), no production Postgres, no Shopify store, no object
storage, no domain, no monitoring destination. The local machine has neither
Postgres nor Docker, so not even a scratch Postgres could be stood up to
validate the migration path — migrations have still only ever been applied to
PGlite. `db/migrations/meta/_journal.json` lists 11 entries (0000–0010),
complete and consistent with the files on disk.

Everything below was measured against a real `next build` served by
`next start` with `NODE_ENV=production` — not `next dev`, not a test fixture.

### Readiness: BEFORE and AFTER are identical, and that is the finding

| | BEFORE | AFTER |
| --- | --- | --- |
| `/api/health/live` | 200 `{"status":"ok"}` | 200 `{"status":"ok"}` |
| `/api/health/ready` | 503 `not_ready` | 503 `not_ready` |
| READY / WARNING / BLOCKED | 1 / 18 / 10 | 1 / 18 / 10 |

No blocker moved, because no owner input arrived. The AFTER differs only in
that three checks now report the truth instead of a misleading version of it.

**The ten mandatory blockers:** Shopify not configured · 114 of 114 variants
unmapped · no `DATABASE_URL` · 4 of 4 products on demo prices · MOQ still the
unconfirmed 500 · no artwork storage · no admin credentials · no
`NEXT_PUBLIC_SITE_DOMAIN` · 4 customer-facing `[TO BE PROVIDED]` values ·
database unreachable.

### What WAS verified — the fail-closed properties

Production cannot silently do the wrong thing. Verified by request, on the
production build:

| Property | Result |
| --- | --- |
| `POST /api/checkout` with no Shopify config | **503**, log `COMMERCE_NOT_CONFIGURED`, **no `MOCK-*` order minted** |
| Unsigned Shopify webhook | 503, writes nothing |
| Artwork upload, storage unset | 503 `UNAVAILABLE` — never pretends to succeed |
| `/admin/*` + `/api/admin/*`, credentials unset | **404** (no existence oracle) |
| Admin with credentials set | 401 unauthenticated · 401 wrong password · 200 correct |
| `/api/health/ready?verbose=1` | No secret VALUE; only variable names appear |
| `robots.txt`, domain unset | `Disallow: /` — refuses crawling entirely |
| Third-party scripts loaded | Zero (none configured); no `gtag`, `dataLayer`, `fbq` |
| Mobile 375px: home, product, configurator | No horizontal overflow |
| Merchandise map validation | 114 required · 0 mapped · 114 missing · 0 duplicate · 0 invalid |
| `npm run ai:smoke`, no key | Skips cleanly; does not fail the build |

### Production bugs found and fixed

Each was invisible from a dev server, because each needed `NODE_ENV=production`
or a real production build to reproduce.

**1. Readiness misdescribed unconfigured Shopify as "partially configured."**
*Root cause:* in production with nothing set, `resolveCommerceConfiguration()`
throws rather than returning mock, so `describeCommerceReadiness()` returned
`mode: "misconfigured"` — which the readiness check read as "partial". The
accurate branch was unreachable in production. *Fix:* the descriptor now
returns `reason: "not_configured" | "partial" | "invalid"`, decided from the
same env read, and the check renders the matching message and code.
*Regression:* `tests/commerce-guard.test.ts` (all three reasons),
`tests/health-readiness.test.ts` (production message and action).

**2. `sitemap.xml` published 21 URLs on a domain the owner does not own.**
*Symptom:* `GET /sitemap.xml` → 200 with `<loc>https://example.com…` for every
page. *Root cause:* Session 03 moved the domain into `NEXT_PUBLIC_SITE_DOMAIN`
and applied the null-refusing accessor to `robots.ts` but not `sitemap.ts`,
which still read `BUSINESS.DOMAIN` — the placeholder-returning accessor that
exists only so `next build` survives missing owner input. `Disallow: /` stops
neither a direct fetch nor a manual Search Console submission. *Fix:*
`sitemap.ts` reads `siteUrl()` and returns `[]` when null. *Regression:*
`tests/canonical-domain.test.ts` — covers both surfaces, unset / placeholder /
real domain.

**3. `NEXT_PUBLIC_DEMO_PRICING=false` over a DEMO catalog published demo
prices as real offers.** *Symptom:* with the flag false and
`pricingStatus: "DEMO"` (the exact ordering mistake §16 of the checklist warns
about), the product page emitted `AggregateOffer lowPrice 0.33 highPrice 0.62`
into its JSON-LD, and the configurator's "Demo pricing" badge disappeared.
*Root cause:* three surfaces gated on different combinations of the same two
inputs — JSON-LD on the env flag alone, the configurator on `flag && DEMO`,
the homepage panel on nothing at all. *Fix:* one helper,
`showsDemoPricing(product) = isDemoPricing() || pricingStatus === "DEMO"`, used
by all three. Evidence and assertion are OR-ed: neither may overrule the other
into showing a fake number as real. *Regression:*
`tests/demo-pricing-disclosure.test.ts`. Re-verified on a rebuilt production
server: badge restored, zero `lowPrice` published.

### Vendor status — every one UNVERIFIED

Shopify · Artwork storage · Anthropic · GA4 · Google Ads · Meta · Monitoring:
**UNVERIFIED**. None is configured, so none was contacted. No test order, no
payment, no webhook delivery, no refund, no reconciliation run against a real
store, no artwork round-trip, no GA4 purchase, no conversion event. **Every
line of §52–§62 of the session brief is unexecuted, and none of it can be
faked.**

### Pricing / MOQ / products

`pricingStatus` is `DEMO` on all 4 products; `MOQ_CONFIRMED: false` with the
placeholder 500; product `images[].src` are all `null`. `config/costs.ts` and
`config/ai-pricing.ts` remain fully null — deliberate, and NOT launch
blockers: missing costs block profit analytics, never a sale.

### Soft-launch scope, when the inputs exist

US only · only configurations present in `SHOPIFY_MERCHANDISE_MAP` · guest
checkout · experiments OFF · CRO agent OFF · Google Ads agent OFF · Meta agent
OFF · all autonomous actions OFF (the executor registry is still empty by
design) · AI Sales OFF until `npm run ai:smoke` passes against a real key and
budget caps are valid. Do not enable Canada.

### Next step

BUSINESS_CONFIG_TODO → "THE SHORT LIST" — ten owner items in dependency order.
Then re-run Session 04. There is no code session between here and a first sale.

---

## Important decisions (and why)

1. **Database is the first ADD** — every roadmap capability consumes
   structured first-party data; nothing unblocks without persistence.
   SQLite dev / Postgres prod, TS ORM, inside the monolith.
2. **Pricing engine is extended, not replaced** — already deterministic,
   pure, tested. Gaps: cost model, margin outputs, server-side checkout
   re-quote. Engine math is reused as the kernel of `modules/pricing`.
3. **Shopify stays behind `lib/commerce`; no Stripe** — checkout/payments/
   tax stay delegated; the AI layer operates above the commerce provider.
4. **Margin guardrails fail closed** — until real costs are configured, any
   price-affecting agent action is rejected as unverifiable.
5. **One configurator state** — AI tools will mutate the same validated
   reducer the UI uses; never parallel states.
6. **Checkout drift → 409 REPRICED, never silent substitution** — no order
   is created at a total the customer wasn't shown; the cart self-corrects
   and the user confirms again. Future AI cart/checkout tools must handle
   REPRICED the same way. Cost/margin data never leaves the server.
7. **(S03) Postgres one-dialect / two-driver (Drizzle + PGlite dev,
   node-postgres prod)** — one schema + one migration set, zero-setup dev,
   no SQLite/Postgres drift; external DBs never auto-migrate at request
   time.
8. **(S03) Persistence is additive to commerce** — DB failures log loudly
   and never fail a checkout/quote the customer completed; `/api/events`
   answers 503 quietly and the storefront never notices.
9. **(S03) Need-profile provenance is authority-ranked** — AI inference is
   data about our guess, never allowed to overwrite USER_STATED/ORDER_DATA/
   CONFIGURATOR facts; enforced in `applyNeedProfileUpdate`, not prompts.
10. **(S03) purchase_completed is server-written at order creation** — the
    first-party purchase record is immune to ad-blockers, StrictMode
    double-fires, and closed tabs; the client `purchase` event stays
    dataLayer-only (GA4/Meta copies).
11. **(S03) AgentAction = typed schema inside AgentDecision (no table);
    missing AgentConfig ⇒ OBSERVE** — one audit trail, fail-safe autonomy
    floor; insights REQUIRE sourceRefs so fabricated intelligence is
    structurally impossible.
12. **(S04) Official vendor SDK inside our adapter, one provider
    implemented** — @anthropic-ai/sdk stays entirely inside
    lib/ai/providers/anthropic.ts; the loop is provider-agnostic; no
    speculative openai/gemini adapters (interface-ready, loud typed error).
13. **(S04) AI security is capability-based, AI spend fails closed** —
    permission tiers + server-minted contexts + structurally-limited output
    schemas (sell-side pricing only), injection cases are unit tests;
    budgets over unpriced models or a failed budget check block the call
    rather than silently spending. Pricing config ships null (no invented
    economics), so budget caps are unenforceable until the owner fills
    config/ai-pricing.ts — deliberate.
14. **(S05) Need-profile writes serialize with row locks, not versions or
    SQL merges** — `SELECT … FOR UPDATE` in a transaction preserves the
    tested TS provenance logic byte-for-byte and gives real-Postgres row
    granularity; PGlite serializes whole transactions (same guarantee).
    Optimistic retry adds loops for a low-contention row; SQL jsonb-merge
    forks the rank gate into a second implementation.
15. **(S05) USER_STATED must be earned through server-verified evidence** —
    no model-writable path to top-rank provenance exists: the tool is
    hard-coded AI_INFERRED and the extractor grants USER_STATED only after
    verifying the quoted evidence against the customer's actual message
    (fabricated quotes die entirely; hedged numbers demote). The rank gate
    stays the final authority beneath both paths.
16. **(S05) One safe sentence for every AI failure at the chat boundary** —
    all AiError codes map to the same 503 customer copy; codes/details go
    to server logs. Customers never see provider internals, and the
    storefront's manual paths are always the stated fallback.
17. **(S05) Escalations are recorded before they are routed** — the
    structured handoff persists in conversation storage (queryable,
    testable) with delivery to email/Slack/CRM deferred to owner config;
    an unroutable escalation still exists and still shows the customer an
    honest "human will follow up" state.
18. **(S06) The shared configuration truth is the DB row; the React store
    is its live view** — the AI runs server-side and must read/commit
    without a browser; restore-on-mount + debounced sync keep the UI
    view live. No state library: useReducer+context matches the repo's
    cart pattern.
19. **(S06) AI writes are revision-checked under a row lock; UI snapshots
    are last-write-wins; client-side, dirty fields win field-wise** — the
    smallest strategy that makes silent clobbering impossible in every
    direction (stale AI patch vs newer manual change; concurrent AI load
    vs in-flight click). Chosen over event sourcing/CRDTs deliberately.
20. **(S06) The UI applies only server-validated configuration payloads,
    and patch schemas are STRICT** — configurationUpdate is lifted from
    validated tool output (never model prose); suggestion chips re-POST
    through /api/configuration for full revalidation; unknown patch keys
    (price/artwork/admin) are loud validation errors, never silently
    stripped — injection surfaces to the agent instead of half-working.
21. **(S06) AI-committed configuration changes record CONFIGURATOR-rank
    evidence** — the tool records what the configuration now IS; when the
    customer's words drove it, the S05 evidence extractor independently
    grants USER_STATED from the actual message. Still zero model-writable
    paths to top-rank provenance.
22. **(S07) The cart stays client-side; the AI gets a validated channel
    INTO it, not a server cart** — a server cart would fork the working
    localStorage-cart + checkout-re-quote design into two truths. The
    server validates/prices lines from the authoritative configuration;
    the client applies them through the manual `addLine`; `/api/checkout`
    stays the only order authority. AI and manual lines are equivalent by
    construction.
23. **(S07) Commerce tools carry intent, never authority; checkout needs
    a customer tap** — expectedRevision/expectedTotalCents are drift
    detection (reprice/stale = fresh confirmation required);
    startCheckout's input is the empty strict object and only surfaces an
    action the customer clicks (mock checkout IS an order, so
    tap-to-confirm is structural). The agent sees the cart only as a
    price-free client-reported snapshot the engine re-prices.
24. **(S07) aiAssisted is conservative and event-derived** — a sales
    conversation plus ≥1 material ai_* commerce event; a loaded widget or
    small-talk chat never counts. The order stores the boolean +
    conversation link; details stay derivable from events (no duplicated
    columns, no invented probability scores).
25. **(S08) The intelligence module computes every number; the model only
    labels with closed enums** — modules/customer-intelligence has no
    lib/ai import (fabricated counts structurally impossible); classifier
    labels must cite messageIds we actually sent (fabricated ids
    dropped); catalog support is deterministic matching, never model
    opinion. Chosen over LLM-estimates-percentages and free-text
    categories.
26. **(S08) Admin auth = HTTP Basic from env, proxy challenge + per-route
    re-check, fail-closed 404** — no session store or login UI for a
    single-operator tool; unset credentials mean the surface doesn't
    exist; handlers stay directly testable. Chosen over login+session and
    URL tokens.
27. **(S08) Classification persists once per conversation; reprocessing
    is explicit and version/message-driven** — page loads never call the
    model; budget/provider failures leave work PENDING (not failed) so
    runs resume; AI spend is bounded by a batch-capped admin action.
    Chosen over classify-on-load and background workers.
28. **(S08) Insights/opportunities are identity-stable and humans own
    terminal statuses** — one row per TYPE:dimension:periodDays updated
    in place; dismissed rows return only on grown evidence; generation
    creates opportunities as `proposed` and never touches
    validated/rejected — manufacturing feasibility is human-only by
    construction.
29. **(S09) Business metrics are typed availability results; missing
    inputs are never zero** — Metric<T> AVAILABLE/PARTIAL/UNAVAILABLE
    with reason+missingInputs everywhere (profitability, AI spend, mixed
    currencies); UNAVAILABLE has no value property at all, so null→0 is
    structurally impossible. Chosen over null-coalescing dashboards and
    over letting the LLM fill gaps.
30. **(S09) The CEO agent has no tools and its references are earned** —
    one structured-output call over the PII-free snapshot; the context
    builder constructs the metric/evidence whitelists from exactly what
    it prints, and persistence filters/drops anything outside them.
    Recommendation ≠ authority: approvalRequired always true,
    executionStatus never leaves `none`, human-reviewed identities are
    frozen against regeneration.
31. **(S09) CEO reviews live in a dedicated append-only table** —
    `ceo_reports` versions the document (period/prompt/model/exact
    snapshot/validated review/decision links) so failures keep the last
    good report visible and audits can replay what the model actually
    saw; AgentDecision stays the per-recommendation approval spine.
    Chosen over stuffing documents into decision rows and over
    regenerate-on-load.

32. **(S10) One guardrail engine, and it is a pure function** —
    `modules/guardrails` imports neither `lib/ai` nor `db/`, and
    `evaluateAgentAction` has no clock, randomness or I/O, so the same
    input under the same `GUARDRAIL_POLICY_VERSION` always produces the
    same verdict and a model can never influence one. Persistence stamps
    the time and writes an append-only evaluation row carrying the policy
    version AND the exact limits consulted. Chosen over per-agent safety
    checks (which drift apart) and over an LLM-judged safety layer.
33. **(S10) The action taxonomy is CLOSED and payload schemas are
    STRICT** — 20 registered types, each with its own zod schema; unknown
    types and unknown payload keys are validation failures. A model can
    neither invent a capability ("TRANSFER_MONEY") nor smuggle an
    authorization field (`riskLevel`, `approvalStatus`) into a payload.
    ACTION TYPE and EXECUTION SUPPORT are separate axes, so
    `PRICE_EXPERIMENT` is representable today with executionStatus
    NOT_SUPPORTED. Also: the SOURCE grants nothing — CEO_AGENT is
    permitted review types only, so a "lower all prices 90%" proposal is
    denied by permission, not by prompt wording.
34. **(S10) Autonomy is clamped by policy, not merely stored** —
    `agent_configs` remains the store (absent row = OBSERVE), but the
    evaluator applies `min(stored, policy ceiling)` where every business
    agent's ceiling is RECOMMEND. A mistaken or tampered AUTONOMOUS row
    grants nothing; the guarded-auto allow-list is empty and HIGH/CRITICAL
    risk always requires a human. Chosen over trusting one mutable row.
35. **(S10) Approval and execution are separate columns, and the executor
    registry is EMPTY** — `status` records the human verdict,
    `executionStatus` records whether anything happened. No dummy
    executors exist, so approving records intent and mutates no price, ad,
    product or payment; the documented contract (validated action → fresh
    evaluation → approval → idempotency key → before/after → audit →
    rollback) must be met before the first executor is registered. Chosen
    over one ambiguous status field and over stubs that pretend to work.
36. **(S10) Proposals are immutable; modification creates a re-evaluated
    revision** — an admin edit marks the original SUPERSEDED and inserts
    `revision + 1` with `originActionId`, then runs the FULL evaluation on
    the new payload: no verdict is inherited and a rule-violating edit
    lands as GUARDRAIL_BLOCKED. Evidence refs may narrow but never grow,
    so an edit cannot launder fabricated evidence. Transitions are
    `stateVersion`-checked under a row lock, so a double-click or a stale
    second reviewer conflicts instead of rewriting history. Chosen over
    in-place payload edits.
37. **(S10) Admin mutation routes defend against the cost of Basic auth** —
    browsers send Basic credentials automatically, so authentication alone
    would leave approve/reject cross-site triggerable. Every write requires
    POST + authenticated admin + same-origin Origin/Referer +
    `application/json` + a bounded body + a strict schema, and
    `reviewedBy` is derived from the server's configured `ADMIN_USER`.
    Documented as a tested control set, NOT a claim of full security
    compliance; per-user RBAC stays deferred.

38. **(S11) Experiment assignment is a pure hash, and the stored row is a
    RECORD of it** — `assignVariant(experimentId, salt, sessionId,
    allocation)` has no randomness and no I/O, so a session's arm is decided
    before any row exists. Stickiness is structural (not a lucky write), a
    lost write cannot move a customer between arms, and editing an
    allocation mid-flight cannot re-randomise anyone. The per-experiment
    salt keeps arms independent across experiments. Chosen over a random
    draw persisted at first sight.
39. **(S11) Experiments resolve during the SERVER render, and the cost is
    stated rather than hidden** — the HTML the browser receives already
    contains the right arm: no client swap, no flicker, no hydration
    mismatch, no bias in the very metric being measured. The price is that
    reading the session cookie makes the hosting page dynamic, so the engine
    reads NOTHING while the flag is off (pages stay static, exactly as
    before S11) and enabling it requires a redeploy. `cookies()`/`headers()`
    are called before the DB lookup and OUTSIDE the defensive try/catch —
    both were bugs first: querying first short-circuits during the build and
    silently prerenders the page, and catching Next's dynamic-usage signal
    does the same. Enrolment also needs an existing first-party session, so
    a brand-new browser's first render sees control; that costs sample, not
    validity, because non-enrolment happens before an arm is chosen.
40. **(S11) Variants are closed typed records, never content** — a variant
    is a strict schema of presentation VALUES an existing component already
    renders; no code path turns experiment data into markup, and `safeText`
    refuses angle brackets, braces, template interpolation,
    `javascript:`/`data:` URLs and inline handlers on top of React's
    escaping. The CONTROL arm renders the app's own UI with NO override at
    all; `control_json` is a launch-time snapshot kept only so historical
    reports stay interpretable. Chosen over a generic remote-content CMS,
    which is the shape this feature keeps trying to become.
41. **(S11) The engine decides, the model explains** — `modules/experiments`
    imports neither `lib/ai` nor `db/`, so eligibility, assignment,
    exposure, counting, the sample gate and the two-proportion z-test are
    structurally beyond model influence. "Inconclusive" is a first-class
    result, no winner exists below the documented minimum sample, and the
    CRO agent receives result STATES rather than producing them. Chosen over
    letting an LLM read a dashboard and call a winner.
42. **(S11) Launch is a human admin route, NOT the first executor** —
    `CRO_EXPERIMENT_LAUNCH` stays NOT_IMPLEMENTED and
    `modules/guardrails/executors.ts` stays EMPTY, so S10's invariant
    ("approving executes nothing") holds system-wide. Launching is instead
    an explicit human action that is guardrail-EVALUATED (verdict + policy
    version + missing configuration snapshotted onto the row),
    traffic-capped, idempotent, `stateVersion`-guarded, limited to one
    running experiment per target by a DB unique index, and audited in
    `experiment_events`. An executor would have been permanently blocked
    anyway while `maximumExperimentTrafficPct` is unset — a
    registered-but-unusable executor is exactly the fake the doctrine
    forbids.
43. **(S11) A missing traffic limit blocks in production and applies a
    documented development ceiling elsewhere** — `resolveTrafficCap()` uses
    the owner's `maximumExperimentTrafficPct` when set, otherwise a 50%
    ceiling in NON-PRODUCTION ONLY, otherwise it refuses the launch and
    names the exact config path. `null` is never "no limit" and never 100%.
    Same doctrine as the S02 cost model: ship the refusal, not an invented
    number.
44. **(S11) A legitimate objection is never "solved" by hiding it** — the
    CRO agent's `kind` is EXPERIMENT or REVIEW, and evidence pointing at a
    business/product problem (MOQ, real delivery times, a product we do not
    make) maps to `CRO_REVIEW`. A REVIEW carries no design, so it cannot be
    materialized into a running experiment even by relabelling. Dark
    patterns are barred by the prompt AND by variant schemas that cannot
    express a countdown, a scarcity claim, a price or a guarantee.

45. **(S12) A specific price is UNREPRESENTABLE, not merely refused** — the
    Pricing Agent's output schema has no `proposedUnitPriceCents`, no
    `discountPct`, no `proposedMoq` and no `optimalPrice`, and its closed
    recommendation taxonomy maps only to REVIEW-ONLY action types. "Lower it
    to $0.37" is not caught by a filter that could be misconfigured — there
    is nowhere to write it. Chosen over a validated `calculateOptimalPrice()`,
    which would make correctness depend on every downstream layer behaving.
46. **(S12) Elasticity is a refusal with a reason, not an unavailable
    number** — `assessElasticity()` returns a type whose `estimable` field is
    the literal `false`; no code path produces a coefficient, so no model can
    be asked to fill one in. The platform has never shown two prices for the
    same configuration to comparable audiences, so every observed
    price/quantity relationship is confounded. The owner is told why in plain
    language plus exactly what would have to exist first. Chosen over
    reporting an observational correlation as elasticity.
47. **(S12) Price friction requires EXPLICIT evidence; a non-purchase is a
    behavioural observation** — `isPriceFriction` is true only when a customer
    actually said something (objection, repeated price question, handoff after
    price, quote after price). Price-view-then-nothing is BEHAVIORAL, capped
    at LOW, and flagged `isPriceFriction: false` with its own limitations.
    Strength is a documented count-and-diversity rule, never a probability —
    there is no "price sensitivity index" because there is nothing to compute
    one from.
48. **(S12) MOQ friction and product gaps are routed AWAY from pricing** —
    a customer wanting 200 bags has a QUANTITY problem and a customer wanting
    insulated bags has a PRODUCT problem; neither is evidence that the unit
    price is wrong, and lowering it would sell them nothing. MOQ signals carry
    `route: MOQ_REVIEW` + `isPriceFriction: false`; product gaps produce no
    pricing signal at all. Chosen over letting a pricing layer claim every
    unclosed sale.
49. **(S12) Repricing is reported as NOT INSTRUMENTED rather than derived** —
    `/api/checkout` answers 409 REPRICED and the client re-confirms, but no
    first-party event records it, so repricing counts, post-reprice
    confirmations and abandonment are unknown. Session 12 names the two events
    that would need to exist instead of inferring a figure from cart
    abandonment. Same doctrine as the S02 cost model: ship the refusal, not an
    invented number.

50. **(S13) Google Ads mutation is UNCONSTRUCTIBLE, not merely uncalled** —
    `lib/google-ads/client.ts` has one URL builder and it appends the literal
    `/googleAds:search`; the method is not a parameter, there is no exported
    `request(method, path, body)`, GAQL has no mutation verb, the transport
    refuses a non-SELECT query, and the provider interface has three read
    methods. Chosen over adopting a Google Ads client library, whose surface
    would include every mutate service and leave "we simply do not call them"
    as the only guard. A structural test asserts each of these, so adding
    campaign mutation requires deleting a test.
51. **(S13) Google's numbers and ours are separate TYPES** —
    `GoogleNativeTotals` has no `orders`/`revenueCents`, `GoogleAdsFunnel`
    has no `googleConversions`/`googleConversionValueCents`, `AdEfficiency`
    has no field named merely `cac` or `roas`. A Google "conversion" is
    whatever that account's conversion actions count — possibly a form view.
    Where the two disagree, BOTH are shown with the five standing causes;
    nothing merges, averages or corrects either side. Chosen over one blended
    attribution model, which would make a guess look like a measurement.
52. **(S13) Attribution has three honest tiers and no fuzzy one** — EXACT
    (`utm_campaign` = campaign id), MAPPED (normalized name), UNMATCHED
    (revenue counts account-wide, under no campaign). `gclid` is used only as
    a BOOLEAN "this was a paid click" and its value never leaves the matching
    function — resolving it to a campaign needs Google's `click_view`, which
    is deliberately not ingested. Two campaigns normalizing to the same name
    make BOTH unmatchable rather than a coin flip. Coverage is reported with
    an owner-language interpretation, and below 50% first-party CAC/ROAS go
    PARTIAL. Chosen over approximate string matching, which would turn
    revenue attribution into a guess wearing a number.
53. **(S13) Reporting days stay on the ACCOUNT's calendar** — Google reports
    a day in the account's time zone and daily totals cannot be re-cut into
    UTC without hourly data this integration does not fetch, so a UTC period
    maps to the account-days it OVERLAPS, inclusively, and the surface prints
    the zone, the exact range, and the fact that boundary days may include
    hours outside the window. Chosen over silently assuming UTC, which shifts
    spend onto the wrong day at both ends of every window.
54. **(S13) NOT CONNECTED, SYNC FAILED, STALE and PARTIAL are four states,
    and none of them is zero** — freshness advances only on a COMPLETE sync;
    a failed sync leaves prior rows and their timestamp untouched; a
    truncated sync keeps its data without claiming freshness; and credentials
    removed while data remains still SHOWS the data, saying it is real but
    frozen. The idempotent `(account, campaign, day)` upsert means a re-sync
    restates rather than accumulates. Chosen over `?? 0`, which would let a
    missing integration read as free advertising — the exact error this
    session exists to prevent.

## Known issues

- **(Product #1) All six product photography slots are empty.** The page renders
  labelled placeholder slots. Owner/supplier assets only — no AI-generated
  product photography, and no other supplier's branding presented as
  BagDirect's. Exact shot list: BUSINESS_CONFIG_TODO → "Product #1".
- **(Product #1) Profit analytics remain unavailable, deliberately.** The
  factory quotes in CNY and there is no FX model, so `config/costs.ts` stays
  null for this product. The CNY figures are a comment, asserted by test not to
  appear in any configured value.
- **(Product #1) Transit time is still `[TO BE PROVIDED]`.** Production time is
  real (15–30 days after proof approval); nobody has contracted a carrier, so
  no delivery date is promised anywhere.
- **(Product #1) The digital proof is a HUMAN production step.** Nothing in the
  codebase generates or sends one, and no copy claims it is automatic or
  instant. The proof turnaround itself is not stated because it is not known.
- **(Product #1) The $100 shipping charge is a commercial decision, not a
  measured freight cost.** If real freight exceeds it, the difference is a
  subsidy — and the subsidy cannot be computed until USD costs exist.
- **(Product #1) Configurations persisted under an older catalog are
  reconciled, not migrated.** A retired option falls back to the catalog
  default for that field on read; the stored row is only rewritten on the next
  sync.

- **(PL-S03) Browser-based ad conversion tracking undercounts.** GA4 and
  Google Ads only see a purchase if the buyer returns to a BagDirect page
  after paying on Shopify. BagDirect's own `purchase_completed` is complete
  regardless — this is a measurement gap, not a data gap. Closing it means
  configuring Shopify's own customer-events tracking against the SAME
  conversion action (docs/ANALYTICS_PRODUCTION.md §7).
- **(PL-S03) Meta Conversions API is not implemented.** The browser Pixel
  emits an `eventID` equal to the transaction id, so adding CAPI later is a
  server-side change only. `META_ACCESS_TOKEN` / `META_DATASET_ID` are read
  by no code today.
- **(PL-S03) Reconciliation is manual.** The sweep exists; no cron runs it.
  A permanently-lost webhook is only recovered when someone presses the
  button, so `WEBHOOK_GAP_REPAIRED` is worth alerting on.
- **(PL-S03) Handoff delivery has no automatic retry.** A failed delivery is
  recorded and retryable from `/admin/handoffs`; nothing retries it in the
  background.
- **(PL-S03) Error tracking is a minimal transport, not the Sentry SDK.** No
  browser/client-side capture, no source-map symbolication, no release
  tracking, no performance tracing, no breadcrumbs.
- **(PL-S03) The durable rate limiter is a FIXED window**, so up to ~2x the
  nominal rate can pass across a window boundary. The per-instance token
  bucket in front smooths that, and the platform/WAF layer is the real outer
  bound.
- **(PL-S03) Admin auth is still one shared Basic credential.** Every
  `handledBy` and `triggeredBy` reads as the single configured admin; there
  is no per-person audit trail.
- ~~Configurator state is six `useState` hooks local to
  `ProductConfigurator`~~ — **RESOLVED in Session 06**: `lib/configuration`
  shared store + `/api/configuration` writer (source "configurator"/"ai");
  see docs/AI_CONFIGURATOR_INTEGRATION.md.
- (S06) Configuration sync is debounced (700ms): a change made <1s before
  closing the tab may not persist (the visible UI never lies — reload
  falls back to the last-synced state). `/api/configuration` has no route
  rate limit (same posture as `/api/events` — platform-edge limiting is
  the LAUNCH_CHECKLIST item; payloads are strictly bounded).
- (S06) The AI-change highlight/announcement lives in the mounted
  configurator only — an updateConfiguration committed while the customer
  is on another page is visible in chat ("✓ Configurator updated" chip)
  and on next configurator mount (restore), with no page-level toast
  elsewhere (deliberate, avoids cross-page notification noise).
- ~~Shopify variant mapping is `TODO(shopify)`; `createCheckout` ships a
  `REPLACE_ME` variant id; the catalog-read mock fallback must be removed~~ —
  **RESOLVED in Production Launch Session 02**: real draft-order checkout,
  deterministic mapping in `config/shopify.ts` (shipped EMPTY — owner data),
  and the catalog fallback DELETED along with the provider hop that needed it.
- ~~Shopify order rows are NOT persisted — order webhooks are a future
  session~~ — **RESOLVED in Production Launch Session 02**: `/api/webhooks/shopify`
  reconciles `orders/create`/`paid`/`cancelled` and `refunds/create` into
  authoritative Order rows. **Shopify CUSTOMER rows are still not created** —
  Shopify collects the email at checkout and BagDirect does not pull it back,
  so a Shopify order links to a session, not to a `customers` row (unless a
  quote created one earlier).
- (Launch S02) **No scheduled reconciliation sweep.** If a webhook is
  permanently lost (endpoint down past Shopify's retry window) the order stays
  `pending_payment` and must be reconciled by hand. A periodic "orders since X"
  sweep is the obvious next hardening step.
- (Launch S02) **Fulfilment sync is not implemented.** Tracking numbers and
  shipping status stay in Shopify; BagDirect order status advances to `paid`
  and stops. The pipeline states exist in the schema but nothing drives them.
- (Launch S02) **Partial refunds are one cumulative amount**, not per line.
  Shopify refunds can be arbitrary amounts against arbitrary lines; inventing
  an allocation would produce precise-looking per-product profit that is false.
- (Launch S02) **Shipping and tax are Shopify's and are NOT verified.** The
  draft order sets no `shippingLine` and no tax fields, so Shopify's shipping
  profiles and tax configuration apply — but that requires a real store and is
  a launch-checklist test, not a claim. **US-only soft launch**; Canada is
  unconfigured and untested.
- (Launch S02) **Quote artwork is still metadata-only** — `/api/quote` records
  filename/type/size and does NOT use durable storage. The infrastructure is
  ready (same upload routes, `artworks.quote_id` exists); converting the
  multipart quote form was deliberately out of scope, since quotes are the
  secondary conversion path.
- (Launch S02) **Artwork size is enforced AFTER upload, not during.** The
  signed PUT does not sign `Content-Length`, so a client could upload more than
  it declared; the completion check catches it, deletes the object and rejects
  the artwork. A bucket lifecycle rule or a signed content-length is the
  tightening step. No virus scanning, no DPI/dimension check, no preview
  thumbnail (the object URL that used to provide one is gone).
- (Launch S02) The `orders_provider_order_idx` UNIQUE migration will FAIL on a
  database that already holds duplicate `(provider, provider_order_id)` pairs.
  Fresh installs and the dev database are unaffected.
- Quantity changes on the cart page re-price client-side for instant
  feedback (optimistic); the server re-quote at checkout remains the
  authority, so drift is always caught before an order exists.
- ~~Artwork binaries are not persisted (metadata rows only)~~ — **RESOLVED in
  Production Launch Session 02** for the PURCHASE path (durable S3-compatible
  storage, server-verified, linked to an order line). Still metadata-only for
  the QUOTE path (above).
- Dev-mode React StrictMode double-fires some dataLayer events (view_item,
  page_view) — visible as duplicate first-party rows in the DEV database
  only (distinct clientEventIds, so dedup correctly doesn't collapse
  them); purchase is server-written and immune; production unaffected.
- First-party event persistence runs independently of the marketing-consent
  banner (separate `NEXT_PUBLIC_FIRST_PARTY_EVENTS` switch); the owner
  must review consent/privacy-policy copy before launch —
  BUSINESS_CONFIG_TODO "Database & first-party data".
- PGlite is single-process: don't open `.data/pglite` from a second
  process while `next dev` runs (inspect after stopping the server, or
  point `PGLITE_DATA_DIR` elsewhere). Deploys that run the standalone
  output tracer must include `db/migrations/` if embedded mode is ever
  used server-side (external Postgres doesn't read migrations at runtime).
- Vitest: PGlite WASM cold-start needs the raised hook/test timeouts and
  `maxWorkers: 4` in vitest.config.ts — don't remove them.
- After a mock purchase the header cart badge shows the old count until
  the next full page load (order-status clears localStorage directly, not
  through the cart context) — pre-existing cosmetic quirk from Session 01.
- `next dev` regenerates `AGENTS.md` (Next 16 breaking-changes notice) —
  keep it committed, keep the `@AGENTS.md` import at the top of this file.
- (S05) Chat rate limiting is per-instance in-memory token buckets — a
  deliberate application guard, not a distributed limiter; platform-edge
  limiting is a ⛔ LAUNCH_CHECKLIST item before enabling AI_SALES on real
  traffic (S07: `/api/cart/line` shares this posture — strictly bounded
  payloads, no route limiter).
- (S07) Explicit-intent classification is prompt-enforced (v1.2.0) plus
  structural backstops (chips are customer taps; reprice/stale/checkout
  all require explicit confirmation) — there is no deterministic intent
  classifier, so an over-eager model could add a REVERSIBLE cart line
  without perfect wording; it can never price, pay, or check out.
- (S07) The chat's cart chips (added/repriced states) are per-turn client
  state — reloading restores transcript text but not chip states (same as
  S06 suggestion chips; the cart itself persists). Duplicate adds follow
  existing cart semantics (append) — the agent is prompted to surface
  "already in your cart" instead of silently re-adding.
- (S07) `orders.conversationId` links the latest sales conversation
  whenever one exists; `aiAssisted` alone marks material assistance — do
  not read linkage as attribution.
- (S05) Escalation handoffs are recorded (system message rows +
  human_handoff_requested events) but not yet DELIVERED anywhere — the
  destination is owner config (BUSINESS_CONFIG_TODO).
- (S05→S06) Sales conversation outcomes: quote_started/checkout_started/
  purchased now stamp from their routes (S06); `abandoned` needs a
  session-expiry sweep (future session). Extraction covers scalar fields
  only (painPoints/objections arrays deferred); in-chat contact info lands
  in the handoff record, not the customers table.
- (S05) `messages` ordering uses createdAt (no per-conversation sequence
  column); same-millisecond rows in one turn could theoretically
  interleave in history reads — not observed in tests, revisit if turn
  transcripts ever misorder.
- (S08) The admin page inherits the storefront layout chrome
  (header/footer) — app/layout.tsx wraps every route and opting out would
  require a route-group restructure; accepted for an internal tool (the
  chat launcher only renders under the separate AI_SALES gates).
- (S08) Classification coverage is explicit-run-driven: the dashboard
  shows pending/failed counts instead of silently classifying on load.
  A "weekly" cadence means running the admin action weekly (or wiring a
  scheduler later) — no background worker exists by design.
- (S08) Intelligence corpus queries are bounded (5,000 rows/period,
  identity scan over listInsights(1000)) — fine at current scale;
  revisit with real volume. `product_configurations` is a live mutating
  row, so the configured demand lane reflects latest-state-in-period,
  not a history.
- (S08) Admin Basic auth is single-credential (no per-user identities or
  audit trail of WHO clicked); acceptable for the single-operator stage —
  revisit before a second admin exists. Basic auth requires HTTPS in
  production (LAUNCH_CHECKLIST).
- (S09) BI queries share the S08 bounded-load posture (5,000 rows/period
  per table; sessions likewise) — fine at current scale, revisit with
  real volume. `ceo_reports.snapshotJson` stores the full snapshot per
  run (append-only); acceptable while generation is an explicit manual
  action.
- (S09) The "Last 24 hours" period is a rolling window, not a calendar
  day (documented). CEO recommendation dedup keys on the refs the model
  cites — a re-generated recommendation citing different metric refs
  creates a separate pending decision (bounded at 10/review; the owner
  dismisses stragglers; S10's Action Center is the management surface).
- (S09) `/admin/business-intelligence` inherits the storefront layout
  chrome, same as the S08 page (accepted for an internal tool).
- (S10) Admin identity is still single-credential Basic auth, so every
  `reviewedBy` reads as the one configured `ADMIN_USER` — the Action
  Center records WHAT was decided and WHEN, but not WHICH person decided
  it. Per-user RBAC and a per-person audit trail are deferred (this is the
  S08 limitation, now visible on approval records).
- (S10) Magnitude-based risk escalation ("a >X% budget increase is
  CRITICAL") is deliberately NOT implemented — it would require inventing
  X. Missing limits are surfaced as missing configuration, which blocks
  automated execution; risk itself comes from the action-type table.
- (S10) The Modify control is a JSON payload editor, not a per-field form.
  It is fully validated and re-evaluated server-side (an invalid edit is
  refused), but it expects an operator comfortable with the structured
  payload; per-type edit forms are a future refinement.
- (S10) Sync materializes actions from PENDING CEO decisions only. A
  recommendation already approved/rejected is history, not a pending
  question, so re-running sync never resurrects it.
- (S10) `/admin/ai-actions` inherits the storefront layout chrome (same as
  S08/S09) and shares their bounded-load posture (500 actions).
- (S10) The Action Center list resolves each action's latest evaluation
  with a per-row query — fine at current volume, revisit alongside the
  S08/S09 bounded-load items if action counts grow.

- (S11) Enabling `EXPERIMENT_ENGINE` changes how `/` and `/products/[slug]`
  render (static → dynamic), so the flag must be set at BUILD time: a build
  made with it off will never enrol anyone even if the flag is on at
  runtime. Documented in .env.example + LAUNCH_CHECKLIST.
- (S11) A brand-new browser's FIRST page render is not enrolled — session
  rows are minted by persisting API routes (`/api/events`) and a Server
  Component cannot set a cookie. Enrolment starts from the next navigation.
  This reduces sample; it cannot bias control vs variant, because
  non-enrolment happens before an arm is chosen.
- (S11) The `visitor` (new vs returning) audience selector exists but never
  enrols, because the signal is not deterministically known yet — ambiguity
  fails closed by design.
- (S11) Interaction between concurrent experiments on DIFFERENT targets is
  not modelled (arms are independent by salt, but a page can host two
  experiments at once). Fine at current volume; revisit with real traffic.
- (S11) No sequential-testing correction: read results at the sample
  threshold, not continuously. The minimum-sample gate is the only defence
  against peeking, and the default (1,000 exposed sessions per arm) is a
  documented development floor, NOT a power calculation.
- (S11) Guardrail metrics are event-based only. "Checkout error rate" and
  "AI failure rate" are deliberately unavailable (no per-session
  deterministic source), and contribution profit stays out while
  `config/costs.ts` is unconfigured — an unavailable metric is never turned
  into an experiment guardrail.
- (S11) The draft-experiment form is a JSON design editor, not a per-field
  builder (same posture as the S10 Modify control): fully validated
  server-side, but it expects an operator comfortable with the payload.
- (S11) `/admin/experiments` inherits the storefront layout chrome and the
  S08–S10 bounded-load posture (500 rows), and computes each experiment's
  readout with per-experiment queries — fine at current volume.
- (S11) Exposure is written during a Server Component render; React's dev
  double-render can call it twice, which the `exposed_at` dedup makes a
  no-op.

- (S12) Pricing question/objection evidence comes from AI sales conversations
  only — customers who never opened the chat are invisible to every
  conversation-level pricing metric. Every affected signal states this as a
  limitation rather than implying full coverage.
- (S12) Checkout is not attributable to a quantity tier (`checkout_started`
  records a cart value, not a product and quantity), so that column renders
  "unavailable", never 0.
- (S12) Checkout repricing (the 409 REPRICED path) is not instrumented — no
  first-party event exists, so repricing counts, confirmations and
  abandonment are genuinely unknown and are not derived from anything else.
- (S12) A conversation only reaches a per-tier rate when its session has a
  configured quantity, or a USER_STATED requested quantity together with a
  `productInterest` matching a catalog product id. The rest are counted as
  `unattributedConversations` and are absent from every per-tier rate (a
  data-quality warning says by how many).
- (S12) The configured demand lane reflects latest-state-in-period, not a
  history (`product_configurations` is a live mutating row — inherited S08
  limitation).
- (S12) The Pricing Agent context is truncated at 16k chars; the enforcement
  rules, cost truth, elasticity refusal, signals and readiness are printed
  FIRST precisely so a busy period cannot cut them, but the long tables and
  the data-quality list can truncate.
- (S12) Pricing analytics share the S08–S11 bounded-load posture (5,000
  rows/query, 20,000 session-event pairs) and `/admin/pricing-intelligence`
  inherits the storefront layout chrome, like every admin page since S08.
- (S12) Demo pricing is still active, so every tier price analysed today is a
  placeholder — a DEMO_PRICING_ACTIVE data-quality warning says so, and every
  pricing conclusion drawn now is a conclusion about the placeholder.

- (S13) Google Ads sync is MANUAL — there is no scheduler, so "weekly
  reporting" means pressing the button weekly. Freshness thresholds
  (26h fresh / 72h stale) describe how recently someone pressed it.
- (S13) Search-term and keyword performance are NOT ingested. Campaign-level
  economics came first, and Google withholds low-volume search terms for
  privacy, so that table would be incomplete by construction. The snapshot
  and the page declare the absence rather than rendering an empty table.
- (S13) Per-campaign first-party revenue depends on tracking templates.
  Without `{campaignid}` (EXACT) or a `utm_campaign` matching the campaign
  name (MAPPED), real visits are UNMATCHED: account-level figures stay
  correct, per-campaign figures are understated, and the coverage section
  says by how much. A `SPEND_WITHOUT_SESSIONS` signal exists precisely so
  "no tracking" is not mistaken for "no traffic" — and it explicitly is NOT
  evidence of click fraud.
- (S13) Google's clicks and our sessions are not expected to match: a
  visitor who leaves before first-party tracking runs is a click with no
  session. The gap is reported and is not lost revenue.
- (S13) Cost per NEW CUSTOMER is not computed — checkout is anonymous, so
  first-time vs repeat is not deterministically known. Only cost per
  attributed ORDER exists, and it is named that way everywhere.
- (S13) Session 13 is single-account by design (no multi-tenant OAuth
  onboarding). More than one `ad_accounts` row would mean the customer id
  changed; the most recently updated wins.
- (S13) Google Ads analytics share the S08–S12 bounded-load posture (5,000
  rows/query) and `/admin/google-ads-intelligence` inherits the storefront
  layout chrome, like every admin page since S08.
- (S13) `config/costs.ts` is still unfilled, so POAS is unavailable: revenue
  ROAS is shown and is explicitly not profitability. A campaign with strong
  revenue ROAS can still lose money on every order.

- (S13.5) **Every value in `config/costs.ts` is still `null`**, so gross
  profit, contribution profit, POAS and the minimum safe price are all
  unavailable. That is the shipped state, not a bug: this session built the
  model and deliberately chose none of the numbers.
- (S13.5) **Orders placed before this session carry no cost snapshot**, so
  their profit reads `HISTORICAL_COST_UNAVAILABLE` permanently. Today's costs
  are never applied backwards. Profit will appear only for orders placed after
  `config/costs.ts` is filled.
- (S13.5) A `flat_per_order` customer shipping charge is supported but makes
  shipping economics PARTIAL, because `orders` records no per-order shipping
  charge. Real shipping charging needs an order-model change alongside the
  config.
- (S13.5) `per_carton` freight rounds per LINE, not per order (separate lines
  are separate artwork and are packed apart). `per_order` freight is
  deduplicated per PRODUCT within an order.
- (S13.5) Per-product profitability is GROSS only. Order-level costs (payment
  fixed fee, order packaging, handling, shipping subsidy) are never allocated
  across products — no deterministic rule exists and none is invented.
- (S13.5) Refunds, discounts, overhead, salaries, rent, tax/duty, freight rate
  shopping, dimensional weight, FX and negotiated quote economics are all
  outside this model. It is contribution accounting, not a P&L.
- (S13.5) The configured-cost browser pass was NOT run: it would have required
  writing invented values into `config/costs.ts`, which this session forbids.
  The configured-state math is covered by 85 unit tests instead.

## Business configuration still needed

See `BUSINESS_CONFIG_TODO.md` — notably: **the four Shopify variant GIDs for
Product #1** (Large/Black, Large/White, XL/Black, XL/White), artwork storage
credentials, `NEXT_PUBLIC_SITE_DOMAIN`, the three remaining customer-facing
`[TO BE PROVIDED]` values, and `NEXT_PUBLIC_DEMO_PRICING=false` in production
(the catalog already says LIVE; both signals must agree). Prices and MOQ are
now REAL and confirmed for the launch product. Also still open: **the
entire cost model** (S13.5 completed the MODEL; `config/costs.ts` is still
100% `null` `[TO BE PROVIDED]` — margins, contribution profit, POAS and the
minimum safe price all stay "unavailable", price guardrails fail closed, and
S12's `SPECIFIC_PRICE_CHANGE` readiness stays BLOCKED until filled together
with `maximumPriceDecreasePct` / `maximumPriceIncreasePct`. A fill-in owner
template is in BUSINESS_CONFIG_TODO → "Cost model"; the architecture is
docs/UNIT_ECONOMICS.md. **Missing costs never block a sale** — only profit
analytics and future price actions), factory identity/photos, policies
legal review, Shopify store + variant mapping, production `DATABASE_URL`
(+ `npm run db:migrate` at deploy), consent-policy review for first-party
events, AI provider key + budget caps + **model pricing
(`config/ai-pricing.ts`, null placeholders — budget caps fail closed until
filled)**, **Google Ads read-only credentials (the five `GOOGLE_ADS_*`
server variables — until they exist the dashboard reads NOT_CONNECTED, which
is never interpreted as $0 spend; a PRODUCTION account is additionally needed
for the figures to mean anything, since a Google Ads test account serves no
real ads)**, guardrail thresholds — including
**`maximumExperimentTrafficPct`, which is REQUIRED before running any
experiment in production (the launch route refuses while it is null and
never assumes 100%)**.

**Added by Production Launch Session 03** (all owner input; the mechanisms
exist, the values do not):
- **`NEXT_PUBLIC_SITE_DOMAIN`** — BUILD-TIME. Unset, launch readiness BLOCKS
  and robots.txt refuses crawling rather than advertising a sitemap at a
  placeholder domain.
- **`read_orders` on the Shopify Admin token** — required by reconciliation,
  and nothing broader. Changing scopes reinstalls the app and issues a NEW
  token.
- **Platform / WAF rate-limit rules** — the only layer that can refuse a
  request before it costs a function invocation. Nothing in the repository
  substitutes for it.
- **Monitoring alert rules** — nothing here can guarantee a person reads an
  error. Suggested set: docs/OBSERVABILITY.md §4.
- **Database backups / PITR, and a TESTED restore** — BagDirect does not back
  up the database and cannot query whether you do.
- **A pooled `DATABASE_URL`** — a direct connection exhausts `max_connections`
  under ordinary serverless traffic.
- **`HUMAN_HANDOFF_WEBHOOK_URL`** (falls back to `QUOTE_WEBHOOK_URL`) —
  without it escalations are stored but nobody is notified.
- **`SENTRY_DSN` or `ERROR_WEBHOOK_URL`**, and **`RATE_LIMIT_IP_SALT`**.
- **`NEXT_PUBLIC_GOOGLE_ADS_ID` AND `NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL`** —
  both, or the conversion cannot be addressed.
- **A verified real test order and a verified refund**, plus **Shopify US
  shipping profile and tax settings** — owner verification, permanently
  WARNING until a person confirms them.

## Deferred work

Explicitly preserved for later sessions: **human escalation delivery**
(owner config), **real action executors** (none exist — the contract in
docs/AI_ACTION_CENTER.md must be satisfied first), **GUARDED_AUTO
promotion** (needs operating history + the guardrail limits in
config/guardrails.ts + an explicit human decision, Stage J), **per-user
admin RBAC** (single Basic credential today),
**real price experiments** (the
experiment engine deliberately cannot run price variants — a price test
changes cart totals, checkout, repricing semantics and what a returning
customer sees, so it needs an authority-aware design; docs/EXPERIMENTATION.md
§24), **a PRICE_CHANGE executor** (none exists; requires the full executor
contract PLUS real costs, a margin policy and price-movement limits),
**guarded-auto pricing** (allow-list empty, ceiling RECOMMEND),
**competitive/market pricing inputs** (no external price data is ingested
anywhere), **repricing instrumentation** (the two events named in
docs/PRICING_INTELLIGENCE.md §8), **winner auto-promotion** (a VARIANT_WIN never changes site
content — promotion is a human source/config change), **GUARDED_AUTO CRO**
and a real `CRO_EXPERIMENT_LAUNCH` executor (need operating history, the
guardrail limits, and the full executor contract), **adaptive traffic /
bandits / RL** (deliberately never at this stage), **multi-arm experiments**
(needs a multiple-comparison correction), **scheduled CRO reviews**, **Google Ads MUTATION of any
kind** (S13 is read-only: budget changes, pause/resume, campaign creation,
keyword management, ad creative and conversion upload all require a SEPARATE
`GoogleAdsMutationProvider` with its own OAuth scope, real ad-spend limits in
`config/guardrails.ts`, and the full executor contract — none exists),
**scheduled Google Ads sync** (manual admin action today), **Google Ads
search-term and keyword ingestion** (declared as not ingested rather than
faked), **Google Ads guarded automation**, **Meta Ads
Agent**, autonomous commerce/background actions (never — every commerce
mutation traces to an explicit customer message or tap; S08/S09
intelligence additionally runs only on explicit admin actions). Also
deferred: `createDraftQuote` tool (the AI points at /request-quote
today), `getOrderStatus` tool, Shopify order webhooks → DB order rows
(real-store aiAssisted linkage + order-status revenue semantics land
there), accounts/reorder, email automation, Merchant Center feed, further
admin surfaces (ai-usage), privacy portal UI, conversation
`abandoned` outcome sweep + intelligence abandonment labeling (needs an
inactivity rule), scheduled/weekly intelligence processing + scheduled
CEO review delivery (manual admin actions today), quote-payload demand
mining, painPoints/objections need-profile array extraction,
owner-configured confirmation thresholds (BUSINESS_CONFIG_TODO),
multi-currency conversion model (headline metrics stay single-currency
until one exists). **S13.5 additionally defers: the owner's real cost values,
advanced freight modelling (rate shopping, dimensional weight, zone tables),
refund economics (the order model supports no refunds), negotiated quote
economics, per-order customer shipping charges (needs an order-model column),
overhead/salary/tax allocation, per-line contribution allocation (no
deterministic rule exists), and a cost-editing admin panel (`config/costs.ts`
stays the single authority).** Order per `docs/AI_PLATFORM_ROADMAP.md`.

### Deferred technical debt (Session 03 audit — accepted, not forgotten)

Findings from the Session 03 independent audit deliberately NOT fixed in
the 03.5 hardening pass (small blast radius, none block Session 04):

- **`/api/events` rate limiting** — the intake validates, bounds and
  413s payloads but has no per-session/IP rate limit; add one before
  real traffic (pairs with the launch checklist, likely at the platform
  edge or in the route).
- ~~**CustomerNeedProfile concurrent-writer locking**~~ — **RESOLVED in
  Session 05** (the mandated prerequisite): transaction +
  `SELECT … FOR UPDATE` in `applyNeedProfileUpdate`, creation race via
  unique index + ON CONFLICT + re-lock; tested in
  tests/need-profile-concurrency.test.ts.
- **Multi-line order need-profile enrichment** — checkout's ORDER_DATA
  enrichment reads only the first cart line; multi-line orders
  under-enrich the profile.
- **Quote live-configuration pointer semantics** — quotes don't set
  `configurationId` to the session's live configuration row (S06 wires
  the configurator writer; decide the pointer semantics there).
- **`quote_started` event double-fire cleanup** — both
  `request_custom_quote` and `quote_form_started` map to
  `quote_started{trigger}`, so one user journey can record it twice
  with different triggers; dedup/refine when funnel reporting exists.

## Recommended next session

**Not a session. Owner configuration — BUSINESS_CONFIG_TODO → "THE SHORT
LIST".** Then re-run Production Launch Session 04. Do not start either
automatically.

Session 04 already ran and returned **NO-GO**. Re-running it against the same
empty environment will return NO-GO again for the same ten reasons; the
blockers are inputs, and no amount of engineering produces them. There is no
useful code session between here and a first sale.

**The engineering for a real, safe sale is done.** Sessions 02 and 03 closed
every P0 commerce blocker and every P1 operational risk; Session 04 verified
the fail-closed behaviour on a real production build and fixed the three
reporting/output bugs it found. What remains is owner data and owner
configuration — and `/admin/launch-readiness` computes the exact list from the
running system, which is more trustworthy than anything written down here.

### Remaining P0 — all owner input, none engineering

| Blocker | Where |
| --- | --- |
| Shopify store domain + Admin token (with `read_orders`) + webhook secret + webhook registration | env + Shopify admin |
| The merchandise map | `config/shopify.ts` (ships empty) |
| Artwork storage credentials, private bucket, CORS | env |
| Real prices, then `NEXT_PUBLIC_DEMO_PRICING=false` | `config/products.ts` |
| MOQ confirmation | `config/business.ts` |
| `NEXT_PUBLIC_SITE_DOMAIN` | env (build-time) |
| Customer-facing `[TO BE PROVIDED]` values | `config/business.ts` |
| Production pooled `DATABASE_URL` + `npm run db:migrate` + backups + a tested restore | env + provider |
| `ADMIN_USER` / `ADMIN_PASSWORD` | env |
| A verified real test order and a verified refund | Shopify + the smoke test in docs/PRODUCTION_OPERATIONS.md §9 |
| Shopify US shipping profile and tax settings verified | Shopify admin |

### Remaining P1 — materially wanted before real traffic, still owner-side

- **Platform / WAF rate-limit rules.** The application layers exist; the outer
  one is configuration.
- **Monitoring alert rules.** Nothing in the repository can guarantee a person
  reads an error.
- **`HUMAN_HANDOFF_WEBHOOK_URL`** and **`QUOTE_WEBHOOK_URL`** — otherwise a
  customer asking for a human, or a B2B quote, waits until someone opens a
  page.
- **`SENTRY_DSN` or `ERROR_WEBHOOK_URL`**, and **`RATE_LIMIT_IP_SALT`**.
- **Google Ads conversion id AND label**, plus a tracking template carrying
  `{campaignid}` so first-party attribution can match campaigns.
- **`npm run ai:smoke`** before enabling AI Sales for customers. It was NOT
  run this session — no credentials were present, and inventing a passing
  result would be worse than reporting none.

### What Session 04 would actually DO

Not new features. Configuration, then proof:

1. Walk `/admin/launch-readiness` to green (or to owner-verified WARNING).
2. Run the launch smoke test end to end: one real payment, one refund, with
   every assertion in docs/PRODUCTION_OPERATIONS.md §9 checked.
3. Verify conversion delivery in GA4 DebugView and the Google Ads tag
   diagnostic, including that a refresh does not double-count.
4. Set the soft-launch flag matrix, remembering that
   `EXPERIMENT_ENGINE_ENABLED` changes render mode and needs a rebuild.
5. Send a small amount of real traffic, and watch the alerts fire (or not).

**And still, from before all of it and arguably worth more than any of it:
filling `config/costs.ts`.** Session 13.5 built the complete unit-economics
model and deliberately supplied none of its numbers. Filling it unblocks gross
profit, contribution profit, the minimum safe price and POAS across S09, S12
and S13 at once — POAS being the only advertising metric that can tell you
whether a campaign makes money. The template is in BUSINESS_CONFIG_TODO →
"Cost model". A business-input task, not a coding session.

---

## Deferred: Session 14 — Google Ads Recommendation Agent + Guarded Action Preparation

Not the recommended next step any more — launch operations come first. Kept
here because its analysis is still accurate.

**Before it, and worth more: fill `config/costs.ts`.** Session 13.5 built the
complete unit-economics model and deliberately supplied none of its numbers.
Filling it unblocks gross profit, contribution profit before paid media, the
minimum safe price and POAS across S09, S12 AND S13 at once — POAS being the
only advertising metric that can tell you whether a campaign makes money. The
fill-in template is in BUSINESS_CONFIG_TODO → "Cost model". That is a
business-input task, not a coding session.

Why this and not something else: Session 13 built the measurement layer and
deliberately stopped at the boundary. The platform can now see what each
campaign costs and what it produced in first-party terms, and it can raise
REVIEWS about that — but every advertising ACTION remains unrepresentable,
unmapped, executor-less and limit-blocked. Session 14 is where the owner
decides whether to cross that line, and under what constraints.

What it would have to establish, in order:

1. **Real ad-spend limits** in `config/guardrails.ts` —
   `maximumDailyAdSpendCents`, `maximumCampaignBudgetChangePct`,
   `maximumNewCampaignTestBudgetCents`. All three are `null` today, and a
   `null` limit BLOCKS; it never means "no limit". These are business
   inputs, not code.
2. **A separate `GoogleAdsMutationProvider`** — its own file, its own OAuth
   scope, its own tests. The reporting provider is never extended, because
   its three-method surface is what makes the read-only guarantee checkable.
3. **The first real executor**, satisfying the contract in
   docs/AI_ACTION_CENTER.md end to end: validated action → fresh evaluation →
   human approval → idempotency key → before/after snapshot → audit →
   rollback. `modules/guardrails/executors.ts` has been empty since S10 on
   purpose; registering the first entry is the single largest authority
   change this platform has made.
4. **Human approval per action**, with GUARDED_AUTO left for Stage J after
   real operating history.

Boundaries that must survive it: the READ path stays structurally read-only
(a mutation provider is added BESIDE it, never merged into it); Google's
conversions never become BagDirect orders; and profit-based decisions stay
unavailable until `config/costs.ts` is filled.

Also available if the owner prefers, and arguably worth more: **filling
`config/costs.ts`**. It unblocks profit intelligence across S09, S12 AND S13
at once — margin, minimum safe price, the first pricing recommendation that
could ever carry a number, and POAS, which is the only advertising metric
that can actually tell you whether a campaign makes money. That is a
business-input task, not a coding session.

Second alternative: **improve Google Ads tracking coverage** before adding
any automation. Adding `{campaignid}` to tracking templates moves attribution
from MAPPED to EXACT and raises match coverage, which is what makes every
per-campaign number on the new dashboard trustworthy. Also a configuration
task, not a coding session.
