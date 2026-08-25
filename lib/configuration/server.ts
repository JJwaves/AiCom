import { getCatalogProductById } from "@/lib/commerce/catalog";
import {
  getActiveConfiguration,
  getLatestActiveConfiguration,
  updateConfigurationChecked,
} from "@/lib/data/configuration-service";
import { applyNeedProfileUpdate } from "@/lib/data/customer-need-service";
import { quoteConfiguration, requiresCustomQuote } from "@/modules/pricing";
import type { Product, ProductConfiguration } from "@/types/commerce";
import { needUpdateFromConfiguration } from "./need-mapping";
import {
  applyConfigurationPatch,
  defaultConfiguration,
  describeConfiguration,
  reconcileConfiguration,
  validateFullConfiguration,
  type ConfigurationDescription,
  type ConfigurationPatch,
  type PatchIssue,
  type PatchableField,
} from "./validation";

/**
 * Server-side shared configuration application (Session 06) — the ONE
 * write path behind every configuration mutation that reaches the server:
 *
 *   /api/configuration (manual UI sync + suggestion apply)  ┐
 *   AI updateConfiguration tool                             ├─► here
 *   (checkout keeps its own re-quote; it writes source      ┘
 *    "checkout" rows through the same data service)
 *
 * Everything funnels through lib/configuration/validation.ts (catalog
 * rules) and lib/data/configuration-service.ts (row-locked, revision-
 * checked persistence). Prices attached to results are SELL-side only,
 * computed by the deterministic engine — cost/margin/floor data has no
 * path through this module.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/configuration/server is server-only — never import it from client components");
}

/** Customer-visible sell price — never cost, margin, or floor data. */
export type CustomerPrice = {
  unitPriceCents: number;
  totalCents: number;
  currency: "USD" | "CAD";
  tier: { minQty: number; unitPriceCents: number };
  savingsPct: number;
  pricingStatus: "DEMO" | "LIVE";
};

export type CurrentConfiguration = {
  description: ConfigurationDescription;
  config: ProductConfiguration;
  revision: number;
  source: string;
  requiresCustomQuote: boolean;
  /** null when the configuration needs a custom quote (below MOQ / custom color / custom dimensions). */
  price: CustomerPrice | null;
};

export function sellPriceFor(product: Product, config: ProductConfiguration): CustomerPrice | null {
  if (requiresCustomQuote(product, config)) return null;
  const quote = quoteConfiguration(product, config);
  if (!quote) return null;
  return {
    unitPriceCents: quote.unitPriceCents,
    totalCents: quote.totalCents,
    currency: quote.currency,
    tier: { minQty: quote.tier.minQty, unitPriceCents: quote.tier.unitPriceCents },
    savingsPct: quote.savingsPct,
    pricingStatus: product.pricingStatus,
  };
}

function toCurrent(product: Product, config: ProductConfiguration, revision: number, source: string): CurrentConfiguration {
  return {
    description: describeConfiguration(product, config),
    config,
    revision,
    source,
    requiresCustomQuote: requiresCustomQuote(product, config),
    price: sellPriceFor(product, config),
  };
}

/**
 * Resolve the session's current configuration. With a productId: that
 * product's live row, or catalog defaults at revision 0 when the session
 * has never configured it. Without: the most recently touched row (null if
 * the session has none).
 */
export async function resolveCurrentConfiguration(
  sessionId: string,
  productId?: string,
): Promise<CurrentConfiguration | { status: "unknown_product" } | null> {
  if (productId !== undefined) {
    const product = await getCatalogProductById(productId);
    if (!product) return { status: "unknown_product" };
    const row = await getActiveConfiguration(sessionId, productId);
    if (!row) return toCurrent(product, defaultConfiguration(product), 0, "none");
    // A row written under an older catalog may name options this product no
    // longer offers — reconcile before anyone renders or prices it.
    return toCurrent(product, reconcileConfiguration(product, row.configJson).config, row.version, row.source);
  }
  const row = await getLatestActiveConfiguration(sessionId);
  if (!row) return null;
  const product = await getCatalogProductById(row.productId);
  if (!product) return null; // catalog changed under the row — treat as no current configuration
  return toCurrent(product, reconcileConfiguration(product, row.configJson).config, row.version, row.source);
}

export type ApplyConfigurationResult =
  | { status: "applied"; current: CurrentConfiguration; changedFields: PatchableField[] }
  | { status: "invalid"; issues: PatchIssue[] }
  | { status: "stale_revision"; current: CurrentConfiguration }
  | { status: "unknown_product" };

/**
 * Validate a partial patch against the catalog and the session's current
 * configuration, persist through the revision-checked service, and record
 * CONFIGURATOR-rank need-profile evidence. Both AI and suggestion-apply
 * writes use this exact function — never a private variant.
 */
export async function applyConfigurationPatchForSession(opts: {
  sessionId: string;
  productId: string;
  patch: ConfigurationPatch;
  expectedRevision?: number;
  source: "ai" | "configurator";
  customerId?: string | null;
}): Promise<ApplyConfigurationResult> {
  const product = await getCatalogProductById(opts.productId);
  if (!product) return { status: "unknown_product" };

  const row = await getActiveConfiguration(opts.sessionId, opts.productId);
  // Same reconciliation as the read path: a patch must never preserve an
  // option the catalog has since retired in the fields it does not touch.
  const base = row ? reconcileConfiguration(product, row.configJson).config : defaultConfiguration(product);
  const baseRevision = row?.version ?? 0;

  // A stale expectation fails BEFORE validation so the agent reconciles
  // against the configuration that actually exists now.
  if (opts.expectedRevision !== undefined && opts.expectedRevision !== baseRevision) {
    return { status: "stale_revision", current: toCurrent(product, base, baseRevision, row?.source ?? "none") };
  }

  const result = applyConfigurationPatch(product, base, opts.patch);
  if (!result.ok) return { status: "invalid", issues: result.issues };

  const price = sellPriceFor(product, result.config);
  const written = await updateConfigurationChecked({
    sessionId: opts.sessionId,
    productId: product.id,
    config: result.config,
    priceSnapshot: price
      ? { unitPriceCents: price.unitPriceCents, totalCents: price.totalCents, currency: price.currency }
      : undefined,
    source: opts.source,
    // Guards the read-validate-write window: the row must still be at the
    // version we validated against (a concurrent writer loses politely).
    expectedRevision: baseRevision,
  });
  if (!written.ok) {
    const current = toCurrent(product, written.current.configJson, written.current.version, written.current.source);
    return { status: "stale_revision", current };
  }

  await recordConfiguratorEvidence(opts.sessionId, product, result.config, opts.customerId);
  return {
    status: "applied",
    current: toCurrent(product, written.row.configJson, written.row.version, written.row.source),
    changedFields: result.changedFields,
  };
}

/**
 * Persist a FULL configuration snapshot from the visual configurator
 * (debounced UI sync). Last-write-wins by design — the customer's visible
 * UI state is the truth being recorded, so there is nothing staler than it.
 */
export async function syncConfigurationForSession(opts: {
  sessionId: string;
  productId: string;
  config: ProductConfiguration;
  customerId?: string | null;
}): Promise<ApplyConfigurationResult> {
  const product = await getCatalogProductById(opts.productId);
  if (!product) return { status: "unknown_product" };

  const validated = validateFullConfiguration(product, { ...opts.config, productId: product.id });
  if (!validated.ok) return { status: "invalid", issues: validated.issues };

  const price = sellPriceFor(product, validated.config);
  const written = await updateConfigurationChecked({
    sessionId: opts.sessionId,
    productId: product.id,
    config: validated.config,
    priceSnapshot: price
      ? { unitPriceCents: price.unitPriceCents, totalCents: price.totalCents, currency: price.currency }
      : undefined,
    source: "configurator",
  });
  if (!written.ok) {
    // Unreachable without expectedRevision; keep the type total.
    const current = toCurrent(product, written.current.configJson, written.current.version, written.current.source);
    return { status: "stale_revision", current };
  }

  await recordConfiguratorEvidence(opts.sessionId, product, validated.config, opts.customerId);
  return {
    status: "applied",
    current: toCurrent(product, written.row.configJson, written.row.version, written.row.source),
    changedFields: validated.changedFields,
  };
}

/** CONFIGURATOR-rank profile evidence — non-fatal; the rank gate decides what lands. */
async function recordConfiguratorEvidence(
  sessionId: string,
  product: Product,
  config: ProductConfiguration,
  customerId?: string | null,
): Promise<void> {
  try {
    await applyNeedProfileUpdate(sessionId, needUpdateFromConfiguration(product, config), "CONFIGURATOR", {
      customerId: customerId ?? null,
    });
  } catch (err) {
    console.error("[configuration] need-profile evidence write failed (configuration persisted)", err);
  }
}
