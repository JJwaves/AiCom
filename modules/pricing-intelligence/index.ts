/**
 * modules/pricing-intelligence — the DETERMINISTIC pricing-analytics
 * authority (Session 12; docs/PRICING_INTELLIGENCE.md is authoritative).
 *
 * What this module IS: the pricing funnel, quantity-tier performance, the
 * three quantity lanes, MOQ intelligence, price-realization checks,
 * evidence-graded pricing signals, cost/margin readiness, PricingReadiness,
 * the elasticity refusal, and the PricingIntelligenceSnapshot.
 *
 * What this module is NOT, structurally:
 *  - It has NO `lib/ai` import. Nothing here can call a model, so no pricing
 *    count, rate, signal or readiness verdict can be fabricated. The Pricing
 *    Agent (lib/ai/agents/pricing) only INTERPRETS the snapshot.
 *  - It has NO price-mutation path. `modules/pricing` remains the sole
 *    pricing authority; this module reads the engine and writes nothing.
 *  - It computes no "optimal price" and no elasticity coefficient. Neither
 *    function exists, so neither can be called.
 *
 * Period semantics are shared with Sessions 08–11 — one Period definition
 * across every intelligence layer.
 */

export { periodFromDays, customPeriod, previousPeriod, type Period } from "@/modules/customer-intelligence/period";
export * from "./types";
export * from "./tiers";
export * from "./readiness";
export * from "./funnel";
export * from "./demand";
export * from "./tier-performance";
export * from "./realization";
export * from "./moq";
export * from "./products";
export * from "./breakdowns";
export * from "./signals";
export * from "./snapshot";
export * from "./report";
