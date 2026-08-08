import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCTS } from "@/config/products";
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
  title: "Custom Non-Woven Takeout Bags, Factory Direct",
  description:
    "Custom non-woven takeout bags for restaurants, cafes and food businesses. Add your logo, choose your quantity, see the price, and order online. Ships to the US and Canada.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      {/* HERO — Workbench: headline left, live pricing panel (product in use) right */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <h1 className="text-4xl leading-[1.05] sm:text-5xl" style={{ fontWeight: 600 }}>
              Custom takeout bags, direct from the factory.
            </h1>
            <p className="mt-4 max-w-lg text-lg text-ink-2">
              Custom non-woven bags for restaurants, cafes and food businesses. Add your logo, choose your
              quantity, and order online.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/products/custom-non-woven-takeout-bags" className="btn btn--primary">
                Shop takeout bags
              </Link>
              <Link href="/bulk-takeout-bags" className="btn btn--secondary">
                See volume pricing
              </Link>
            </div>
          </div>
          <PricingDemo />
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
          Four formats cover most takeout counters. Every one configures the same way: size, color, printing,
          quantity — price on screen the whole time.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRODUCTS.map((p) => (
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
          Four steps, no sales calls required. Your artwork gets a proof before anything prints.
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
          body="Delivery drivers, takeout counters, catering drop-offs — your bag travels further than your dining room. Durable non-woven fabric holds containers upright and gets reused, so the logo keeps circulating."
          bullets={[
            "Wide gussets sized for takeout containers",
            "1- and 2-color logo printing with proof approval",
            "Volume pricing that drops at 1,000 / 2,500 / 5,000+ units",
          ]}
          cta="Customize your bags"
          href="/restaurant-takeout-bags"
        />
        <UseCaseSection
          reverse
          title="For coffee shops & cafes: small orders, big brand surface"
          body="Pastry boxes, drink carriers, weekend pastry runs. The cafe carryout format is sized for smaller orders and prints beautifully with a single-color logo."
          bullets={[
            "Compact sizes that fit drink carriers and pastry boxes",
            "Kraft, white, black and custom colors",
            "Reusable — your customers carry it back in",
          ]}
          cta="Create your bag"
          href="/coffee-shop-bags"
          illustrationColor="oklch(75% 0.06 70)"
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
