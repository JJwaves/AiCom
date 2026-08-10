# Session 11 — Experiment engine + CRO agent

Roadmap: Stage F (spec stage 10). Requires guardrails (Session 10) and
meaningful traffic.

## Read first

- `CLAUDE.md`
- `docs/MASTER_PROMPT.md` §25–§26
- `docs/DATABASE_SCHEMA.md` (Experiment model)
- `docs/AI_AGENT_ARCHITECTURE.md` (per-agent spec #3)

## Objective

A minimal, safe experiment runtime (flag `EXPERIMENT_ENGINE`) and a
recommendation-only CRO agent.

## In scope

1. Experiment runtime: deterministic assignment, exposure recorded as
   first-party `experiment_exposed` events, traffic split capped by
   `maximumExperimentTrafficPct`.
2. Experiment lifecycle: draft → approved (human, via Action Center) →
   running → stopped/decided. No winner declared below `minimumSample` —
   enforced in code.
3. Supported surfaces first: hero copy / CTA text / shipping-messaging
   variants from config. No arbitrary DOM injection.
4. CRO agent (flag `AI_CRO_AGENT`, RECOMMEND): analyzes funnel + chat +
   abandonment; proposes fully-specified experiments as AgentDecision
   rows.
5. Tests: assignment determinism, cap enforcement, minimum-sample gate.

## Out of scope

Auto-publishing site changes; pricing experiments (Stage G); multi-armed
bandits / ML.

## Exit criteria

One trivial experiment runs end-to-end (assignment → exposure events →
readout); CRO proposals appear in the Action Center; all checks green.

## Closeout

Update `CLAUDE.md`, roadmap, `docs/DATABASE_SCHEMA.md` status.
