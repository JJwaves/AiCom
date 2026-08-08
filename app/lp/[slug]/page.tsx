import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LP_ALIASES, getLandingPage } from "@/config/landing-pages";
import { LandingTemplate } from "@/components/landing/LandingTemplate";

/**
 * Ad landing pages: /lp/restaurant-bags, /lp/cafe-bags, /lp/custom-logo-bags,
 * /lp/bulk-takeout-bags. Same content system as the organic pages, rendered
 * in adMode (minimal nav, one conversion objective). noindex — ad variants
 * must not compete with the canonical organic pages in search.
 */

export function generateStaticParams() {
  return Object.keys(LP_ALIASES).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const content = getLandingPage(LP_ALIASES[slug] ?? "");
  if (!content) return {};
  return {
    title: content.metaTitle,
    description: content.metaDescription,
    robots: { index: false, follow: true },
    alternates: { canonical: `/${content.slug}` },
  };
}

export default async function LpPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const content = getLandingPage(LP_ALIASES[slug] ?? "");
  if (!content) notFound();
  return <LandingTemplate content={content} adMode />;
}
