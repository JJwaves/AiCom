import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Script from "next/script";
import { getCatalogProduct, listCatalogProducts } from "@/lib/commerce/catalog";
import { resolveProductPrimaryCta, resolveProductShippingMessage } from "@/lib/experiments/server";
import { BUSINESS, PROOF_POLICY, QUOTE_CTA, showsDemoPricing } from "@/config/business";
import { FLAT_US_SHIPPING_COPY } from "@/config/shipping";
import { FAQ_ITEMS } from "@/config/faq";
import { baseUnitPriceCents, startingUnitPriceCents } from "@/modules/pricing";
import { ProductConfigurator } from "@/components/product/ProductConfigurator";
import { WholesalePricing } from "@/components/landing/WholesalePricing";
import { Eyebrow, FAQAccordion, FinalCTA, HowItWorks, SectionHeading } from "@/components/landing/sections";
import { ViewItemTracker } from "./view-item-tracker";

export async function generateStaticParams() {
  const products = await listCatalogProducts();
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getCatalogProduct(slug);
  if (!product) return {};
  return {
    title: `${product.title} — Wholesale Pricing & Custom Printing`,
    description: `${product.positioning} Configure size, colour and quantity, from $${(
      startingUnitPriceCents(product) / 100
    ).toFixed(2)} per bag at wholesale quantities. ${FLAT_US_SHIPPING_COPY}. Request a quote — ships within the United States.`,
    alternates: { canonical: `/products/${product.slug}` },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getCatalogProduct(slug);
  if (!product) notFound();

  /* Session 11: experiment targets are resolved SERVER-SIDE so the HTML the
   * browser receives already contains the right arm (no flicker, no
   * hydration mismatch). With EXPERIMENT_ENGINE off these read nothing and
   * return null overrides — the page renders exactly as before. */
  const path = `/products/${slug}`;
  const [shippingMessage, primaryCta] = await Promise.all([
    resolveProductShippingMessage(path),
    resolveProductPrimaryCta(path),
  ]);

  // Product structured data — omit price when demo pricing is active so the
  // feed/schema never publishes fake numbers.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description,
    brand: { "@type": "Brand", name: BUSINESS.BRAND_NAME },
    ...(showsDemoPricing(product)
      ? {}
      : {
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: product.currency,
            lowPrice: (startingUnitPriceCents(product) / 100).toFixed(2),
            highPrice: (baseUnitPriceCents(product) / 100).toFixed(2),
            availability: "https://schema.org/InStock",
          },
        }),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Products", item: `https://${BUSINESS.DOMAIN}/products` },
      { "@type": "ListItem", position: 2, name: product.title },
    ],
  };

  return (
    <>
      <Script id={`ld-product-${product.id}`} type="application/ld+json" strategy="afterInteractive">
        {JSON.stringify([jsonLd, breadcrumbLd])}
      </Script>
      <ViewItemTracker product={product} />

      <nav aria-label="Breadcrumb" className="container-page pt-6">
        <ol className="flex gap-2 text-sm text-brand-ink-muted">
          <li>
            <Link href="/products" className="hover:text-brand-ink hover:underline">
              Products
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-brand-ink-2">
            {product.title}
          </li>
        </ol>
      </nav>

      <section className="container-page pt-6 pb-16 lg:pb-24">
        <ProductConfigurator
          product={product}
          experiments={{ shippingMessage: shippingMessage.override, primaryCta: primaryCta.override }}
        />
      </section>

      {/* Specifications — the catalog table in full. */}
      <section className="bg-brand-canvas-2" aria-labelledby="pdp-specs">
        <div className="container-page section-tight grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <SectionHeading eyebrow="Specifications" title={<span id="pdp-specs">What you are ordering.</span>} lead={product.description} />
          </div>
          <dl className="grid gap-x-10 self-start border-t border-brand-hairline-strong sm:grid-cols-2 lg:col-span-8">
            {product.specifications.map((spec) => (
              <div key={spec.label} className="border-b border-brand-hairline py-4">
                <dt className="eyebrow">{spec.label}</dt>
                <dd className="mt-1 text-base text-brand-ink">{spec.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Wholesale price breaks, both sizes. */}
      <section className="container-page section-tight" aria-labelledby="pdp-pricing">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <Eyebrow className="mb-4">Wholesale pricing</Eyebrow>
            <h2 id="pdp-pricing" className="type-h2">
              Price breaks by size and quantity.
            </h2>
            <p className="mt-4 text-sm leading-body text-brand-ink-2">
              Product subtotal per design, including your custom print. {FLAT_US_SHIPPING_COPY}, charged once per order and shown separately.
            </p>
          </div>
          <div className="lg:col-span-8">
            <WholesalePricing product={product} />
          </div>
        </div>
      </section>

      {/* How customisation works — proof preparation is a human production step; no automation is promised. */}
      <section className="container-page pb-(--space-section)" aria-labelledby="pdp-process">
        <SectionHeading
          eyebrow="How it works"
          title={<span id="pdp-process">From configuration to delivery.</span>}
          lead={`${PROOF_POLICY.detail} ${PROOF_POLICY.leadTime}`}
        />
        <div className="mt-10">
          <HowItWorks />
        </div>
      </section>

      <section className="container-page pb-(--space-section)" aria-labelledby="pdp-faq">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <Eyebrow className="mb-4">FAQ</Eyebrow>
            <h2 id="pdp-faq" className="type-h2">
              Before you request a quote.
            </h2>
            <p className="mt-4 text-sm text-brand-ink-2">
              More in the{" "}
              <Link href="/faq" className="text-brand-accent-ink underline underline-offset-3 hover:text-brand-ink">
                full FAQ
              </Link>
              .
            </p>
          </div>
          <div className="lg:col-span-8">
            <FAQAccordion items={FAQ_ITEMS.slice(0, 5)} />
          </div>
        </div>
      </section>

      <FinalCTA
        heading="Send the spec, get the price."
        sub={`Size, colour, quantity and your artwork. Pricing comes back ${QUOTE_CTA.responseTime}, and nothing prints before you approve a digital proof.`}
        href={`${QUOTE_CTA.href}?product=${product.slug}`}
      />
    </>
  );
}
