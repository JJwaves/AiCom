/**
 * `modules/google-ads-intelligence` — the DETERMINISTIC advertising-analytics
 * authority (Session 13; docs/GOOGLE_ADS_INTELLIGENCE.md is authoritative).
 *
 * What this module IS: connection and freshness states, Google-native
 * metrics, the first-party lens on paid traffic, campaign↔session attribution
 * with explicit match quality, CAC and ROAS with named denominators, the
 * Google-vs-first-party discrepancy view, per-campaign performance,
 * deterministic data-quality signals, and the GoogleAdsIntelligenceSnapshot.
 *
 * What this module is NOT, structurally:
 *  - It has NO `lib/ai` import. Nothing here can call a model, so no spend
 *    figure, rate, attribution verdict or signal can be fabricated. The
 *    Google Ads agent (lib/ai/agents/google-ads) only INTERPRETS the snapshot.
 *  - It has NO `lib/google-ads` import and calls no `fetch`. It reads
 *    PERSISTED daily snapshots, so a dashboard render is never an API call
 *    and no analytics path can reach any Google endpoint — mutating or not.
 *  - It computes no blended "true CAC" and no reconciliation between Google's
 *    attribution and ours. Both are reported; neither is corrected.
 *
 * Period semantics are shared with Sessions 08–12 — one Period definition
 * across every intelligence layer.
 */

export { periodFromDays, customPeriod, previousPeriod, type Period } from "@/modules/customer-intelligence/period";
export * from "./types";
export * from "./dates";
export * from "./format";
export * from "./attribution";
export * from "./native";
export * from "./efficiency";
export * from "./firstparty";
export * from "./connection";
export * from "./discrepancy";
export * from "./campaigns";
export * from "./signals";
export * from "./snapshot";
export * from "./report";
