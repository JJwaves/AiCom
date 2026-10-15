# DESIGN.md — Premium B2B Takeout Packaging

Status: reusable starting contract, pending brand/product confirmation. No website is created by this document.

## Audience and conversion
US restaurants, cafés, caterers and food operators buying takeout bags in bulk. Product clarity and purchasing confidence are the priorities. Default primary action: Request a quote. Secondary: Request samples, only if offered. Customer-facing language: US English. No invented product facts or claims.

## Direction
Warm editorial utility: tactile paper detail, precise specifications and calm typography. Show actual bags, handles, gussets and scale in use. Photography should describe the supplied product. Brand-inspired quality does not authorize copying another brand's identity or assets.

## Semantic color tokens
| Token | Value | Role |
|---|---|---|
| canvas | #F7F6F3 | Warm neutral background |
| surface | #FFFFFF | Product and form surfaces |
| ink | #202420 | Main text |
| muted-ink | #565D56 | Secondary text |
| action | #244A3B | Primary action and links |
| action-hover | #19382C | Hover action |
| on-action | #FFFFFF | Text on action |
| subtle-border | #DEDFD8 | Decorative separators |
| control-border | #777E75 | Essential input outlines |
| focus | #8A4B20 | Visible keyboard focus |
| error | #A12D28 | Errors, paired with text/icon |

Verify contrast in the final rendered combinations; never use subtle-border as the sole essential control outline. Use semantic CSS variables and map existing shadcn variables such as background, foreground, primary, border, input and ring to these roles using the installed project's expected color syntax.

## Type
Use system sans by default: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif. An optional licensed editorial serif may be selected later. No paid/proprietary font requirement or font installation. Body 16–18px with 1.5–1.65 line-height; UI 16px; captions at least 14px. Display 36–64px fluid; section headings 28–40px. Use 400/500/600 weights. Avoid clipping and forced line breaks; keep body measures near 60–70 characters. Use tabular numerals for quantity and price comparisons.

## Layout and spacing
Spacing scale in px: 4, 8, 12, 16, 24, 32, 48, 64, 96. Max content width 1200px; side gutters 20px mobile, 32px tablet, 48px desktop. Single column below about 640px, two where useful above 768px, expanded grid above 1024px; let real content determine breakpoints. Section padding 48px mobile and 80px desktop. Do not sacrifice information for whitespace. Use clear editorial sections, not repeated generic feature-card grids.

## Components
Buttons/inputs: 6px radius, 44px preferred minimum touch height, visible labels and focus ring with offset. Cards: 8px radius and light border; elevation only where it communicates layering. One primary action per decision area. Product cards need real image, descriptive name, key size/material and a clear quote or detail destination. Specification tables remain usable on mobile. FAQ uses semantic disclosure or the existing accessible accordion. Reuse shadcn interaction primitives; adapt HyperUI section compositions to these tokens. Do not add competing UI frameworks.

## Procurement content
Clearly distinguish per bag/per case, units per case, MOQ, quantity tiers, customization/setup costs, freight/tax and estimated versus confirmed lead times. Use confirmed values only; unresolved facts must be tracked before launch. Show inches with optional metric equivalents. Identify dimension order explicitly. Keep quote summary synchronized with selected options. Inquiry success requires a real confirmed backend response.

## Imagery and motion
Use owned/licensed accurate product photography and retain credits. AI images and placeholders are concept material, not evidence of an actual product or certification. No arbitrary image-count minimum. Keep product color/material faithful. Motion is optional, normally 120–200ms feedback using opacity/transform; respect reduced-motion and keep content visible without animation. No mandatory animation library.

## Validation
Inspect phone/tablet/desktop layouts and keyboard paths. Check visible focus, accessible names, errors, contrast and non-color status cues. Target WCAG 2.2 AA. Verify form failure/retry and actual CTA destinations when built. Do not claim visual or submission tests that were not run.

## Provenance
Original B2B contract adapted from the structural approach of Awesome DESIGN.md and reviewed Taste/minimalist-ui principles. shadcn/ui and HyperUI are component references. See the skill's references/sources.md and licenses/. No upstream runtime code or external assets are bundled. daisyUI and Chakra UI are recorded alternatives only, not installed.
