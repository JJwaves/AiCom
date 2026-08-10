# Session 04 — AI provider layer + tool architecture

Roadmap: Stage B (spec stage 3). Requires Session 03 (AiUsage table).

## Read first

- `CLAUDE.md`
- `docs/AI_AGENT_ARCHITECTURE.md` (provider layer, router, tool rules)
- `docs/GUARDRAILS.md` (feature flags, AI budget caps)
- `docs/MASTER_PROMPT.md` §8, §11, §22–§24

## Objective

Build `/lib/ai` — provider-agnostic model access, model router, usage
tracking, and the typed tool registry. No customer-facing surface yet.

## In scope

1. `lib/ai/providers/` — one `AIProvider` interface (`generateText`,
   `generateStructuredObject`, `runToolConversation`); implementations
   selected by env (`AI_PROVIDER`, `AI_API_KEY_*`). Keys are server-only.
2. `lib/ai/router/` — task-class routing (LOW_COST / STANDARD /
   REASONING) as configuration; per-agent overrides.
3. AiUsage row per call (provider, model, agent, tokens, estimated cost,
   latency, success/error); daily/monthly budget caps from config —
   cap breach disables AI gracefully, commerce unaffected.
4. `lib/ai/tools/` — typed tool registry: every tool runs server-side,
   zod-validates input, checks the calling agent's allowlist, calls
   existing deterministic modules only, returns typed output, logs the
   call. No raw DB/HTTP escape hatches.
5. `config/flags.ts` — all AI flags, default **false**.
6. Unit tests: router selection, permission denial, budget-cap behavior,
   usage recording.

## Out of scope

The sales agent itself (Session 05), prompts/personas, any UI.

## Exit criteria

A scripted server-side test conversation can call a whitelisted dummy tool
end-to-end with usage recorded; denied tools stay denied; flags off ⇒
nothing reachable; all checks green.

## Closeout

Update `CLAUDE.md`, `docs/AI_AGENT_ARCHITECTURE.md` (implemented status).
