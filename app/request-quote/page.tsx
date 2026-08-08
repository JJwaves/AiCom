import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { QuoteClient } from "./quote-client";

export const metadata: Metadata = {
  title: "Request Custom Pricing",
  description:
    "Custom dimensions, Pantone colors, special handles or non-standard quantities — send the spec and get factory-direct pricing within one business day.",
  alternates: { canonical: "/request-quote" },
};

export default function RequestQuotePage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl sm:text-4xl" style={{ fontWeight: 600 }}>
        Request custom pricing
      </h1>
      <p className="mt-3 max-w-lg text-ink-2">
        For anything the online configurator can&apos;t price: custom dimensions, matched colors, special
        handles, or quantities outside the standard tiers. Standard configurations are faster to{" "}
        <Link href="/products" className="text-accent underline">
          order directly
        </Link>
        .
      </p>
      <div className="mt-8">
        <Suspense>
          <QuoteClient />
        </Suspense>
      </div>
    </section>
  );
}
