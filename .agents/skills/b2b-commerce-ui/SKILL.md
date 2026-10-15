---
name: b2b-commerce-ui
description: "Design or implement US B2B takeout-bag product discovery, specifications, customization and wholesale inquiry flows using shadcn/ui and HyperUI references. Use for packaging commerce UI; not generic dashboards or installing alternative UI frameworks."
---

# B2B commerce UI

Read the target project's AGENTS.md, DESIGN.md and dependency versions first. If no DESIGN.md exists, use the brand-design-system template when available, or establish a concise contract from the actual brief. Preserve the current stack. An invocation asking for planning or Skills configuration does not authorize creating a website.

Use shadcn/ui for accessible interactive primitives (fields, selects, dialogs, accordions and tables), and HyperUI as a source of marketing compositions. These are references, not two competing full application frameworks. Reuse the project's existing primitives; when implementation is authorized, inspect current official documentation and dependencies before adding only the needed components. Avoid arbitrary registry URLs and remote install scripts. Do not install daisyUI or Chakra UI unless the user changes the chosen stack. Tailwind configuration must match the project's installed version.

Design the shortest useful procurement path: product/size discovery → specifications → quantity/custom print options → quote summary → inquiry. Adapt the path to the requested scope rather than generating all pages.

For a product show only confirmed material, dimensions (clearly distinguish width × gusset × height), unit and case quantities, MOQ, printing options, sample availability and shipping/lead-time basis. Use inches for US buyers, with explicit metric equivalents if useful. Distinguish unit price, case price, tiers, setup costs, freight and tax; do not manufacture numbers. For missing commercial facts use “Confirm with sales” in planning and flag them before launch.

Inquiry fields should capture the needed product, quantity, print preference, delivery ZIP and business contact with visible labels and accessible errors. Keep optional fields optional. Preserve entered data on failure; provide loading, validation, recoverable failure and confirmed success states. An unconnected form must be labeled as a demo and must never claim the inquiry was sent. Do not transmit customer details, accept payments or publish as a consequence of applying this skill alone.

Use a useful product hero, specification comparison and clear quote/sample actions. Make custom-print and bulk procurement details easy to compare on mobile. Use honest evidence; no invented reviews, customer logos, urgency or eco/food-contact certifications.

Read [references/sources.md](references/sources.md) for official references and license notices. Validate keyboard operation, mobile overflow, quote totals where implemented, form recovery and actual destination behavior. Report what was verified and what remains unconnected.
