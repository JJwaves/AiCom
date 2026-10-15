---
name: frontend-quality-review
description: "Review and improve the visual and interaction quality of premium B2B packaging websites using a vetted Taste/minimalist-ui rubric. Use for responsive, accessibility, brand consistency or inquiry-flow review; not a broad security audit."
---

# Frontend quality review

Read the actual brief, project instructions and DESIGN.md. Review only the requested scope. For a review-only request, report findings without changing files; for a requested polish or fix, make focused reversible changes within scope.

Read [references/reviewed-design-principles.md](references/reviewed-design-principles.md). This is an adapted, instruction-only Taste/minimalist-ui subset. Do not fetch or execute upstream scripts, activate the unreviewed upstream skill or impose its image/animation quotas.

When a running page is available, inspect rendered views around 390, 768 and 1440 CSS pixels and the narrowest supported width. Check zoom, text wrapping, image crops, horizontal overflow, heading hierarchy, real font loading and contrast. Use available browser tooling; if no browser is available, state that visual checks remain unverified. Never claim screenshot review from source inspection alone.

Review hierarchy and brand consistency, product-specific imagery and evidence, useful content density, procurement clarity and a clear primary action. Minimalism must not remove specifications, labels, pricing context or necessary controls. Do not enforce a font/icon ban or a bento layout against an existing design contract.

Check keyboard focus, focus visibility, dialog focus return, field labels/errors, touch targets, contrast, reduced motion and content visibility when scripts fail. Use WCAG 2.2 AA as a review target rather than claiming certification. Aim for 4.5:1 normal text and 3:1 large text/UI boundaries where applicable; distinguish decorative rules from essential control boundaries.

Exercise representative product selection and quote/sample inquiry: required fields, invalid entries, submission loading/failure/success, retained data, and real destinations. Do not submit live inquiries or payments just to test. Flag fabricated claims, misleading success states and unconnected CTAs.

Return findings ordered by user impact with location, observed evidence, suggested fix and verification status. Separate blockers from stylistic preferences. Fix and recheck the meaningful issues when authorized, with at most three visual refinement rounds unless new failures justify more. Do not install packages or rewrite the app solely to satisfy a stylistic rubric.

Read [references/sources.md](references/sources.md) for pinned provenance, licenses and review boundaries.
