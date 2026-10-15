---
name: frontend-quality-review
description: Review finished or in-progress frontend work for visual quality, design-system compliance, responsiveness and accessibility before it is called done. Use when the user asks to review, audit, QA, critique or polish a page/component, says something "looks generic / AI-made / off", or when any page built with brand-design-system or b2b-commerce-ui is about to be merged. Produces a findings list ranked by severity with concrete fixes; does not redesign.
---

# Frontend quality review

A review is a measurement, not an opinion. Render the page, look at it at three widths,
run the static lint, check the contract in `DESIGN.md`, and report findings as
`severity · location · what is wrong · the fix`. Fix only what the user asked you to fix;
otherwise hand back the list.

## When to use

- Before a page or component is merged or demoed.
- After `b2b-commerce-ui` or `brand-design-system` work, as the final step.
- When a page feels generic, templated, "AI-made", cluttered or thin.
- When responsiveness, contrast, keyboard access or performance is in question.
- On a pull request touching `app/`, `components/` or `globals.css`.

## When not to use

- To invent a new visual direction (use `design-taste-frontend` or `redesign-existing-projects`).
- For backend, data or test-only changes.
- As a substitute for real user testing of the quote funnel.

## Procedure

1. **Static lint (30 s).** `node scripts/lint-design.mjs` scans `app/` and `components/` for:
   raw hex / rgb in TSX, arbitrary Tailwind values, `bg-gradient-*`, `backdrop-blur`,
   `shadow-*` other than `shadow-overlay`, `animate-*` on non-interactive elements,
   font-weight 700 on headings, `<img>` instead of `next/image`, buttons without text,
   images without alt. Exit code 1 means findings.
2. **Render and photograph.** With the dev server running:
   `node .claude/skills/design-taste-frontend/scripts/inspect.mjs http://localhost:3000/<path> --widths 1440,768,390 --out .taste-skill/review`
   (zero-dependency; drives a locally installed Chrome/Chromium). If no browser is
   available, fall back to `npx playwright screenshot --viewport-size=390,844 <url> 390.png`
   for each width. Look at every screenshot before writing anything.
3. **Walk the DESIGN.md contract.** For each screenshot check, in order: hierarchy (one
   display size, headline ≤ 8 words, product dominant), colour proportion (≤ 1 terracotta
   non-type element per viewport, primary buttons are ink), type (weights 500/400, measure
   ≤ 65ch, no orphans), spacing rhythm (section gaps consistent, no cramped cards),
   imagery (real subject, consistent stage, declared ratio), B2B facts visible (MOQ, lead
   time, from-price on cards/PDP), CTA count and labels.
4. **Accessibility pass.** Keyboard tab order and visible focus; contrast of every
   text/background pair against `tokens.json` ratios; form labels and errors; `aria-live`
   on price totals; dialogs trap and return focus; reduced-motion respected;
   touch targets ≥ 44px. Run Lighthouse (`npx lighthouse <url> --only-categories=accessibility,performance --quiet`) when available.
5. **Generic-pattern scan.** Flag any of: centred headline + eyebrow + three icon cards;
   gradient/glass/blob; purple or blue-violet; stock handshake/team photos; auto-playing
   carousel; "Trusted by N+" without a source; fabricated testimonials or logos; a hero
   that could belong to any SaaS. Each flag must name the replacement
   (bigger photo, larger type, a real number, a section deleted).
6. **Report.** Markdown table sorted by severity:
   `Blocker` (contrast fail, broken layout at 390, fabricated claim, no keyboard access) ·
   `Major` (token violations, hierarchy, missing B2B facts, extra accent CTA) ·
   `Minor` (spacing, copy case, image ratio drift) · `Nit`. One line each, with file:line
   where known. End with the three changes that would most improve the page.

## Principles

- Measure, don't guess: screenshots, ratios from `tokens.json`, lint output, Lighthouse.
- Judge against this system (`DESIGN.md`), not personal taste; cite the section you apply.
- Removing is a fix. Thin is also a failure — if a page lost its decoration and gained
  nothing, prescribe larger type, bigger photography or fuller content, not ornaments.
- Mobile findings outrank desktop findings.
- Never approve fabricated social proof, even as "placeholder".
- Keep the review independent of the build: when the same session built the page, prefer
  spawning a separate reviewer agent with this skill and the screenshots.

## Reference repositories

- taste-skill — https://github.com/Leonxlnx/taste-skill (MIT): `design-taste-frontend`
  provides `scripts/inspect.mjs` (measured house-style rules, screenshots at three widths)
  and `references/tells.md` / `critique.md` (the catalogue of generic tells and a juror's
  rubric). `redesign-existing-projects` audits an existing UI without breaking it.
- shadcn/ui — https://github.com/shadcn-ui/ui (MIT): component accessibility baseline
  (Radix primitives). A review should not re-implement what the primitive already does.
- HyperUI — https://github.com/markmead/hyperui (MIT): compare adapted sections against the
  source to confirm demo copy and decorative classes were removed.
- awesome-design-md — https://github.com/VoltAgent/awesome-design-md (MIT): for calibration
  of "premium" (Apple whitespace, Nike hierarchy, Uber CTA restraint). Interpretation only.

## Implementation checklist (running a review)

- [ ] Dev server up; page renders without console errors (`read_console_messages` or
      browser devtools).
- [ ] `node scripts/lint-design.mjs` run; output captured.
- [ ] Screenshots at 390 / 768 / 1440 captured and actually viewed.
- [ ] Each DESIGN.md section (§2 colour, §3 type, §4 components, §5 layout, §6 depth,
      §7 don'ts, §8 responsive) checked and cited.
- [ ] Keyboard walk-through and contrast check completed; Lighthouse scores recorded.
- [ ] Generic-pattern scan done with a named replacement for every flag.
- [ ] Findings table written, sorted, with file:line and a concrete fix each.
- [ ] Top-three improvements listed.

## Quality validation checklist (the page passes when)

- [ ] Zero Blockers; Majors either fixed or explicitly accepted by the user.
- [ ] Lint exits 0 (or every remaining hit is justified in the report).
- [ ] No horizontal scroll at 390px; sticky bars do not hide content.
- [ ] All text ≥ 4.5:1 (≥ 3:1 for large), controls ≥ 3:1 borders, focus ring visible.
- [ ] One display headline, one accent CTA, ink primary buttons, no shadows except
      `overlay`, no gradients/animations/blur.
- [ ] Product photography dominant; B2B facts visible on first screen of PDP and on cards.
- [ ] Nothing fabricated; placeholders are labelled TODO with the real source named.
- [ ] Lighthouse Accessibility ≥ 95, Performance ≥ 90 (mobile).
