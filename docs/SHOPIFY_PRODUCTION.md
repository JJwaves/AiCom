# Shopify Production Commerce

**Authoritative for: provider selection, catalog authority, merchandise
mapping, checkout, price consistency, webhooks, order authority.**
Implemented in Production Launch Session 02 (2026-08-16).

Companion documents: [ARTWORK_STORAGE.md](ARTWORK_STORAGE.md),
[UNIT_ECONOMICS.md](UNIT_ECONOMICS.md),
[AI_COMMERCE_INTEGRATION.md](AI_COMMERCE_INTEGRATION.md).

---

## 1. The one-paragraph version

BagDirect owns the catalog and the price. Shopify owns the money.

`config/products.ts` defines what exists and `modules/pricing` computes what
it costs. Checkout creates a Shopify **draft order** whose every line carries
an explicit `priceOverride` set to that engine price, then reads the draft
order back and verifies it line by line before letting the customer near it.
Payment happens on Shopify's hosted checkout. The paid order comes back as a
**webhook**, and only then does BagDirect record a sale.

In production, missing Shopify configuration is a **hard failure**. There is
no mock fallback.

---

## 2. Provider architecture

```
lib/commerce/
  config.ts              THE guard — resolves credentials or THROWS
  index.ts               getCommerce() — the one selection point
  provider.ts            the CommerceProvider interface
  mock.ts                dev/test only; refuses to run in production
  shopify.ts             the production provider (draft orders)
  shopify-transport.ts   the ONLY place the Admin token is attached
  catalog.ts             the one catalog read path (no provider hop)
  cart-line.ts           S07 AI-path cart validation (unchanged)
  webhook-verify.ts      HMAC
  shopify-webhook-payload.ts   defensive payload parsing
  order-reconciliation.ts      Shopify truth → BagDirect orders
```

### The production guard (§3)

| environment | Shopify config | result |
|---|---|---|
| development / test | none | **mock provider** |
| development / test | partial | **THROWS** |
| development / test | complete | Shopify provider |
| production | none | **THROWS** |
| production | partial | **THROWS** |
| production | complete | Shopify provider |

Partial configuration throws in *every* environment: half-set credentials
always mean Shopify was intended, and silently degrading to mock is the exact
bug class this guard exists to delete.

**What the old behaviour would have done in production:** minted `MOCK-*`
order ids, written `Order` rows, fired the authoritative `purchase_completed`
event and marked sessions converted — while charging nobody and shipping
nothing. Business intelligence, profitability, POAS and ad attribution would
all have reported that as real revenue. Fake revenue is worse than no revenue.

The mock provider additionally throws if invoked directly with
`NODE_ENV=production`, so even a future route or script cannot mint a mock
order in production.

**What a misconfiguration looks like in production:** the storefront still
renders (see §3 — the catalog is local), `/api/checkout` answers **503** with
customer-safe copy, and the server log names the missing variables. Customers
can browse a store that cannot yet take money; they are never sold a fake
order.

---

## 3. Catalog authority vs merchandise representation (§7, §8)

This distinction is the one most likely to be undone by a future session, so
it is stated plainly:

| concern | authority |
|---|---|
| which products exist | **BagDirect** (`config/products.ts`) |
| which sizes/materials/colors/print options are legal | **BagDirect** |
| quantity tiers and the price | **BagDirect** (`modules/pricing`) |
| what a customer configured | **BagDirect** (`product_configurations`) |
| a purchasable item Shopify can attach shipping, tax and payment to | **Shopify variant** |
| payment | **Shopify** |
| paid-order truth | **Shopify** |

`listProducts()` and `getProduct()` on the Shopify provider serve the
BagDirect catalog. That is **not a fallback and not a stub** — it is the
architecture. Shopify has no representation for quantity tiers, print-option
deltas or custom-quote routing, so a Shopify catalog read would be strictly
less information.

Consequences, all deliberate:

- the storefront renders whether or not Shopify is reachable
- a catalog read makes no network call and needs no credential
- `next build` can prerender product pages with commerce unconfigured
- **there is no remote catalog read to fail, so there is nothing to fall back
  from** — the Session 01 hazard ("Shopify is down" → "show demo products") is
  structurally gone, not merely disabled

`lib/commerce/catalog.ts` remains the single read path; a structural test
asserts nothing outside `lib/commerce/` imports `config/products` directly.

---

## 4. Merchandise mapping (§5, §6)

**`config/shopify.ts` is the only place a Shopify id appears.**

```
BagDirect product · size · material · color  →  Shopify ProductVariant GID
```

Key format: `productId|sizeId|materialId|colorId`, built by exactly one
function (`merchandiseKey`).

### Why only four dimensions

A configuration has six variable fields. Only four identify distinct
*merchandise*:

- **product, size, material, color** — the physical thing → a Shopify variant
- **printOption** — a service applied to it → a line attribute
- **quantity** — → the line quantity

Print option and quantity change the **price**, not the item, and BagDirect
owns price. Folding them into the variant key would demand roughly 1,700
Shopify variants that exist only to encode arithmetic this codebase already
does deterministically.

### Resolution rules

Exact match only. There is **no** nearest match, **no** default variant, **no**
"first variant of the product", **no** fuzzy matching and **no** AI. An
unmapped configuration:

- fails `resolveMerchandise` with `unmapped_configuration`
- **never reaches Shopify** — the failure happens while building the request
- returns HTTP 409 `UNAVAILABLE_CONFIGURATION` with copy directing the
  customer to a custom quote

Shipping a customer the wrong physical bag is worse than failing their
checkout.

### Validation

`validateMerchandiseMap()` reports:

- **error** — a key that is not a purchasable configuration (typo)
- **error** — two keys pointing at the same variant GID (one would sell the
  wrong item)
- **error** — a malformed GID
- **missing** — a required key with no mapping (`[TO BE PROVIDED]`)

`requiredMerchandiseKeys()` derives the exact list the owner must fill, from
the real catalog. Custom colors are excluded: they are quote-only and can
never reach checkout, so asking for variants would be asking for merchandise
that can never be sold.

**The shipped map is EMPTY.** This session implemented the mechanism; the
owner supplies the ids.

---

## 5. Price consistency (§9, §12) — the important section

### Why draft orders, not the Storefront cart

Shopify's Storefront Cart API **cannot express a custom line price**
(`CartLineInput` accepts `merchandiseId`, `quantity` and `attributes` — no
price field). The charged price would be the variant's catalog price.

A BagDirect price is `tier(quantity) + material delta + print delta`. A single
variant price cannot encode it. So a Storefront-cart checkout would have
charged a number BagDirect did not compute — the precise failure §9 forbids.

The Admin API's `draftOrderCreate` accepts `priceOverride` per line
*alongside* `variantId`, which gives both: the real variant (its shipping
profile, tax code, inventory and product identity) **and** BagDirect's price.

### The flow

```
Client cart (browser state, never trusted)
        │
        ▼
/api/checkout — re-prices EVERY line with modules/pricing
        │  ├─ drift vs the browser's numbers → 409 REPRICED (S07, unchanged)
        │  ├─ invalid line / missing artwork  → 422
        │  └─ artwork not owned by this session → 422
        ▼
Order row created as `pending_payment`  ← NOT revenue
        │
        ▼
draftOrderCreate  — priceOverride = the engine price, per line
        │
        ▼
READ BACK and VERIFY: per-line unit price, per-line total, quantity,
currency, and the subtotal
        │  └─ any divergence → DELETE the draft order, fail visibly
        ▼
Shopify invoiceUrl → the customer pays on Shopify
```

Verification is not paranoia about Shopify's arithmetic. It catches a
mis-built request: a dropped `priceOverride`, a variant whose catalog price
won, a quantity that did not survive serialisation, a currency the store is
not configured for. Any of those would charge the customer a number BagDirect
never quoted.

Money crosses the boundary as integer cents ↔ a 2-decimal string, converted by
`centsToDecimalString` / `decimalStringToCents`. `decimalStringToCents`
returns `null` on anything that is not a clean 2-decimal amount rather than
rounding — silently rounding is how a customer ends up paying a different
number.

**`409 REPRICED` semantics are unchanged from Session 07.** Nothing in this
session weakens them.

---

## 6. What travels to Shopify (§11)

### Line-item attributes

Customer-visible (no underscore): `Size`, `Material`, `Color`, `Printing`,
`Quantity`, `Artwork file`.

Internal (leading `_`, hidden by Shopify convention): `_bd_product_id`,
`_bd_line_id`, `_bd_artwork_id`.

### Order attributes

`_bd_order_id` (the reconciliation key), `_bd_session_id`, and first-party
attribution as `_bd_attr_<key>` — `utm_*`, `gclid`, `gbraid`, `wbraid` and
anything else the session recorded.

### Deliberately absent, and asserted by tests

Unit cost, COGS, margin, margin floor, contribution profit, any
`config/costs.ts` value, any API token, any AI prompt or model output, and any
contact detail. Shopify collects its own customer PII at checkout; BagDirect
pushes none into it.

The artwork reference is the **durable artwork id**, never a signed URL:
signed URLs expire, and the factory needs a reference that still resolves
months later. BagDirect's database remains the authoritative artwork
association (§31).

---

## 7. Webhooks (§13–§15)

**Route:** `POST /api/webhooks/shopify`

**Topics:** `orders/create`, `orders/paid`, `orders/cancelled`,
`refunds/create` (`SHOPIFY_WEBHOOK_TOPICS` in `config/shopify.ts`).

### Order of operations *is* the security model

1. read the **raw** body (`req.text()`) — never `req.json()` first
2. verify the HMAC
3. only then parse, and only then touch the database

Step 3 never happens before step 2. A structural test asserts the ordering,
because anyone who could forge this endpoint could mint revenue.

Shopify signs the exact bytes it sent. `JSON.parse` then `JSON.stringify`
changes whitespace, and the signature no longer matches — a test pins this.

### HMAC

Header `X-Shopify-Hmac-Sha256`, base64 HMAC-SHA256 over the raw body, keyed by
`SHOPIFY_WEBHOOK_SECRET`, compared with `timingSafeEqual` on decoded buffers.
The verifier logs nothing, never throws on attacker-controlled input, and
fails **closed** when no secret is configured (503, with a loud server log
saying paid orders will not be reconciled).

### Response codes are instructions to Shopify

| code | meaning |
|---|---|
| 401 | bad signature → do not retry |
| 200 | processed, ignored, or duplicate → stop retrying |
| 500 | processing failed → **please retry** (the claim is released) |
| 503 | no webhook secret configured → retry after it is set |

A 200 on an unparseable body is deliberate: Shopify retrying a payload we
structurally cannot read for 48 hours helps nobody.

### Idempotency — and why it is NOT the delivery id

The key is `(provider, topic, SUBJECT id)`: the **order id** for order topics,
the **refund id** for refund topics. Stored in `provider_webhook_events` with
a UNIQUE constraint, claimed by insert-first (never read-then-write, so two
concurrent deliveries cannot both see "not processed yet").

`X-Shopify-Webhook-Id` is stored for diagnostics only. Deduping on it would be
wrong: a merchant re-sending the same event from the admin gets a **new**
delivery id for the **same** business fact, which would process that payment
twice.

If processing throws, the claim is **released** so the retry is real work
rather than a skipped "duplicate".

---

## 8. Order authority (§16)

```
cart              → BagDirect browser state
price             → BagDirect deterministic engine
checkout          → Shopify hosted checkout
PAYMENT TRUTH     → Shopify
PAID ORDER TRUTH  → Shopify, delivered by webhook
BagDirect order   → RECONCILED from that truth
```

**A browser returning from Shopify proves nothing** and is never treated as
payment.

### Why the order row is created before payment

`/api/checkout` writes the order as `pending_payment` **before** calling
Shopify, because that row is the only place the exact server-priced lines, the
immutable configuration snapshots, the artwork links, the attribution and the
cost snapshot exist together. Its id travels to Shopify as `_bd_order_id` and
comes back on the paid order, so **reconciliation is a lookup, not a
reconstruction**. Rebuilding an order from Shopify's line items would mean
re-deriving the configuration from display attributes, and any gap would
silently corrupt what the factory prints.

`pending_payment` is in `EXCLUDED_ORDER_STATUSES`
(`modules/business-intelligence/revenue.ts`), so it is excluded from revenue,
AOV, profitability and every conversion metric. An abandoned Shopify checkout
stays as honest abandoned-checkout data.

This is the **one** place where "persistence is additive to commerce" does not
apply: if the pending order cannot be written, the checkout fails. Without it
a paid order could never be linked to a configuration, an artwork file or a
session — the factory would receive money and no printable instructions.

### purchase_completed fires exactly once (§19)

From one place: the `transitioned` flag returned by `markOrderPaid`, which
flips inside a row-locked transaction. A replayed webhook, an `orders/paid`
following an already-paid `orders/create`, or two concurrent deliveries all
see `transitioned: false` and do nothing.

It does **not** fire because a checkout URL was created, a browser redirected,
a customer returned, or the AI requested checkout.

The same flag gates the conversion mark, the `purchased` conversation outcome
and the `ORDER_DATA` need-profile enrichment.

### Shopify's total is not copied over BagDirect's

Shopify's `total_price` includes shipping and tax; `orders.totalCents` is the
BagDirect product subtotal, and it is the figure every profit calculation
divides by. Overwriting it would silently redefine every margin. A test pins
this.

---

## 9. Cancellation and refunds (§45, §46)

**Cancellation:** `orders/cancelled` sets `status = "cancelled"` and stamps
`cancelled_at`. Cancelled orders are excluded from revenue by the existing
S09 filter, so a cancelled order cannot remain reported as valid revenue.

**Refunds:** `orders.refunded_total_cents` accumulates what Shopify reports.
Reaching the order total moves the status to `refunded`; anything less leaves
the order `paid` with the partial amount recorded.

Refund amounts are summed from the refund's **transactions**, not its
`refund_line_items` — the latter excludes shipping and manual adjustments and
would systematically under-report.

**Deferred, explicitly:** per-line refund allocation, refund economics in the
unit-economics ladder, and refund-adjusted product profitability. Shopify
refunds can be arbitrary amounts against arbitrary lines; inventing an
allocation would produce precise-looking per-product profit that is not true.
BagDirect never *executes* a refund — Shopify remains the refund authority.

---

## 10. Shipping and tax (§37, §38, §39)

**Shipping is Shopify's.** The draft order sets **no** `shippingLine`, which
leaves Shopify's shipping profiles to rate the order from the customer's real
address at checkout. BagDirect does not calculate shipping and does not claim
to. `config/shipping.ts` remains a storefront *messaging* estimate only.

**Tax is Shopify's.** No custom tax engine exists. The draft order sets no tax
fields; the variant's tax settings and the store's tax configuration apply.

**Neither is verified.** Both require a real store with shipping profiles and
tax registration configured, and both are launch-checklist items. This
document does not claim they work until that test is run.

**Canada:** not expanded in this session. Prepare for a **US-only soft
launch**. Nothing here blocks future Canada support — `currency` is already
per-product and the merchandise map is per-configuration — but CA shipping,
tax and customs behaviour is unconfigured and untested.

---

## 11. Error handling (§42, §43)

Customers never see a raw Shopify API error, a stack trace or an internal
code.

| failure | customer sees | status |
|---|---|---|
| commerce not configured | "Checkout is temporarily unavailable" | 503 |
| unmapped configuration | "That exact combination isn't available to order online yet — request a custom quote" | 409 |
| Shopify down / timeout | "Checkout is temporarily unavailable. Nothing was charged" | 502 |
| price mismatch | same as above (and the draft order is deleted) | 502 |
| artwork missing/unowned | "We couldn't find that uploaded logo — please upload it again" | 422 |
| invalid webhook signature | *(nothing — Shopify's problem)* | 401 |
| webhook replay | *(nothing)* | 200 |

**Timeouts and retries:** 15s per Shopify request. Idempotent operations get
up to 3 attempts on transport failures, 429 and 5xx. **Mutations are never
retried** — a retried `draftOrderCreate` whose first attempt actually
succeeded creates two invoices for one cart. GraphQL-level errors (bad field,
bad id, missing scope) are contract errors and are never retried.

---

## 12. API version (§34)

`SHOPIFY_API_VERSION = "2026-07"` in `config/shopify.ts` — **one constant, no
inlined version strings anywhere** (a structural test enforces this).

`SUPPORTED_SHOPIFY_API_VERSIONS` lists the versions this codebase has been
verified against. `SHOPIFY_API_VERSION` (env) may pin one of them; a value
outside the list **throws** rather than silently talking to an unverified API.

### Upgrade procedure

1. read Shopify's changelog for the target version, focusing on
   `draftOrderCreate`, `DraftOrderLineItemInput.priceOverride`,
   `DraftOrderLineItem.originalUnitPriceSet` and the four webhook topics
2. add the version to `SUPPORTED_SHOPIFY_API_VERSIONS`
3. set `SHOPIFY_API_VERSION` in staging only
4. run the production smoke test (§14)
5. promote by changing `SHOPIFY_API_VERSION` (the constant), then remove the
   env pin

---

## 13. Owner configuration required

Server-only. Never `NEXT_PUBLIC_*`, never committed, never logged.

| variable | purpose | required for |
|---|---|---|
| `SHOPIFY_STORE_DOMAIN` | `your-store.myshopify.com` | checkout |
| `SHOPIFY_ADMIN_API_TOKEN` | Admin API access token (`shpat_…`), scopes `write_draft_orders` **and `read_orders`** | checkout + reconciliation |
| `SHOPIFY_WEBHOOK_SECRET` | webhook signing secret | order reconciliation |
| `SHOPIFY_API_VERSION` | optional pin | — |

Plus `config/shopify.ts → SHOPIFY_MERCHANDISE_MAP`: one Shopify variant GID
per purchasable configuration.

**`read_orders` was added in Production Launch Session 03**, for the
reconciliation sweep (§16) and for nothing else. It is the minimum that
feature needs: not `write_orders`, not `read_customers`, not `read_products`,
not `read_all_orders` (which is a separately-approved scope for orders older
than 60 days, and is not required). If the scope is missing, the sweep records
a `failed` run naming the reason — it never degrades into "found nothing",
which would read as "everything is fine".

Changing scopes on a custom app requires reinstalling it in the Shopify admin,
which issues a NEW access token. Update `SHOPIFY_ADMIN_API_TOKEN` and
redeploy.

`SHOPIFY_ADMIN_API_TOKEN` was present but unused before this session; it is
now genuinely required, for draft-order creation. There is no Storefront
token in the architecture any more — the Storefront API cannot express the
price, so it is not used.

### Webhook registration (§33)

Not self-registered — registration is an operational step, done once in the
Shopify admin (Settings → Notifications → Webhooks) or via the Admin API:

| topic | callback |
|---|---|
| `orders/create` | `https://<domain>/api/webhooks/shopify` |
| `orders/paid` | `https://<domain>/api/webhooks/shopify` |
| `orders/cancelled` | `https://<domain>/api/webhooks/shopify` |
| `refunds/create` | `https://<domain>/api/webhooks/shopify` |

Format JSON, API version matching `SHOPIFY_API_VERSION`. The signing secret
shown after creating the first webhook is `SHOPIFY_WEBHOOK_SECRET`.

---

## 14. Production smoke test

Run against a **real store in test mode** (Shopify's Bogus Gateway or a test
payment). Do not run against live payments.

1. `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_ADMIN_API_TOKEN` set; app starts
2. `/products/...` renders; prices match `config/products.ts`
3. `validateMerchandiseMap()` reports `complete: true`
4. configure a product → add to cart → Checkout
5. the browser is redirected to a `*.myshopify.com` invoice URL
6. **the Shopify checkout shows exactly the BagDirect total** (line by line)
7. shipping options appear after entering an address
8. tax is calculated
9. pay with a test payment
10. `orders/paid` arrives; the BagDirect order flips `pending_payment` → `paid`
11. exactly one `purchase_completed` event exists for that order
12. re-send the webhook from the Shopify admin → nothing changes
13. refund part of the order → `refunded_total_cents` updates, status stays `paid`
14. refund the rest → status becomes `refunded`
15. cancel a different test order → status becomes `cancelled`

---

## 15. Known limitations

- **Fulfilment sync is not implemented.** Shipping status, tracking numbers
  and fulfilment events stay in Shopify. Order status in BagDirect advances to
  `paid` and stops; the pipeline states (`artwork_review` → `production_ready`)
  exist in the schema but nothing drives them yet.
- **Customer records are not created from Shopify orders.** Shopify collects
  the email at checkout; BagDirect does not pull it back. Orders link to a
  session, not to a `customers` row, unless a quote created one earlier.
- **Partial-refund accounting is a single cumulative amount**, not per line
  (§9).
- **Shopify's grand total is not stored.** Only the BagDirect product subtotal
  is, deliberately (§8).
- **Multi-currency is untested.** `presentmentCurrencyCode` is sent, but a
  store must be configured for the currency; the cart already refuses mixed
  currencies.
- **No automatic webhook registration** — an operational step (§13).
- **Reconciliation is manual, not scheduled.** Production Launch Session 03
  added the sweep itself (§16 below); what does not exist is a cron that runs
  it. That is deliberate — no scheduler was introduced this session — but it
  does mean a lost webhook is only recovered when someone presses the button.


---

## 16. Lost-webhook reconciliation (Production Launch Session 03 §24–§28)

### The failure this exists for

Shopify retries a failed webhook for roughly 48 hours and then stops. An
endpoint that was down for that whole window — a bad deploy, an expired
certificate, a database outage — loses that payment's notification
permanently. The customer paid. Shopify knows. The BagDirect order sits at
`pending_payment` forever: excluded from revenue, missing from fulfilment, and
no amount of waiting fixes it, because nothing is going to knock again.

### How to run it

`/admin/launch-readiness` → **Reconcile Shopify orders**, or POST to
`/api/admin/commerce/reconcile` with `{"lookbackHours": 72}` (1 hour to 14
days; 72 by default). Authenticated admin only, same-origin, JSON content
type.

### What it does

1. Reads a bounded window of Shopify orders via one GraphQL **query**
   (`lib/commerce/shopify-orders.ts` — no mutation is defined there and none
   is importable from it, asserted structurally).
2. For each one, calls `reconcileOrderSnapshot`, which routes into **the same
   primitives the webhook path uses** — including the single row-locked
   `transitioned` flag that fires `purchase_completed`. There is no second
   order-processing implementation, so a repaired order is indistinguishable
   from a webhook one.
3. Records the run: range, orders inspected, repairs performed, already
   consistent, failures, truncation, status.

### Idempotence is the safety property

Every primitive it calls is a no-op when the state already matches:

| Situation | Result |
| --- | --- |
| Webhook already processed the order | `alreadyConsistent`, nothing changes, no duplicate purchase event |
| Sweep run twice over the same window | Second run repairs nothing |
| Webhook arrives after a repair | `transitioned: false`, nothing fires |
| Order placed in the Shopify admin (no `_bd_order_id`) | Reported `unmatched`; never fabricated into a BagDirect order with invented configuration |

**Refund totals are SET, not accumulated.** `recordOrderRefund` adds, which is
right for a `refunds/create` webhook (each delivery is one new refund event).
The sweep sees Shopify's `totalRefunded` — a running total — so it uses
`setOrderRefundTotal`, which writes the absolute figure and never decreases
it. Adding a cumulative figure to an existing total is exactly the
double-counting bug a naive implementation would ship.

### Reading a run

- `success` — the window was fully inspected and everything is consistent or
  repaired. **A run that repairs zero orders is the healthy result.**
- `partial` — some orders failed, or the window was `truncated` (larger than
  one sweep covers). Run it again for a shorter window.
- `failed` — Shopify could not be read at all. `PROVIDER_READ_FAILED` with the
  reason, most often a missing `read_orders` scope.
- `not_configured` — Shopify is not configured; there is nothing to
  reconcile.

Repairs log `code:WEBHOOK_GAP_REPAIRED`. **Alert on it**: a repair means a
payment reached you only because a human pressed a button.
