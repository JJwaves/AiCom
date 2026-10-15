---
name: premium-industrial-minimalism
version: 0.1.0
description: >
  Original design system for a premium B2B packaging brand (Phase 1: takeout and
  delivery bags for restaurants, cafés and food businesses, US market). Photography-first,
  warm-neutral, typographically led, with the conversion discipline of a DTC store and the
  information density a buyer placing a 5,000-unit order needs. Source of truth for tokens:
  design/tokens.json.
tokens: design/tokens.json
stack: Next.js · TypeScript · Tailwind CSS v4 · shadcn/ui · HyperUI (reference only)
---

# Premium Industrial Minimalism

## 1. Visual theme and atmosphere

The site should feel like a well-run workshop that happens to have a beautiful showroom.
Everything in it is there to help a buyer decide: the bag, its dimensions, what it holds,
what it costs at 1,000 vs 10,000 units, how it looks with their logo, and how to get a quote.

Three ideas carry the whole system:

1. **The product is the hero, the chrome is quiet.** Photography of real bags, real kitchens
   and real hands does the emotional work. UI surfaces are warm off-white, hairline-divided,
   shadowless. Nothing competes with the picture.
2. **Typography does the talking.** A geometric grotesk (Space Grotesk) for headings and large
   numbers, a neutral workhorse (Inter) for everything else. Big, confident headline sizes;
   small, disciplined captions. Hierarchy comes from size and spacing, not from colour or
   decoration.
3. **B2B is a feature, not a mode.** Minimum order quantities, lead times, volume price
   breaks, material specs and "Request a quote" are first-class content, set in tabular
   figures and shown early. We never hide the business facts behind a consumer-style funnel.

Reference study (interpretations only, nothing copied): Apple's whitespace and product-first
storytelling; Nike's single large editorial headline over full-bleed photography and its
"photo *is* the card" grids; Uber's near-monochrome chrome with one unmistakable CTA style.
Our twist is warmth — kraft paper, terracotta, off-white — because the product is paper and
the customer is a kitchen, not a data centre.

What it is **not**: a SaaS landing page. No gradient blobs, no glassmorphism, no floating
3-column icon cards, no purple, no "Trusted by 10,000+ restaurants" without a real number.

## 2. Colour palette and roles

All values live in `design/tokens.json`; the names below are the token names. Ratios are
measured against `canvas` (#F7F5F0) unless stated.

| Role | Token | Value | Notes |
|---|---|---|---|
| Page background | `canvas` | #F7F5F0 | Warm off-white. The default ground. |
| Alternate band | `canvas-2` | #EFEBE3 | Section banding, table headers, product stages. |
| Card / input surface | `surface` | #FFFFFF | Sits on canvas with a hairline, never a shadow. |
| Dark band | `surface-ink` | #171717 | Footer, occasional statement band, primary button fill. |
| Text | `ink` / `ink-2` / `ink-muted` | #171717 / #4A4541 / #6B645C | 16.5 / 8.7 / 5.4 : 1. `ink-muted` is the lightest text allowed. |
| Accent (large) | `accent` | #C65D32 | Terracotta. Display type ≥24px, icons, rules, selected states. 3.8:1 — **not for body-size text**. |
| Accent (text) | `accent-ink` | #A84A25 | Links, small accent text, accent-filled buttons with white labels (5.7:1). |
| Accent tint | `accent-soft` | #F5E4DB | Badge and callout fills. |
| Kraft (decorative) | `secondary` | #B69573 | Swatches, image stages, dividers. Never text. |
| Kraft (text) | `secondary-ink` | #7A5C3C | 5.6:1. Material labels, eyebrow on kraft stages. |
| Kraft tint | `secondary-soft` | #EFE4D6 | Material-option fills. |
| Hairlines | `hairline` / `hairline-strong` | #E3DED5 / #CFC8BC | Dividers, card borders, table rules. |
| Control borders | `border-control` | #8C8275 | Inputs, checkboxes, radios (3.5:1 non-text minimum). |
| Status | `success` / `warning` / `danger` | #2F6B4F / #9A5A0B / #B3261E | Stock, lead-time warnings, errors. All ≥5:1. |

**Proportions.** Roughly 85% canvas/surface, 10% ink (text, one dark band, primary buttons),
5% accent and kraft combined. If a viewport shows more than one terracotta element that is
not type or a selected state, remove one.

**Primary button is ink, not accent.** A black button on warm white reads as premium and
keeps terracotta scarce. Accent-filled buttons (`accent-ink` fill, white label) are reserved
for the single highest-value action on a page — usually "Request a quote".

## 3. Typography rules

| Style | Family | Size | Line | Weight | Use |
|---|---|---|---|---|---|
| `display-xl` | Space Grotesk | clamp(48–88px) | 0.95 | 500 | Homepage hero. One per page. |
| `display` | Space Grotesk | clamp(40–64px) | 1.0 | 500 | Section openers. |
| `h1` | Space Grotesk | clamp(32–44px) | 1.05 | 500 | Page title, PDP product name. |
| `h2` | Space Grotesk | clamp(24–32px) | 1.15 | 500 | Section headings. |
| `h3` / `h4` | Space Grotesk | 24 / 20px | 1.2 / 1.3 | 500 | Card, dialog, spec-group titles. |
| `body-lg` / `body` / `body-sm` | Inter | 18 / 16 / 14px | 1.6 / 1.6 / 1.5 | 400 | Copy, forms, tables. Inputs are never below 16px. |
| `label` | Inter | 14px | 1.4 | 500 | Form labels, tabs, small buttons. |
| `caption` | Inter | 12px | 1.4 | 500, +0.08em, uppercase | Eyebrows, spec keys, badges. |
| `numeric` | Inter, `tnum` | 16px | 1.4 | 500 | Prices, quantities, MOQ, lead times. |

Rules:

- Headings use weight 500 only. Bold (700) is for a single number you want to land
  ("5,000 units · 10 business days"), never for whole headings.
- Negative tracking on display sizes (−0.02em), none at body size. No letterspaced lowercase.
- One display size per viewport. The second-largest text in a hero is `body-lg`, not `h2`.
- Running text wraps at 65ch. Headlines wrap at ~14 words; `text-wrap: balance`.
- Fonts load through `next/font/google` with `display: swap`; both are OFL-licensed. Do not
  ship them as local files copied from elsewhere.

## 4. Component stylings

Build from shadcn/ui primitives; adapt HyperUI marketing sections into React. Every
component reads the shadcn CSS-variable contract in `design/generated/globals.css`, which
is mapped onto the brand tokens — so restyling a token restyles every component.

- **Buttons.** Height 44px (52px for hero/submit). Radius `md` (4px). Three variants:
  `primary` (ink fill, canvas text), `outline` (1px ink border, transparent), `accent`
  (accent-ink fill, white text — one per page). Label in Inter 500, 14–16px, sentence case.
  No icons inside buttons except a trailing arrow on "See all" links.
- **Links.** `accent-ink`, underlined with 1px offset 3px. Hover: `ink`. Never colour-only.
- **Cards.** `surface` or transparent on `canvas`, 1px `hairline` border, radius `md`, no
  shadow. Product cards: image 4:5 on a `canvas-2` stage, zero inner padding on the image,
  name / spec line / "from $X per 1,000" below with 8px gaps. The photograph is the card.
- **Inputs, selects, textareas.** 44px, `surface` fill, 1px `border-control`, radius `sm`.
  Focus: 2px `focus` ring at 2px offset. Error: `danger` border + message with icon.
- **Dialogs, sheets, menus.** `surface`, radius `lg`, `overlay` shadow — the only shadow in
  the system. Mobile: bottom sheet for option pickers and the quote form.
- **Badges / chips.** Radius `sm`, 12px caption text. Fills: `accent-soft` (featured, new),
  `canvas-2` (neutral), `success` text on canvas for "In stock".
- **Tables (specs, price breaks).** Hairline rows, `canvas-2` header, `tnum` figures,
  right-aligned numbers, 12px caption keys. On mobile, specs become a two-column
  definition list; price breaks stay a table with horizontal scroll and a sticky first column.
- **Navigation.** Transparent on canvas, 64px tall, wordmark left, 4–6 links, "Request a
  quote" as the only button. Hairline bottom border appears on scroll. Mobile: full-height
  sheet, links at 20px, quote CTA pinned to the bottom.
- **Hero.** Full-bleed photograph (16:9 desktop, 4:5 mobile) *or* a split: `display-xl` on
  canvas left, product on `canvas-2` stage right. Headline ≤ 8 words, one supporting
  sentence, one primary CTA plus one text link. No slideshow.
- **Product configurator (PDP).** Option groups as `ToggleGroup`/radio cards: size, material,
  handle, print (none / 1-colour / full). Each option shows a thumbnail and a price delta.
  Quantity as a stepper with MOQ enforced and price-break hints ("Add 500 more to reach
  $0.42/unit"). Summary panel sticky on desktop, bottom bar on mobile.
- **Request a quote.** Multi-step but short: product + quantity → logo upload (optional) →
  business details. Progress shown as text ("Step 2 of 3"), not a progress bar. Confirmation
  states the expected response time.
- **FAQ.** shadcn `Accordion`, single open item, `h4` question, `body` answer, hairline rows.
  No icons other than the chevron.

## 5. Layout principles

- 12-column grid, 24px gap, container 1280px, gutters 16px (mobile) / 32px (≥1024px).
- Section rhythm `clamp(64px, 10vw, 128px)`; related blocks `clamp(40px, 6vw, 64px)`.
- Asymmetry is allowed and encouraged: 7/5 and 8/4 splits for feature stories; 5/7 for
  text-left-image-right. Avoid three-equal-columns of icon cards.
- Full-bleed is for photography and the dark footer only. Text never goes full-bleed.
- Product grids: 2-up mobile, 3-up tablet, 4-up desktop, 8–24px gutters, no card borders in
  the grid (stage colour separates them).
- Whitespace is a material: when a section feels thin, make the type larger or the photo
  bigger rather than adding a decorative element.

## 6. Depth and elevation

Flat by default. Hierarchy is expressed by three background steps (`canvas` → `canvas-2` →
`surface`) and hairlines. The single shadow token `overlay` is reserved for things that float
over content (dialogs, sheets, menus, sticky quote bar). No inner shadows, no glows, no
gradients anywhere except an optional 0→40% ink scrim over hero photography so headline text
reaches 4.5:1.

## 7. Do's and don'ts

**Do**

- Lead with the product photograph; stage cut-outs on `canvas-2` or `secondary-soft`.
- Show MOQ, lead time and a "from" price on every product card.
- Use real numbers with their source ("Ships in 10 business days from Reno, NV").
- Keep one accent CTA per page; everything else is ink or outline.
- Write in sentence case; headlines are statements, not slogans.
- Make every interactive element at least 44×44px and keyboard reachable with a visible ring.

**Don't**

- Don't use gradients, glassmorphism, blurred blobs, neon, purple or blue-violet.
- Don't put small text in `accent` or `secondary` — use the `-ink` variants.
- Don't add scroll-triggered entrance animations, parallax or auto-playing carousels.
- Don't fabricate testimonials, logos, review counts or "trusted by" claims. Use a quiet
  "Customers" section only when real customers and permissions exist.
- Don't use stock photos of handshakes, generic smiling teams or AI-generated people.
- Don't introduce a second component library (DaisyUI, Chakra, MUI) in Phase 1.
- Don't invent new colours or sizes in a component; add a token in `tokens.json` first.

## 8. Responsive behaviour

| Breakpoint | Layout |
|---|---|
| < 640px | Single column. Hero 4:5 crop. Nav becomes a sheet. Configurator options stack; summary is a sticky bottom bar (64px) with price + "Request a quote". Spec tables become definition lists. |
| 640–1023px | 2-up product grids, 6/6 splits, nav still collapsed ≥ 768 shows links. |
| ≥ 1024px | Full grid, 32px gutters, sticky configurator summary (top: 96px), 3–4-up grids. |
| ≥ 1280px | Container caps at 1280px; imagery may bleed. Type reaches the top of its clamp. |

Images: `next/image` with `sizes`, art-directed `<picture>` for hero crops, lazy below the
fold, explicit aspect ratios to prevent layout shift. Touch targets 44px. No hover-only
information (price deltas, tooltips) — everything is visible or tappable.

## 9. Agent prompt guide

When building or reviewing UI for this project:

1. Read `DESIGN.md` and `design/tokens.json`. Use token names, never raw hex, in components.
2. Start from the shadcn/ui primitive (`pnpm dlx shadcn@latest add <component>`); for
   marketing sections, pick the closest HyperUI pattern, rebuild it as a typed React
   component, replace its colours/spacing with tokens, and keep the MIT notice in
   `docs/references.md`.
3. Before writing a page, write its argument: one line per section stating the claim and the
   proof (photo, number, spec). Delete sections with no claim. Then run the
   `design-taste-frontend` skill's draw step with `--keep palette,type`.
4. Check every text/background pair against the ratios in §2. Run the
   `frontend-quality-review` skill before calling anything done; it screenshots at
   390 / 768 / 1440 and checks the don'ts above.
5. Prefer fewer, larger elements. If in doubt, remove the decoration and enlarge the type or
   the photograph.

Suggested prompt opener for new pages:

> Using DESIGN.md and design/tokens.json, build `<page>` for the takeout-bag B2B site.
> Stack: Next.js app router, TypeScript, Tailwind v4, shadcn/ui. Sections (with claims):
> … Keep one accent CTA. Photography placeholders must declare their real subject and
> aspect ratio. No gradients, no animations, no fabricated social proof.
