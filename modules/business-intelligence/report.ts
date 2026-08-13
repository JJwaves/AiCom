import { BUSINESS_INTELLIGENCE } from "@/config/business-intelligence";
import { getLatestCeoReport, type CeoReportRow } from "@/lib/data/ceo-report-service";
import type { Period } from "@/modules/customer-intelligence/period";
import { buildBusinessHealthSnapshot, type BusinessHealthSnapshot } from "./snapshot";

/**
 * Admin report assembly (Session 09 spec §29, §32) — deterministic
 * metrics load WITHOUT any LLM call; the CEO narrative is whatever the
 * last explicit "Generate CEO Review" action persisted (or null). A
 * provider outage therefore never darkens the dashboard.
 */

export type BusinessIntelligenceReport = {
  snapshot: BusinessHealthSnapshot;
  /** Latest persisted CEO review for this period length; null = never generated. */
  ceoReport: CeoReportRow | null;
  /** True when the persisted review covers an older window than the snapshot. */
  ceoReportStale: boolean;
  thresholds: typeof BUSINESS_INTELLIGENCE;
};

export async function buildBusinessIntelligenceReport(period: Period): Promise<BusinessIntelligenceReport> {
  const [snapshot, ceoReport] = await Promise.all([
    buildBusinessHealthSnapshot(period),
    getLatestCeoReport(period.days),
  ]);
  const ceoReportStale =
    ceoReport !== null && period.end.getTime() - ceoReport.periodEnd.getTime() > 24 * 60 * 60 * 1000;
  return { snapshot, ceoReport, ceoReportStale, thresholds: BUSINESS_INTELLIGENCE };
}
