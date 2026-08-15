/**
 * Experiment vocabulary (Session 11).
 *
 * Everything here is deterministic data. Like modules/guardrails,
 * modules/customer-intelligence and modules/business-intelligence, this
 * module never imports `lib/ai` and never imports `db/` — measurement
 * authority cannot depend on the model layer, so a model can never
 * influence an assignment, an exposure, a count, or a statistical result.
 */

/**
 * Supported experiment types (spec §3). A type describes WHAT KIND of
 * presentation change is being tested; the target registry decides WHERE
 * it may be applied and with which validated schema.
 */
export const EXPERIMENT_TYPES = [
  "HERO_COPY",
  "CTA_COPY",
  "SHIPPING_MESSAGE",
  "PRICING_PRESENTATION",
  "FAQ_PLACEMENT",
  "PRODUCT_IMAGE",
  "CONFIGURATOR_UI",
  "LANDING_PAGE_VARIANT",
] as const;
export type ExperimentType = (typeof EXPERIMENT_TYPES)[number];

/**
 * Deliberately NOT supported in Session 11 (spec §3, §40). Price authority
 * belongs to modules/pricing and Session 12 Pricing Intelligence; checkout
 * is a protected surface. These names exist so a proposal naming one is
 * REFUSED by name rather than silently mis-handled.
 */
export const DEFERRED_EXPERIMENT_TYPES = ["PRICE_EXPERIMENT", "CHECKOUT_EXPERIMENT"] as const;
export type DeferredExperimentType = (typeof DEFERRED_EXPERIMENT_TYPES)[number];

export function isExperimentType(value: unknown): value is ExperimentType {
  return typeof value === "string" && (EXPERIMENT_TYPES as readonly string[]).includes(value);
}

/**
 * Surfaces no experiment may ever touch (spec §4). This list is
 * informational-but-enforced: the target registry is a CLOSED allow-list,
 * so a surface is experimentable only by being registered. These names are
 * kept explicit so the refusal is legible in code, docs and tests.
 */
export const PROTECTED_SURFACES = [
  "checkout payment internals",
  "pricing authority (modules/pricing, config/costs)",
  "authentication and admin surfaces",
  "privacy / consent controls",
  "factory capability and delivery claims",
  "deterministic product validation",
  "409 REPRICED drift handling",
] as const;

/** Experiment lifecycle status (spec §2, §33). */
export const EXPERIMENT_STATUSES = ["draft", "approved", "running", "stopped", "decided", "archived"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export function isExperimentStatus(value: unknown): value is ExperimentStatus {
  return typeof value === "string" && (EXPERIMENT_STATUSES as readonly string[]).includes(value);
}

/** Statuses that enroll traffic. Exactly one: `running`. */
export const ENROLLING_STATUSES: readonly ExperimentStatus[] = ["running"];

/**
 * Result states (spec §17). "Inconclusive" is a first-class answer — no
 * experiment is forced to produce a winner.
 */
export const EXPERIMENT_RESULT_STATES = [
  /** Running, and the minimum sample has not been reached in both arms. */
  "RUNNING",
  /** Sample threshold met but the statistical preconditions are not (or the run ended short). */
  "INSUFFICIENT_DATA",
  "CONTROL_WIN",
  "VARIANT_WIN",
  "NO_CLEAR_WINNER",
  /** Stopped by a human before any decision threshold was reached. */
  "STOPPED",
  /** The configuration no longer validates — the numbers must not be trusted. */
  "INVALID",
] as const;
export type ExperimentResultState = (typeof EXPERIMENT_RESULT_STATES)[number];

/** The control arm's key. Reserved: a variant may never be named "control". */
export const CONTROL_VARIANT_KEY = "control";

/** The default key for the single non-control arm (MVP: one variant). */
export const DEFAULT_VARIANT_KEY = "variant_b";

/**
 * Primary metrics (spec §13). Every one is an existing first-party event
 * name, so the numerator is a deterministic event query — never an
 * AI-inferred conversion.
 */
export const PRIMARY_METRICS = [
  "configurator_started",
  "price_viewed",
  "add_to_cart",
  "checkout_started",
  "purchase_completed",
] as const;
export type PrimaryMetric = (typeof PRIMARY_METRICS)[number];

/** Secondary metrics — reported, never used to declare a winner. */
export const SECONDARY_METRICS = [
  "ai_chat_started",
  "artwork_uploaded",
  "quote_started",
  "quote_submitted",
  "ai_product_recommended",
  "human_handoff_requested",
] as const;
export type SecondaryMetric = (typeof SECONDARY_METRICS)[number];

/**
 * Guardrail metrics (spec §14) — the things that must not get worse.
 *
 * Every entry is a real first-party event. Deliberately ABSENT, because no
 * deterministic per-session source exists: "checkout error rate" (no error
 * event is recorded) and "AI failure rate" (failures are server logs +
 * ai_usage rows, not session-scoped events). Contribution profit is absent
 * too — config/costs.ts is unconfigured, and an unavailable metric is never
 * turned into an experiment guardrail.
 */
export const GUARDRAIL_METRICS = [
  "purchase_completed",
  "checkout_started",
  "add_to_cart",
  "quote_started",
  "human_handoff_requested",
] as const;
export type GuardrailMetric = (typeof GUARDRAIL_METRICS)[number];

export const isPrimaryMetric = (v: unknown): v is PrimaryMetric =>
  typeof v === "string" && (PRIMARY_METRICS as readonly string[]).includes(v);

/** Per-arm counts feeding the statistical engine. */
export type ArmCounts = {
  variant: string;
  /** Distinct sessions that ACTUALLY SAW the surface (exposures, not assignments). */
  exposedSessions: number;
  /** Distinct exposed sessions with ≥1 primary-metric event at/after exposure. */
  conversions: number;
};
