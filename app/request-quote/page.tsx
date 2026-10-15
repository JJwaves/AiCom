import type { Metadata } from "next";
import { Suspense } from "react";
import { listCatalogProducts } from "@/lib/commerce/catalog";
import { BUSINESS, PROOF_POLICY, QUOTE_CTA } from "@/config/business";
import { FLAT_US_SHIPPING_COPY } from "@/config/shipping";
import { formatDimensions, formatQty } from "@/lib/format";
import { Eyebrow } from "@/components/landing/sections";
import { QuoteClient } from "./quote-client";

export const metadata: Metadata = {
  title: "Request a Wholesale Quote",
  description:
    "Request wholesale pricing for custom printed insulated takeout bags: choose size, colour and quantity, attach your logo, and get factory-direct pricing within one business day.",
  alternates: { canonical: "/request-quote" },
};

/** Wholesale inquiry — the Phase 1 primary conversion. Narrow column, three short steps, facts beside it. */
export default async function RequestQuotePage() {
  const products = await listCatalogProducts();
  const options = products.map((p) => ({
    slug: p.slug,
    title: p.title,
    sizes: p.sizes.map((s) => ({ id: s.id, label: s.label, dims: formatDimensions({ ...s.dimensions, unit: s.unit }) })),
    colors: p.colors.filter((c) => !c.custom).map((c) => ({ id: c.id, label: c.label })),
    quantityPresets: p.quantityPresets,
    minQuantity: p.minQuantity,
  }));

  return (
    <section className="container-page pt-10 pb-16 lg:pt-16 lg:pb-24">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <aside className="lg:col-span-4">
          <Eyebrow className="mb-4">Wholesale inquiry</Eyebrow>
          <h1 className="type-h1">{QUOTE_CTA.label}.</h1>
          <p className="mt-4 text-base leading-body text-brand-ink-2">
            Tell us the bag, the quantity and what you want printed on it. Pricing comes back {QUOTE_CTA.responseTime}.
          </p>
          <dl className="mt-8 divide-y divide-brand-hairline border-y border-brand-hairline text-sm">
            {[
              { k: "Minimum", v: `${formatQty(BUSINESS.MOQ)} pieces per design` },
              { k: "Proof", v: PROOF_POLICY.headline },
              { k: "Production", v: BUSINESS.STANDARD_PRODUCTION_TIME },
              { k: "Shipping", v: `${FLAT_US_SHIPPING_COPY} · United States only` },
            ].map((row) => (
              <div key={row.k} className="grid grid-cols-[6rem_1fr] gap-4 py-3">
                <dt className="text-brand-ink-muted">{row.k}</dt>
                <dd className="text-brand-ink tabular">{row.v}</dd>
              </div>
            ))}
          </dl>
        </aside>
        <div className="lg:col-span-7 lg:col-start-6">
          <Suspense>
            <QuoteClient products={options} />
          </Suspense>
        </div>
      </div>
    </section>
  );
}
