# Google Ads Read-Only Intelligence (Session 13)

**Authoritative** for everything Google Ads. Session 13 gave BagDirect its
first external paid-media input, and gave it exactly one direction: **in**.

```
READ → INGEST → RECONCILE → MEASURE → INTERPRET
```

Never `MUTATE → OPTIMIZE → EXECUTE`.

---

## 1. Architecture

Four layers, each with a boundary the next one cannot cross.

| Layer | Path | Talks to | Cannot |
| --- | --- | --- | --- |
| Adapter | `lib/google-ads/` | Google Ads API | mutate anything (§3) |
| Persistence | `lib/data/google-ads-service.ts`, `lib/data/google-ads-report-service.ts` | Postgres | call Google |
| Deterministic analytics | `modules/google-ads-intelligence/` | Postgres (read) | call Google **or** an LLM |
| Agent | `lib/ai/agents/google-ads/` | the model | call Google, use tools, execute |

`modules/google-ads-intelligence` imports neither `lib/ai` nor
`lib/google-ads`, and calls no `fetch`. Rendering the dashboard therefore
**never** makes a Google Ads API call (§10): it reads persisted daily rows.
A Google outage cannot change a number on the page.

The credential picture crosses the adapter→analytics boundary as a plain
`CredentialSnapshot` (`configured`, missing/invalid env var **names**,
customer id, API version) built by
`lib/google-ads/credential-snapshot.ts`. No secret is representable in it.

---

## 2. Authentication

Server-only environment variables, none of them `NEXT_PUBLIC_`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | ✅ | Google Ads API developer token |
| `GOOGLE_ADS_CLIENT_ID` | ✅ | OAuth client id |
| `GOOGLE_ADS_CLIENT_SECRET` | ✅ | OAuth client secret |
| `GOOGLE_ADS_REFRESH_TOKEN` | ✅ | OAuth refresh token for a user with read access |
| `GOOGLE_ADS_CUSTOMER_ID` | ✅ | The account being reported on (dashes ok) |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | optional | Manager (MCC) id, sent as `login-customer-id` |
| `GOOGLE_ADS_API_VERSION` | optional | Pin the API version (must be supported) |

Rules, enforced rather than promised:

- **Server only.** No `NEXT_PUBLIC_`, so the client bundle cannot contain one.
- **Never logged.** `GoogleAdsError` runs every message through `redact()`,
  which strips bearer tokens, `ya29.*` access tokens, `1//*` refresh tokens,
  client secrets and developer tokens before the message can be stored,
  displayed, or written to a sync row.
- **Never in a prompt.** The agent context is built from the deterministic
  snapshot, which has no credential field.
- **Never in the database.** No table has a token column, and `ad_accounts`
  stores identity/currency/time-zone only.
- **Never returned to the browser.** `GoogleAdsCredentialStatus` carries
  booleans, env var NAMES, and the customer id (an identifier the owner
  already sees in the Google Ads UI).

Access tokens are exchanged from the refresh token at
`https://oauth2.googleapis.com/token` and cached in-process for their
lifetime (60s early-refresh skew). The cache is module-private with no
exported reader.

### No OAuth UI (§7)

BagDirect is owner-operated and single-business. Owner-supplied server
credentials are sufficient, so **no multi-tenant OAuth onboarding flow was
built**. A connect-your-account UI is deferred until there is a second
business to connect.

---

## 3. The read-only boundary

This is the session's central guarantee, and it is **structural**.

**Allowed read operations — the complete list:**

1. `GoogleAdsService.search` over the `customer` resource (account identity,
   currency, time zone, manager/test flags).
2. `GoogleAdsService.search` over the `campaign` resource segmented by
   `segments.date` (campaign id/name/status/channel + impressions, clicks,
   `cost_micros`, `conversions`, `conversions_value`).

**There is no third.** And there are **no mutations at all** — no campaign
create/update/pause/enable, no budget change, no keyword create/remove, no
bid change, no ad create/modify, no conversion upload, no audience or asset
change, no targeting change.

Why a future developer cannot quietly add one:

| Guard | Mechanism |
| --- | --- |
| No mutating URL can be built | `client.ts`'s `endpointFor()` appends the **literal** `/googleAds:search`. The method is not a parameter. |
| No generic transport | There is no exported `request(method, path, body)`. The one exported function takes a customer id and a GAQL query. |
| No mutating query language | GAQL has no INSERT/UPDATE/DELETE. Mutations are separate `*Service:mutate` endpoints, whose URLs cannot be constructed here. |
| Defense in depth | `searchGoogleAds()` refuses any query that does not start with `SELECT`. |
| No mutating interface | `GoogleAdsReportingProvider` exposes exactly `status`, `getAccountInfo`, `getCampaignDailyMetrics`. |
| Tests | `tests/google-ads-readonly.test.ts` asserts all of the above, plus that the mapping table contains no executable ad action, plus an empty executor registry. |

Adding campaign mutation requires **deleting a test**, which is a visible,
deliberate act.

---

## 4. API version

Centralized in `config/google-ads.ts`:

```ts
DEFAULT_GOOGLE_ADS_API_VERSION = "v25"
SUPPORTED_API_VERSIONS = ["v25"]
```

Verified against the official Google Ads API reference at implementation
time (2026-08-15): v25 was current. The literal appears in **one** place in
business code — a test asserts no `"v2x"` literal exists anywhere in
`modules/google-ads-intelligence`, `lib/ai/agents/google-ads` or the admin
page.

`GOOGLE_ADS_API_VERSION` may pin a version, but only one in
`SUPPORTED_API_VERSIONS`. **An unsupported value throws
`API_VERSION_UNSUPPORTED`** — it never silently falls back to the default,
because a deploy that thinks it pinned v24 while running v25 queries is
exactly the failure a pin exists to prevent.

### Upgrade procedure

1. Read Google's release notes and the deprecation/sunset schedule for the
   new version.
2. Verify every field in `lib/google-ads/queries.ts` still exists and still
   means the same thing (`customer.*`, `campaign.*`, `segments.date`,
   `metrics.impressions|clicks|cost_micros|conversions|conversions_value`).
3. Add the version to `SUPPORTED_API_VERSIONS`. Presence in that list is a
   claim that step 2 was done.
4. Run the optional live smoke test (§13) against a real account.
5. Change `DEFAULT_GOOGLE_ADS_API_VERSION`, or pin per-environment with
   `GOOGLE_ADS_API_VERSION` first.
6. Remove sunset versions from the list so a stale pin fails loudly.

**Deprecated-version detection:** Google returns 404 for a retired version.
`classify()` maps a 404 with no customer hint to `API_VERSION_UNSUPPORTED`,
so the dashboard names the version rather than reporting a mystery failure.

---

## 5. Data synced

Three tables (migration `0007_google_ads_intelligence.sql`, additive) plus a
review-document table.

### `ad_accounts`

One row per (platform, external account id). It exists to persist the two
facts every downstream number depends on and that must never be assumed:
**currency** and **reporting time zone**. Plus `isManager`, `isTestAccount`,
`loginCustomerId`, `apiVersion`, `lastSuccessfulSyncAt`. **No credentials.**

### `ad_campaign_daily_metrics`

Campaign × reporting-day. `UNIQUE(ad_account_id, campaign_id, date)` is the
whole design (§6).

| Column | Meaning |
| --- | --- |
| `date` | TEXT `YYYY-MM-DD`, a calendar day in the **account's** time zone — deliberately not a timestamp, which would force a timezone choice |
| `impressions`, `clicks` | Google's counts |
| `cost_cents` | Converted from `cost_micros` (§7) |
| `currency_code` | The account currency, per row |
| `google_conversions` | `double precision` — Google reports fractional conversions under data-driven attribution |
| `google_conversion_value_cents` | Google's value, in cents |
| `last_sync_run_id` | Restatement provenance |

The conversion columns are prefixed `google_` on purpose. **There is no
`orders` column and no `revenue_cents` column on this table** (§8).

### `google_ads_sync_runs`

Append-only audit: `startedAt`, `completedAt`, requested range,
account reference, API version, `rowsFetched`/`rowsInserted`/`rowsUpdated`,
`truncated`, normalized `errorCode`, **redacted** `errorMessage`,
`providerRequestId`, server-derived `triggeredBy`, and `status`
(`running`/`success`/`partial`/`failed`).

### `google_ads_reports`

Append-only agent review documents (same shape and doctrine as `ceo_reports`
and `pricing_reports`): period, prompt id+version, model, provider, the exact
snapshot the model saw, the server-validated review, and the decision ids.

### Not ingested (§12)

**Search terms and keywords are not synced.** Campaign-level economics come
first, and Google withholds low-volume search terms for privacy, so that
table would be knowingly incomplete. `SEARCH_TERMS_INGESTED` and
`KEYWORDS_INGESTED` are `false` constants so the snapshot and the admin page
say so, rather than rendering an empty table that reads as "nobody
searched".

---

## 6. Sync lifecycle

```
Admin presses "Sync Google Ads"
  → write guard (POST + auth + same-origin + JSON + bounded body)
  → provider.getAccountInfo()        ← identity, currency, time zone; fails before quota is spent
  → upsert ad_accounts
  → start google_ads_sync_runs row
  → provider.getCampaignDailyMetrics(start, end)
  → upsert ad_campaign_daily_metrics (idempotent)
  → finish the run row (success | partial | failed)
  → success ONLY ⇒ advance ad_accounts.lastSuccessfulSyncAt
```

There is **no scheduler and no cron**. No page render triggers a sync (§10).

### Default window

`lookbackDays` (default **30**), ending **today in the account's time zone**.
Today is included deliberately — the owner pressing Sync wants today's spend
— and the trailing `PROVISIONAL_TRAILING_DAYS` (3) are marked provisional
rather than presented as final. A single sync may cover at most
`MAX_SYNC_RANGE_DAYS` (180); a larger request is refused **before any API
call**, so "sync everything" is not a feature.

### Idempotency (§44 of the spec)

Running the same sync twice cannot double spend. The upsert writes on the
natural key `(account, campaign, day)`; the second run reports
`rowsInserted: 0, rowsUpdated: N`. Tested.

### Restatements (§45)

Google revises recent days as delayed conversions arrive. A re-sync
**overwrites those days in place** — every metric is REPLACED, never
accumulated, because Google's row for a day is the whole truth for that day.
Old periods eventually stop changing, but nothing here treats any day as
permanently immutable, and no second version is ever appended.

### Partial and failed syncs (§46)

| Outcome | Data | `lastSuccessfulSyncAt` | Dashboard |
| --- | --- | --- | --- |
| `success` | written | advanced | FRESH (or STALE by age) |
| `partial` | written | **not advanced** | PARTIAL — "understates the period" |
| `failed` | **untouched** | **not advanced** | SYNC_FAILED — shows the last good data with its own timestamp |

A failed sync never deletes a row and never writes a zero.

---

## 7. Money: cost micros

Google returns `cost_micros` (1/1,000,000 of the account currency unit).
Converted **once**, at the adapter boundary:

```
cents = round(micros / 10_000)
```

Rounded half-away-from-zero, not truncated: sub-cent costs are real in the
API, and truncating them would make a long tail of tiny spend vanish.
`conversions_value` is a plain DOUBLE in currency units, converted with
`round(value * 100)`.

Integer cents is the persistence authority throughout, matching the
project-wide money convention. **No floating-point dollar is ever stored.**

---

## 8. Google's numbers vs ours — the hard boundary

This is the distinction the whole surface is built around.

| Google's lens | BagDirect's lens |
| --- | --- |
| `googleConversions` | `firstParty.orders` |
| `googleConversionValueCents` | `firstParty.revenueCents` |
| `googleReportedCostPerConversionCents` | `firstPartyCostPerOrderCents` |
| `googleReportedRoas` | `firstPartyRoas` |

**A Google "conversion" is whatever that account's conversion actions are
configured to count** — possibly a form view or a phone call. It is not a
BagDirect order, and its value is not BagDirect revenue.

Enforced structurally: `GoogleNativeTotals` has no `orders` or
`revenueCents` field; `GoogleAdsFunnel` has no `googleConversions` or
`googleConversionValueCents` field; `AdEfficiency` has no field simply named
`cac` or `roas`. A careless destructure cannot confuse them, and tests
assert each absence.

Nothing merges, averages, or "corrects" the two. Where they differ, the
difference is itself the finding (§10 below).

---

## 9. Attribution matching

### Step 1 — is this session Google Ads paid traffic?

YES if the first **or** last touch carries a Google click id (`gclid`,
`gbraid`, `wbraid`), or carries `utm_source=google` with a paid
`utm_medium` (`cpc`/`ppc`/`paid`/`paidsearch`/`paid_search`/`paid-search`).
`google/organic` is not paid traffic.

### Step 2 — which campaign?

| Quality | Rule |
| --- | --- |
| `EXACT` | `utm_campaign` equals a known Google campaign **id** (what `{campaignid}` in a tracking template produces). No naming assumption. |
| `MAPPED` | `utm_campaign` equals a known campaign **name** after normalizing case, whitespace, `_` and `-`. Deterministic, but depends on a convention the owner can break. |
| `UNMATCHED` | Neither. Its orders and revenue still count in the Google-Ads-wide totals; they simply carry no campaign. |

Checked last touch first, then first touch: for advertising performance, the
campaign that brought this visit is the one being measured.

### What is deliberately NOT done

- **No `gclid` → campaign resolution.** Google can do it via `click_view`,
  but only for a short window and as a separate report we do not ingest. A
  gclid tells us "Google Ads click" and nothing about which campaign.
- **No fuzzy matching.** "Restaurant Bags" and "Restaurant Bags 2026" are
  different campaigns. There is no FUZZY tier — approximate string matching
  would make revenue attribution a guess wearing a number.
- **No AI attribution.** The matching code is pure and typed; the model
  never sees a session.
- **Ambiguity refuses.** If two live campaigns normalize to the same name,
  **both** become unmatchable by name and the coverage report shows the
  shortfall.

### Coverage is reported, not scored

`AttributionCoverage` reports `googleAdsSessions`, EXACT/MAPPED/UNMATCHED
counts, `matchedPct`, campaigns with spend but no sessions, and Google's
clicks vs our sessions — plus an owner-language `interpretation` stating
what that level of coverage does and does not permit. Below
`MIN_ATTRIBUTION_COVERAGE_PCT` (50%), first-party CAC and ROAS report
`PARTIAL` with the coverage named.

**Clicks and sessions are not expected to match.** A visitor who leaves
before first-party tracking runs is a click with no session; the gap is not
lost revenue, and the page says so.

---

## 10. Metric definitions

### Google-native

| Metric | Formula | Zero denominator |
| --- | --- | --- |
| CTR | clicks ÷ impressions | `null` (also `null` below the 5-row minimum) |
| CPC | cost ÷ clicks | `null` — "no clicks", never "$0.00 per click" |
| Google-reported cost/conversion | cost ÷ Google conversions | UNAVAILABLE, stating that this does not mean nobody bought |
| Google-reported ROAS | Google conversion value ÷ cost | UNAVAILABLE |

### First-party

| Metric | Formula | Denominator |
| --- | --- | --- |
| **First-party cost per attributed order** | Google Ads spend ÷ BagDirect orders whose session arrived from a Google Ads click | Stated in `firstPartyCacDenominator` and rendered beside the number everywhere |
| **First-party ROAS** | attributed revenue ÷ Google Ads spend | Revenue, not profit |

`firstPartyCacDenominator` is explicit: *"BagDirect orders whose session
arrived from a Google Ads click in this period (first-party attribution),
NOT Google-reported conversions."*

**Cost per NEW CUSTOMER is not computed.** Checkout is anonymous, so
first-time vs repeat cannot be determined deterministically. Only cost per
attributed ORDER exists, and it is named that way.

### POAS — permanently unavailable this session

`config/costs.ts` is all `null` placeholders, so contribution profit does not
exist for any order. `profitOnAdSpend` is `UNAVAILABLE` with every unfilled
config path listed. **Revenue ROAS is never called profitability**, and the
page says: *"Profit-based advertising efficiency unavailable — manufacturing
costs are not configured."*

### Currency is a hard gate

Every first-party ratio mixes a Google figure with a BagDirect figure. If
the account currency and the order currency differ — or orders span multiple
currencies, or the window mixes ad currencies — those ratios return
UNAVAILABLE with that reason. **There is no FX model in this session and
none is invented.** Google's own ROAS is unaffected: both its sides are in
the account currency.

### The discrepancy view

Both sides are shown, with the standing reasons they legitimately differ:
different attribution windows (Google credits the click date, up to 90 days
back), different attribution models (fractional, multi-campaign), different
definitions of "conversion", cross-device joins we deliberately cannot make,
and blocked tracking. A gap at or above `CONVERSION_DISCREPANCY_PCT` (30%)
raises a signal routed to `ATTRIBUTION_REVIEW` — **a question, never a
correction**.

---

## 11. Time zone

Google Ads reports a "day" in the **account's** time zone. BagDirect's
sessions and orders are timestamptz, and every intelligence layer since S08
defines its period in UTC. These are different calendars.

The normalization strategy:

1. Google-native metrics are stored and aggregated by the **account's**
   calendar day, exactly as Google reported them. They are never re-bucketed
   into UTC — impossible without hourly data we deliberately do not fetch.
2. A UTC period maps to the account-calendar days it **overlaps**
   (`accountDayRangeForPeriod`), inclusive at both ends. An offset account
   can therefore contribute one boundary day a strict UTC reading would miss.
3. Where the calendars can disagree (any non-UTC account), the snapshot says
   so and the page prints the account zone and the exact account-day range
   used. **The disagreement is reported, never silently reconciled.**

`Intl.DateTimeFormat` with `en-CA` does the conversion, so DST and
historical zone changes come from the platform tz database rather than from
arithmetic.

---

## 12. Freshness

| State | Meaning |
| --- | --- |
| `FRESH` | A COMPLETE sync within `FRESH_MAX_AGE_HOURS` (26) |
| `STALE` | Last complete sync older than that (hard threshold `STALE_MAX_AGE_HOURS`, 72) |
| `PARTIAL` | The last sync was truncated — data kept, freshness not claimed |
| `SYNC_FAILED` | The last attempt failed — **previous data still shown**, with its own timestamp |
| `NOT_CONNECTED` | No credentials |

Freshness is computed from the last **success** only. `SYNC_FAILED` outranks
age, because the owner needs to know the data stopped updating and why.

The last `PROVISIONAL_TRAILING_DAYS` (3) reporting days are marked
provisional even when the sync is fresh — Google revises them.

**A state that deserves its own note:** credentials removed while synced data
remains. The connection reads `NOT_CONNECTED`, but the figures are still
shown, because they are real measurements that simply stopped updating. The
freshness reason says so explicitly ("DATA WE PREVIOUSLY SYNCED … they
stopped updating when the credentials went away"), and the page does not mix
blanked-out cards with a populated campaign table.

---

## 13. Errors, quota and pagination

Normalized codes (`GoogleAdsErrorCode`): `AUTHENTICATION_FAILED`,
`AUTHORIZATION_FAILED`, `DEVELOPER_TOKEN_ERROR`, `QUOTA_EXCEEDED`,
`RATE_LIMITED`, `INVALID_CUSTOMER`, `API_VERSION_UNSUPPORTED`,
`REPORTING_ERROR`, `NETWORK_ERROR`, `NOT_CONFIGURED`.

`NOT_CONFIGURED` is in the same enum but means "not connected yet" — never
rendered as a failure and **never** interpreted as $0 spend.

Each code carries a fixed owner-language explanation
(`GOOGLE_ADS_ERROR_EXPLANATION`). Google's response body is read only far
enough to classify; message text and echoed request fields are discarded.
Google's `request-id` **is** preserved — it is the one identifier that makes
a support ticket answerable and carries no credential.

**Quota considerations.** Reporting requests count against the developer
token's daily operations quota. This integration bounds every dimension:
`MAX_REPORT_ROWS` (10,000), `MAX_REPORT_PAGES` (50), page size ≤ 10,000,
`MAX_SYNC_RANGE_DAYS` (180), a 30s per-request timeout, and one account-info
read per sync. Hitting a cap reports `truncated` (⇒ PARTIAL) rather than
silently cutting the window. There is no scheduler, so quota use is bounded
by how often a human presses Sync.

### Optional live smoke test

If real credentials exist locally, verify in this order — all read-only:

1. `POST /api/admin/google-ads/test-connection` — account identity.
2. Confirm currency and time zone look right.
3. `POST /api/admin/google-ads/sync` with `{"lookbackDays": 7}`.
4. Inspect `ad_campaign_daily_metrics` — spend in cents, dates as account
   calendar days.
5. Re-run the same sync; confirm `rowsInserted: 0` (idempotency).
6. Load `/admin/google-ads-intelligence`.

Without credentials this skips cleanly. **The automated suite is fully
offline**: `tests/setup.ts` deletes every `GOOGLE_ADS_*` variable, every
test uses `FakeGoogleAdsReportingProvider` or a stub `fetch`, and a
structural test asserts no live provider is built without one.

---

## 14. The Google Ads Intelligence Agent

`lib/ai/agents/google-ads/` — **RECOMMEND**, prompt
`ai_google_ads_review` v1.0.0, one REASONING `generateStructuredObject` call.

**No tools** (`AGENT_TOOL_PERMISSIONS.google_ads = []`). **No Google Ads
access of any kind** — it imports no adapter module and cannot even read
from Google; it reads only the persisted snapshot.

Its output schema **cannot express a mutation**: there is no
`proposedDailyBudgetCents`, no `budgetChangePct`, no `newStatus`, no
`pause`, no `bidCents`, no `targetCpaCents`, no `keywordText`, no `adCopy`.
A budget change is not blocked — it is **unwritable**.

Closed recommendation taxonomy: `CAMPAIGN_REVIEW`, `BUDGET_REVIEW`,
`SEARCH_TERM_REVIEW`, `KEYWORD_REVIEW`, `LANDING_PAGE_REVIEW`,
`ATTRIBUTION_REVIEW`, `DATA_QUALITY_REVIEW`.

**Budget recommendation boundary (§38 of the spec):** `BUDGET_REVIEW` means
*"review whether this campaign's budget is right"*. It sets nothing, and no
number in the narrative maps into an executable action — the mapping table
contains review types only.

### Server-side validation

- Metric/evidence/signal refs filtered against exactly what the context
  printed; a recommendation with **no** surviving metric ref is DROPPED.
- `campaignId` validated against the campaigns the snapshot contained;
  anything else becomes `null`.
- Signal notes may only annotate printed signal ids.
- Provider or budget failure persists **nothing** — the dashboard and the
  previous review are untouched.

### Context privacy

PII-free and credential-free by construction: no click id value, no OAuth
token, no email, phone, customer name, order id, session id or message text.
Click ids are used **only** as a boolean inside the deterministic module.

---

## 15. Action Center integration

| Recommendation | Action type |
| --- | --- |
| `CAMPAIGN_REVIEW`, `BUDGET_REVIEW`, `SEARCH_TERM_REVIEW`, `KEYWORD_REVIEW`, `LANDING_PAGE_REVIEW`, `ATTRIBUTION_REVIEW` | `MARKETING_REVIEW` |
| `DATA_QUALITY_REVIEW` | `DATA_QUALITY_REVIEW` |

Every entry is `REVIEW_ONLY`. **`AD_BUDGET_CHANGE`, `AD_PAUSE`, `AD_RESUME`
and `AD_CREATIVE_TEST` are absent from the mapping** — a Google Ads
recommendation cannot become an executable ad action by any mapping.

Those four types stay **registered** in the Session 10 taxonomy because a
later guarded session will implement them under approval. Registered,
unmapped, executor-less and limit-blocked is exactly the intended state:
`maximumDailyAdSpendCents` and `maximumCampaignBudgetChangePct` are still
`null`, so even a HUMAN_ADMIN proposal is execution-ineligible with the
missing configuration named.

`GUARDRAIL_POLICY_VERSION` → `2026-08-15.s13.1`. `GOOGLE_ADS_AGENT` default
autonomy OBSERVE → RECOMMEND (**ceiling unchanged at RECOMMEND**,
guarded-auto allow-list still empty), and one permission added:
`DATA_QUALITY_REVIEW` (review-only), so "Google Ads has never synced" routes
honestly instead of masquerading as a campaign problem.

**`modules/guardrails/executors.ts` remains EMPTY.**

---

## 16. Admin surface

`/admin/google-ads-intelligence` — behind the S08 HTTP Basic auth + the
`GOOGLE_ADS_INTELLIGENCE` flag, fail-closed 404.

Sections: Connection & sync · What Google Ads reports · What BagDirect
measured · Google Ads funnel · Campaigns (both lenses side by side, with
match quality) · Attribution coverage · Where Google and we disagree · What
paid-search visitors asked · Trends · Google Ads review (AI) · What to keep
in mind · Sync history.

Three explicit actions, all behind `lib/admin/write-guard.ts` (POST + auth +
same-origin + `application/json` + bounded body + strict zod):

| Route | Effect |
| --- | --- |
| `POST /api/admin/google-ads/test-connection` | One `customer` read. Accepts **no parameters** — the account id comes from server configuration, so a client cannot ask the platform to probe an arbitrary account. |
| `POST /api/admin/google-ads/sync` | The only path that fetches reporting data. |
| `POST /api/admin/google-ads/ads-review` | The only trigger for a model call. Additionally requires `AI_GOOGLE_ADS_AGENT`. |

**Syncing does not generate an AI review** (§54 of the spec): deterministic
figures refresh immediately, and the owner decides when to spend tokens.

---

## 17. Business Intelligence integration

Session 09's revenue, funnel, profitability and attribution semantics are
**unchanged**. `attribution.adSpendIntegrated` stays `false`, because that
breakdown still contains no ad spend and still computes no CAC or ROAS.

What S13 adds is a **separate** `adSpend` section on
`BusinessHealthSnapshot` (`modules/google-ads-intelligence/spend.ts`),
carrying its own availability state so a missing integration reads
UNAVAILABLE, never zero. The CEO agent sees it as two citable metric refs
plus a one-sentence statement, and is told it may recommend REVIEWING
advertising and may never call it profitable.

---

## 18. Privacy

- No Google user identifier is ingested. Click ids are read from our own
  first-party session rows as a **boolean** and never stored, displayed,
  serialized into a snapshot, or sent to a model.
- No user profiling, no cross-device identity graph, no fingerprinting —
  asserted structurally.
- Reporting queries request campaign identity, the day, and five metrics.
  No audience membership, no `click_view`, no per-person field.
- No conversion upload — nothing is sent **to** Google.

## 19. Google Ads policy

Reporting intelligence only. No cloaking, no prohibited targeting, no
unauthorized data upload, and no feature designed to circumvent Google Ads
policy. There is nothing here that changes what an ad says or who sees it.

---

## 20. Limitations

- **Search terms and keywords are not ingested** — no question about what
  people searched can be answered from this data.
- **Campaign-level only** — no ad group, ad, device, geo or hour breakdown.
- **Single account.** More than one `ad_accounts` row would mean the
  customer id changed; the most recently updated wins.
- **Conversation-based customer signals** cover only visitors who used the
  AI expert.
- **Coverage depends on tracking templates.** Without `{campaignid}` or a
  matching campaign name in `utm_campaign`, real visits are UNMATCHED and
  per-campaign first-party revenue is understated (account-level figures are
  unaffected).
- **No profit anywhere** until `config/costs.ts` is filled.
- **Bounded loads** (5,000 rows/query) — the S08–S12 posture; revisit at real
  volume.
- **Manual sync only** — "weekly" means pressing the button weekly.

## 21. Future mutation architecture (NOT built)

When a later session implements budget/pause/resume actions, this is the
shape it must take — and none of it exists today:

1. A **separate** `GoogleAdsMutationProvider` interface, in its own file,
   with its own OAuth scope. The reporting provider is never extended.
2. Real executors registered in `modules/guardrails/executors.ts`, meeting
   the full contract in `docs/AI_ACTION_CENTER.md` (validated action → fresh
   evaluation → approval → idempotency key → before/after snapshot → audit →
   rollback).
3. `maximumDailyAdSpendCents`, `maximumCampaignBudgetChangePct` and
   `maximumNewCampaignTestBudgetCents` filled with real owner figures — every
   one is `null` today and blocks execution while it stays that way.
4. The agent's output schema extended to carry a proposal, which today it
   structurally cannot.
5. Human approval per action; GUARDED_AUTO only after operating history and
   an explicit human decision (roadmap Stage J).

Until every one of those is done, the correct state is the current one:
representable, unmapped, executor-less, and limit-blocked.

## 22. Session 13.5 — POAS

Session 13 shipped `profitOnAdSpend` as permanently UNAVAILABLE because no
cost model existed. Session 13.5 built one, so POAS is now computed **where
profit actually exists** — and is still unavailable everywhere else.

```
ROAS = first-party attributed revenue           / Google Ads cost
POAS = contribution profit before paid media    / Google Ads cost
Contribution profit after paid media
     = contribution profit before paid media − Google Ads cost
```

`AdEfficiency` gained three fields, all `Metric<number>`:
`contributionBeforePaidMediaCents`, `profitOnAdSpend` (POAS) and
`postAdContributionCents`. **`firstPartyRoas` and `profitOnAdSpend` remain
separate fields with separate formulas** — there is still no field named
merely `roas` or `poas`, so no destructure can turn one into the other. ROAS
is revenue; POAS is profit; neither is ever substituted for the other.

**Numerator.** Contribution profit before paid media on BagDirect orders whose
session arrived from a Google Ads click, taken from each order's own COST
SNAPSHOT — the costs that applied when it was placed. `GoogleAdsFunnel` and
`CampaignFirstParty` gained `contributionBeforePaidMediaCents` (null when NO
attributed order carries one — never 0) and `ordersWithContribution` (the
coverage denominator).

**Four gates, and any gap downgrades rather than approximates:**

| Condition | POAS |
| --- | --- |
| Cost model unconfigured, or no attributed order carries a snapshot | UNAVAILABLE, with the exact `config/costs.ts` paths listed |
| Ad currency ≠ order currency | UNAVAILABLE — no FX model exists and none is invented |
| Attribution coverage below `MIN_ATTRIBUTION_COVERAGE_PCT` | PARTIAL, coverage stated |
| Only some attributed orders carry a snapshot | PARTIAL, "N of M attributed orders" |
| No ad spend / no synced data | UNAVAILABLE — the ratio is undefined, not 0 |
| All four satisfied | AVAILABLE |

`missingCostPaths()` now also names `orderCosts.packagingCentsPerOrder`,
`orderCosts.handlingCentsPerOrder` and `shippingPolicy.customerCharge`.

**Admin.** `/admin/google-ads-intelligence` gained a "Did the advertising make
money?" section showing contribution profit before paid media, POAS and
contribution profit after paid media side by side, with the blocking config
paths listed when they are unavailable. The section states in plain language
that ROAS divides revenue and POAS divides profit, and that a strong ROAS can
sit beside a POAS below 1×.

**Nothing about Session 13's read-only boundary changed.** No mutation
provider, no budget executor, no pause/resume, no new action type; the Google
Ads Agent stays RECOMMEND with an output schema that cannot express a
mutation.

Full specification: `docs/UNIT_ECONOMICS.md`.
