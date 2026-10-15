import type { Metadata } from "next";
import { listCatalogProducts } from "@/lib/commerce/catalog";
import { QUOTE_CTA } from "@/config/business";
import { FinalCTA, ProductCard, SectionHeading } from "@/components/landing/sections";

export const metadata: Metadata = {
  title: "Products — Custom Insulated Takeout Bags",
  description:
    "Custom printed insulated takeout bags for restaurants, catering and food delivery. Configure size, colour and quantity, see wholesale pricing, and request a quote. Ships within the United States.",
  alternates: { canonical: "/products" },
};

export default async function ProductsPage() {
  const products = await listCatalogProducts();
  return (
    <>
      <section className="container-page pt-10 pb-16 lg:pt-16 lg:pb-24">
        <SectionHeading
          as="h1"
          eyebrow="Products"
          title="Every bag configures online, with the price on the page."
          lead={`Size, colour, printing, quantity. Specs beyond these are quoted individually, ${QUOTE_CTA.responseTime}.`}
        />
        <div className={`mt-10 grid gap-x-6 gap-y-10 sm:grid-cols-2 ${products.length > 2 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
          {products.map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i === 0} />
          ))}
        </div>
      </section>
      <FinalCTA accent />
    </>
  );
}
