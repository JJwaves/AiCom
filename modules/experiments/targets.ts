import type { z } from "zod";
import type { ExperimentType } from "./types";
import {
  ctaCopyVariantSchema,
  heroCopyVariantSchema,
  shippingMessageVariantSchema,
  type VariantConfig,
} from "./variants";

/**
 * Experiment target registry (Session 11 spec §7) — the CLOSED allow-list of
 * surfaces that may be experimented on.
 *
 * A surface is experimentable ONLY by appearing here, and a target names an
 * existing rendering component that already knows how to consume the typed
 * override. The CRO agent cannot invent a component path, a route, or a new
 * field: an unknown target key fails closed everywhere (agent output
 * validation, guardrail payload validation, launch, and render).
 *
 * The CONTROL is never stored as page content (spec §8): the control arm
 * renders the application's own current UI with NO override at all, so an
 * experiment can only ever ADD a validated presentation override for one
 * arm. `describeControl` exists purely so the experiment record can snapshot
 * what the control looked like at launch (spec §42).
 */

export type ExperimentTargetSpec = {
  key: string;
  /** The one experiment type this target accepts. */
  experimentType: ExperimentType;
  /** Strict schema every variant config for this target must satisfy. */
  variantSchema: z.ZodType<VariantConfig>;
  /** Bumped whenever the rendered contract changes; snapshotted per experiment. */
  targetVersion: string;
  /** Owner-facing label for the admin surface. */
  label: string;
  /** Where the surface lives, in owner language. */
  surface: string;
  /** Route prefixes on which this target renders. Used for audience defaults. */
  routes: readonly string[];
  /** The component that renders the override (documentation + audit). */
  renderedBy: string;
  /**
   * Fields on this surface an experiment may NEVER change, listed explicitly
   * so the boundary is legible. They are structurally impossible to change
   * anyway — the variant schema has no such field.
   */
  protectedFields: readonly string[];
  /** What the control arm currently shows, for the launch-time snapshot. */
  describeControl: () => { summary: string; config: Record<string, unknown> };
};

/**
 * Session 11 ships THREE targets (spec §41 recommends starting small). Each
 * is a presentation-only override on a component that already exists.
 */
export const EXPERIMENT_TARGETS: Record<string, ExperimentTargetSpec> = {
  "product.shipping_message": {
    key: "product.shipping_message",
    experimentType: "SHIPPING_MESSAGE",
    variantSchema: shippingMessageVariantSchema,
    targetVersion: "1.0.0",
    label: "Product page — shipping / production expectation line",
    surface: "Product configurator, next to Add to cart",
    routes: ["/products/"],
    renderedBy: "components/product/ProductConfigurator.tsx",
    protectedFields: ["price", "unitPrice", "total", "minimumQuantity", "artworkRequirement", "customQuoteRouting"],
    describeControl: () => ({
      summary: "No additional shipping message is shown next to Add to cart (current default).",
      config: { message: null },
    }),
  },

  "product.primary_cta": {
    key: "product.primary_cta",
    experimentType: "CTA_COPY",
    variantSchema: ctaCopyVariantSchema,
    targetVersion: "1.0.0",
    label: "Product page — primary call to action",
    surface: "Product configurator Add-to-cart button (desktop + sticky mobile bar)",
    routes: ["/products/"],
    renderedBy: "components/product/ProductConfigurator.tsx",
    protectedFields: ["buttonBehaviour", "disabledRules", "price", "cartPayload"],
    describeControl: () => ({
      summary: 'The primary button reads "Add to cart" with no helper line (current default).',
      config: { ctaLabel: "Add to cart", helperText: null },
    }),
  },

  "homepage.hero": {
    key: "homepage.hero",
    experimentType: "HERO_COPY",
    variantSchema: heroCopyVariantSchema,
    targetVersion: "1.0.0",
    label: "Homepage — hero headline block",
    surface: "Homepage hero: headline, sub-headline and primary button label",
    routes: ["/"],
    renderedBy: "app/page.tsx",
    protectedFields: ["ctaHref", "pricingPanel", "structuredData", "metadata"],
    describeControl: () => ({
      summary: "The homepage hero renders its built-in headline, sub-headline and “Shop insulated takeout bags” button.",
      config: {
        headline: "Custom insulated takeout bags, direct from the factory.",
        subheadline:
          "Custom printed insulated bags for restaurants, catering and food delivery. Upload your logo, choose your quantity, and order online.",
        ctaLabel: "Shop insulated takeout bags",
      },
    }),
  },
};

export const EXPERIMENT_TARGET_KEYS = Object.keys(EXPERIMENT_TARGETS) as readonly string[];

export function isExperimentTargetKey(value: unknown): value is string {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EXPERIMENT_TARGETS, value);
}

export function getExperimentTarget(key: string): ExperimentTargetSpec | null {
  return isExperimentTargetKey(key) ? EXPERIMENT_TARGETS[key] : null;
}

/**
 * Validate a variant config against its target. Unknown target ⇒ failure
 * (fail closed), wrong experiment type ⇒ failure, unknown key inside the
 * config ⇒ failure (schemas are strict).
 */
export function validateVariantConfig(
  targetKey: string,
  experimentType: string,
  config: unknown,
): { ok: true; config: VariantConfig } | { ok: false; reason: string } {
  const target = getExperimentTarget(targetKey);
  if (!target) return { ok: false, reason: `Unknown experiment target "${String(targetKey)}"` };
  if (experimentType !== target.experimentType) {
    return {
      ok: false,
      reason: `Target ${target.key} accepts experiment type ${target.experimentType}, not "${String(experimentType)}"`,
    };
  }
  const parsed = target.variantSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 4)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, reason: `Variant config failed validation — ${issues}` };
  }
  return { ok: true, config: parsed.data };
}

/** Does this request path host the target's surface? */
export function targetRendersOnPath(targetKey: string, path: string): boolean {
  const target = getExperimentTarget(targetKey);
  if (!target) return false;
  return target.routes.some((route) => (route === "/" ? path === "/" : path.startsWith(route)));
}
