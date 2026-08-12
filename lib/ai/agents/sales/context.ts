import type { ConversationRow } from "@/lib/data/conversation-service";
import type { NeedProfileRow } from "@/lib/data/customer-need-service";
import { getCatalogProductById } from "@/lib/commerce/catalog";
import { resolveCurrentConfiguration } from "@/lib/configuration/server";
import { quoteConfiguration, requiresCustomQuote } from "@/modules/pricing";
import type { CartSnapshot } from "../../tools/types";

/**
 * Sales context assembly (Session 05 spec §12) — the agent receives useful,
 * MINIMAL context: this session's need profile (with provenance labels so
 * the model knows what is verified vs guessed), the rolling conversation
 * summary, the product the conversation is about, and (Session 06) the
 * session's LIVE shared configuration — manual configurator choices are
 * visible to the agent without the customer repeating them.
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

// Raised 2400 → 3200 in S07: the cart block must not truncate the summary.
const MAX_CONTEXT_CHARS = 3200;

/** Compact cart line for the context block — engine-priced, never client prices. */
async function describeCartLine(line: CartSnapshot["lines"][number]): Promise<string> {
  const product = await getCatalogProductById(line.productId);
  if (!product) return `unrecognized product "${line.productId}" × ${line.quantity}`;
  const size = product.sizes.find((s) => s.id === line.sizeId)?.label ?? line.sizeId;
  const color = product.colors.find((c) => c.id === line.colorId)?.label ?? line.colorId;
  const print = product.printOptions.find((p) => p.id === line.printOptionId)?.label ?? line.printOptionId;
  const config = {
    productId: product.id,
    sizeId: line.sizeId,
    materialId: line.materialId,
    colorId: line.colorId,
    printOptionId: line.printOptionId,
    quantity: line.quantity,
    artwork: null,
  };
  const price = requiresCustomQuote(product, config) ? null : quoteConfiguration(product, config);
  const priceText = price
    ? `$${(price.totalCents / 100).toFixed(2)} (${product.pricingStatus} pricing)`
    : "needs custom quote";
  return `${product.title} — ${size}, ${color}, ${print}, qty ${line.quantity.toLocaleString("en-US")}, artwork ${
    line.hasArtwork ? "uploaded" : "none"
  }; ${priceText}`;
}

export async function buildSalesContext(opts: {
  profile: NeedProfileRow | null;
  conversation: ConversationRow;
  /** Session id for the live-configuration lookup (S06). Omit = skip. */
  sessionId?: string;
  /** Route-validated client cart snapshot (S07). Omit = cart unknown. */
  cartSnapshot?: CartSnapshot;
}): Promise<string> {
  const lines: string[] = [];

  if (opts.conversation.productId) {
    const product = await getCatalogProductById(opts.conversation.productId);
    if (product) lines.push(`Conversation product: ${product.title} (${product.id}).`);
  }

  // The session's live shared configuration (visual configurator + AI both
  // write it). Non-fatal: a read failure just omits the block.
  if (opts.sessionId) {
    try {
      const current = await resolveCurrentConfiguration(opts.sessionId);
      if (current && !("status" in current) && current.revision > 0) {
        const d = current.description;
        const price = current.price
          ? `$${(current.price.totalCents / 100).toFixed(2)} total ($${(current.price.unitPriceCents / 100).toFixed(2)}/bag, ${current.price.pricingStatus} pricing)`
          : "priced via custom quote";
        lines.push(
          `Current configuration (live, revision ${current.revision}): ${d.productTitle} (${d.productId}) — ` +
            `size ${d.size.label}, material ${d.material.label}, color ${d.color.label}, printing ${d.printOption.label}, ` +
            `quantity ${d.quantity.toLocaleString("en-US")}, artwork ${d.hasArtwork ? "uploaded" : "not uploaded"}; ${price}. ` +
            `The customer sees this in the configurator right now — never ask them to repeat it; ` +
            `verify with getCurrentConfiguration before committing changes.`,
        );
      }
    } catch {
      // Context stays useful without the configuration block.
    }
  }

  // The customer's cart as their browser reported it this turn (S07) —
  // engine-priced for display; checkout re-quotes authoritatively.
  if (opts.cartSnapshot) {
    if (opts.cartSnapshot.lines.length === 0) {
      lines.push("Cart: empty.");
    } else {
      try {
        const described = await Promise.all(opts.cartSnapshot.lines.map(describeCartLine));
        lines.push(
          `Cart (${opts.cartSnapshot.lines.length} line${opts.cartSnapshot.lines.length === 1 ? "" : "s"}, prices are current engine prices):`,
        );
        lines.push(...described.map((d, i) => `- ${i + 1}. ${d}`));
      } catch {
        // Context stays useful without the cart block.
      }
    }
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
