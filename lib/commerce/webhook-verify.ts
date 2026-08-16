import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shopify webhook signature verification (Production Launch Session 02 §14).
 *
 * Everything about this is deliberately narrow:
 *
 *  - it takes the RAW request body as a string. Shopify signs the exact
 *    bytes it sent; `JSON.parse` then `JSON.stringify` reorders keys and
 *    changes whitespace, and the signature no longer matches. The webhook
 *    route therefore reads `req.text()` and parses only AFTER verification.
 *  - comparison is `timingSafeEqual` on decoded buffers, so a signature
 *    cannot be discovered a byte at a time by timing the response.
 *  - it returns a boolean and never throws on attacker-controlled input: a
 *    malformed header must be a rejection, not a 500.
 *  - it logs nothing. The secret, the expected digest and the supplied
 *    digest all stay inside this function.
 */

export type WebhookVerification =
  | { valid: true }
  | { valid: false; reason: "missing_secret" | "missing_signature" | "malformed_signature" | "signature_mismatch" };

export function verifyShopifyWebhook(input: {
  /** The raw, unparsed request body exactly as received. */
  rawBody: string;
  /** Value of the X-Shopify-Hmac-Sha256 header. */
  signatureHeader: string | null;
  /** SHOPIFY_WEBHOOK_SECRET. */
  secret: string | null;
}): WebhookVerification {
  if (!input.secret) return { valid: false, reason: "missing_secret" };
  if (!input.signatureHeader) return { valid: false, reason: "missing_signature" };

  const expected = createHmac("sha256", input.secret).update(input.rawBody, "utf8").digest();

  let supplied: Buffer;
  try {
    supplied = Buffer.from(input.signatureHeader, "base64");
  } catch {
    return { valid: false, reason: "malformed_signature" };
  }
  // Length check first: timingSafeEqual throws on a length mismatch, and the
  // length of a SHA-256 digest is not a secret.
  if (supplied.length !== expected.length) return { valid: false, reason: "malformed_signature" };

  return timingSafeEqual(supplied, expected) ? { valid: true } : { valid: false, reason: "signature_mismatch" };
}
