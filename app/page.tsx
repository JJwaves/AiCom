import type { Metadata } from "next";
import Link from "next/link";
import { getHeroCatalogProduct, listCatalogProducts } from "@/lib/commerce/catalog";
import { resolveHomepageHero } from "@/lib/experiments/server";
import { FAQ_ITEMS } from "@/config/faq";
import { PricingDemo } from "@/components/landing/PricingDemo";
import {
  FAQAccordion,
  FactoryBand,
  FinalCTA,
  HowItWorks,
  ProductCard,
  TrustBar,
  UseCaseSection,
} from "@/components/landing/sections";

export const metadata: Metadata = {
  title: "Custom Insulated Takeout Bags, Factory Direct",
  description:
    "Custom printed insulated takeout bags for restaurants, catering and food delivery. Two sizes, black or white, 5,000-piece minimum, digital proof before production. Ships within the United States.",
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const products = await listCatalogProducts();
  const hero = await getHeroCatalogProduct();
  /* Session 11: server-resolved hero copy experiment. Null override (the
   * default, and always when EXPERIMENT_ENGINE is off) = the copy below. */
  const heroCopy = (await resolveHomepageHero("/")).override;
  return (
    <>
      {/* HERO — Workbench: headline left, live pricing panel (product in use) right */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
          <div data-experiment={heroCopy ? "homepage.hero" : undefined}>
            <h1 className="text-4xl leading-[1.05] sm:text-5xl" style={{ fontWeight: 600 }}>
              {heroCopy?.headline ?? "Custom insulated takeout bags, direct from the factory."}
            </h1>
            <p className="mt-4 max-w-lg text-lg text-ink-2">
              {heroCopy?.subheadline ??
                "Custom printed insulated bags for restaurants, catering and food delivery. Upload your logo, choose your quantity, and order online."}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/products/custom-insulated-takeout-bags" className="btn btn--primary">
                {heroCopy?.ctaLabel ?? "Shop insulated takeout bags"}
              </Link>
              <Link href="/bulk-takeout-bags" className="btn btn--secondary">
                See pricing
              </Link>
            </div>
          </div>
          <PricingDemo product={hero} />
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <TrustBar />
      </div>

      {/* Products */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" aria-labelledby="popular-heading">
        <h2 id="popular-heading" className="text-2xl sm:text-3xl" style={{ fontWeight: 600 }}>
          Built for food businesses
        </h2>
        <p className="mt-2 max-w-lg text-ink-3">
          Insulated bags for restaurants, takeout, catering, bakeries and food delivery. Configure size, color and
          quantity, upload your artwork — the price is on screen the whole time.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6" aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-2xl sm:text-3xl" style={{ fontWeight: 600 }}>
          How ordering works
        </h2>
        <p className="mt-2 max-w-lg text-ink-3">
          Four steps, no sales calls required. A digital proof comes to you for approval before anything prints.
        </p>
        <div className="mt-8">
          <HowItWorks />
        </div>
      </section>

      {/* Factory-direct dark band */}
      <FactoryBand />

      {/* Use cases */}
      <section className="mx-auto max-w-6xl space-y-16 px-4 py-16 sm:px-6">
        <UseCaseSection
          title="For restaurants: every takeout order carries your brand"
          body="Delivery drivers, takeout counters, catering drop-offs — your bag travels further than your dining room. A PP laminated outer layer, non-woven middle layer and aluminium foil lining hold temperature on the way, and the printed logo keeps circulating."
          bullets={[
            "Large 26 × 26 × 17 cm and Extra Large 30 × 30 × 20 cm",
            "Custom logo printing with a digital proof before production",
            "5,000 or 10,000 pieces per design, priced on the page",
          ]}
          cta="Customize your bags"
          href="/restaurant-takeout-bags"
        />
        <UseCaseSection
          reverse
          title="For catering, bakeries and delivery: arrives the way it left"
          body="Catering drop-offs, bakery boxes and third-party delivery all spend time in transit. The foil lining is there for that trip, and your artwork is on the outside of it."
          bullets={[
            "Insulated construction for hot and cold orders",
            "Black or white base, your artwork printed on it",
            "Flat $100 U.S. shipping, charged once per order",
          ]}
          cta="Create your bag"
          href="/coffee-shop-bags"
          illustrationColor="oklch(97% 0 0)"
        />
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 pb-16 sm:px-6" aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="text-2xl sm:text-3xl" style={{ fontWeight: 600 }}>
          Questions restaurant owners ask
        </h2>
        <div className="mt-6">
          <FAQAccordion items={FAQ_ITEMS.slice(0, 6)} />
        </div>
        <p className="mt-4 text-sm text-ink-3">
          More in the <Link href="/faq" className="text-accent underline">full FAQ</Link>.
        </p>
      </section>

      <FinalCTA />
    </>
  );
}
