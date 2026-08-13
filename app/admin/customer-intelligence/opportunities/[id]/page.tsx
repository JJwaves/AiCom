import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isFlagEnabled } from "@/config/flags";
import { checkAdminAuth } from "@/lib/admin/auth";
import { getOpportunity } from "@/lib/data/insight-service";
import { formatQty } from "@/lib/format";
import { EvidenceList } from "../../evidence-list";

export const metadata: Metadata = { title: "Opportunity evidence — Admin", robots: { index: false, follow: false } };

/** Evidence drill-down for one ProductOpportunity (spec §21, §30). */
export default async function OpportunityEvidencePage({ params }: { params: Promise<{ id: string }> }) {
  if (!isFlagEnabled("AI_CUSTOMER_INTELLIGENCE")) notFound();
  const h = await headers();
  if (checkAdminAuth(h.get("authorization")) !== "authorized") notFound();

  const { id } = await params;
  const opportunity = await getOpportunity(id);
  if (!opportunity) notFound();

  return (
    <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link className="text-sm underline" href="/admin/customer-intelligence">
        ← Customer Intelligence
      </Link>
      <p className="label-mono mt-4 text-ink-3">
        {opportunity.opportunityType ?? "opportunity"} · {opportunity.status} · human validation required
      </p>
      <h1 className="mt-1 text-2xl" style={{ fontWeight: 600 }}>
        {opportunity.title}
      </h1>
      <p className="mt-2 text-sm text-ink-2">{opportunity.description}</p>
      <p className="mt-2 text-xs text-ink-3">
        Evidence: {formatQty(opportunity.evidenceCount)} records
        {opportunity.estimatedDemand ? ` · ${opportunity.estimatedDemand}` : ""}
      </p>
      <EvidenceList refs={opportunity.sourceRefsJson ?? []} />
    </section>
  );
}
