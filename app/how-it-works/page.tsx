import type { Metadata } from "next";
import Link from "next/link";
import { HowItWorks, FinalCTA, SectionHeading } from "@/components/landing/sections";
import { QUOTE_CTA } from "@/config/business";

export const metadata: Metadata = {
  title: "How Ordering Works",
  description:
    "Four steps from configuration to delivery: choose your bag, add your logo, approve the proof, and the factory manufactures and ships your order.",
  alternates: { canonical: "/how-it-works" },
};

const DETAILS = [
  {
    title: "01 · Choose your bag",
    body: "Pick a product, then configure size, colour and quantity. The per-bag price and order total update live as you change options, and the configuration travels with your quote request.",
  },
  {
    title: "02 · Add your logo",
    body: "Attach artwork (PNG, JPG, PDF, AI or EPS — up to 25 MB; SVG is not accepted) to the quote request, with a notes field for placement and ink instructions. No artwork yet? Tell us — our artwork team will help.",
  },
  {
    title: "03 · Approve your design",
    body: "For printed orders, our artwork team prepares a production proof and emails it to you. You approve it (or request changes) before anything prints. Production timelines start at proof approval.",
  },
  {
    title: "04 · We manufacture & ship",
    body: "The factory produces your order and ships it to your U.S. business address. Production typically takes 15–30 days after you approve your digital proof, and you'll get tracking when it leaves the dock.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <section className="container-page pt-10 pb-16 lg:pt-16 lg:pb-24">
        <SectionHeading as="h1" eyebrow="How it works" title="How ordering works." lead="The whole flow runs without a sales call. Configure, send artwork, approve the proof, receive." />
        <div className="mt-10">
          <HowItWorks />
        </div>
        <dl className="mt-16 grid gap-x-16 border-t border-brand-hairline-strong lg:grid-cols-2">
          {DETAILS.map((d) => (
            <div key={d.title} className="border-b border-brand-hairline py-6">
              <dt className="font-heading text-xl font-medium leading-snug text-brand-ink">{d.title}</dt>
              <dd className="mt-2 max-w-prose text-base leading-body text-brand-ink-2">{d.body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 text-sm text-brand-ink-2">
          Configuration outside the standard options?{" "}
          <Link href={QUOTE_CTA.href} className="text-brand-accent-ink underline underline-offset-3 hover:text-brand-ink">
            {QUOTE_CTA.label}
          </Link>{" "}
          — same process, with a human pricing step at the start.
        </p>
      </section>
      <FinalCTA accent />
    </>
  );
}
