# Reference repositories and licences

| Repository | Used for | Licence | How we use it |
|---|---|---|---|
| [shadcn/ui](https://github.com/shadcn-ui/ui) | Accessible primitives (buttons, forms, dialogs, dropdowns, toggle groups, tables) | MIT | Installed per component with `pnpm dlx shadcn@latest add …`; generated files live in `components/ui/` and are ours to edit. Official docs: https://ui.shadcn.com/docs |
| [HyperUI](https://github.com/markmead/hyperui) | Marketing and eCommerce section patterns (hero, features, pricing, FAQ, contact, product cards) | MIT | Pattern reference only — no npm dependency. Markup is copied from hyperui.dev, rebuilt as typed React components, restyled with our tokens. List substantially reused patterns below. |
| [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | Study of Apple / Nike / Uber design languages (third-party analyses) | MIT (repo); brand identities belong to their owners | Interpretation only. Our `DESIGN.md` is original; no brand assets, fonts or copy were taken. |
| [taste-skill](https://github.com/Leonxlnx/taste-skill) | `design-taste-frontend`, `redesign-existing-projects` skills | MIT | Vendored into `.claude/skills/` with the LICENSE file; tracked in `skills-lock.json` for updates. |
| [DaisyUI](https://github.com/saadeghi/daisyui) | Optional reference | MIT | **Not installed.** Would compete with shadcn/ui's styling layer. |
| [Chakra UI](https://github.com/chakra-ui/chakra-ui) | Future reference for B2B dashboards / customer management | MIT | **Not installed in Phase 1.** |
| Inter (Rasmus Andersson), Space Grotesk (Florian Karsten) | Typefaces | SIL Open Font License 1.1 | Loaded through `next/font/google`. |

## Attribution log for adapted HyperUI patterns

Add a line when a section is substantially adapted (component name → HyperUI pattern URL).

- _none yet_

## Third-party script review (taste-skill, reviewed 2026-10-15)

- `scripts/draw.mjs` — reads its own `library/`, writes `.taste-skill/` in the project and a
  history file under `~/.taste-skill/`. No network.
- `scripts/inspect.mjs`, `scripts/lib/cdp.mjs` — spawns a locally installed Chrome/Edge/
  Chromium over the DevTools protocol to render, measure and screenshot. No install, no
  network beyond the page under test.
- `scripts/assets.mjs` — searches and downloads open-licence images from Openverse,
  Wikimedia Commons, Art Institute of Chicago, The Met, Internet Archive and NASA, recording
  licence and credit. Network only to those APIs; no API keys.
- `scripts/lint.mjs` — static checks on HTML/CSS.
- Re-run this review after `npx skills update`.
