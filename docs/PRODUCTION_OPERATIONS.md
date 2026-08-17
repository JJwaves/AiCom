# Production Operations

Production Launch Session 03. How to deploy, what to do when something breaks,
and what to switch off first.

Nothing here describes a vendor feature that is not actually configured. Where
something depends on owner setup, it says so.

---

## 1. Deploy sequence

Order matters. Migrations before code, code before flags.

```bash
# 1. Verify locally
npm test && npm run typecheck && npm run lint && npm run build

# 2. Apply migrations against production Postgres FIRST
DATABASE_URL='<production pooled url>' npm run db:migrate

# 3. Deploy
#    (Vercel: push to the production branch, or `vercel --prod`)

# 4. Confirm the deployment is serving
curl -sS https://<domain>/api/health/live
curl -sS 'https://<domain>/api/health/ready?verbose=1' | jq

# 5. Read the preflight dashboard
open https://<domain>/admin/launch-readiness
```

**Migrations are additive and run before the code that needs them.** Every
migration in `db/migrations` adds tables or nullable columns; none drops or
renames. That is what makes step 2-before-3 safe: the old code keeps working
against the new schema, so a rollback does not need a down-migration.

Build-time values (`NEXT_PUBLIC_*`) are inlined into the bundle. Changing
`NEXT_PUBLIC_SITE_DOMAIN`, `NEXT_PUBLIC_GA4_ID`, `NEXT_PUBLIC_GOOGLE_ADS_*`,
`NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_DEMO_PRICING` or
`NEXT_PUBLIC_FIRST_PARTY_EVENTS` **requires a redeploy**, not a restart.

### If a migration fails

1. The deploy has not happened yet — the old code is still serving. Nothing
   is broken for customers.
2. Read the error. Migrations are plain SQL in `db/migrations`.
3. Fix forward with a new migration. **Do not hand-edit an applied
   migration** — Drizzle's journal tracks what ran, and editing history makes
   every future environment diverge.
4. Re-run `npm run db:migrate`, then deploy.

### Rollback

```bash
vercel rollback            # or promote the previous deployment in the dashboard
```

Because migrations are additive, rolling back CODE is safe with the new schema
in place. Do not roll back the database.

---

## 2. Emergency switches, fastest first

| Problem | Action | Effect |
| --- | --- | --- |
| AI is misbehaving or costing too much | Set `AI_SALES_ENABLED=false`, redeploy | Chat returns its unavailable message; the storefront sells normally |
| AI spend runaway (immediate) | Set `AI_DAILY_BUDGET_USD` to a low number, redeploy | Budget guard fails closed. Requires model pricing in `config/ai-pricing.ts` |
| An experiment is harming conversion | Set `EXPERIMENT_ENGINE_ENABLED=false`, redeploy | No assignment, no exposure, control experience everywhere. **Requires a rebuild** — this flag changes render mode |
| Checkout is charging wrong / Shopify is broken | Unset `SHOPIFY_STORE_DOMAIN` **and** `SHOPIFY_ADMIN_API_TOKEN`, redeploy | `/api/checkout` answers 503 with customer-safe copy. Partial config fails hard, so unset BOTH |
| Checkout is broken but you want quotes | As above; `/request-quote` is unaffected | Custom quote intake keeps working |
| Artwork storage compromised | Rotate `ARTWORK_S3_*`, redeploy | Uploads answer 503 with "choose No logo"; existing artwork is unaffected |
| Admin surface exposed | Unset `ADMIN_USER`/`ADMIN_PASSWORD` | Every admin path answers 404 |

**There is no kill switch that stops Shopify taking money.** Shopify is the
payment authority. To stop selling, pause the store in the Shopify admin.

---

## 3. Webhook troubleshooting

Symptom: **a customer paid and BagDirect still shows `pending_payment`.**

1. **Is the secret set?** No `SHOPIFY_WEBHOOK_SECRET` ⇒ the endpoint answers
   503 to every delivery and refuses to process anything. Launch readiness
   reports this as blocked.
2. **Shopify admin → Settings → Notifications → Webhooks.** Check recent
   deliveries and their response codes.
   - `401` — the signing secret does not match. Recopy it (it is shown once;
     regenerate if lost).
   - `503` — the secret is not set on the server.
   - `500` — processing failed. The claim is released, so Shopify's retry is
     real work. Check `subsystem:webhook severity:error` in the logs.
   - No delivery at all — the subscription is missing. Required topics:
     `orders/create`, `orders/paid`, `orders/cancelled`, `refunds/create`,
     all pointing at `https://<domain>/api/webhooks/shopify`.
3. **Still nothing?** Shopify gives up after ~48 hours. Use reconciliation
   (§4).

Replays are safe. Idempotency keys are on the SUBJECT (order id, refund id),
not the delivery id, so re-sending from the Shopify admin cannot process a
payment twice.

---

## 4. Reconciliation — recovering a lost webhook

`/admin/launch-readiness` → **Reconcile Shopify orders**, or:

```bash
curl -X POST https://<domain>/api/admin/commerce/reconcile \
  -u "$ADMIN_USER:$ADMIN_PASSWORD" \
  -H 'content-type: application/json' \
  -H 'origin: https://<domain>' \
  -d '{"lookbackHours": 72}'
```

- Reads a bounded window of recent Shopify orders (**requires the
  `read_orders` scope** — see `docs/SHOPIFY_PRODUCTION.md`).
- Repairs through the **same reconciliation service the webhook uses**, so a
  repaired order is indistinguishable from a webhook one.
- **Idempotent.** Running it twice repairs nothing the second time. A run that
  repairs zero orders is the healthy result.
- Lookback: 1 hour to 14 days; 72 hours by default.
- A `truncated` run means the window was larger than one sweep can cover — run
  it again for a shorter window.
- Every run is recorded and shown on `/admin/launch-readiness`.

There is **no cron**. It is an explicit, attended operation, which also means
it never runs unattended against a misconfigured store.

Repairs log `code:WEBHOOK_GAP_REPAIRED`. **Alert on it**: a repair means a
payment reached you only because a human pressed a button.

---

## 5. Human escalations

AI escalations are stored at `/admin/handoffs` **whether or not delivery
succeeded** — a delivery failure never loses a customer's request.

```bash
HUMAN_HANDOFF_WEBHOOK_URL=https://hooks.slack.com/workflows/...
# falls back to QUOTE_WEBHOOK_URL if unset
```

A generic JSON POST reaches Slack workflows, Zapier/Make, email automation and
helpdesk intake without embedding any of them in the architecture.

Delivery states: `pending`, `delivered`, `failed`, `not_configured`. A failed
delivery can be retried from the admin page. The assistant only ever tells a
customer their request was **recorded** — never that a human has been
notified, which would be a claim about a system BagDirect does not own.

---

## 6. Database

**Requirement: a pooled / serverless-safe connection string.** Serverless
functions open a connection per instance; a direct connection to a small
Postgres exhausts `max_connections` under ordinary traffic and the symptom is
intermittent 503s that look like an application bug.

Use your provider's pooled endpoint:

| Provider | Use |
| --- | --- |
| Neon | the `-pooler` host |
| Supabase | Connection pooling (port 6543), `?pgbouncer=true` |
| RDS / self-hosted | PgBouncer in transaction mode |
| Vercel Postgres | the pooled `POSTGRES_URL` |

Launch readiness inspects the connection string for pooler markers and warns
if it does not look pooled. That is a hint, not a guarantee.

### Backups and point-in-time recovery — OWNER ACTION

**BagDirect does not back up the database, and cannot query whether you do.**
Implementing backups in application code would be worse than not having them:
a backup written by the same process that writes the data fails with it.

Enable automated backups / PITR in your Postgres provider, and record:

- retention window (7 days minimum for a soft launch)
- how to restore
- **that you have actually tested a restore** — an untested backup is a
  hypothesis

Launch readiness shows `BACKUP_POLICY_UNVERIFIED` and will never self-resolve.

---

## 7. Artwork

Symptom: **a customer cannot upload a logo.**

1. `/admin/launch-readiness` → Artwork. Unconfigured or partially configured
   storage is reported there.
2. `subsystem:artwork severity:error` in the logs.
3. CORS: the bucket must allow `PUT` from your domain, with `Content-Type`
   allowed as a request header. A CORS failure looks like a silent upload
   failure in the browser.
4. `UPLOAD_LIMIT_REACHED` means the session used its allowance
   (`ARTWORK_MAX_UPLOADS_PER_SESSION`, default 25/day). Raise it or take the
   file by email.
5. A rejected file is deleted from storage and marked `rejected`. SVG is
   refused by policy (see `docs/ARTWORK_STORAGE.md`).

**Durability.** Object storage durability and any cross-region replication are
provider settings. For soft launch, durable object storage is enough; enable
versioning on the bucket, and treat long-term replication as a deliberate
later decision rather than an assumed one.

---

## 8. Monitoring

See `docs/OBSERVABILITY.md` for the full picture. The short version:

- `GET /api/health/live` — liveness. Point your uptime monitor here.
- `GET /api/health/ready` — readiness. 503 means a mandatory requirement is
  missing.
- `SENTRY_DSN` or `ERROR_WEBHOOK_URL` — error tracking. Unconfigured, errors
  reach the platform log only.
- **Alerts are yours to configure.** Nothing in this repository can guarantee
  a person reads an error.

---

## 9. Launch smoke test

Do this once, before real traffic, with the real production configuration.

### One real payment

1. Shopify admin → Settings → Payments. Either enable a test gateway (Bogus
   Gateway) or accept a real card charge you will refund. **BagDirect has no
   test-payment code path** — hard-coding one into production would be exactly
   the class of bug Session 02 deleted.
2. Configure a product on the live site, upload a logo, check out.
3. Verify, in order:
   - the Shopify checkout shows **shipping** and **tax** (if either is
     missing, your Shopify shipping profile or tax settings are wrong)
   - payment completes
   - the webhook is delivered (Shopify admin → Notifications → Webhooks)
   - the BagDirect order moves to `paid` with a `paidAt`
   - exactly **one** `purchase_completed` event exists for it
   - the artwork is attached to the correct **order line**
   - the confirmation page shows the paid state
   - GA4 / Google Ads / Meta received the purchase (if configured)

### One refund

4. Refund or cancel the order **in Shopify**.
5. Verify BagDirect records it: `refunds/create` arrives, `refundedTotalCents`
   updates, a full refund moves the status to `refunded` and removes it from
   revenue.
6. If the webhook does not arrive, run reconciliation (§4) and confirm it
   repairs the same state.

**BagDirect has no refund execution authority.** Shopify is the refund
authority; BagDirect records what it is told.

---

## 10. Soft-launch feature flag matrix

Derived from `config/flags.ts`. Every flag is read from the server
environment; **none are `NEXT_PUBLIC`**, so changing one takes effect on the
next deploy.

| Flag | Soft launch | Why |
| --- | --- | --- |
| `AI_RUNTIME_ENABLED` | ON *after* `npm run ai:smoke` | Master switch for `lib/ai` |
| `AI_SALES_ENABLED` | ON after the smoke test | Customer-facing chat. Commerce works fully without it |
| `AI_CUSTOMER_INTELLIGENCE_ENABLED` | optional ON | Read-only admin surface; deterministic metrics need no AI |
| `AI_BUSINESS_INTELLIGENCE_ENABLED` | optional ON | Read-only admin surface; CEO review only from an explicit button |
| `PRICING_INTELLIGENCE_ENABLED` | optional ON | Deterministic dashboard, no AI required |
| `AI_PRICING_AGENT_ENABLED` | **OFF** | Model calls with no operating history to judge them against |
| `AI_ACTION_CENTER_ENABLED` | **OFF** | Action review surface; the executor registry is empty, so nothing could execute anyway |
| `EXPERIMENT_ENGINE_ENABLED` | **OFF** | **Build-time behaviour: toggling requires a rebuild.** Also needs `GUARDRAIL_LIMITS.maximumExperimentTrafficPct` set, or launch refuses in production |
| `AI_CRO_AGENT_ENABLED` | **OFF** | Proposes experiments there is no traffic to run |
| `GOOGLE_ADS_INTELLIGENCE_ENABLED` | ON **only if** Google Ads credentials are configured | With it off, no Google Ads call is ever made |
| `AI_GOOGLE_ADS_AGENT_ENABLED` | **OFF** | Review generation; no ad data worth reviewing yet |
| `AI_META_ADS_AGENT_ENABLED` | **OFF** | Not implemented |
| `AI_AUTO_PRICING_ENABLED` | **OFF** | Autonomous execution. Requires operating history that does not exist |
| `AI_AUTO_ADS_ENABLED` | **OFF** | As above |

**`EXPERIMENT_ENGINE_ENABLED` is the one to watch**: turning it on changes `/`
and `/products/[slug]` from static to dynamic rendering, so a build made with
it off will never enrol anyone. Toggling it means a rebuild and redeploy.

---

## 11. Initial soft-launch scope

- **US only.** Canada is in `BUSINESS.MARKETS` but shipping and tax are only
  verified for the US. Do not advertise into Canada until a Canadian shipping
  profile and tax settings are verified in Shopify.
- **Limited validated products.** Only configurations present in
  `SHOPIFY_MERCHANDISE_MAP` can be bought; everything else routes to a quote.
- **Low traffic.** The rate-limit defaults and the un-pooled-connection
  warning are sized for soft-launch volume.
- **AI Sales optional**, and only after `npm run ai:smoke`.
- **Experiments off.**
- **No autonomous actions.** The guardrail executor registry is empty; every
  agent is RECOMMEND-only, and Google Ads is read-only.

---

## 12. Routine checks

| Cadence | Check |
| --- | --- |
| Daily | `/admin/handoffs` for unhandled escalations |
| Daily (first two weeks) | Reconciliation sweep; confirm it repairs zero orders |
| Weekly | `/admin/launch-readiness`; confirm nothing regressed |
| Weekly | Error tracker: are the top errors expected business outcomes or real faults? |
| Monthly | Restore a database backup into a scratch environment |
| Monthly | Rotate `RATE_LIMIT_IP_SALT` if your privacy policy commits to it |
