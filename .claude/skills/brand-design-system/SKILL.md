---
name: brand-design-system
description: Apply the Premium Industrial Minimalism design system (DESIGN.md + design/tokens.json) whenever UI is created or styled in this project — pages, sections, components, Tailwind classes, shadcn theme changes, typography, colour, spacing. Use when the user asks to build, style, theme, restyle or "make it look premium/on-brand", or when any new JSX/CSS is written. Also use when editing tokens or DESIGN.md itself.
---

# Brand design system

You are working inside a design system. Its source of truth is two files; read both before
touching any UI:

- `DESIGN.md` — the brand book: theme, colour roles, type scale, component styling, layout,
  do's and don'ts, responsive rules.
- `design/tokens.json` — every value. `node scripts/build-tokens.mjs` regenerates
  `design/generated/globals.css` (Tailwind v4 `@theme` + the shadcn/ui variable contract) and
  `design/generated/tokens.ts`.

The visual direction in one line: **photography-first, warm-neutral, typographically led,
shadowless, one accent CTA per page, B2B facts (MOQ, lead time, price breaks) shown early.**

## When to use

- Writing or changing any `.tsx` with markup, any CSS, `globals.css`, `tailwind` config.
- Adding or theming a shadcn/ui component.
- Adapting a HyperUI section into a React component.
- Choosing colours, type sizes, spacing, radii, shadows, image ratios.
- Editing `design/tokens.json` or `DESIGN.md` (the system is editable — change the token,
  not the component).

## When not to use

- Pure logic, data fetching, API routes, tests, build config with no visual output.
- Internal admin/dashboard screens in a later phase (those will get their own system;
  Chakra UI is the noted future reference — do not install it now).
- Email templates and PDFs (they get a print-safe subset later).

## Principles

1. **Tokens, not values.** In components use `bg-brand-canvas`, `text-brand-ink-muted`,
   `rounded-md`, `shadow-overlay`, `.type-h2` — never a raw hex, px or arbitrary
   `[#C65D32]`. If the needed value does not exist, add it to `tokens.json` with a `usage`
   note and regenerate.
2. **shadcn contract stays intact.** `--background`, `--primary`, `--accent`, `--border`,
   `--ring` … are mapped to brand tokens in `globals.css`. Do not rename them; shadcn
   components depend on them. Brand colours are deliberately prefixed `brand-` so they
   never collide with shadcn's `accent`/`secondary` roles.
3. **Contrast is a token property.** The `usage` note on every colour states its ratio.
   `accent` (#C65D32) and `secondary` (#B69573) are decorative/large-type only;
   body-size text uses `accent-ink` / `secondary-ink`. `ink-muted` is the lightest text.
4. **Primary button is ink.** Terracotta fill is for the single highest-value CTA on a page.
5. **Flat.** The only shadow is `overlay`, for floating layers. Separation = background
   steps + hairlines.
6. **Type carries hierarchy.** Headings weight 500, negative tracking at display sizes,
   one display size per viewport, 65ch measure, `tnum` for every number a buyer compares.
7. **Photography first.** Real bags, kitchens, hands. Product cut-outs on a `canvas-2` or
   `secondary-soft` stage, 4:5 ratio, consistent across a grid. Never stock handshakes or
   AI people. Placeholders must say what the real photo will be.
8. **Fonts via `next/font/google`.** Inter (body) and Space Grotesk (headings); both OFL.
   No local copies of other brands' fonts.
9. **Nothing fabricated.** No invented testimonials, customer logos, counts or awards.
10. **No AI tropes.** No gradients, glass, blobs, purple, icon-card trios, entrance
    animations, hover-only information.

## Reference repositories

| Repo | Role here | Licence |
|---|---|---|
| shadcn/ui — github.com/shadcn-ui/ui | Primitives: Button, Input, Select, Dialog, Sheet, Accordion, ToggleGroup, Form/Field, Table, Tabs. Install per component with the CLI. | MIT |
| HyperUI — github.com/markmead/hyperui | Pattern reference for marketing sections (hero, feature grid, pricing, FAQ, contact). Copy markup → rebuild as typed React → swap classes to tokens. Tailwind v4. | MIT |
| awesome-design-md — github.com/VoltAgent/awesome-design-md | Study only (Apple, Nike, Uber interpretations). Our DESIGN.md is original; copy nothing. | MIT (files are third-party analyses) |
| taste-skill — github.com/Leonxlnx/taste-skill | Installed as `design-taste-frontend` and `redesign-existing-projects` for art direction and anti-generic checks. | MIT |
| DaisyUI, Chakra UI | Optional / future reference. **Not installed in Phase 1.** | MIT |

## Implementation checklist

- [ ] Read `DESIGN.md` §2–§4 and the relevant token names before writing markup.
- [ ] Fonts wired through `next/font/google` and exposed as `--font-heading` / `--font-body`.
- [ ] `app/globals.css` is (or imports) `design/generated/globals.css`; tokens were not
      hand-edited in CSS.
- [ ] Every colour/space/radius/shadow in the component is a token class or CSS variable.
- [ ] Heading uses a `.type-*` class or the matching Tailwind size tokens; weight 500.
- [ ] Only one accent-filled CTA on the page; other buttons are `primary` (ink) or `outline`.
- [ ] Images use `next/image`, declared aspect ratio, `sizes`, alt text that names the bag.
- [ ] Interactive elements ≥ 44px, visible focus ring (`ring-2 ring-ring ring-offset-2`).
- [ ] Mobile layout written first (single column), then `md:` and `lg:` variants.
- [ ] Any new token added to `tokens.json` with a `usage` note; `build-tokens.mjs` re-run.
- [ ] Third-party pattern (HyperUI) noted in `docs/references.md` if substantially reused.

## Quality validation checklist

- [ ] Text/background pairs meet 4.5:1 (3:1 for ≥24px or 19px bold); checked against the
      ratios in `tokens.json`, not guessed.
- [ ] No raw hex, no arbitrary Tailwind values (`[#…]`, `[13px]`) outside `globals.css`.
- [ ] No `shadow-*` other than `shadow-overlay`; no `bg-gradient-*`; no `animate-*` on
      content entrance; no `backdrop-blur`.
- [ ] Screenshots at 390 / 768 / 1440 show no horizontal scroll, no clipped type, no
      orphaned single-word headline lines.
- [ ] Headline count: one `display-*` per viewport.
- [ ] Terracotta appears ≤ 1 non-type element per viewport.
- [ ] `prefers-reduced-motion` respected (globals.css base handles it; no inline overrides).
- [ ] Lighthouse accessibility ≥ 95 on the page; keyboard walk-through completed.
- [ ] Nothing on the page is a fabricated claim, logo, quote or number.
