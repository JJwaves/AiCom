import type { ConversationRow } from "@/lib/data/conversation-service";
import type { NeedProfileRow } from "@/lib/data/customer-need-service";
import { getCatalogProductById } from "@/lib/commerce/catalog";

/**
 * Sales context assembly (Session 05 spec §12) — the agent receives useful,
 * MINIMAL context: this session's need profile (with provenance labels so
 * the model knows what is verified vs guessed), the rolling conversation
 * summary, and the product the conversation is about.
 *
 * Structurally absent: other customers/sessions (services are keyed by this
 * session's ids), admin data, provider secrets, cost/margin figures (server-
 * only, unreachable from here), and ad/analytics credentials. Everything in
 * the context is data the customer produced or public catalog truth.
 */

const SOURCE_LABELS: Record<string, string> = {
  USER_STATED: "customer-stated",
  ORDER_DATA: "from their order",
  CONFIGURATOR: "from the configurator",
  SYSTEM_DERIVED: "derived",
  AI_INFERRED: "our guess",
};

/** Profile columns surfaced to the model, in display order. */
const CONTEXT_FIELDS: { key: keyof NeedProfileRow; label: string; money?: boolean }[] = [
  { key: "businessName", label: "business name" },
  { key: "businessType", label: "business type" },
  { key: "industry", label: "industry" },
  { key: "location", label: "location" },
  { key: "quantity", label: "quantity needed" },
  { key: "productInterest", label: "product interest" },
  { key: "desiredCapacity", label: "desired capacity" },
  { key: "materialPreference", label: "material preference" },
  { key: "colorPreference", label: "color preference" },
  { key: "handlePreference", label: "handle preference" },
  { key: "printingRequirement", label: "printing requirement" },
  { key: "printingColors", label: "printing colors" },
  { key: "printingSides", label: "printing sides" },
  { key: "logoAvailable", label: "logo available" },
  { key: "estimatedDailyOrders", label: "estimated daily orders" },
  { key: "estimatedMonthlyUsage", label: "estimated monthly usage" },
  { key: "budgetCents", label: "stated budget", money: true },
  { key: "targetUnitPriceCents", label: "target unit price", money: true },
  { key: "shippingPostalCode", label: "shipping postal code" },
  { key: "desiredDeliveryDate", label: "desired delivery date" },
  { key: "priceSensitivity", label: "price sensitivity" },
  { key: "purchaseIntent", label: "purchase intent" },
];

const MAX_CONTEXT_CHARS = 2400;

export async function buildSalesContext(opts: {
  profile: NeedProfileRow | null;
  conversation: ConversationRow;
}): Promise<string> {
  const lines: string[] = [];

  if (opts.conversation.productId) {
    const product = await getCatalogProductById(opts.conversation.productId);
    if (product) lines.push(`Conversation product: ${product.title} (${product.id}).`);
  }

  const profile = opts.profile;
  const known: string[] = [];
  if (profile) {
    for (const { key, label, money } of CONTEXT_FIELDS) {
      const value = profile[key];
      if (value === null || value === undefined) continue;
      const sourceEntry = profile.fieldSourcesJson[key as string];
      const sourceLabel = sourceEntry ? SOURCE_LABELS[sourceEntry.source] ?? sourceEntry.source : "unknown source";
      const rendered = money && typeof value === "number" ? `$${(value / 100).toFixed(2)}` : String(value);
      known.push(`- ${label}: ${rendered} (${sourceLabel})`);
    }
  }
  if (known.length > 0) {
    lines.push("What we know about this customer so far (treat 'our guess' entries as unconfirmed):");
    lines.push(...known);
  } else {
    lines.push("Nothing is known about this customer yet.");
  }

  const summary = opts.conversation.summaryJson?.text;
  if (typeof summary === "string" && summary.trim() !== "") {
    lines.push(`Earlier conversation summary: ${summary.trim()}`);
  }

  const context = lines.join("\n");
  return context.length > MAX_CONTEXT_CHARS ? `${context.slice(0, MAX_CONTEXT_CHARS)}…` : context;
}
