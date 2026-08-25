import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Script from "next/script";
import { getCatalogProduct, listCatalogProducts } from "@/lib/commerce/catalog";
import { resolveProductPrimaryCta, resolveProductShippingMessage } from "@/lib/experiments/server";
import { BUSINESS, PROOF_POLICY, showsDemoPricing } from "@/config/business";
import { FLAT_US_SHIPPING_COPY } from "@/config/shipping";
import { baseUnitPriceCents, startingUnitPriceCents } from "@/modules/pricing";
import { ProductConfigurator } from "@/components/product/ProductConfigurator";
import { HowItWorks } from "@/components/landing/sections";
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
    title: `${product.title} — Pricing & Custom Printing`,
    description: `${product.positioning} Configure size, color and quantity online and upload your logo; from $${
      (startingUnitPriceCents(product) / 100).toFixed(2)
    } per bag. ${FLAT_US_SHIPPING_COPY}. Ships within the United States.`,
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

      <nav aria-label="Breadcrumb" className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <ol className="flex gap-2 font-mono text-xs text-ink-3">
          <li>
            <Link href="/products" className="hover:text-accent">
              Products
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink-2">
            {product.title}
          </li>
        </ol>
      </nav>

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <ProductConfigurator
          product={product}
          experiments={{ shippingMessage: shippingMessage.override, primaryCta: primaryCta.override }}
        />
      </section>

      {/* How customization works — three steps, no promise of an automated
          proof: proof preparation is a human production step. */}
      <section className="mx-auto max-w-6xl border-t border-rule px-4 py-12 sm:px-6">
        <h2 className="text-xl" style={{ fontWeight: 600 }}>
          How customization works
        </h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { n: 1, h: "Configure", b: "Choose size, color and quantity." },
            { n: 2, h: "Upload artwork", b: "Upload your restaurant logo or bag design." },
            {
              n: 3,
              h: "Approve your proof",
              b: `We'll prepare a digital proof for approval before production. ${PROOF_POLICY.productionStart}`,
            },
          ].map((step) => (
            <li key={step.n} className="surface p-5">
              <p className="label-mono">Step {step.n}</p>
              <h3 className="mt-1 text-base" style={{ fontWeight: 600 }}>
                {step.h}
              </h3>
              <p className="mt-1 text-sm text-ink-3">{step.b}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-ink-2">{PROOF_POLICY.leadTime}</p>
        <p className="mt-1 text-sm text-ink-3">
          {FLAT_US_SHIPPING_COPY}, charged once per order and shown separately from the product subtotal. Any sales tax
          is calculated at checkout.
        </p>
      </section>

      <section className="mx-auto max-w-6xl border-t border-rule px-4 py-12 sm:px-6">
        <h2 className="text-xl" style={{ fontWeight: 600 }}>
          What happens after you order
        </h2>
        <div className="mt-6">
          <HowItWorks compact />
        </div>
        <p className="mt-6 max-w-2xl text-sm text-ink-3">{product.description}</p>
      </section>
    </>
  );
}
