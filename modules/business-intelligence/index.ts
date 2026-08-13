/**
 * modules/business-intelligence — the DETERMINISTIC business-metrics
 * authority (Session 09; docs/BUSINESS_INTELLIGENCE.md is authoritative).
 *
 * This module owns the metric-availability model, revenue/funnel/AI/cost/
 * profitability/segment/attribution aggregation, trend semantics, and the
 * BusinessHealthSnapshot. It deliberately has NO lib/ai import: nothing
 * in here can call a model, so every business total is structurally
 * incapable of being fabricated. The CEO agent (lib/ai/agents/ceo) only
 * INTERPRETS the snapshot this module computes.
 *
 * Period semantics are shared with Session 08 — one Period definition
 * across both intelligence layers (modules/customer-intelligence/period).
 */

export { periodFromDays, customPeriod, previousPeriod, type Period } from "@/modules/customer-intelligence/period";
export * from "./availability";
export * from "./trend";
export * from "./revenue";
export * from "./funnel";
export * from "./ai-metrics";
export * from "./profitability";
export * from "./products";
export * from "./segments";
export * from "./attribution";
export * from "./snapshot";
export * from "./report";
