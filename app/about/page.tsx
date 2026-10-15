import type { Metadata } from "next";
import Script from "next/script";
import { BUSINESS, PROOF_POLICY, QUOTE_CTA } from "@/config/business";
import { formatQty } from "@/lib/format";
import { FactoryBand, FinalCTA, SectionHeading, TrustBar } from "@/components/landing/sections";
import { PhotoStage } from "@/components/product/PhotoStage";

export const metadata: Metadata = {
  title: "About the Factory",
  description:
    "Factory-direct manufacturer of custom printed insulated takeout bags for U.S. food businesses — who we are and how factory-direct ordering works.",
  alternates: { canonical: "/about" },
};

const placeholder = (v: string) => v.startsWith("[");

export default function AboutPage() {
  const orgLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BUSINESS.BRAND_NAME,
    url: `https://${BUSINESS.DOMAIN}`,
    description: "Factory-direct manufacturer of custom printed insulated takeout bags.",
  };
  return (
    <>
      <Script id="ld-org" type="application/ld+json" strategy="afterInteractive">
        {JSON.stringify(orgLd)}
      </Script>

      <section className="container-page pt-10 pb-16 lg:pt-16 lg:pb-24">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-6">
            <SectionHeading
              as="h1"
              eyebrow="About"
              title="A factory with a quote form, not a sales floor."
              lead="Most custom packaging reaches restaurants through two or three intermediaries — an importer, a distributor, sometimes a local rep — each adding margin and a delay. We manufacture insulated takeout bags and sell them directly to the businesses that use them."
            />
            <div className="measure mt-8 space-y-4 text-base leading-body text-brand-ink-2">
              <p>
                That is the whole model. It is why the price breaks are printed on the product page instead of hidden behind a sales
                call, and why custom printing starts at {formatQty(BUSINESS.MOQ)} pieces — a quantity a single restaurant can use.
              </p>
              <p>
                Every order is made to your approved artwork. {PROOF_POLICY.detail} {PROOF_POLICY.leadTime}
              </p>
            </div>
            <dl className="mt-10 grid gap-x-10 border-t border-brand-hairline-strong sm:grid-cols-2">
              {[
                { k: "Factory location", v: BUSINESS.FACTORY_LOCATION },
                { k: "Ships from", v: BUSINESS.SHIPPING_ORIGIN },
                { k: "Markets served", v: "United States" },
                { k: "Pricing replies", v: QUOTE_CTA.responseTime },
              ].map((row) => (
                <div key={row.k} className="border-b border-brand-hairline py-4">
                  <dt className="eyebrow">{row.k}</dt>
                  <dd className={`mt-1 text-base ${placeholder(row.v) ? "text-brand-ink-muted" : "text-brand-ink"}`}>
                    {placeholder(row.v) ? "To be confirmed" : row.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="lg:col-span-6">
            <PhotoStage ratio="4/5" tone="kraft" label="The factory floor — owner/supplier photography only" illustrationClassName="w-5/12 opacity-70" className="lg:aspect-[5/6]" />
          </div>
        </div>
        <div className="mt-12 lg:mt-16">
          <TrustBar />
        </div>
      </section>

      <FactoryBand />
      <FinalCTA accent />
    </>
  );
}
