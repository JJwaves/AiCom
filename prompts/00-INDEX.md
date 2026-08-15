# Prompt pack — development session index

One file per development session. Start a **new** session per prompt; the
repo (CLAUDE.md + docs/) is the only persistent memory. Paste the prompt
file's contents (or reference it) to start the session.

Rules that apply to every session:

1. Read `CLAUDE.md` first, then the docs listed in the prompt.
2. Work only on that session's scope. Commerce keeps working — run
   `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
   before finishing.
3. Never invent business data (prices, costs, capabilities, insights).
   Placeholders are explicit `[TO BE PROVIDED]`.
4. All AI features behind flags, default off.
5. Close out by updating `CLAUDE.md` (stage, completed work, architecture,
   known issues, next session) and any affected docs.

| Prompt | Scope | Roadmap stage | Status |
| --- | --- | --- | --- |
| [01-audit-migration.md](01-audit-migration.md) | System audit + architecture docs | A | ✅ 2026-08-08 |
| [02-commerce-pricing.md](02-commerce-pricing.md) | Server-authoritative pricing + cost model | A | ✅ 2026-08-08 |
| [03-data-foundation.md](03-data-foundation.md) | DB, sessions, events, profiles, conversations | B | ✅ 2026-08-09 |
| [04-ai-infrastructure.md](04-ai-infrastructure.md) | AI provider layer, router, tools, usage tracking | B | ✅ 2026-08-10 |
| [05-ai-sales.md](05-ai-sales.md) | AI Packaging Expert core | C | ✅ 2026-08-10 |
| [06-ai-configurator.md](06-ai-configurator.md) | Chat ↔ configurator shared state | C | ✅ 2026-08-10 |
| [07-ai-checkout.md](07-ai-checkout.md) | AI-assisted checkout end-to-end (§44) | C | ✅ 2026-08-11 |
| [08-customer-intelligence.md](08-customer-intelligence.md) | Insight aggregation + admin dashboard | D | ✅ 2026-08-12 |
| [09-business-intelligence.md](09-business-intelligence.md) | Contribution profit + CEO agent | E | ✅ 2026-08-12 |
| [10-guardrails.md](10-guardrails.md) | Guardrail engine + AI Action Center | E | ✅ 2026-08-12 |
| [11-cro.md](11-cro.md) | Experiment engine + CRO agent | F | ✅ 2026-08-12 |
| [12-pricing-intelligence.md](12-pricing-intelligence.md) | Pricing agent (RECOMMEND) | G | next |
| [13-google-ads-readonly.md](13-google-ads-readonly.md) | Google Ads read-only reporting | H | |

Later phases (Google Ads recommendations/automation, Meta Ads, advanced
CEO agent, guarded autonomy) get prompt files when their prerequisites are
done — see `docs/AI_PLATFORM_ROADMAP.md` and `docs/MASTER_PROMPT.md`
Part II (Sessions 13–18).
