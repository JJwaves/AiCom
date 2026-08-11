# AI_CONFIGURATOR_INTEGRATION

Session 06 — AI Sales × Product Configurator. This document is authoritative
for the shared configuration state and its AI integration.

## The invariant

**ONE authoritative product-configuration state.** The visual configurator
and the AI Packaging Expert read and mutate the SAME validated
configuration through the SAME server path. There is no
AIConfigurationState, no parallel copy, no client-side fork.

```text
                    Customer
                       │
          ┌────────────┴────────────┐
          ↓                         ↓
   Visual Configurator         AI Sales Agent
   (React store dispatch)      (updateConfiguration tool)
          │                         │
          └────────────┬────────────┘
                       ↓
        lib/configuration/validation.ts     ← catalog rules (isomorphic, pure)
                       ↓
        lib/configuration/server.ts         ← ONE server application path
                       ↓
        lib/data/configuration-service.ts   ← row-locked, revision-checked
                       ↓
        product_configurations row          ← session × product, version = revision
          ┌────────────┴────────────┐
          ↓                         ↓
   Configurator UI              AI context/tools
   (restore + AI sync)          (getCurrentConfiguration)
          ↓
   modules/pricing (sole pricing authority)
```

## Modules

| Module | Role |
| --- | --- |
| `lib/configuration/validation.ts` | Pure catalog validation + patch semantics. `defaultConfiguration` (the UI's historical defaults — server and client share them), `applyConfigurationPatch` (all-or-nothing partial patch; structured `PatchIssue[]` with the legal alternatives), `validateFullConfiguration` (UI-sync path), `describeConfiguration` (customer-visible labels). Patchable fields are exactly `sizeId · materialId · colorId · printOptionId · quantity` — artwork and customDimensions are structurally not patchable (uploader / quote flow only). |
| `lib/configuration/store.ts` | Pure reducer. User actions (`SET_*`), server loads (`LOAD_SERVER_CONFIGURATION`), sync acks, reset. Tracks `revision` (server row version), `dirtyFields` (unsynced local edits), `lastChange` (highlight + aria-live driver). |
| `lib/configuration/context.tsx` | React binding (`ConfigurationProvider`/`useConfiguration`, mounted inside `ProductConfigurator`): session restore on mount (GET), debounced 700 ms persistence (POST, never blocks a click, silent retry), sync-bus subscription for AI updates, `flushSync()` before add-to-cart. |
| `lib/configuration/sync-bus.ts` | Module-level pub/sub connecting the chat widget (root layout tree) to the configurator store (page tree): server-validated AI updates in, configurator presence out (chip enablement + mobile launcher offsets). |
| `lib/configuration/server.ts` | The one server-side application path: `resolveCurrentConfiguration`, `applyConfigurationPatchForSession` (AI tool + tapped suggestions), `syncConfigurationForSession` (UI snapshots). Prices via `sellPriceFor` — engine sell side ONLY. Writes CONFIGURATOR-rank need-profile evidence (non-fatal). |
| `lib/configuration/need-mapping.ts` | Configuration → CustomerNeedProfile field mapping (mirrors checkout's ORDER_DATA mapping). |
| `app/api/configuration/route.ts` | POST `{productId, config}` (UI sync, last-write-wins) or `{productId, patch, expectedRevision?}` (suggestion apply, revalidated); GET `?productId=` (session restore). Strict zod, 32 KB cap, structured 422/409/404. |
| `lib/ai/tools/configuration-tools.ts` | The three sales tools (below). |

## Configuration authority

- **Product catalog** defines legal options; `lib/configuration/validation.ts`
  enforces them for every writer.
- **Pricing Engine** (`modules/pricing`) computes every price. Configuration
  results carry engine sell-side numbers only.
- **AI proposes** patches; **UI proposes** snapshots/patches; the
  application validates and applies. Neither bypasses catalog rules.
- Below-MOQ quantities and the custom color are LEGAL states (the UI always
  allowed them) — `requiresCustomQuote` routes them to the quote flow and
  add-to-cart stays disabled; this parity is deliberate.

## AI tools (sales registry, 8 → 11)

- **`getCurrentConfiguration`** (READ) — the session's live configuration
  (labels, quantity, artwork status, `revision`, engine price,
  `requiresCustomQuote`). Without `productId`: the most recently touched
  row; with it: that product's row or catalog defaults at revision 0.
  Customer-visible fields only — the zod output schema structurally
  excludes cost/margin/floor and even the row's `source`.
- **`updateConfiguration`** (CUSTOMER_WRITE) — COMMIT a customer-requested
  change as a partial patch (only the fields the customer asked about;
  everything else preserved verbatim). Outcomes: `applied` (validated
  config + new revision + engine price), `rejected` (structured issues
  with the available alternatives — the agent relays, never invents),
  `stale_revision` (the current state comes back for reconciliation),
  `unknown_product`. Emits `ai_configuration_updated` /
  `ai_configuration_rejected`.
- **`suggestConfigurationUpdate`** (READ — writes nothing) — PROPOSE a
  change: validates + prices the hypothetical configuration and surfaces a
  structured apply action (label, patch, basedOnRevision, productPath,
  preview price). Emits `ai_configuration_proposed`.

Price previews for "what would X cost?" questions remain `calculatePrice`
(no state change). The v1.1.0 sales prompt states the COMMIT vs PREVIEW
rule and the confirmation policy; the tools make violations recoverable
(visible, revision-guarded), not silent.

## UI ↔ AI synchronization

**UI → AI:** manual changes dispatch to the store → debounced POST →
`product_configurations` (source `configurator`, version++). The agent sees
the live configuration two ways: `buildSalesContext` injects a
"Current configuration (live, revision N)" line each turn, and
`getCurrentConfiguration` reads on demand. The customer never repeats what
they configured.

**AI → UI:** `updateConfiguration` persists server-side (source `ai`),
the agent layer lifts the tool's validated output into
`SalesAgentResult.configurationUpdate` (config + revision + changedFields +
changeSummary + price), `/api/ai/chat` returns it, and the chat widget
publishes it on the sync bus. The mounted configurator applies it through
the reducer: controls re-render, the price re-computes through the same
engine call as manual changes, changed sections briefly highlight with an
"Updated by Packaging Expert" badge (~6 s), and an `aria-live` region
announces the change ("Packaging Expert updated quantity to 10,000.").
The client NEVER applies model text — only the server-validated payload.

**Suggestions:** `suggestedActions` render as apply chips in the chat
("Update to 25,000 bags · $8,250.00 (demo)"). Tapping one POSTs the patch
to `/api/configuration`, which revalidates against the CURRENT state —
then publishes the result on the bus. Off the product page the applied
chip links to the configurator (`productPath`); a rejected/stale apply
shows "no longer matches your configuration".

## Revision + stale-action protection

`product_configurations.version` is the configuration revision:

- Every write goes through `updateConfigurationChecked` — a transaction
  holding `SELECT … FOR UPDATE` on the row, so concurrent writers (manual
  sync, AI turn, tapped chip) serialize.
- The AI passes `expectedRevision` (from its last read); a mismatch writes
  NOTHING and returns the current state (`stale_revision`) — an update
  based on a configuration the customer has since changed can never
  clobber it. The read-validate-write window inside the patch path is also
  guarded (revision re-checked under the row lock).
- Client-side, the store ignores incoming revisions ≤ its own, and
  locally-dirty fields win field-wise over a concurrent AI load (the next
  sync re-asserts them) — a customer's in-flight click is never visually
  reverted.
- UI full-config sync is deliberately last-write-wins: it records what the
  customer currently sees, which is never stale from their perspective.

## Persistence + reload

One live row per session × product (S03 foundation), versioned in place;
orders/quotes keep their own immutable snapshots. The configurator restores
its state on mount from GET `/api/configuration` (manual AND AI changes
survive reload); persistence failures leave a fully-functional local
configurator (loud server logs, silent client retry on the next change).
Assistant messages carry `configSnapshotJson` (the configuration each
AI-committed turn produced) for conversation forensics.

Decided S03 debt: quotes do NOT point `configurationId` at the live row —
the live row keeps mutating after submission and would misrepresent what
was quoted; quotes keep their embedded payload copies.

## CustomerNeedProfile provenance

- Manual configurator changes AND AI-committed changes write
  CONFIGURATOR-rank evidence server-side (`needUpdateFromConfiguration` —
  same mapping as checkout's ORDER_DATA writer). The rank gate
  (USER_STATED > ORDER_DATA > CONFIGURATOR > SYSTEM_DERIVED > AI_INFERRED)
  decides what lands; USER_STATED facts always survive.
- When the customer's own words drove an AI change ("make it black"), the
  S05 evidence-validated extractor independently grants USER_STATED from
  the actual message. Tool execution never erases provenance, and no
  model-writable path to USER_STATED exists — unchanged from S05.

## First-party events

`configurator_updated` (client, per option — unchanged),
`ai_configuration_updated` / `ai_configuration_rejected` (updateConfiguration),
`ai_configuration_proposed` (suggestConfigurationUpdate). No events for
internal reducer operations or engine price previews (noise).
`conversations.outcome` now stamps `quote_started` / `checkout_started` /
`purchased` on the session's active sales conversation (escalated outcomes
are never downgraded).

## Security boundaries (tested)

- The patch schemas are STRICT zod objects over the five option fields:
  price/margin/artwork/admin keys are a loud validation error, never
  silently stripped. There is no input through which the AI can assert a
  price, upload artwork, or touch another session (context is
  server-minted).
- Unsupported options/products come back as structured rejections with
  alternatives; nothing is written.
- Tool outputs and `/api/configuration` responses carry engine sell-side
  prices only — cost/margin/floor fields are structurally excluded.
- The suggestion-apply route revalidates everything server-side; a stale
  or tampered chip cannot inject state.
- DEMO pricing status rides every price payload; the prompt requires demo
  labeling in replies (S05 rule, unchanged).

## Failure behavior

- AI off/unavailable: the configurator is fully functional; chat failures
  show the one customer-safe sentence (S05).
- `/api/configuration` down: local state stays authoritative and visible;
  sync retries on the next change; restore silently falls back to
  defaults.
- Invalid AI patch / unknown product / stale revision: structured tool
  rejections the agent explains; zero side effects.
- Session expired mid-chat: tools fail `execution_failed`; commerce
  unaffected.

## Verification (2026-08-10)

317 vitest tests (no network, FakeAiProvider), typecheck, lint, production
build. Browser-verified on `next dev` (desktop + 375 px mobile) with a
scripted local mock of the provider API (`ANTHROPIC_BASE_URL`; no real
credentials, no app-code changes): manual flow with flags off; "Make it
10,000 bags" → visible configurator update + highlight + aria-live +
$3,700.00 re-price; suggestion chip "Update to 25,000 bags · $8,250.00
(demo)" → tap → visible update; manual 5,000 → chat sees it; reload
restoration; cart line = AI-configured state (Large · Black · No logo ·
10,000 × $0.37); provider-down failure copy; mobile launcher/panel sit
above the sticky Add-to-Cart bar.
