# DATABASE_SCHEMA

## Current state (Session 01)

**There is no database.** Persistence today:

| Data | Where | Notes |
| --- | --- | --- |
| Catalog, pricing tiers, options | `config/products.ts` | TS config; Shopify supersedes later |
| Cart | localStorage `bd_cart_v1` | client-only |
| Attribution (first/last touch) | localStorage `bd_attribution_v1` | client-only |
| Consent | localStorage `bd_consent_v1` | client-only |
| Mock orders | sessionStorage `order:<id>` | demo checkout only |
| Quote requests | `QUOTE_WEBHOOK_URL` or server log | fire-and-forget |
| Analytics events | window.dataLayer → GA4/Meta | third-party only |

TypeScript domain types already exist in `types/commerce.ts`
(Product, ProductConfiguration, ArtworkRef, Cart/CartLine, PriceQuote) —
the DB schema below deliberately reuses their shapes.

## Planned schema (AI Data Foundation — next milestone)

Engine: SQLite in development, Postgres in production, via a TypeScript ORM
with migrations (Drizzle or Prisma — decided in the implementation session).
All money integer cents; all timestamps UTC; ids are prefixed cuids
(`sess_…`, `conv_…`).

### Identity & commerce spine

```
Customer      id · email? · name? · phone? · createdAt
Business      id · customerId → Customer · name? · type? · industry? · location?
Session       id · customerId? · startedAt · lastSeenAt · userAgent?
              · firstTouchJson · lastTouchJson        ← attribution snapshot
Order         id · sessionId? · customerId? · provider (mock|shopify)
              · providerOrderId? · currency · subtotalCents · totalCents
              · status (see Factory statuses, §37 of upgrade prompt)
              · aiAssisted (bool) · conversationId? · attributionJson · createdAt
OrderLine     id · orderId → Order · productId · configurationJson
              · unitPriceCents · totalCents · artworkId?
Quote         id · sessionId? · customerId? · status (draft|submitted|priced|
              accepted|rejected) · payloadJson · attributionJson · createdAt
Artwork       id · customerId? · orderId? · quoteId? · fileName · fileType
              · sizeBytes · storageUrl? · notes?
              · status (uploaded|review_required|proof_created|proof_sent|
                approved|revision_requested|production_ready)
Configuration id · sessionId · productId · stateJson · updatedAt
              (abandoned-config analysis; one active row per session/product)
```

### Events & attribution

```
Event         id · sessionId? · customerId? · name · propsJson
              · productId? · conversationId? · orderId? · ts
              (names: session_started, page_view, product_viewed,
               configurator_started, configurator_updated, quantity_selected,
               artwork_uploaded, price_viewed, shipping_estimate_requested,
               ai_chat_started, ai_message_sent, ai_product_recommended,
               add_to_cart, checkout_started, purchase_completed,
               quote_started, quote_submitted, experiment_exposed,
               reorder_started)
```

Attribution is stored as first/last-touch JSON snapshots on Session and
copied onto Order/Quote/Conversation at creation — the existing
`lib/attribution` merge semantics (immutable first touch, campaign-only
last-touch updates) are preserved server-side.

### Conversation & need profile

```
Conversation  id · sessionId · customerId? · agentType (sales)
              · outcome? (abandoned|quote_started|checkout_started|
                purchased|escalated) · summaryJson? · createdAt · endedAt?
Message       id · conversationId → Conversation · role (user|assistant|tool)
              · content · toolCallsJson? · configSnapshotJson? · ts
              (raw transcript preserved separately from extracted insights)

CustomerNeedProfile
              id · sessionId · customerId?
              · businessType? · businessName? · industry? · location?
              · estimatedDailyOrders? · estimatedMonthlyUsage?
              · productInterest?
              · desiredWidth? · desiredHeight? · desiredGusset?
              · materialPreference? · gsmPreference? · colorPreference?
              · handlePreference?
              · printingRequirement? · printingColors? · printingSides?
              · logoAvailable?
              · quantity? · budgetCents? · targetUnitPriceCents?
              · shippingPostalCode? · desiredDeliveryDate?
              · priceSensitivity? · purchaseIntent?
              · painPointsJson? · objectionsJson? · questionsAskedJson?
              · conversationSummary?
              · createdAt · updatedAt
              (every field optional; enriched progressively; unknown stays
               unknown — extraction must never fabricate)
```

### AI operations

```
AiUsage       id · provider · model · agentType · requestType
              · inputTokens · outputTokens · estimatedCostMicros
              · latencyMs · success · error? · conversationId? · ts

AgentDecision id · agentType · observation · recommendation
              · reasoningSummary · supportingMetricsJson · confidence
              · riskLevel (low|medium|high) · proposedActionJson
              · approvalRequired · approvalStatus (pending|approved|
                rejected|modified) · executionStatus (none|scheduled|
                executed|rolled_back) · createdAt · executedAt?

Approval      id · decisionId → AgentDecision · reviewer · action
              (approve|reject|modify) · note? · beforeJson? · afterJson? · ts

AgentConfig   agentType (pk) · autonomyMode (OBSERVE|RECOMMEND|
              GUARDED_AUTO|AUTONOMOUS) · limitsJson · updatedAt
```

### Experimentation (schema only until Stage F)

```
Experiment    id · name · hypothesis · controlJson · variantsJson
              · trafficSplitJson · audience? · primaryMetric
              · guardrailMetricsJson · minimumSample · startAt? · endAt?
              · status (draft|running|stopped|decided) · resultJson? · winner?
Exposure      → recorded as Event(name=experiment_exposed,
                props={experimentId, variant})
```

### Insights (Stage D)

```
Insight       id · kind (top_question|objection|demand|lost_opportunity|…)
              · title · valueJson · sourceRefsJson (traceable to real rows)
              · periodStart · periodEnd · createdAt
```

## Migration rules

- Extend, don't duplicate: `types/commerce.ts` types map onto tables; the
  client keeps working against the same shapes.
- localStorage cart/attribution stay as the client cache; the server
  becomes authoritative when a session record exists.
- Migrations are additive and reversible; no destructive migration without
  an explicit backup step.
- Every table lands with its feature — no speculative empty tables except
  where a foreign key demands it.
