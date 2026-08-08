import type { Metadata } from "next";
import Link from "next/link";
import { BUSINESS } from "@/config/business";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact our customer service team about orders, artwork, shipping or custom manufacturing.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl sm:text-4xl" style={{ fontWeight: 600 }}>
        Contact
      </h1>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="surface p-6">
          <p className="label-mono">Email</p>
          <p className="mt-2 font-mono text-sm text-ink">{BUSINESS.CUSTOMER_SERVICE_EMAIL}</p>
          <p className="mt-2 text-xs text-ink-3">Orders, artwork, shipping questions. Replies within one business day.</p>
        </div>
        <div className="surface p-6">
          <p className="label-mono">Phone</p>
          <p className="mt-2 font-mono text-sm text-ink">{BUSINESS.CUSTOMER_SERVICE_PHONE}</p>
          <p className="mt-2 text-xs text-ink-3">Business hours, {BUSINESS.MARKETS.join(" & ")} time zones.</p>
        </div>
      </div>
      <div className="surface mt-4 p-6">
        <p className="label-mono">Custom pricing</p>
        <p className="mt-2 text-sm text-ink-2">
          Custom sizes, colors or quantities go through the quote form — it routes straight to the pricing team
          with everything they need.
        </p>
        <Link href="/request-quote" className="btn btn--primary mt-4 text-sm">
          Request custom pricing
        </Link>
      </div>
      <p className="mt-6 text-xs text-ink-3">
        Checking an existing order? See <Link href="/order-status" className="underline hover:text-accent">order status</Link>.
      </p>
    </section>
  );
}
