---
name: b2b-commerce-ui
description: Build B2B e-commerce surfaces for the takeout-bag site — homepage, product listing and detail pages, spec tables, quantity/material/print configurators, wholesale price breaks and MOQ, custom logo options, Request-a-Quote forms, FAQ, responsive navigation and conversion CTAs — using shadcn/ui primitives and HyperUI patterns on the brand design system. Use whenever a page, section or component with commerce or lead-capture intent is requested.
---

# B2B commerce UI

Phase 1 sells takeout and food-delivery bags to restaurants, cafés and food businesses in
the US. The buyer is a busy operator or purchasing manager comparing capacity, material,
price per unit at volume, lead time and whether they can print their logo. Every screen
should answer those questions faster than a phone call would.

Always pair this skill with `brand-design-system` (tokens, styling) and finish with
`frontend-quality-review`. For art direction of marketing pages, run `design-taste-frontend`
first with `--keep palette,type`.

## When to use

- Homepage, category/listing pages, product detail pages (PDP), comparison views.
- Spec tables, dimension diagrams, capacity guides ("fits 2 × 32 oz containers").
- Quantity steppers, price-break tables, MOQ and lead-time messaging.
- Material / size / handle / print option pickers; custom-logo flows and artwork upload.
- Request-a-Quote, sample-request and contact forms; confirmation and error states.
- FAQ, shipping/returns, wholesale terms pages.
- Site navigation, mega-menu, footer, sticky CTA bars.

## When not to use

- Back-office dashboards, order management, CRM (future phase; different system).
- Checkout/payment integration logic — Phase 1 is quote-led, there is no cart checkout
  unless the user explicitly adds one.
- Blog/editorial content with no commerce intent (use `brand-design-system` alone).
- Anything that would require a second component framework.

## Principles

1. **Facts above the fold on a PDP:** name, one-line use case, capacity, dimensions,
   material, MOQ, lead time, "from $X / 1,000". Then the configurator, then the story.
2. **Price is shown as breaks, not a single number.** A `PriceBreaks` table: quantity tiers →
   unit price → total. Highlight the tier the current quantity falls in; show the delta to
   the next tier ("Add 500 to reach $0.42/unit"). Figures use `tnum`.
3. **Configuration is a form, not a toy.** Option groups are accessible radio groups
   (`ToggleGroup` / `RadioGroup` from shadcn) with visible labels, thumbnails and price
   deltas. Selected state uses `accent` border + `accent-soft` fill, plus a check icon —
   never colour alone. Disabled combinations say why ("Full-colour print requires 2,500+").
4. **Quote request is the primary conversion.** One accent CTA per page, labelled
   "Request a quote" (sentence case). Secondary: "Order samples", "Talk to sales". The quote
   form is three short steps, saves progress in state, validates inline with
   `react-hook-form` + `zod`, and confirms with the expected response time.
5. **Custom logo is an option, not a separate product.** Print options: none / 1-colour /
   2-colour / full-colour, with artwork upload (PDF, AI, SVG, PNG ≥ 300 dpi) and a
   plain-language proof step. Show a mock-up slot but never fake a customer's logo.
6. **Navigation is shallow.** Products (by use: delivery, catering, bakery…), Custom
   printing, Wholesale pricing, Samples, About, FAQ. Mobile: sheet with pinned quote CTA.
7. **Trust is specific.** Material certifications (FSC, FDA-contact, compostable
   standards) shown as text with the certificate reference — only when the user supplies
   them. No fabricated logos, reviews, counts or "as seen in".
8. **Mobile is the showroom.** Operators check sites from the kitchen. Sticky bottom bar
   with price + CTA on PDP; tables scroll horizontally with a sticky first column; tap
   targets 44px; forms use the right `inputmode` and `autocomplete`.
9. **Reuse over reinvention.** Use the shadcn primitive first, the HyperUI pattern second,
   custom markup last. Do not add other UI libraries.
10. **Accessible by construction.** Labels for every control, error summary linked to
    fields, `aria-live` for price updates, focus moved into dialogs/sheets and returned.

## Component map (shadcn/ui + HyperUI → ours)

| Need | Build from | Our component |
|---|---|---|
| Nav, mobile menu | shadcn `NavigationMenu`, `Sheet`, HyperUI headers | `SiteHeader`, `MobileNav` |
| Hero | HyperUI hero sections (rebuilt) | `Hero` (full-bleed / split variants) |
| Product grid | HyperUI product cards (rebuilt) + `next/image` | `ProductCard`, `ProductGrid` |
| Feature stories | HyperUI feature/content sections | `FeatureStory` (7/5 split) |
| Specs | shadcn `Table`, `Tabs` | `SpecTable`, `CapacityGuide` |
| Option pickers | shadcn `ToggleGroup`, `RadioGroup`, `Tooltip` | `OptionGroup`, `MaterialSwatch` |
| Quantity + breaks | shadcn `Input`, `Button`, `Table` | `QuantityStepper`, `PriceBreaks` |
| Logo / print | shadcn `Form`/`Field`, `Select`, file input | `PrintOptions`, `ArtworkUpload` |
| Quote form | shadcn `Form`, `Input`, `Select`, `Textarea`, `Checkbox` + rhf/zod | `QuoteForm` (3 steps) |
| FAQ | shadcn `Accordion`, HyperUI FAQ layout | `Faq` |
| Pricing info | HyperUI pricing tables (rebuilt as breaks) | `WholesaleTiers` |
| Contact | HyperUI contact sections + shadcn `Form` | `ContactForm` |
| Sticky CTA | custom, `overlay` shadow | `StickyQuoteBar` |
| Dialogs | shadcn `Dialog`, `Sheet`, `Drawer` | sample request, artwork preview |

Install primitives one at a time as needed:
`pnpm dlx shadcn@latest add button input select dialog sheet accordion toggle-group radio-group table tabs form checkbox textarea tooltip badge separator`.

## Reference repositories

- shadcn/ui — https://github.com/shadcn-ui/ui (MIT). Use the official docs and the shadcn
  skill (`pnpm dlx skills add shadcn/ui`) for current CLI flags and composition rules.
- HyperUI — https://github.com/markmead/hyperui (MIT). Browse hyperui.dev → Marketing
  (hero, features, pricing, FAQ, contact) and eCommerce (product cards, filters). Copy the
  markup, convert to a typed React component, replace every colour/spacing class with
  tokens, delete decorative extras.
- awesome-design-md — https://github.com/VoltAgent/awesome-design-md (MIT). For PDP and
  grid patterns, see the Nike and Apple analyses; for CTA discipline, Uber. Interpret, do
  not copy.
- DaisyUI (optional, not installed), Chakra UI (future dashboards, not installed).

## Implementation checklist

- [ ] Page argument written: one line per section → claim + proof (photo, number, spec).
- [ ] Data shape defined in TypeScript first (`Product`, `Option`, `PriceBreak`, `QuoteRequest`)
      with sample JSON in `content/` — no hard-coded strings in components.
- [ ] shadcn primitives installed via CLI, not hand-copied; `components.json` present.
- [ ] HyperUI pattern rebuilt as a typed component with props; no leftover demo copy.
- [ ] PDP above the fold shows: name, use case, capacity, dimensions, material, MOQ,
      lead time, from-price.
- [ ] `PriceBreaks` highlights current tier and shows delta to next tier; `aria-live="polite"`
      on the computed total.
- [ ] Option groups are real radio/toggle groups with labels; selected state has a
      non-colour indicator; impossible combinations explain themselves.
- [ ] Quote form: zod schema, inline errors, error summary, step indicator as text,
      success state with response-time promise, honeypot or captcha hook left as a TODO.
- [ ] Artwork upload accepts PDF/AI/SVG/PNG, states size/dpi requirements, never renders a
      fake customer logo.
- [ ] FAQ uses `Accordion` with semantic headings; questions are real buyer questions.
- [ ] Navigation: ≤ 6 top-level items, one button, mobile sheet with pinned CTA, skip link.
- [ ] Sticky mobile CTA bar on PDP; desktop summary sticky at `top: 96px`.
- [ ] Every image: `next/image`, aspect ratio, `sizes`, descriptive alt ("Kraft paper
      bag, 12×7×14 in, twisted handles").
- [ ] Empty, loading, error states designed for grids, price lookups and forms.

## Quality validation checklist

- [ ] A buyer can find MOQ, lead time and a unit price within one scroll on mobile.
- [ ] Only one accent CTA per page; it reads "Request a quote" or an equally concrete verb.
- [ ] Keyboard-only run-through: configure a product, change quantity, open and submit the
      quote form, open/close the mobile nav. Focus is visible and never trapped.
- [ ] Screen reader announces option labels, price updates and form errors.
- [ ] 390px: no horizontal scroll, tables scroll internally, bottom bar does not cover
      content (`scroll-padding-bottom`).
- [ ] Price arithmetic verified against `content/` fixtures (tier boundaries inclusive).
- [ ] No fabricated social proof, certifications or numbers; placeholders are labelled TODO.
- [ ] Lighthouse: Performance ≥ 90 (images sized, fonts swapped), Accessibility ≥ 95.
- [ ] `frontend-quality-review` run and its findings resolved.
