import type { ArtworkRef, Product, ProductConfiguration } from "@/types/commerce";

/**
 * Shared configuration domain logic (Session 06) — the ONE validation +
 * patch-application path for every writer of a product configuration:
 * the visual configurator, the AI updateConfiguration tool, and the
 * /api/configuration route. Pure and framework-free so the client store
 * and server tools import the SAME rules (never two parallel copies).
 *
 * Validation policy mirrors what the Session-01 UI always allowed:
 * - Options must exist on the product (unknown ids are rejected with the
 *   available alternatives — the AI relays these instead of inventing).
 * - Below-MOQ quantities and custom colors are LEGAL states: the UI keeps
 *   them selectable and routes them to the custom-quote flow; pricing
 *   (requiresCustomQuote) stays the authority on what is auto-priceable.
 * - Artwork/customDimensions are NOT patchable fields here: artwork comes
 *   only from the uploader (the AI must never fabricate an upload), custom
 *   dimensions only from the quote flow.
 */

/** Fields a configuration patch may change — deliberately excludes artwork + customDimensions. */
export const PATCHABLE_FIELDS = ["sizeId", "materialId", "colorId", "printOptionId", "quantity"] as const;
export type PatchableField = (typeof PATCHABLE_FIELDS)[number];

export type ConfigurationPatch = Partial<Pick<ProductConfiguration, PatchableField>>;

export const MAX_QUANTITY = 1_000_000;

export type PatchIssue = {
  field: PatchableField;
  requested: string | number;
  reason: "unsupported_option" | "invalid_quantity";
  /** Legal ids for option fields (what the AI should offer instead). */
  available: string[];
  message: string;
};

export type PatchResult =
  | { ok: true; config: ProductConfiguration; changedFields: PatchableField[] }
  | { ok: false; issues: PatchIssue[] };

/** The exact defaults the configurator UI has always started from. */
export function defaultConfiguration(product: Product): ProductConfiguration {
  return {
    productId: product.id,
    sizeId: product.sizes[0]?.id ?? "",
    materialId: product.materials[0]?.id ?? "",
    colorId: product.colors[0]?.id ?? "",
    printOptionId: product.printOptions.find((p) => p.id === "one-color")?.id ?? product.printOptions[0].id,
    quantity: product.quantityPresets[1] ?? product.minQuantity,
    artwork: null,
  };
}

/**
 * Reconcile a PERSISTED configuration against the CURRENT catalog.
 *
 * A stored row outlives the catalog that produced it. When a product's
 * options change — a size retired, a print option replaced, a colour
 * dropped — a row written under the old catalog still holds ids the product
 * no longer offers, and reading it back verbatim puts the storefront in a
 * state it cannot render honestly: the configurator finds no matching
 * option, so it silently stops enforcing that option's rules (artwork stops
 * being required, an option delta stops being priced) while Add to cart
 * still looks available. Checkout would refuse it — but only after the
 * customer had filled in everything.
 *
 * So a stale field falls back to the catalog DEFAULT for that field, and the
 * caller is told which fields moved. Nothing is invented: the default is the
 * same value a first-time visitor sees.
 */
export function reconcileConfiguration(
  product: Product,
  stored: ProductConfiguration,
): { config: ProductConfiguration; resetFields: PatchableField[] } {
  const fallback = defaultConfiguration(product);
  const resetFields: PatchableField[] = [];
  const config: ProductConfiguration = { ...stored, productId: product.id };

  const reset = <F extends "sizeId" | "materialId" | "colorId" | "printOptionId">(field: F, legal: string[]) => {
    if (legal.includes(config[field] as string)) return;
    (config as Record<string, unknown>)[field] = fallback[field];
    resetFields.push(field);
  };
  reset("sizeId", product.sizes.map((s) => s.id));
  reset("materialId", product.materials.map((m) => m.id));
  reset("colorId", product.colors.map((c) => c.id));
  reset("printOptionId", product.printOptions.map((o) => o.id));

  if (!Number.isInteger(config.quantity) || config.quantity <= 0 || config.quantity > MAX_QUANTITY) {
    config.quantity = fallback.quantity;
    resetFields.push("quantity");
  }

  return { config, resetFields };
}

const optionIds = {
  sizeId: (p: Product) => p.sizes.map((s) => s.id),
  materialId: (p: Product) => p.materials.map((m) => m.id),
  colorId: (p: Product) => p.colors.map((c) => c.id),
  printOptionId: (p: Product) => p.printOptions.map((o) => o.id as string),
} as const;

function checkOption(product: Product, field: keyof typeof optionIds, requested: string): PatchIssue | null {
  const available = optionIds[field](product);
  if (available.includes(requested)) return null;
  return {
    field,
    requested,
    reason: "unsupported_option",
    available,
    message: `"${requested}" is not a supported ${field.replace(/Id$/, "")} for ${product.title}. Available: ${available.join(", ")}.`,
  };
}

function checkQuantity(quantity: number): PatchIssue | null {
  if (Number.isInteger(quantity) && quantity > 0 && quantity <= MAX_QUANTITY) return null;
  return {
    field: "quantity",
    requested: quantity,
    reason: "invalid_quantity",
    available: [],
    message: `Quantity must be a whole number between 1 and ${MAX_QUANTITY.toLocaleString("en-US")}.`,
  };
}

/**
 * Validate a partial patch against the catalog and apply it to `current`.
 * Untouched fields are preserved verbatim (the AI never regenerates whole
 * configurations, so unrelated choices cannot be lost). All-or-nothing:
 * any invalid field rejects the entire patch with structured issues.
 */
export function applyConfigurationPatch(
  product: Product,
  current: ProductConfiguration,
  patch: ConfigurationPatch,
): PatchResult {
  const issues: PatchIssue[] = [];
  for (const field of ["sizeId", "materialId", "colorId", "printOptionId"] as const) {
    const requested = patch[field];
    if (requested === undefined) continue;
    const issue = checkOption(product, field, requested);
    if (issue) issues.push(issue);
  }
  if (patch.quantity !== undefined) {
    const issue = checkQuantity(patch.quantity);
    if (issue) issues.push(issue);
  }
  if (issues.length > 0) return { ok: false, issues };

  const changedFields = PATCHABLE_FIELDS.filter(
    (field) => patch[field] !== undefined && patch[field] !== current[field],
  );
  const config: ProductConfiguration = {
    ...current,
    ...Object.fromEntries(PATCHABLE_FIELDS.flatMap((f) => (patch[f] !== undefined ? [[f, patch[f]]] : []))),
    productId: product.id,
  };
  return { ok: true, config, changedFields };
}

/**
 * Validate a FULL configuration (the UI-sync path): every option field must
 * be legal for the product. Returns the same structured issues as the patch
 * path. Artwork is passed through as-is (shape-validated by zod at the API
 * boundary; the uploader is its only producer).
 */
export function validateFullConfiguration(
  product: Product,
  config: ProductConfiguration,
): PatchResult {
  const base = defaultConfiguration(product);
  const result = applyConfigurationPatch(product, base, {
    sizeId: config.sizeId,
    materialId: config.materialId,
    colorId: config.colorId,
    printOptionId: config.printOptionId,
    quantity: config.quantity,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    config: { ...result.config, artwork: config.artwork ?? null, customDimensions: config.customDimensions ?? null },
    changedFields: result.changedFields,
  };
}

/** Human-readable labels for a configuration — shared by the AI tools and UI summaries. */
export function describeConfiguration(product: Product, config: ProductConfiguration) {
  const size = product.sizes.find((s) => s.id === config.sizeId);
  const material = product.materials.find((m) => m.id === config.materialId);
  const color = product.colors.find((c) => c.id === config.colorId);
  const print = product.printOptions.find((p) => p.id === config.printOptionId);
  return {
    productId: product.id,
    productTitle: product.title,
    size: { id: config.sizeId, label: size?.label ?? config.sizeId },
    material: { id: config.materialId, label: material?.label ?? config.materialId },
    color: { id: config.colorId, label: color?.label ?? config.colorId, custom: color?.custom === true },
    printOption: { id: config.printOptionId, label: print?.label ?? config.printOptionId, requiresArtwork: print?.requiresArtwork === true },
    quantity: config.quantity,
    hasArtwork: Boolean(config.artwork),
    artworkFileName: config.artwork?.fileName,
  };
}

export type ConfigurationDescription = ReturnType<typeof describeConfiguration>;

/** Re-exported so store consumers type artwork without importing types/commerce directly. */
export type { ArtworkRef, ProductConfiguration };
