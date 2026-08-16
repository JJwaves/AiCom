import { z } from "zod";
import { ARTWORK_MAX_BYTES } from "./artwork";

/**
 * Checkout re-quote request schema — what the browser PROPOSES to
 * /api/checkout. Proposed prices are used only to detect drift (409
 * REPRICED); the server recomputes every price with the deterministic
 * engine and never trusts these numbers.
 */

/**
 * Artwork reference accepted from a browser.
 *
 * `artworkId` is the durable server-minted reference (Production Launch
 * Session 02). `url` is accepted for BACKWARDS COMPATIBILITY with carts
 * saved in localStorage before durable storage existed — and it is STRIPPED
 * here rather than stored: it was a `blob:` object URL that died with the
 * tab, and persisting one would put a permanently broken link on an order
 * line. A legacy line whose print option requires artwork is caught at
 * checkout, which requires a real `artworkId` and tells the customer to
 * re-upload.
 */
const artworkRefSchema = z
  .object({
    artworkId: z.string().trim().min(1).max(64).optional(),
    fileName: z.string().trim().min(1).max(255),
    fileType: z.string().trim().max(120),
    fileSizeBytes: z.number().int().positive().max(ARTWORK_MAX_BYTES),
    url: z.string().max(2048).optional(),
    notes: z.string().max(1000).optional(),
  })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured to DROP it
  .transform(({ url, ...ref }) => ref);

/** ProductConfiguration shape — reused by checkout lines and by lib/data configuration snapshots. */
export const configurationSchema = z.object({
  productId: z.string().trim().min(1).max(100),
  sizeId: z.string().trim().min(1).max(100),
  materialId: z.string().trim().min(1).max(100),
  colorId: z.string().trim().min(1).max(100),
  printOptionId: z.enum(["none", "one-color", "two-color", "full-custom"]),
  quantity: z.number().int().positive().max(1_000_000),
  artwork: artworkRefSchema.nullish(),
  customDimensions: z
    .object({ width: z.number().positive(), height: z.number().positive(), gusset: z.number().positive() })
    .nullish(),
});

const checkoutLineSchema = z.object({
  lineId: z.string().trim().min(1).max(64),
  config: configurationSchema,
  /** Browser price snapshot — drift detection only, never authoritative. */
  proposedUnitPriceCents: z.number().int().nonnegative(),
  proposedTotalCents: z.number().int().nonnegative(),
});

export const checkoutRequestSchema = z.object({
  lines: z.array(checkoutLineSchema).min(1).max(50),
  attribution: z
    .record(z.string().max(64), z.string().max(512))
    .refine((attrs) => Object.keys(attrs).length <= 40, "Too many attribution keys")
    .optional()
    .default({}),
});

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;
export type CheckoutRequestLine = z.infer<typeof checkoutLineSchema>;
