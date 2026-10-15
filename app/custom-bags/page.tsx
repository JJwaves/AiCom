import type { Metadata } from "next";
import Link from "next/link";
import { FinalCTA, SectionHeading } from "@/components/landing/sections";
import { Button } from "@/components/ui/button";
import { QUOTE_CTA } from "@/config/business";

export const metadata: Metadata = {
  title: "Custom Bag Manufacturing",
  description:
    "Custom bag manufacturing beyond the standard catalog: custom dimensions (5,000-piece minimum), other base colors, and quantities above 10,000 — all quoted individually.",
  alternates: { canonical: "/custom-bags" },
};

const CAPABILITIES = [
  { h: "Custom dimensions", b: "Width, height and gusset to your spec — sized to your containers, boxes or bottles. Provide target dimensions in the quote form and we'll confirm tooling feasibility." },
  { h: "Custom colors", b: "Pantone-matched fabric beyond the standard palette. Matched colors are dyed per run, so they're quoted with the quantity." },
  { h: "Handle styles", b: "Loop handles are standard; die-cut and reinforced handles are quoted per design once factory capability for your spec is confirmed." },
  { h: "Materials and construction", b: "Our launch product is a fixed three-layer insulated construction: PP laminated outer, non-woven middle, aluminium foil inner. Other constructions and GSM weights are quoted per run." },
  { h: "Full-coverage printing", b: "Beyond 1- and 2-color logos: multi-color and large-format prints are reviewed by the artwork team and quoted individually." },
  { h: "Volume programs", b: "Standing reorder schedules and distributor volumes — tell us your annual usage and we'll price a program, not just an order." },
];

export default function CustomBagsPage() {
  return (
    <>
      <section className="container-page pt-10 pb-16 lg:pt-16 lg:pb-24">
        <SectionHeading
          as="h1"
          eyebrow="Custom manufacturing"
          title="Beyond the catalog."
          lead="The online configurator covers standard sizes, colours and printing. Everything else — custom dimensions, matched colours, special handles — is a conversation with the factory, started from one form."
        />
        <dl className="mt-12 grid gap-x-12 border-t border-brand-hairline-strong sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c) => (
            <div key={c.h} className="border-b border-brand-hairline py-6">
              <dt className="font-heading text-xl font-medium leading-snug text-brand-ink">{c.h}</dt>
              <dd className="mt-2 text-sm leading-body text-brand-ink-2">{c.b}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-10">
          <Button variant="accent" size="lg" render={<Link href={`${QUOTE_CTA.href}?product=custom`} />}>
            {QUOTE_CTA.label}
          </Button>
          <p className="mt-3 text-sm text-brand-ink-muted">Pricing replies {QUOTE_CTA.responseTime}.</p>
        </div>
      </section>
      <FinalCTA
        heading="Standard specs? The price is already on the page."
        sub="Standard sizes, colours and printing are priced online — configure the bag and send the quote request in one sitting."
        href="/products/custom-insulated-takeout-bags"
        cta="Configure the standard bag"
      />
    </>
  );
}
