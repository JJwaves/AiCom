import { z } from "zod";

/**
 * Safe variant model (Session 11 spec §6).
 *
 * A variant is NEVER arbitrary HTML, JavaScript, React or CSS. It is a
 * CLOSED, strictly-typed record of presentation VALUES that an existing
 * component already knows how to render. There is no code path anywhere in
 * this repository that turns experiment data into markup — the values below
 * are rendered as React text children and attributes only.
 *
 * The `safeText` primitive is defence in depth on top of that: even though
 * React escapes text by default, a stored `<script>` string is a smell we
 * refuse at the boundary so it can never reach an admin export, an email,
 * or a future non-React renderer.
 */

/**
 * Characters and sequences that have no business in customer-facing copy
 * and are the building blocks of markup / template / script injection.
 */
const UNSAFE_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /[<>]/, message: "must not contain angle brackets (no markup in variant copy)" },
  { pattern: /[{}]/, message: "must not contain braces (no template expressions in variant copy)" },
  { pattern: /\\/, message: "must not contain backslashes" },
  { pattern: /`/, message: "must not contain backticks" },
  { pattern: /\$\{/, message: "must not contain template interpolation" },
  { pattern: /javascript\s*:/i, message: "must not contain a javascript: URL" },
  { pattern: /data:\s*[a-z-]+\/[a-z-]+/i, message: "must not contain a data: URL" },
  { pattern: /\bon[a-z]+\s*=/i, message: "must not contain an inline event handler" },
  { pattern: /&#|&lt;|&gt;/i, message: "must not contain HTML entities" },
  { pattern: /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/, message: "must not contain control characters" },
];

/** Returns the first violation message, or null when the text is safe. */
export function unsafeTextReason(value: string): string | null {
  for (const { pattern, message } of UNSAFE_PATTERNS) {
    if (pattern.test(value)) return message;
  }
  return null;
}

/** Plain customer-facing copy: bounded, trimmed, and markup-free. */
export function safeText(min: number, max: number) {
  return z
    .string()
    .min(min)
    .max(max)
    .superRefine((value, ctx) => {
      const reason = unsafeTextReason(value);
      if (reason) ctx.addIssue({ code: "custom", message: `Variant copy ${reason}` });
      if (value.trim().length < min) {
        ctx.addIssue({ code: "custom", message: "Variant copy must not be blank" });
      }
    });
}

/* ------------------------------------------------------------------ */
/* Variant schemas — one per experiment type we actually render        */
/* ------------------------------------------------------------------ */

/** HERO_COPY: headline block at the top of a page. */
export const heroCopyVariantSchema = z
  .object({
    headline: safeText(1, 120),
    subheadline: safeText(1, 300).nullable().default(null),
    ctaLabel: safeText(1, 40).nullable().default(null),
  })
  .strict();
export type HeroCopyVariant = z.infer<typeof heroCopyVariantSchema>;

/** CTA_COPY: the label (and optional helper line) of one primary button. */
export const ctaCopyVariantSchema = z
  .object({
    ctaLabel: safeText(1, 40),
    helperText: safeText(1, 160).nullable().default(null),
  })
  .strict();
export type CtaCopyVariant = z.infer<typeof ctaCopyVariantSchema>;

/**
 * SHIPPING_MESSAGE: one honest expectation-setting line near a CTA.
 *
 * NOTE: this carries NO delivery promise authority. The copy an experiment
 * may show is reviewed by the human who approves the experiment, and the
 * variant schema cannot express a date, a price, or a guarantee that the
 * rest of the system would have to honour.
 */
export const shippingMessageVariantSchema = z
  .object({
    message: safeText(1, 200),
    placement: z.enum(["above_cta", "below_cta"]).default("above_cta"),
  })
  .strict();
export type ShippingMessageVariant = z.infer<typeof shippingMessageVariantSchema>;

/** Every registered variant schema, by the experiment type it serves. */
export const VARIANT_SCHEMAS = {
  HERO_COPY: heroCopyVariantSchema,
  CTA_COPY: ctaCopyVariantSchema,
  SHIPPING_MESSAGE: shippingMessageVariantSchema,
} as const;

export type SupportedVariantExperimentType = keyof typeof VARIANT_SCHEMAS;

export type VariantConfig = HeroCopyVariant | CtaCopyVariant | ShippingMessageVariant;
