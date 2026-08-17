# Observability, Abuse Protection and Alerting

Production Launch Session 03. What the system tells you when it is working,
what it tells you when it is not, and what it refuses to let a stranger do to
it.

---

## 1. Structured logging

`lib/observability/logger.ts`. One JSON line per event:

```json
{"subsystem":"checkout","event":"checkout_created","severity":"info","at":"2026-08-16T21:03:11.412Z","correlationId":"req_9f2c…","orderId":"ord_…","totalCents":210000}
```

Fields are a closed set at the top level — `subsystem`, `event`, `severity`,
`at`, plus optional `correlationId` and `code` — so a log-drain query or an
alert rule can filter on a field rather than grepping a prefix.

`subsystem` is a fixed list (`LOG_SUBSYSTEMS`): checkout, commerce, webhook,
reconciliation, artwork, events, quote, escalation, rate-limit, health, admin,
ai, db, analytics. It is closed on purpose — a free-form string would
silently create a subsystem nobody is alerting on.

The pre-existing `[ai]` channel (`lib/ai/log.ts`) keeps its own format and
vocabulary from Session 04. It has its own redaction rules and its own tests;
rewriting it would churn a lot of history for no operational gain.

### What never reaches a log line

API keys, the Shopify Admin token, the webhook signing secret, OAuth refresh
tokens, storage credentials, payment data, raw artwork, full conversations.

Two mechanisms, in this order:

1. **Fields are scalars.** `logEvent` accepts only string/number/boolean/null.
   You cannot pass a credentials object or a raw provider response, because
   there is no field type that would carry one.
2. **Key and value redaction.** A field whose *name* matches
   `token|secret|password|apikey|credential|authorization|cookie|dsn|signature`
   becomes `[redacted]`. A *value* matching a known credential shape
   (`shpat_…`, `sk-…`, `sk-ant-…`, an AWS key id, `Bearer …`, a Google refresh
   token) is redacted wherever it appears — including inside a provider's own
   error text, which is where credentials actually leak from in practice.

Redaction is a backstop, not a licence. The rule is still: do not log the
secret.

---

## 2. Correlation ids

`lib/observability/correlation.ts`. Header: `x-request-id` (Vercel and most
proxies pass it through).

One id follows a customer action across the subsystems that fail
independently — checkout creation → the Shopify draft order → order
persistence → webhook reconciliation → artwork finalization. It is returned to
the browser on `/api/checkout` responses, so a customer can quote it to
support.

A correlation id is random. It is never derived from a session id, a customer
id, an email or an IP, so it cannot be reversed into an identity — which is
what makes it safe to put in a third-party error report.

This is deliberately not distributed tracing. No OpenTelemetry, no collector,
no new infrastructure.

---

## 3. Error tracking

`lib/observability/error-tracking.ts`. Works unconfigured; the structured log
line is always written first and unconditionally.

| Variable | Effect |
| --- | --- |
| `SENTRY_DSN` | Sentry-compatible envelope ingest (also GlitchTip) |
| `ERROR_WEBHOOK_URL` | plain JSON POST (Slack workflow, Zapier, a log drain) |
| neither | structured log only |

**Why not `@sentry/nextjs`.** The capability needed — "an unexpected server
exception reaches somebody" — is about sixty lines of `fetch` against a
documented HTTP endpoint. The SDK's real value is browser capture, source
maps, performance tracing and release health, none of which this session
needs and all of which change the build.

**What this does NOT do**, and would need the real SDK for: browser/client-side
error capture, source-map symbolication, release tracking, performance
tracing, breadcrumbs, session replay. If you later want those, installing the
SDK is a clean upgrade — the `captureException` call sites do not change.

### What is an error

Reported: unexpected server exceptions — a Shopify call that threw, a failed
database write, an artwork verification that crashed, a reconciliation
failure, an AI runtime fault.

**Not** reported: expected business outcomes. Below MOQ, missing artwork, a
409 REPRICED, an unmapped configuration, invalid customer input, a
rate-limited caller. Those are the system working. Reporting them trains you
to ignore the channel, which is the same as having no alerting.

A burst cap (60 reports/minute) stops an error loop becoming an outbound
request loop. Dropped reports still reach the structured log, and the drop
count rides along on the next report.

---

## 4. Alerts — YOU must configure these

**Nothing in this repository can guarantee a person reads an error.** Alert
rules live in your monitoring provider and your platform. Launch readiness
reports this as `ALERTS_UNVERIFIED` and it will never self-resolve.

Configure at minimum:

| Alert | Signal | Why it matters |
| --- | --- | --- |
| Checkout error spike | `subsystem:checkout severity:error` above baseline | You are not selling and nobody has told you |
| Commerce not configured | `code:COMMERCE_NOT_CONFIGURED` (any occurrence) | Production cannot take money at all |
| Shopify webhook failures | HTTP 5xx on `/api/webhooks/shopify`, or `subsystem:webhook severity:error` | Paid orders are not being reconciled |
| Webhook gap repaired | `code:WEBHOOK_GAP_REPAIRED` (any occurrence) | A payment reached you only because someone ran reconciliation |
| Database failures | `subsystem:db`, or `code:DATABASE_UNREACHABLE` | Nothing can be written |
| Readiness unhealthy | `/api/health/ready` returning 503 | A mandatory requirement disappeared |
| AI provider failures / budget exhausted | `[ai]` `budget_rejected`, `provider_error` | The assistant is silently offline for customers |
| Artwork upload failures | `subsystem:artwork severity:error` | Printed orders cannot be placed |
| Rate-limit backend degraded | `code:DURABLE_UNAVAILABLE` | Limits are per-instance only |

Do not claim these exist until you have actually configured them.

---

## 5. Health endpoints

| Endpoint | Question | Cost |
| --- | --- | --- |
| `GET /api/health/live` | Is the process responding? | Nothing. No DB, no config read |
| `GET /api/health/ready` | Can we safely accept a sale? | One `select 1` plus configuration reads |

`?verbose=1` on readiness adds per-check detail.

**Why they are separate.** A liveness probe that touched the database would
tell the platform to RESTART the application when the DATABASE was down —
turning a degraded system into an unavailable one, in a loop.

**Readiness never calls an external API.** Shopify readiness is judged from
configuration validity, not connectivity: an uptime poller hitting readiness
every ten seconds would otherwise burn Shopify's rate limit forever, and a
vendor's slow minute would read as BagDirect being down. Live connectivity
checks belong on an authenticated admin diagnostic, where a human asks once.

**Readiness never depends on AI, Google Ads, CRO, pricing intelligence or
customer intelligence.** Those are optional enhancements. A system that
refuses traffic because an LLM provider is having a bad afternoon has turned
an optional feature into an outage.

Status codes: `200 ready`, `200 degraded` (warnings only — still sellable),
`503 not_ready` (a mandatory requirement is missing).

Responses contain a state, subsystem names, safe categories and owner-readable
reasons. Never a database URL, a token, an account id, a bucket credential or
a stack trace.

---

## 6. Rate limiting

`lib/rate-limit/`. Three layers; a request must pass every applicable one.

### Layer 0 — platform / WAF (OWNER CONFIGURATION, NOT CODE)

The only layer that can refuse a request before it costs a function
invocation. **Nothing in this repository substitutes for it.**

Configure Vercel Firewall (or your CDN/WAF) rate-limit rules:

| Path | Suggested rule |
| --- | --- |
| `/api/events` | 600 requests / minute / IP |
| `/api/ai/chat` | 60 requests / minute / IP |
| `/api/checkout` | 60 requests / minute / IP |
| `/api/artwork/*` | 120 requests / minute / IP |
| `/api/*` (catch-all) | 1200 requests / minute / IP |
| `/admin`, `/api/admin/*` | consider an IP allowlist |

These are deliberately looser than the application limits: layer 0 stops
floods, layers 1–2 shape ordinary abuse.

### Layer 1 — per-instance token bucket

Synchronous, free, always available. Refuses obvious abuse before any I/O.
**Not globally authoritative**: on serverless, N instances mean N independent
allowances. This file never pretends otherwise — that is why layer 2 exists.

### Layer 2 — durable shared counter (Postgres)

A fixed-window counter in `rate_limit_counters`: one atomic
`INSERT … ON CONFLICT DO UPDATE … RETURNING` per checked request, so
concurrent instances cannot both read "under the limit" and both proceed.

Postgres, not Redis: production already requires a Postgres, so a shared
counter costs one table and zero new vendors, credentials, failure modes or
bills. Redis would be faster per operation and entirely unnecessary at
soft-launch traffic.

`RATE_LIMIT_DURABLE=true|false`. Defaults ON in production (where multiple
instances exist) and OFF in development and tests. Setting it to `false` in
production is a deliberate, documented downgrade.

**Failure mode:** a store error returns `unavailable`, `enforceRateLimit`
falls back to the per-instance bucket alone, and logs `DURABLE_UNAVAILABLE`.
It never converts to "allow everything". There is no code path in which a
database outage grants unlimited AI spend — and the AI budget guard remains
the hard financial backstop underneath.

### Route policies

| Route | Class | Session | Network | Durable |
| --- | --- | --- | --- | --- |
| `/api/events` | PUBLIC_DB_WRITE | 120/min (burst 60) | 400/min (burst 200) | yes |
| `/api/configuration` | PUBLIC_DB_WRITE | 90/min (burst 40) | 300/min (burst 150) | yes |
| `/api/cart/line` | PUBLIC_DB_WRITE | 40/min (burst 20) | 160/min (burst 80) | yes |
| `/api/quote` | PUBLIC_EXTERNAL_COST | 5/min | 15/min | yes |
| `/api/checkout` | PUBLIC_EXTERNAL_COST | 8/min | 30/min | yes |
| `/api/artwork/upload` | PUBLIC_EXTERNAL_COST | 10/min | 30/min | yes |
| `/api/artwork/[id]/complete` | PUBLIC_LOW_COST | 60/min (burst 30) | 180/min (burst 90) | no |
| `/api/ai/chat` | PUBLIC_EXTERNAL_COST | 6/min | 20/min | yes |
| `/api/admin/*` writes | AUTHENTICATED | — | 60/min | no |

Every limit is set from the shape of legitimate use, widened for the worst
honest case, and only then compared against the abuse cost. The B2B buyer is
explicitly protected: checkout is limited per CHECKOUT (one request regardless
of line count), and the artwork allowance is a working session's worth of
files.

The NETWORK scope is enforced **before** a session is resolved on public write
routes — a caller with no cookie mints a session row on every request, so
limiting after identity resolution would still let an abusive client force
unbounded writes.

### Privacy of the network identity

An IP address is personal data in the markets BagDirect sells into. Rate
limiting does not need to *know* the address — only to tell two callers apart
— so it is reduced to a keyed HMAC-SHA256 the moment it is read. Only the
digest reaches a counter key, a log line or the durable store. **The raw
address is never written anywhere.**

`RATE_LIMIT_IP_SALT` supplies the key. Unset, an ephemeral random key is
generated per process, with two deliberate consequences:

- digests are not comparable across instances or a redeploy, so the network
  scope of the durable limiter degrades to per-instance;
- nothing persisted can be correlated back to a person even in principle,
  because the key that produced it no longer exists.

Production should set it (a long random string, rotated like any secret).
`rate_limit_counters` rows carry `expiresAt` and are pruned opportunistically
— this table is ephemeral operational state, not a record of who visited.

---

## 7. Artwork abuse controls

| Control | Where | What it bounds |
| --- | --- | --- |
| Signed content-type | Session 02 | What the object is stored as |
| Server-chosen object key | Session 02 | Which object may be written |
| **Signed content-length** | Session 03 | **How big it may be** |
| Post-upload HEAD + magic bytes | Session 02 | What the bytes actually are |
| Rate limit | Session 03 | How FAST URLs can be minted |
| **Per-session allowance** | Session 03 | **How MANY objects one session can create** |

The size binding matters because everything Session 02 built was a check
performed *after* the caller had already consumed storage. Content-Length is a
forbidden header name in `fetch`, so the browser sets it from the body — which
is exactly what makes it a useful binding: the value cannot be forged, and a
body of any other size fails the signature at the storage backend.

The allowance answers a different question from the rate limit: a limiter
bounds the RATE, not the TOTAL. A patient script staying under every
per-minute limit could still create unbounded objects over a day.

```bash
ARTWORK_MAX_UPLOADS_PER_SESSION=25   # default
ARTWORK_UPLOAD_WINDOW_HOURS=24       # default
```

Deliberately generous: a blocked customer is a lost order, an over-uploading
one costs fractions of a cent per file.
