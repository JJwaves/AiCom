import { PRICING_INTELLIGENCE } from "@/config/pricing-intelligence";
import { getLatestPricingReport, type PricingReportRow } from "@/lib/data/pricing-report-service";
import type { Period } from "@/modules/customer-intelligence/period";
import { buildPricingIntelligenceSnapshot, type PricingIntelligenceSnapshot } from "./snapshot";

/**
 * Admin report assembly (spec §36, §38, §42).
 *
 * Deterministic pricing analytics load with NO model call. The Pricing Agent
 * narrative is whatever the last explicit "Generate Pricing Review" action
 * persisted (or null). A provider outage, an exhausted budget or a disabled
 * flag therefore never darkens the dashboard — it only means the review
 * section shows the previous review, or an honest empty state.
 */

export type PricingIntelligenceReport = {
  snapshot: PricingIntelligenceSnapshot;
  /** Latest persisted pricing review for this period length; null = never generated. */
  pricingReport: PricingReportRow | null;
  /** True when the persisted review covers an older window than the snapshot. */
  pricingReportStale: boolean;
  thresholds: typeof PRICING_INTELLIGENCE;
};

export async function buildPricingIntelligenceReport(period: Period): Promise<PricingIntelligenceReport> {
  const [snapshot, pricingReport] = await Promise.all([
    buildPricingIntelligenceSnapshot(period),
    getLatestPricingReport(period.days),
  ]);
  const pricingReportStale =
    pricingReport !== null && period.end.getTime() - pricingReport.periodEnd.getTime() > 24 * 60 * 60 * 1000;
  return { snapshot, pricingReport, pricingReportStale, thresholds: PRICING_INTELLIGENCE };
}
