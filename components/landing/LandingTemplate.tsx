import Link from "next/link";
import Script from "next/script";
import { BUSINESS, QUOTE_CTA } from "@/config/business";
import type { LandingContent } from "@/config/landing-pages";
import { getCatalogProduct } from "@/lib/commerce/catalog";
import { startingUnitPriceCents } from "@/modules/pricing";
import { formatQty, formatUnitPrice } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { PhotoStage } from "@/components/product/PhotoStage";
import { WholesalePricing } from "@/components/landing/WholesalePricing";
import { Eyebrow, FAQAccordion, FinalCTA, HowItWorks, SectionHeading, TrustBar } from "@/components/landing/sections";

/**
 * Shared landing template (organic SEO pages + /lp/* ad variants).
 * `adMode` strips nav distractions down to one conversion objective; the organic variant
 * keeps full context. UTM params survive via the attribution layer — links stay clean.
 * One display headline, one accent CTA (the hero's); every other button is ink/outline.
 */
export async function LandingTemplate({ content, adMode = false }: { content: LandingContent; adMode?: boolean }) {
  const product = await getCatalogProduct(content.productSlug);
  if (!product) return null;
  const productHref = `/products/${product.slug}`;
  const quoteHref = `${QUOTE_CTA.href}?product=${product.slug}`;
  const black = product.colors.find((c) => c.id === "black") ?? product.colors[0];

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
      <section className="container-page pt-10 pb-16 lg:pt-16 lg:pb-24">
        <div className="grid items-end gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-6">
            <Eyebrow className="mb-6">{content.title}</Eyebrow>
            <h1 className="type-display">{content.hero.headline}</h1>
            <p className="mt-6 max-w-lg text-lg leading-body text-brand-ink-2">{content.hero.sub}</p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button variant="accent" size="lg" render={<Link href={quoteHref} />}>
                {QUOTE_CTA.label}
              </Button>
              <Link href={productHref} className="text-base text-brand-accent-ink underline underline-offset-3 hover:text-brand-ink">
                {content.hero.cta}
              </Link>
            </div>
            <p className="mt-6 text-sm text-brand-ink-muted tabular">
              From {formatUnitPrice(startingUnitPriceCents(product), product.currency)}/bag · minimum {formatQty(product.minQuantity)} per design
            </p>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
              {content.emphases.map((e) => (
                <li key={e} className="text-sm text-brand-ink-2">
                  {e}
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-6">
            <PhotoStage
              image={product.images[0] ?? null}
              ratio="4/5"
              bagColor={content.illustrationColor ?? black?.swatch}
              showLogo
              priority
              label={product.images[0]?.alt}
              className="lg:aspect-[5/4]"
              illustrationClassName="w-7/12"
            />
          </div>
        </div>
        <div className="mt-12 lg:mt-16">
          <TrustBar />
        </div>
      </section>

      {/* Benefit blocks — a ruled two-column list, not cards. */}
      <section className="container-page section-tight">
        <dl className="grid gap-x-16 border-t border-brand-hairline-strong lg:grid-cols-2">
          {content.bullets.map((b) => (
            <div key={b.heading} className="border-b border-brand-hairline py-6">
              <dt className="font-heading text-xl font-medium leading-snug text-brand-ink">{b.heading}</dt>
              <dd className="mt-2 max-w-prose text-base leading-body text-brand-ink-2">{b.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Pricing */}
      <section className="bg-brand-canvas-2">
        <div className="container-page section-tight grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <SectionHeading eyebrow="Wholesale pricing" title="Per bag, by size and quantity." lead="The product page prices your exact configuration. Anything outside these tiers is quoted individually." />
            <Button variant="outline" className="mt-8" render={<Link href={productHref} />}>
              {content.hero.cta}
            </Button>
          </div>
          <div className="lg:col-span-8">
            <WholesalePricing product={product} compact ground="canvas-2" />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="container-page section-tight">
        <SectionHeading eyebrow="How it works" title="Four steps from spec to delivery." />
        <div className="mt-10">
          <HowItWorks />
        </div>
      </section>

      {/* FAQ + policies */}
      <section className="container-page pb-(--space-section)">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <SectionHeading eyebrow="FAQ" title="Common questions." />
            <p className="mt-4 text-sm text-brand-ink-muted">
              Shipping to {BUSINESS.MARKETS.join(" & ")} ·{" "}
              <Link href="/shipping-policy" className="underline underline-offset-3 hover:text-brand-ink">
                shipping policy
              </Link>{" "}
              ·{" "}
              <Link href="/return-policy" className="underline underline-offset-3 hover:text-brand-ink">
                custom-product return policy
              </Link>
            </p>
          </div>
          <div className="lg:col-span-8">
            <FAQAccordion items={content.faq} />
          </div>
        </div>
      </section>

      {!adMode && <FinalCTA heading={content.hero.headline} href={quoteHref} />}
      {adMode && (
        <div className="container-page border-t border-brand-hairline py-12 text-center">
          <Button size="lg" render={<Link href={quoteHref} />}>
            {QUOTE_CTA.label}
          </Button>
        </div>
      )}
    </>
  );
}
