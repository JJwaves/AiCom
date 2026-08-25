import type { Metadata } from "next";
import Script from "next/script";
import { BUSINESS } from "@/config/business";
import { FactoryBand, FinalCTA, TrustBar } from "@/components/landing/sections";

export const metadata: Metadata = {
  title: "About the Factory",
  description:
    "Factory-direct manufacturer of custom printed insulated takeout bags for U.S. food businesses — who we are and how factory-direct ordering works.",
  alternates: { canonical: "/about" },
};

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
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h1 className="max-w-xl text-3xl sm:text-4xl" style={{ fontWeight: 600 }}>
          A factory with a checkout page
        </h1>
        <div className="mt-6 grid max-w-3xl gap-4 text-ink-2">
          <p>
            Most custom packaging reaches restaurants through two or three intermediaries — an importer, a
            distributor, sometimes a local rep — each adding margin and a delay. We manufacture insulated takeout bags
            and sell them directly to the businesses that use them.
          </p>
          <p>
            That&apos;s the whole model. It&apos;s why the tier table is printed on the product page instead of
            hidden behind a sales call, and why custom printing starts at {""}
            quantities a single restaurant can actually use.
          </p>
          <p className="text-sm text-ink-3">
            Factory location: {BUSINESS.FACTORY_LOCATION} · Shipping origin: {BUSINESS.SHIPPING_ORIGIN} — company
            details are being finalized for this page.
          </p>
        </div>
      </section>
      <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <TrustBar />
      </div>
      <FactoryBand />
      <FinalCTA />
    </>
  );
}
