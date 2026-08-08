import type { Metadata } from "next";
import Link from "next/link";
import { FinalCTA } from "@/components/landing/sections";

export const metadata: Metadata = {
  title: "Custom Bag Manufacturing",
  description:
    "Custom non-woven bag manufacturing beyond the standard catalog: custom dimensions, Pantone-matched colors, handle styles and materials, quoted individually.",
  alternates: { canonical: "/custom-bags" },
};

const CAPABILITIES = [
  { h: "Custom dimensions", b: "Width, height and gusset to your spec — sized to your containers, boxes or bottles. Provide target dimensions in the quote form and we'll confirm tooling feasibility." },
  { h: "Custom colors", b: "Pantone-matched fabric beyond the standard palette. Matched colors are dyed per run, so they're quoted with the quantity." },
  { h: "Handle styles", b: "Loop handles are standard; die-cut and reinforced handles are quoted per design once factory capability for your spec is confirmed." },
  { h: "Material weights", b: "Standard and heavy-duty non-woven fabric today; other GSM weights are quoted per run." },
  { h: "Full-coverage printing", b: "Beyond 1- and 2-color logos: multi-color and large-format prints are reviewed by the artwork team and quoted individually." },
  { h: "Volume programs", b: "Standing reorder schedules and distributor volumes — tell us your annual usage and we'll price a program, not just an order." },
];

export default function CustomBagsPage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h1 className="max-w-xl text-3xl sm:text-4xl" style={{ fontWeight: 600 }}>
          Custom manufacturing, beyond the catalog
        </h1>
        <p className="mt-3 max-w-lg text-ink-2">
          The online configurator covers standard sizes, colors and printing. Everything else — custom
          dimensions, matched colors, special handles — is a conversation with the factory, started from one
          form.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c) => (
            <div key={c.h} className="surface p-5">
              <h2 className="text-base" style={{ fontWeight: 600 }}>
                {c.h}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{c.b}</p>
            </div>
          ))}
        </div>
        <div className="mt-10">
          <Link href="/request-quote" className="btn btn--primary">
            Request custom pricing
          </Link>
          <p className="mt-3 text-sm text-ink-3">Pricing replies within one business day.</p>
        </div>
      </section>
      <FinalCTA
        heading="Standard specs? Skip the quote."
        sub="Standard sizes, colors and printing are priced online — configure and order in one sitting."
      />
    </>
  );
}
