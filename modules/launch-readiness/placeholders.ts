import { BUSINESS } from "@/config/business";
import { SHIPPING_CONFIG } from "@/config/shipping";

/**
 * Owner-placeholder detection (Production Launch Session 03 §43).
 *
 * `[TO BE PROVIDED]` is the repository's honest marker for a value only the
 * owner can supply. It is honest right up until it is deployed, at which
 * point a customer reads "Questions? Email [TO BE PROVIDED]" on a live site.
 *
 * This does not write legal or business copy — it never could, and §43 says
 * not to. It makes the gaps IMPOSSIBLE TO MISS: a deterministic scan over the
 * customer-facing business configuration, reported by launch readiness, so a
 * placeholder cannot reach launch unnoticed.
 */

export const PLACEHOLDER_MARKER = "[TO BE PROVIDED]";

export type PlaceholderField = {
  path: string;
  label: string;
  /** Whether shipping this placeholder to a customer would be actively harmful. */
  customerFacing: boolean;
};

const BUSINESS_FIELDS: { key: keyof typeof BUSINESS; label: string; customerFacing: boolean }[] = [
  { key: "CUSTOMER_SERVICE_EMAIL", label: "Customer service email", customerFacing: true },
  { key: "CUSTOMER_SERVICE_PHONE", label: "Customer service phone", customerFacing: true },
  { key: "STANDARD_PRODUCTION_TIME", label: "Standard production time", customerFacing: true },
  { key: "STANDARD_SHIPPING_TIME", label: "Standard shipping time", customerFacing: true },
  { key: "SHIPPING_ORIGIN", label: "Shipping origin", customerFacing: false },
  { key: "FACTORY_LOCATION", label: "Factory location", customerFacing: false },
];

const isPlaceholder = (value: unknown): boolean =>
  typeof value === "string" && value.trim().toUpperCase().includes("TO BE PROVIDED");

/** Every placeholder still present in customer-facing business configuration. */
export function findBusinessPlaceholders(): PlaceholderField[] {
  const found: PlaceholderField[] = [];
  for (const field of BUSINESS_FIELDS) {
    if (isPlaceholder(BUSINESS[field.key])) {
      found.push({ path: `config/business.ts → ${field.key}`, label: field.label, customerFacing: field.customerFacing });
    }
  }
  if (isPlaceholder(SHIPPING_CONFIG.originCountry)) {
    found.push({ path: "config/shipping.ts → originCountry", label: "Shipping origin country", customerFacing: false });
  }
  return found;
}
