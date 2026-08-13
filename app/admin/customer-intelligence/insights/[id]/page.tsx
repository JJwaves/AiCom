import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isFlagEnabled } from "@/config/flags";
import { checkAdminAuth } from "@/lib/admin/auth";
import { getInsight } from "@/lib/data/insight-service";
import { formatQty } from "@/lib/format";
import { EvidenceList } from "../../evidence-list";

export const metadata: Metadata = { title: "Insight evidence — Admin", robots: { index: false, follow: false } };

/** Evidence drill-down for one persisted CustomerInsight (spec §19, §30). */
export default async function InsightEvidencePage({ params }: { params: Promise<{ id: string }> }) {
  if (!isFlagEnabled("AI_CUSTOMER_INTELLIGENCE")) notFound();
  const h = await headers();
  if (checkAdminAuth(h.get("authorization")) !== "authorized") notFound();

  const { id } = await params;
  const insight = await getInsight(id);
  if (!insight) notFound();

  return (
    <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link className="text-sm underline" href="/admin/customer-intelligence">
        ← Customer Intelligence
      </Link>
      <p className="label-mono mt-4 text-ink-3">{insight.insightType} · {insight.status}</p>
      <h1 className="mt-1 text-2xl" style={{ fontWeight: 600 }}>
        {insight.title}
      </h1>
      {insight.summary ? <p className="mt-2 text-sm text-ink-2">{insight.summary}</p> : null}
      <p className="mt-2 text-xs text-ink-3">
        Evidence: {formatQty(insight.evidenceCount)} records
        {insight.periodStart && insight.periodEnd
          ? ` · period ${insight.periodStart.toISOString().slice(0, 10)} → ${insight.periodEnd.toISOString().slice(0, 10)}`
          : ""}
      </p>
      <EvidenceList refs={insight.sourceRefsJson} />
    </section>
  );
}
