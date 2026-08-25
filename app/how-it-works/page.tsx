import type { Metadata } from "next";
import Link from "next/link";
import { HowItWorks, FinalCTA } from "@/components/landing/sections";

export const metadata: Metadata = {
  title: "How Ordering Works",
  description:
    "Four steps from configuration to delivery: choose your bag, add your logo, approve the proof, and the factory manufactures and ships your order.",
  alternates: { canonical: "/how-it-works" },
};

const DETAILS = [
  {
    title: "1 · Choose your bag",
    body: "Pick a product, then configure size, material weight, color and quantity. The per-bag price and order total update live as you change options — no quote request needed for standard configurations.",
  },
  {
    title: "2 · Add your logo",
    body: "Upload artwork (PNG, JPG, PDF, AI or EPS — up to 25 MB; SVG is not accepted) right in the configurator, with a notes field for placement and ink instructions. No artwork yet? Use the quote form and tell us — our artwork team will help.",
  },
  {
    title: "3 · Approve your design",
    body: "For printed orders, our artwork team prepares a production proof and emails it to you. You approve it (or request changes) before anything prints. Production timelines start at proof approval.",
  },
  {
    title: "4 · We manufacture & ship",
    body: "The factory produces your order and ships it to your U.S. business address. Production typically takes 15–30 days after you approve your digital proof, and you'll get tracking when it leaves the dock.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl sm:text-4xl" style={{ fontWeight: 600 }}>
          How ordering works
        </h1>
        <p className="mt-3 max-w-lg text-ink-2">
          The whole flow is designed to run without a sales call. Configure, upload, approve, receive.
        </p>
        <div className="mt-8">
          <HowItWorks />
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {DETAILS.map((d) => (
            <div key={d.title} className="border-l-2 border-accent pl-5">
              <h2 className="text-lg" style={{ fontWeight: 600 }}>
                {d.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{d.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-10 text-sm text-ink-3">
          Configuration outside the standard options?{" "}
          <Link href="/request-quote" className="text-accent underline">
            Request custom pricing
          </Link>{" "}
          — same process, with a human quote step at the start.
        </p>
      </section>
      <FinalCTA />
    </>
  );
}
