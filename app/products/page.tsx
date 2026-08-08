import type { Metadata } from "next";
import { PRODUCTS } from "@/config/products";
import { ProductCard } from "@/components/landing/sections";

export const metadata: Metadata = {
  title: "All Products — Custom Non-Woven Bags",
  description:
    "Custom non-woven takeout, carryout and catering bags with logo printing and volume pricing. Configure and order online; ships to the US and Canada.",
  alternates: { canonical: "/products" },
};

export default function ProductsPage() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl sm:text-4xl" style={{ fontWeight: 600 }}>
        Products
      </h1>
      <p className="mt-2 max-w-lg text-ink-3">
        Every bag configures online — size, color, printing, quantity — with the price on screen. Custom
        specs beyond these go through the quote form.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PRODUCTS.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
