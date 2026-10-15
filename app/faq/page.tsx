import type { Metadata } from "next";
import Script from "next/script";
import { FAQ_ITEMS } from "@/config/faq";
import { QUOTE_CTA } from "@/config/business";
import { FAQAccordion, FinalCTA, SectionHeading } from "@/components/landing/sections";

export const metadata: Metadata = {
  title: "FAQ — Minimums, Artwork, Pricing, Shipping",
  description:
    "Answers on the 5,000-piece minimum, digital proofs, artwork file formats, wholesale pricing, flat U.S. shipping and custom-printed returns.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return (
    <>
      <Script id="ld-faq" type="application/ld+json" strategy="afterInteractive">
        {JSON.stringify(faqLd)}
      </Script>
      <section className="container-page pt-10 pb-16 lg:pt-16 lg:pb-24">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <SectionHeading
              as="h1"
              eyebrow="FAQ"
              title="Frequently asked questions."
              lead={`If yours is not here, send it with a quote request — pricing and answers come back ${QUOTE_CTA.responseTime}.`}
            />
          </div>
          <div className="lg:col-span-8">
            <FAQAccordion items={[...FAQ_ITEMS]} />
          </div>
        </div>
      </section>
      <FinalCTA accent />
    </>
  );
}
