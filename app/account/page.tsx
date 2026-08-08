import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Account",
  description: "Customer accounts and reordering.",
  robots: { index: false },
};

/**
 * Account stub. Guest checkout is the MVP path (no forced signup).
 * Post-MVP: Shopify customer accounts power order history, saved artwork
 * and one-click reorder — the order metadata model already records
 * everything reorder needs (see types/commerce.ts + README "Reorder").
 */
export default function AccountPage() {
  return (
    <section className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
      <h1 className="text-3xl" style={{ fontWeight: 600 }}>
        Accounts are coming
      </h1>
      <p className="mx-auto mt-3 max-w-md text-ink-2">
        Checkout works without an account. Accounts arrive with reordering — previous orders, saved artwork and
        one-click “reorder my bags.” Until then, reorder from your confirmation email or contact us with your
        order number.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/products" className="btn btn--primary">
          Shop products
        </Link>
        <Link href="/contact" className="btn btn--secondary">
          Contact us
        </Link>
      </div>
    </section>
  );
}
