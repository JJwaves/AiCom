import type { Metadata } from "next";
import Link from "next/link";
import { getHeroCatalogProduct, listCatalogProducts } from "@/lib/commerce/catalog";
import { resolveHomepageHero } from "@/lib/experiments/server";
import { FAQ_ITEMS } from "@/config/faq";
import { BUSINESS, PROOF_POLICY, QUOTE_CTA } from "@/config/business";
import { formatDimensions, formatQty } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { PhotoStage } from "@/components/product/PhotoStage";
import { WholesalePricing } from "@/components/landing/WholesalePricing";
import { Eyebrow, FAQAccordion, FactoryBand, FinalCTA, HowItWorks, ProductCard, SectionHeading, TrustBar } from "@/components/landing/sections";

export const metadata: Metadata = {
  title: "Custom Printed Insulated Takeout Bags, Factory Direct",
  description:
    "Custom printed insulated takeout bags for restaurants, catering and food delivery. Two sizes, black or white, 5,000-piece minimum, wholesale pricing on the page, digital proof before production. Request a quote. Ships within the United States.",
  alternates: { canonical: "/" },
};

/**
 * Homepage — the page argument (one claim per section, with its proof):
 *   Hero       "Your logo on an insulated bag, from the factory."  → the product, four facts, one CTA
 *   Benefits   "Built for the trip, not the counter."              → three-layer construction, sizes
 *   Specs      "These are the exact specifications."               → the catalog spec table + size stage
 *   Process    "Ordering is four steps and the price is public."   → steps + wholesale price breaks
 *   Branding   "Your artwork, proofed before anything prints."     → file formats, proof policy
 *   FAQ        "The questions operators ask first."                → six real answers
 *   CTA        "Request a quote."                                   → the accent button
 */
export default async function HomePage() {
  const products = await listCatalogProducts();
  const hero = await getHeroCatalogProduct();
  /* Session 11: server-resolved hero copy experiment. Null override (the
   * default, and always when EXPERIMENT_ENGINE is off) = the copy below. */
  const heroCopy = (await resolveHomepageHero("/")).override;
  const black = hero.colors.find((c) => c.id === "black") ?? hero.colors[0];
  const white = hero.colors.find((c) => c.id === "white") ?? hero.colors[1] ?? hero.colors[0];
  const largest = hero.sizes[hero.sizes.length - 1];

  return (
    <>
      {/* HERO — split: statement on canvas left, product on the stage right. One display size, one accent CTA. */}
      <section className="container-page pt-10 pb-16 lg:pt-16 lg:pb-24">
        <div className="grid items-end gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-7" data-experiment={heroCopy ? "homepage.hero" : undefined}>
            <Eyebrow className="mb-6">Custom insulated takeout bags · US wholesale</Eyebrow>
            <h1 className="type-display-xl">
              {heroCopy?.headline ?? "Insulated takeout bags, printed with your logo."}
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-body text-brand-ink-2">
              {heroCopy?.subheadline ??
                `Factory direct for restaurants, catering and food delivery. Two sizes, black or white, ${formatQty(BUSINESS.MOQ)} pieces per design — priced on the page, proofed before production.`}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button variant="accent" size="lg" render={<Link href={`${QUOTE_CTA.href}?product=${hero.slug}`} />}>
                {heroCopy?.ctaLabel ?? QUOTE_CTA.label}
              </Button>
              <Link href="#pricing" className="text-base text-brand-accent-ink underline underline-offset-3 hover:text-brand-ink">
                See wholesale pricing
              </Link>
            </div>
          </div>
          <div className="lg:col-span-5">
            <PhotoStage
              image={hero.images[0] ?? null}
              ratio="4/5"
              bagColor={black?.swatch}
              showLogo
              priority
              label={hero.images[0]?.alt}
              illustrationClassName="w-7/12"
            />
          </div>
        </div>
        <div className="mt-12 lg:mt-16">
          <TrustBar />
        </div>
      </section>

      {/* BENEFITS — a 5/7 split: three claims as a ruled list, photograph beside them. */}
      <section className="container-page section-tight" aria-labelledby="benefits-heading">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <Eyebrow className="mb-4">Why this bag</Eyebrow>
            <h2 id="benefits-heading" className="type-h2">
              Built for the trip, not the counter.
            </h2>
            <ol className="mt-8 divide-y divide-brand-hairline border-y border-brand-hairline">
              {[
                {
                  t: "Three layers hold the temperature",
                  b: "PP laminated outer, non-woven middle, aluminium foil inner. The construction is fixed — it is what makes the bag insulated.",
                },
                {
                  t: "Your brand rides along",
                  b: "Takeout and delivery orders leave your dining room behind. The printed bag is the one brand surface that travels with the food.",
                },
                {
                  t: "Two sizes that fit real orders",
                  b: `Large ${formatDimensions({ ...hero.sizes[0].dimensions, unit: hero.sizes[0].unit })} and Extra Large ${formatDimensions({ ...largest.dimensions, unit: largest.unit })} — sized for stacked containers and family orders.`,
                },
              ].map((item, i) => (
                <li key={item.t} className="grid grid-cols-[2.5rem_1fr] gap-4 py-5">
                  <span className="font-heading text-2xl leading-none text-brand-accent tabular">0{i + 1}</span>
                  <div>
                    <h3 className="font-heading text-xl font-medium leading-snug text-brand-ink">{item.t}</h3>
                    <p className="mt-2 text-base leading-body text-brand-ink-2">{item.b}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:col-span-7">
            <PhotoStage image={hero.images[1] ?? null} ratio="4/5" bagColor={white?.swatch} showLogo label={hero.images[1]?.alt} className="mt-10" />
            <PhotoStage image={hero.images[2] ?? null} ratio="4/5" tone="kraft" bagColor={black?.swatch} showLogo label={hero.images[2]?.alt} />
          </div>
        </div>
      </section>

      {/* SPECIFICATIONS — the catalog table, rendered as a definition list on the alternate band. */}
      <section className="bg-brand-canvas-2" aria-labelledby="specs-heading">
        <div className="container-page section-tight grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <PhotoStage image={hero.images[3] ?? null} ratio="1/1" tone="kraft" bagColor={white?.swatch} label={hero.images[3]?.alt} />
          </div>
          <div className="lg:col-span-7">
            <SectionHeading eyebrow="Specifications" title={<span id="specs-heading">Exactly what you are ordering.</span>} />
            <dl className="mt-8 grid gap-x-10 border-t border-brand-hairline-strong sm:grid-cols-2">
              {hero.specifications.map((spec) => (
                <div key={spec.label} className="border-b border-brand-hairline py-4">
                  <dt className="eyebrow">{spec.label}</dt>
                  <dd className="mt-1 text-base text-brand-ink">{spec.value}</dd>
                </div>
              ))}
            </dl>
            <Button variant="outline" className="mt-8" render={<Link href={`/products/${hero.slug}`} />}>
              Configure this bag
            </Button>
          </div>
        </div>
      </section>

      {/* PROCESS + WHOLESALE PRICING */}
      <section id="pricing" className="container-page section" aria-labelledby="process-heading">
        <SectionHeading
          eyebrow="Wholesale ordering"
          title={<span id="process-heading">Four steps, and the price is already on the page.</span>}
          lead="No sales call to find out what it costs. Configure, send artwork, approve the proof, receive."
        />
        <div className="mt-10">
          <HowItWorks />
        </div>
        <div className="mt-16 grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <Eyebrow className="mb-4">Price breaks</Eyebrow>
            <h3 className="type-h3">Per bag, by size and quantity.</h3>
            <p className="mt-3 text-base leading-body text-brand-ink-2">
              {formatQty(hero.pricingTiers[0].minQty)} and {formatQty(hero.pricingTiers[hero.pricingTiers.length - 1].minQty)} pieces per
              design are priced here. Anything else is quoted individually, {QUOTE_CTA.responseTime}.
            </p>
          </div>
          <div className="lg:col-span-8">
            <WholesalePricing product={hero} />
          </div>
        </div>
      </section>

      {/* CUSTOM BRANDING */}
      <section className="container-page pb-(--space-section)" aria-labelledby="branding-heading">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:order-2 lg:col-span-5">
            <Eyebrow className="mb-4">Custom branding</Eyebrow>
            <h2 id="branding-heading" className="type-h2">
              Your artwork, proofed before anything prints.
            </h2>
            <p className="mt-4 text-base leading-body text-brand-ink-2">
              Send a logo or full artwork with your quote request. {PROOF_POLICY.detail} {PROOF_POLICY.productionStart}
            </p>
            <dl className="mt-6 divide-y divide-brand-hairline border-y border-brand-hairline text-base">
              {[
                { k: "Files", v: "PNG, JPG, PDF, AI or EPS, up to 25 MB. Vector prints sharpest." },
                { k: "Colours", v: "Upload what you have — production review sets the colour separation; you approve the proof." },
                { k: "Base colours", v: hero.colors.map((c) => c.label).join(" or ") },
                { k: "No artwork yet?", v: "Request a quote anyway and say so. The artwork team will tell you what is possible." },
              ].map((row) => (
                <div key={row.k} className="grid grid-cols-[7rem_1fr] gap-4 py-3">
                  <dt className="text-brand-ink-muted">{row.k}</dt>
                  <dd className="text-brand-ink">{row.v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="lg:order-1 lg:col-span-7">
            <PhotoStage image={hero.images[4] ?? null} ratio="16/9" bagColor={black?.swatch} showLogo label={hero.images[4]?.alt} className="lg:aspect-[4/3]" illustrationClassName="w-2/5" />
          </div>
        </div>
      </section>

      <FactoryBand />

      {/* More products — only when the catalog has more than the hero. */}
      {products.length > 1 && (
        <section className="container-page section-tight" aria-labelledby="products-heading">
          <SectionHeading title={<span id="products-heading">Products</span>} />
          <div className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {/* FAQ */}
      <section className="container-page section-tight" aria-labelledby="faq-heading">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <Eyebrow className="mb-4">FAQ</Eyebrow>
            <h2 id="faq-heading" className="type-h2">
              The questions operators ask first.
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
            <FAQAccordion items={FAQ_ITEMS.slice(0, 6)} />
          </div>
        </div>
      </section>

      <FinalCTA />
    </>
  );
}
