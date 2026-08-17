# Analytics and Conversion Tracking in Production

Production Launch Session 03. Where a purchase comes from, where it goes, and
what each destination is actually worth.

---

## 1. Four things called "purchase", and only one of them is truth

| Name | What it is | Where it lives |
| --- | --- | --- |
| `purchase_completed` | **The authoritative transaction.** Written server-side from an HMAC-verified Shopify webhook. | `events` table |
| GA4 `purchase` | Analytics DELIVERY | Google Analytics |
| Google Ads conversion | Ad-platform SIGNAL | Google Ads |
| Meta `Purchase` | Ad-platform SIGNAL | Meta |

Every business number — revenue, AOV, conversion rate, profitability, POAS,
CEO reporting — reads the first. The other three are copies sent to vendors.

**If all three vendor copies fail, the customer's order is still complete,
still paid, still fulfilled and still counted.** Nothing in the analytics
layer can mutate an order; the conversion module imports no order, checkout or
database code, and a structural test asserts it.

---

## 2. The path a purchase takes

```
customer confirms cart
      ↓
/api/checkout            → BagDirect order row, status pending_payment
                           (excluded from revenue; NOT a sale)
      ↓                    the BagDirect order id is remembered in the
                           browser as a PENDING order — an intention
customer pays on Shopify
      ↓
Shopify → signed webhook → markOrderPaid (row-locked, ONE transitioned flag)
      ↓
purchase_completed        ← the authoritative event, exactly once
      ↓
customer returns to a BagDirect page
      ↓
server is asked: "is this order, which belongs to my session, paid?"
      ↓  paid
GA4 · Google Ads · Meta   ← consent-aware, deduplicated by transaction id
```

A purchase never fires because a checkout started, a draft order was created,
an invoice URL was opened, a browser came back, or the AI asked for a
checkout.

### What changed

The confirmation page used to read an order out of `sessionStorage` and fire
`purchase` whenever the URL carried `?placed=1`. Both were browser state: the
parameter could be typed, the stored object was written *before* any payment
existed, and a customer who abandoned the Shopify checkout could still reach a
page that reported a sale. Both inputs are gone.

---

## 3. The confirmation endpoint

`GET /api/orders/confirmation?order=<bagdirect order id>`

- **Session-scoped.** Only the session that placed the order gets an answer.
  Order ids are unguessable, but "unguessable" is not an authorization model:
  ids travel in URLs, history, screenshots and support tickets.
- A non-existent order and someone else's order return the **identical** 404 —
  no existence oracle.
- **Mints no session.** A GET that creates a row would be a write amplifier
  for anyone with a URL.
- Returns: order id, transaction id, paid flag, status, currency, value in
  cents, placed/paid timestamps, line items, and a `demo` flag for
  mock-provider orders.
- Returns **no** cost, margin, cost-model version, attribution, session id,
  customer id, email or artwork metadata.

---

## 4. Deduplication

Every destination gets the same `transaction_id`: the **provider order id**
(Shopify's), falling back to the BagDirect order id when Shopify has not named
one yet. One transaction, one id, in Shopify, in GA4, in Ads, and on the
customer's receipt.

Two guards:

1. **Local.** A fired transaction id is remembered in `localStorage`
   (`bd_fired_purchases_v1`, bounded to 20), so a refresh or a second visit
   does not send it again.
2. **Vendor.** GA4 and Meta both drop a repeat purchase with a transaction id
   they have already seen; Google Ads deduplicates on `transaction_id` when it
   is supplied, which is why it always is.

The local guard exists because "the vendor will deduplicate it" is a claim
about someone else's system.

The first-party `purchase_completed` has its own exactly-once rule — the
row-locked `transitioned` flag — and is unaffected by any of this.

---

## 5. Consent

Two axes, because the destinations are two different things:

| Axis | Gates |
| --- | --- |
| `analytics` | GA4 |
| `advertising` | Google Ads, Meta Pixel |

"Analytics only" is a real choice, honoured all the way down to
`deliverPurchaseConversions`. Declining both sends nothing at all — no tag
script loads, and no event is delivered.

---

## 6. Configuration

All build-time inlined (`NEXT_PUBLIC_*`). **Changing any of them requires a
redeploy.**

```bash
NEXT_PUBLIC_GTM_ID=                        # optional; if set, GTM manages the tags
NEXT_PUBLIC_GA4_ID=G-XXXXXXX
NEXT_PUBLIC_GOOGLE_ADS_ID=AW-XXXXXXXXX
NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL=xxxxxxxxxxxxxxx
NEXT_PUBLIC_META_PIXEL_ID=
```

**Google Ads needs BOTH the id and the conversion label.** The label comes
from the conversion action in Google Ads → Goals → Conversions → your purchase
action → "Tag setup" → "Use Google tag" — the `send_to` value is
`AW-XXXXXXXXX/label`. An id without a label is reported as *not configured*,
because a conversion cannot be addressed without it.

Unconfigured destinations fail **silently from the customer's perspective**
and are reported honestly on `/admin/launch-readiness`.

### GTM vs direct gtag

- `NEXT_PUBLIC_GTM_ID` set → GTM is loaded and there is no `window.gtag`. The
  `purchase` **dataLayer** event still fires; configure your GA4 and Google
  Ads tags inside GTM to trigger on it. Readiness reports this honestly rather
  than claiming a direct send.
- No GTM, GA4 and/or Ads id set → `gtag.js` is loaded once and each
  destination is `config`-ured on it, each gated by its own consent axis.

---

## 7. The reliability limitation — READ THIS

**Browser-based conversion tracking undercounts.** It depends on the buyer
returning to a BagDirect page after paying. A customer who closes the tab on
Shopify's order-status page never runs the code, so GA4 and Google Ads will
see fewer purchases than actually happened.

This is a **measurement gap, not a data gap**: `purchase_completed` is written
server-side from the webhook and is complete regardless. Revenue, AOV,
conversion rate and profitability all read that.

To close the ad-platform gap, configure Shopify's own checkout tracking —
Shopify admin → Settings → Customer events, or the Google & YouTube / Meta
sales channel apps. That fires from Shopify's thank-you page, which the buyer
does reach. Use the **same conversion action** so Google Ads deduplicates on
`transaction_id` rather than double-counting.

---

## 8. Meta Conversions API — deferred, honestly

Server-side Meta CAPI is **not implemented**. The browser Pixel `Purchase`
event carries an `eventID` equal to the transaction id, which is precisely
what a future CAPI send would deduplicate against — so adding it later is a
server-side change only.

It is deferred because Google paid traffic is the primary launch requirement
and a CAPI subsystem (access token handling, event hashing rules, PII
normalisation, the test-event workflow) is not a small addition. `META_ACCESS_TOKEN`
and `META_DATASET_ID` remain in `.env.example` as server-only placeholders and
are not read by any code today.

---

## 9. Google Ads campaign attribution — OWNER ACTION

BagDirect's first-party attribution (`lib/attribution`) already captures
`gclid`, `gbraid`, `wbraid` and the `utm_*` parameters from the landing URL,
and stores them on the session and the order.

For campaign-level matching, add a **tracking template** or **final URL
suffix** in Google Ads so campaign identity arrives in the URL:

```
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}&gad_source={gad_source}
```

Set it at **Account settings → Tracking → Tracking template**, or per campaign
as a Final URL suffix. Auto-tagging (`gclid`) should stay ON — it is what
Google itself matches on; the `utm_*` values are what BagDirect's own
attribution reads.

Nothing in this repository modifies your Google Ads account. The Google Ads
integration is **read-only** and gained no conversion-upload capability in
this session — asserted structurally.

---

## 10. Verifying it

1. **Consent declined** → no tag script loads, no network call to Google or
   Meta.
2. **GA4 DebugView** (Admin → DebugView) with `?debug_mode=1`, or the Google
   Tag Assistant.
3. **Google Ads** → Goals → Conversions → your purchase action. "Recent
   conversions" lags by hours; the tag diagnostic updates faster.
4. **Meta Events Manager** → Test Events.
5. **The one that actually matters:** a paid order appears in BagDirect with
   `status: paid`, and exactly one `purchase_completed` event exists for it.
   If the vendors disagree with that, the vendors are wrong.
