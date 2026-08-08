import Link from "next/link";
import Script from "next/script";
import { BUSINESS } from "@/config/business";
import type { LandingContent } from "@/config/landing-pages";
import { getProductBySlug } from "@/config/products";
import { startingUnitPriceCents } from "@/lib/pricing/engine";
import { formatQty, formatUnitPrice } from "@/lib/format";
import { BagIllustration } from "@/components/product/BagIllustration";
import { TierPricingTable } from "@/components/product/TierPricingTable";
import { FAQAccordion, FinalCTA, HowItWorks, TrustBar } from "@/components/landing/sections";

/**
 * Shared landing template.
 * `adMode` (used by /lp/*) strips nav distractions down to one conversion
 * objective; the organic variant keeps full context. UTM params survive via
 * the attribution layer (captured on every page load) — links stay clean.
 */
export function LandingTemplate({ content, adMode = false }: { content: LandingContent; adMode?: boolean }) {
  const product = getProductBySlug(content.productSlug);
  if (!product) return null;
  const productHref = `/products/${product.slug}`;

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: content.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <>
      <Script id={`ld-faq-${content.slug}`} type="application/ld+json" strategy="afterInteractive">
        {JSON.stringify(faqLd)}
      </Script>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-12 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <h1 className="max-w-xl text-4xl leading-[1.08] sm:text-5xl" style={{ fontWeight: 600 }}>
              {content.hero.headline}
            </h1>
            <p className="mt-4 max-w-lg text-lg text-ink-2">{content.hero.sub}</p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Link href={productHref} className="btn btn--primary">
                {content.hero.cta}
              </Link>
              <p className="font-mono text-sm text-ink-3">
                from {formatUnitPrice(startingUnitPriceCents(product), product.currency)}/bag ·{" "}
                MOQ {formatQty(product.minQuantity)}
              </p>
            </div>
            <ul className="mt-6 flex flex-wrap gap-2">
              {content.emphases.map((e) => (
                <li key={e} className="label-mono rounded-[6px] border border-rule px-2.5 py-1.5">
                  {e}
                </li>
              ))}
            </ul>
          </div>
          <div className="surface flex items-center justify-center p-10">
            <BagIllustration className="w-64" showLogo bodyColor={content.illustrationColor} title={`${content.title} illustration`} />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <TrustBar />
      </div>

      {/* Benefit blocks */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {content.bullets.map((b) => (
            <div key={b.heading} className="surface p-6">
              <h2 className="text-lg" style={{ fontWeight: 600 }}>
                {b.heading}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto max-w-3xl px-4 pb-14 sm:px-6">
        <h2 className="text-2xl" style={{ fontWeight: 600 }}>
          Volume pricing
        </h2>
        <p className="mt-2 text-sm text-ink-3">
          Per-bag pricing before printing options. The configurator on the product page shows your exact total.
        </p>
        <div className="surface mt-5 p-5">
          <TierPricingTable tiers={product.pricingTiers} currency={product.currency} />
        </div>
        <div className="mt-5 text-center">
          <Link href={productHref} className="btn btn--primary">
            {content.hero.cta}
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 pb-14 sm:px-6">
        <h2 className="text-2xl" style={{ fontWeight: 600 }}>
          How ordering works
        </h2>
        <div className="mt-6">
          <HowItWorks />
        </div>
      </section>

      {/* FAQ + policies */}
      <section className="mx-auto max-w-3xl px-4 pb-14 sm:px-6">
        <h2 className="text-2xl" style={{ fontWeight: 600 }}>
          Common questions
        </h2>
        <div className="mt-5">
          <FAQAccordion items={content.faq} />
        </div>
        <p className="mt-4 text-xs text-ink-3">
          Shipping to {BUSINESS.MARKETS.join(" & ")} ·{" "}
          <Link href="/shipping-policy" className="underline hover:text-accent">
            shipping policy
          </Link>{" "}
          ·{" "}
          <Link href="/return-policy" className="underline hover:text-accent">
            custom-product return policy
          </Link>
        </p>
      </section>

      {!adMode && <FinalCTA cta={content.hero.cta} href={productHref} />}
      {adMode && (
        <div className="border-t border-rule py-10 text-center">
          <Link href={productHref} className="btn btn--primary !px-10 !py-4 text-base">
            {content.hero.cta}
          </Link>
        </div>
      )}
    </>
  );
}
