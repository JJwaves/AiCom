import Link from "next/link";
import { VALUE_PROPS } from "@/config/business";
import { baseUnitPriceCents, startingUnitPriceCents } from "@/modules/pricing";
import { formatQty, formatUnitPrice } from "@/lib/format";
import type { Product } from "@/types/commerce";
import { BagIllustration } from "@/components/product/BagIllustration";

/* ---------------- Trust / value bar ---------------- */

export function TrustBar() {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 border-y border-rule py-4">
      {VALUE_PROPS.map((v) => (
        <li key={v.id} className="label-mono flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          {v.label}
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Product card ---------------- */

export function ProductCard({ product }: { product: Product }) {
  const from = startingUnitPriceCents(product);
  const base = baseUnitPriceCents(product);
  return (
    <Link
      href={`/products/${product.slug}`}
      className="surface group flex flex-col p-5 no-underline transition-colors hover:border-accent"
    >
      <div className="flex items-center justify-center bg-paper-2 py-6" style={{ borderRadius: "6px" }}>
        <BagIllustration className="w-36" showLogo title={`${product.title} illustration`} />
      </div>
      <h3 className="mt-4 text-lg" style={{ fontWeight: 600 }}>
        {product.title}
      </h3>
      <p className="mt-1 flex-1 text-sm text-ink-3">{product.positioning}</p>
      <div className="mt-4 flex items-baseline justify-between border-t border-rule pt-3">
        <p className="font-mono text-sm text-ink">
          {formatUnitPrice(from, product.currency)}–{formatUnitPrice(base, product.currency)}
          <span className="text-ink-3">/bag</span>
        </p>
        <span className="text-sm font-medium text-accent group-hover:underline">Configure →</span>
      </div>
      <p className="mt-1 font-mono text-[11px] text-ink-3">
        MOQ {formatQty(product.minQuantity)} · {product.allowCustomQuantity ? "volume priced" : "digital proof included"}
      </p>
    </Link>
  );
}

/* ---------------- How it works ---------------- */

const STEPS = [
  { n: "01", title: "Configure", body: "Choose size, color and quantity." },
  { n: "02", title: "Upload artwork", body: "Upload your restaurant logo or bag design." },
  {
    n: "03",
    title: "Approve your proof",
    body: "We prepare a digital proof for your approval. Production starts after artwork approval.",
  },
  {
    n: "04",
    title: "We manufacture & ship",
    body: "Production typically takes 15–30 days after proof approval, then it ships to your business.",
  },
];

export function HowItWorks({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={`grid gap-4 ${compact ? "sm:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
      {STEPS.map((s) => (
        <li key={s.n} className="surface p-5">
          <p className="font-mono text-sm text-accent">{s.n}</p>
          <h3 className="mt-2 text-base" style={{ fontWeight: 600 }}>
            {s.title}
          </h3>
          <p className="mt-1 text-sm text-ink-3">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- Factory band (the page's one dark beat) ---------------- */

export function FactoryBand() {
  return (
    <section className="bg-graphite">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="max-w-xl text-3xl text-graphite-ink" style={{ fontWeight: 600 }}>
          From our factory to your restaurant.
        </h2>
        <p className="mt-4 max-w-xl text-graphite-muted">
          No distributor layer. You configure the bag, the factory makes it, and it ships to your door. That&apos;s
          the whole supply chain — which is why volume pricing lands where it does.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Production line", note: "Factory photo slot — replace with real photography" },
            { label: "Printing process", note: "Logo printing in progress — replace with real photography" },
            { label: "Quality inspection", note: "QC and packing — replace with real photography" },
          ].map((s) => (
            <figure
              key={s.label}
              className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed p-4 text-center"
              style={{ borderColor: "oklch(40% 0.02 260)" }}
            >
              <figcaption className="label-mono !text-graphite-muted">{s.label}</figcaption>
              <p className="text-xs" style={{ color: "oklch(55% 0.015 258)" }}>
                {s.note}
              </p>
            </figure>
          ))}
        </div>
        <div className="mt-8">
          <Link href="/about" className="btn btn--secondary !border-graphite-2 !text-graphite-ink hover:!border-accent">
            About the factory
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Use-case section ---------------- */

export function UseCaseSection({
  title,
  body,
  bullets,
  cta,
  href,
  reverse = false,
  illustrationColor,
}: {
  title: string;
  body: string;
  bullets: string[];
  cta: string;
  href: string;
  reverse?: boolean;
  illustrationColor?: string;
}) {
  return (
    <div className={`grid items-center gap-8 lg:grid-cols-2 ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
      <div>
        <h2 className="text-2xl sm:text-3xl" style={{ fontWeight: 600 }}>
          {title}
        </h2>
        <p className="mt-3 text-ink-2">{body}</p>
        <ul className="mt-4 space-y-2">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm text-ink-2">
              <span aria-hidden="true" className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              {b}
            </li>
          ))}
        </ul>
        <Link href={href} className="btn btn--primary mt-6">
          {cta}
        </Link>
      </div>
      <div className="surface flex items-center justify-center p-10">
        <BagIllustration className="w-56" showLogo bodyColor={illustrationColor} title={`${title} — bag illustration`} />
      </div>
    </div>
  );
}

/* ---------------- FAQ accordion ---------------- */

export function FAQAccordion({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="divide-y divide-rule border-y border-rule">
      {items.map((item) => (
        <details key={item.q} className="group py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium text-ink [&::-webkit-details-marker]:hidden">
            {item.q}
            <span aria-hidden="true" className="font-mono text-ink-3 transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

/* ---------------- Final CTA ---------------- */

export function FinalCTA({
  heading = "Put your logo on the bag.",
  sub = "Configure a bag, see the price, order online. A digital proof comes to you for approval before anything prints.",
  cta = "Shop insulated takeout bags",
  href = "/products/custom-insulated-takeout-bags",
}: {
  heading?: string;
  sub?: string;
  cta?: string;
  href?: string;
}) {
  return (
    <section className="border-t border-rule">
      <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
        <h2 className="mx-auto max-w-lg text-3xl" style={{ fontWeight: 600 }}>
          {heading}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-ink-3">{sub}</p>
        <Link href={href} className="btn btn--primary mt-6">
          {cta}
        </Link>
      </div>
    </section>
  );
}
