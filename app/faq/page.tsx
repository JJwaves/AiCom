import type { Metadata } from "next";
import Script from "next/script";
import { FAQ_ITEMS } from "@/config/faq";
import { FAQAccordion, FinalCTA } from "@/components/landing/sections";

export const metadata: Metadata = {
  title: "FAQ — Ordering, Artwork, Shipping",
  description:
    "Answers on minimum order quantities, artwork proofs, file formats, US and Canada shipping, volume pricing and custom-printed returns.",
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
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl sm:text-4xl" style={{ fontWeight: 600 }}>
          Frequently asked questions
        </h1>
        <div className="mt-8">
          <FAQAccordion items={[...FAQ_ITEMS]} />
        </div>
      </section>
      <FinalCTA />
    </>
  );
}
