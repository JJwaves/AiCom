import type { Metadata } from "next";
import Link from "next/link";
import { BUSINESS, QUOTE_CTA, isCheckoutEnabled } from "@/config/business";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/landing/sections";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact us about wholesale pricing, artwork, shipping or custom manufacturing.",
  alternates: { canonical: "/contact" },
};

const placeholder = (v: string) => v.startsWith("[");

export default function ContactPage() {
  const channels = [
    { k: "Email", v: BUSINESS.CUSTOMER_SERVICE_EMAIL, note: "Quotes, artwork, shipping questions. Replies within one business day." },
    { k: "Phone", v: BUSINESS.CUSTOMER_SERVICE_PHONE, note: "Business hours, U.S. time zones." },
  ];
  return (
    <section className="container-page pt-10 pb-16 lg:pt-16 lg:pb-24">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <SectionHeading as="h1" eyebrow="Contact" title="Talk to the factory." lead="For pricing, the quote form is fastest — it reaches the pricing team with everything they need. For everything else:" />
        </div>
        <div className="lg:col-span-7">
          <dl className="divide-y divide-brand-hairline border-y border-brand-hairline">
            {channels.map((c) => (
              <div key={c.k} className="grid gap-2 py-6 sm:grid-cols-[8rem_1fr]">
                <dt className="eyebrow">{c.k}</dt>
                <dd>
                  <p className={`font-heading text-2xl font-medium ${placeholder(c.v) ? "text-brand-ink-muted" : "text-brand-ink"}`}>
                    {placeholder(c.v) ? "To be confirmed" : c.v}
                  </p>
                  <p className="mt-1 text-sm text-brand-ink-2">{c.note}</p>
                </dd>
              </div>
            ))}
            <div className="grid gap-2 py-6 sm:grid-cols-[8rem_1fr]">
              <dt className="eyebrow">Pricing</dt>
              <dd>
                <p className="text-base text-brand-ink">Custom sizes, colours or quantities go through the quote form.</p>
                <Button variant="accent" className="mt-4" render={<Link href={QUOTE_CTA.href} />}>
                  {QUOTE_CTA.label}
                </Button>
              </dd>
            </div>
          </dl>
          {isCheckoutEnabled() && (
            <p className="mt-6 text-sm text-brand-ink-muted">
              Checking an existing order? See{" "}
              <Link href="/order-status" className="underline underline-offset-3 hover:text-brand-ink">
                order status
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
