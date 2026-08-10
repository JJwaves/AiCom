# Session 10 — Guardrail engine + AI Action Center

Roadmap: Stage E (spec stage 9). Requires AgentDecision rows existing
(Session 09) to review.

## Read first

- `CLAUDE.md`
- `docs/GUARDRAILS.md` (this session implements it)
- `docs/MASTER_PROMPT.md` §18–§21

## Objective

Central `/modules/guardrails` with `evaluateAgentAction`, per-agent
autonomy modes, configurable hard limits, and the human approval surface.

## In scope

1. `evaluateAgentAction(action) → GuardrailVerdict` per
   `docs/GUARDRAILS.md`; every verdict logged; every allowed-with-approval
   action becomes a pending `AgentDecision`.
2. `AgentConfig` autonomy modes enforced in code (OBSERVE / RECOMMEND /
   GUARDED_AUTO / AUTONOMOUS); initial assignments per `docs/GUARDRAILS.md`.
3. Hard limits from configuration with `[TO BE PROVIDED]` placeholders —
   margin-dependent rules **fail closed** while the cost model is
   unpopulated. Never invent a threshold.
4. The never-automated list enforced structurally (no code path exists).
5. `/admin/ai-actions`: pending decisions with observation, metrics,
   confidence, risk, proposed action; Approve / Reject / Modify; full
   reviewer audit log with before/after.
6. Tests: verdicts for allowed / blocked / needs-approval / fail-closed;
   autonomy-mode enforcement.

## Out of scope

Promoting any agent's autonomy; new agents; ads.

## Exit criteria

The decision → guardrail → approval → (logged) execution loop works on a
real recommendation end-to-end; all checks green.

## Closeout

Update `CLAUDE.md`, `docs/GUARDRAILS.md` (implemented status), roadmap.
