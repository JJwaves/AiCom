# Session 12 — Pricing Intelligence agent (RECOMMEND)

Roadmap: Stage G (spec stage 11). Requires populated cost model, real
sales history, guardrails live.

## Read first

- `CLAUDE.md`
- `docs/MASTER_PROMPT.md` §13–§14, §27
- `docs/AI_AGENT_ARCHITECTURE.md` (per-agent spec #4)
- `docs/GUARDRAILS.md` (price limits)
- `modules/pricing`

## Objective

An agent that analyzes pricing toward **expected contribution profit**
and proposes changes — while the deterministic engine remains the only
pricing authority.

## In scope

1. Pricing agent (flag `AI_PRICING_AGENT`, RECOMMEND): analyzes price ↔
   conversion ↔ margin ↔ segment ↔ quantity, quote acceptance, chat price
   objections, abandonment.
2. Proposals as AgentDecision rows: specific tier/delta change, expected
   contribution-profit impact, confidence, supporting data. Guardrail
   engine validates every proposal against `minimumAllowedPrice` /
   `minimumMargin` / `maximumPriceChangePct` before it reaches a human.
3. Bounded price experiments ONLY via the experiment engine after human
   approval, within guardrail bounds.
4. Applying an approved change remains a human/config action this stage
   (no automated price writes).

## Out of scope

Autonomous pricing, per-customer pricing, dynamic/personalized prices.

## Exit criteria

The agent produces at least one well-formed, guardrail-validated pricing
recommendation from real data in the Action Center; engine untouched by
the agent; all checks green.

## Closeout

Update `CLAUDE.md`, roadmap.
