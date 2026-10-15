# Which skill for which task

Claude Code loads project skills from `.claude/skills/<name>/SKILL.md` automatically when a
request matches the skill's description. You can also invoke one explicitly with
`/<skill-name>` or by naming it ("use brand-design-system").

## The five skills

| Skill | Origin | Use it for | Don't use it for |
|---|---|---|---|
| `brand-design-system` | ours | Any styling decision: tokens, Tailwind classes, shadcn theming, typography, colour, spacing, image ratios; editing `tokens.json` / `DESIGN.md` | Logic, data, tests; future admin dashboards |
| `b2b-commerce-ui` | ours | Homepage, listing/PDP, spec tables, size/material/print configurators, price breaks + MOQ, logo upload, Request-a-Quote, FAQ, nav, sticky CTAs | Back-office, checkout/payments, editorial-only pages |
| `frontend-quality-review` | ours | Pre-merge review: lint, screenshots at 390/768/1440, DESIGN.md contract, a11y, generic-pattern scan → ranked findings | Inventing a new direction; replacing user testing |
| `design-taste-frontend` | taste-skill v2 (MIT) | Art direction *before* building a marketing page: deals composition/hero/section blueprints from a library of 247 studied sites, measured house-style inspector, look-and-fix loop | Dashboards/app screens; use `--keep palette,type` so it never overrides our tokens |
| `redesign-existing-projects` | taste-skill (MIT) | Auditing and upgrading an existing page that looks generic, without breaking behaviour | Greenfield pages (use the two above) |

## Typical flows

**New marketing page (homepage, "Custom printing", landing page)**
1. `design-taste-frontend` → write the page argument, `draw.mjs --keep palette,type`, adopt
   the dealt composition.
2. `b2b-commerce-ui` + `brand-design-system` → build with shadcn primitives and adapted
   HyperUI sections, tokens only.
3. `frontend-quality-review` → fix Blockers/Majors, re-run until clean.

**Product detail page / configurator / quote form**
1. `b2b-commerce-ui` (data shape first, then components) with `brand-design-system`.
2. `frontend-quality-review`, with extra attention to keyboard flow and `aria-live`.

**"This looks generic / AI-made"**
1. `frontend-quality-review` to measure what is wrong.
2. `redesign-existing-projects` to fix it in place; `brand-design-system` keeps it on tokens.

**Changing the brand (new accent, new font)**
1. `brand-design-system`: edit `design/tokens.json`, run `node scripts/build-tokens.mjs`,
   update DESIGN.md §2/§3 tables, re-check contrast ratios.
2. `frontend-quality-review` on the two or three most important pages.

## Skills from taste-skill that were *not* installed, and why

- `high-end-visual-design` (soft-skill): bans Inter and prescribes glass/gradient
  archetypes — conflicts with our tokens and the "no gradients" rule.
- `minimalist-ui`, `industrial-brutalist-ui`: alternative house styles; our DESIGN.md is the
  house style. Add later only for an experiment.
- `image-to-code`, `imagegen-*`, `brandkit`: image-generation workflows; not needed for
  Phase 1 (real product photography is the plan).
- `full-output-enforcement`, `gpt-taste`, `stitch-design-taste`: tool-specific; not needed.

To add one later: `npx skills add https://github.com/Leonxlnx/taste-skill --skill <name> -a claude-code`
then review its SKILL.md and any scripts before first use.

## shadcn skill

After the app is scaffolded (`components.json` exists), install the official shadcn skill
so Claude uses the current CLI (`init`, `add`, `search`, `view`, `diff`, `info`) and
composition rules: `pnpm dlx skills add shadcn/ui`. It activates automatically when it
finds `components.json`.
