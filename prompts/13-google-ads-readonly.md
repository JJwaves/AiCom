# Session 13 — Google Ads read-only reporting

Roadmap: Stage H, first step only (spec stage 12). Requires contribution
profit (Session 09). READ-ONLY — no write scopes at all.

## Read first

- `CLAUDE.md`
- `docs/MASTER_PROMPT.md` §28
- `docs/AI_AGENT_ARCHITECTURE.md` (per-agent spec #5)
- `lib/attribution/` (join key: gclid/wbraid/gbraid)

## Objective

`/modules/ads/google` reading campaign performance and joining it to
first-party attribution and contribution profit. Reporting only.

## In scope

1. Google Ads API integration with **read-only** credentials, server-side
   only; module boundary `/modules/ads/google`; flag `AI_GOOGLE_ADS_AGENT`
   gating the surface (agent mode OBSERVE).
2. Campaign/ad-group/keyword spend + click reports persisted or cached
   server-side.
3. Join: ad spend ↔ first-party attribution (click ids) ↔ orders ↔
   contribution profit — true profit-per-campaign, not ROAS alone.
4. Admin marketing report page (read-only tables).
5. Failure isolation: ads API errors must never affect commerce.

## Out of scope

ANY write scope, budget/bid/keyword changes, recommendations (next
session in the progression), Meta (Stage I).

## Exit criteria

Real campaign data renders joined to first-party outcomes; zero write
capability exists in code or credentials; all checks green.

## Closeout

Update `CLAUDE.md`, roadmap (H1 done → H2 recommendations is next).
