/**
 * Deterministic launch readiness (Production Launch Session 03 §45).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ═══════════════════════════════════════════════════════════════════════════
 * One place that answers "can this system take a real order safely, right
 * now?" — computed, not remembered. LAUNCH_CHECKLIST.md is a document a human
 * ticks; this is the same questions asked of the running code, which is the
 * only version that cannot drift from reality.
 *
 * DETERMINISTIC. No AI, no network, no provider calls. It reads
 * configuration and (for a few checks) the database. The same inputs always
 * produce the same verdict, which is what lets `/api/health/ready` and the
 * admin page share it without one of them being a different opinion.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE STATES, AND THE ONE THAT MATTERS MOST
 * ═══════════════════════════════════════════════════════════════════════════
 *   READY    verified, by looking.
 *   WARNING  works, but something is missing, unverified, or degraded.
 *            NOT a soft "blocked" — it is the state for everything that
 *            needs a HUMAN to confirm something this code cannot see: a
 *            Shopify tax setting, a database backup policy, a real test
 *            order. Those never become READY on their own, and pretending
 *            otherwise would be the whole point of the exercise missed.
 *   BLOCKED  a real order would fail, or would be wrong.
 *
 * Only MANDATORY checks can block. Optional subsystems (AI, intelligence,
 * ads) can warn but never block — commerce must work with every AI flag off
 * (§31).
 */

export const READINESS_CATEGORIES = [
  "COMMERCE",
  "DATABASE",
  "PRODUCT",
  "ARTWORK",
  "AI",
  "ANALYTICS",
  "ADMIN",
  "MONITORING",
  "OPERATIONS",
  "BUSINESS_CONFIG",
] as const;

export type ReadinessCategory = (typeof READINESS_CATEGORIES)[number];

export type ReadinessState = "READY" | "WARNING" | "BLOCKED";

export type ReadinessCheck = {
  /** Stable machine id, e.g. "commerce.shopify_credentials". */
  id: string;
  category: ReadinessCategory;
  /** Owner-friendly title. A person, not a log parser, reads this first. */
  title: string;
  state: ReadinessState;
  /**
   * Owner-friendly reason (§47): "12 Shopify variants are unmapped", not
   * "SHOPIFY_MAP_INVALID". Full sentences, plain words, no codes.
   */
  summary: string;
  /** What the owner should actually DO. Null when nothing is needed. */
  action: string | null;
  /**
   * MANDATORY checks can block launch; optional ones can only warn.
   * An optional check that computes BLOCKED is downgraded to WARNING by the
   * report builder — the classification lives here so it cannot be forgotten
   * at a call site.
   */
  mandatory: boolean;
  /**
   * Secondary technical code for logs and support (§47). Never the primary
   * message.
   */
  code: string;
  /**
   * TRUE when only a HUMAN can close this out — a Shopify tax setting, a
   * backup policy, a real test payment. These are reported honestly as
   * "owner verification required" and never self-resolve.
   */
  ownerVerified?: boolean;
};

export type ReadinessReport = {
  /** Worst state across MANDATORY checks. */
  state: ReadinessState;
  generatedAt: string;
  environment: string;
  checks: ReadinessCheck[];
  counts: { ready: number; warning: number; blocked: number };
  /** Blocking reasons, owner-friendly, in the order they should be fixed. */
  blockers: string[];
};
