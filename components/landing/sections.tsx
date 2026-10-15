import Link from "next/link";
import { BUSINESS, PROOF_POLICY, QUOTE_CTA, VALUE_PROPS } from "@/config/business";
import { FLAT_US_SHIPPING_COPY } from "@/config/shipping";
import { baseUnitPriceCents, startingUnitPriceCents } from "@/modules/pricing";
import { formatQty, formatUnitPrice } from "@/lib/format";
import type { Product } from "@/types/commerce";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PhotoStage } from "@/components/product/PhotoStage";

/* ------------------------------------------------------------------------------------------
 * Section primitives — Premium Industrial Minimalism (DESIGN.md).
 * Photography first, one display size per viewport, hairlines not cards, no icon trios.
 * ---------------------------------------------------------------------------------------- */

export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`eyebrow ${className}`}>{children}</p>;
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  as: Tag = "h2",
  className = "",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={`max-w-2xl ${className}`}>
      {eyebrow && <Eyebrow className="mb-4">{eyebrow}</Eyebrow>}
      <Tag className={Tag === "h1" ? "type-h1" : Tag === "h2" ? "type-h2" : "type-h3"}>{title}</Tag>
      {lead && <p className="mt-4 text-lg leading-body text-brand-ink-2">{lead}</p>}
    </div>
  );
}

/* ---------------- Fact strip (replaces the dotted "trust bar") ---------------- */

/**
 * Four verifiable, structural facts in a ruled row. Values come from config so nothing here
 * is a marketing claim: MOQ, proof policy, production time, flat shipping.
 */
export function TrustBar() {
  const facts = [
    { k: "Minimum order", v: `${formatQty(BUSINESS.MOQ)} per design` },
    { k: "Before printing", v: PROOF_POLICY.headline },
    { k: "Production", v: BUSINESS.STANDARD_PRODUCTION_TIME },
    { k: "U.S. shipping", v: VALUE_PROPS.find((v) => v.id === "flat-shipping")?.label ?? FLAT_US_SHIPPING_COPY },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-6 border-y border-brand-hairline py-6 lg:grid-cols-4">
      {facts.map((f) => (
        <div key={f.k}>
          <dt className="eyebrow">{f.k}</dt>
          <dd className="mt-1.5 font-heading text-lg leading-snug text-brand-ink tabular">{f.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- Product card — the photograph IS the card ---------------- */

export function ProductCard({ product, priority = false }: { product: Product; priority?: boolean }) {
  const from = startingUnitPriceCents(product);
  const base = baseUnitPriceCents(product);
  const largestTier = product.pricingTiers[product.pricingTiers.length - 1];
  const black = product.colors.find((c) => c.id === "black") ?? product.colors[0];
  return (
    <Link href={`/products/${product.slug}`} className="group block no-underline">
      <PhotoStage
        image={product.images[0] ?? null}
        ratio="4/5"
        bagColor={black?.swatch}
        showLogo
        label={product.images[0]?.alt}
        priority={priority}
        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        className="transition-colors group-hover:bg-brand-secondary-soft"
      />
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-heading text-xl font-medium leading-snug text-brand-ink group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
            {product.title}
          </h3>
          <p className="mt-1 text-base text-brand-ink-2">{product.positioning}</p>
        </div>
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm tabular">
        <div className="flex gap-2">
          <dt className="text-brand-ink-muted">From</dt>
          <dd className="font-medium text-brand-ink">
            {formatUnitPrice(from, product.currency)}/bag at {formatQty(largestTier.minQty)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-brand-ink-muted">MOQ</dt>
          <dd className="text-brand-ink-2">{formatQty(product.minQuantity)}</dd>
        </div>
        {base !== from && (
          <div className="flex gap-2">
            <dt className="text-brand-ink-muted">Up to</dt>
            <dd className="text-brand-ink-2">{formatUnitPrice(base, product.currency)}/bag</dd>
          </div>
        )}
      </dl>
    </Link>
  );
}

/* ---------------- How it works — a numbered, ruled sequence, not four cards ---------------- */

export const ORDER_STEPS = [
  { n: "01", title: "Configure", body: "Choose size, colour and quantity. The price is on the page." },
  { n: "02", title: "Send artwork", body: "Upload your logo with the quote request, or tell us what you have." },
  { n: "03", title: "Approve the proof", body: `${PROOF_POLICY.detail} ${PROOF_POLICY.productionStart}` },
  { n: "04", title: "We make and ship", body: `${PROOF_POLICY.leadTime} Then it ships to your U.S. address.` },
] as const;

export function HowItWorks({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={`grid gap-y-8 border-t border-brand-hairline ${compact ? "sm:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
      {ORDER_STEPS.map((s) => (
        <li key={s.n} className="border-b border-brand-hairline pt-6 pb-6 sm:border-b-0 sm:pr-8">
          <p className="font-heading text-4xl leading-none text-brand-accent tabular">{s.n}</p>
          <h3 className="mt-5 font-heading text-xl font-medium leading-snug text-brand-ink">{s.title}</h3>
          <p className="mt-2 text-base leading-body text-brand-ink-2">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- Factory band — three photo stages + one statement ---------------- */

export function FactoryBand() {
  return (
    <section className="bg-brand-canvas-2">
      <div className="container-page section-tight">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-5">
            <Eyebrow className="mb-4">From the factory</Eyebrow>
            <h2 className="type-h2">No distributor between the line and your door.</h2>
            <p className="mt-4 text-lg leading-body text-brand-ink-2">
              You configure the bag, the factory makes it, and it ships to your business. That is the whole supply chain,
              and it is why volume pricing lands where it does.
            </p>
            <Button variant="outline" className="mt-8" render={<Link href="/about" />}>
              About the factory
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-3 lg:col-span-7 lg:gap-4">
            {[
              { label: "Production line", ratio: "3/4" as const },
              { label: "Logo printing in progress", ratio: "3/4" as const },
              { label: "QC and packing", ratio: "3/4" as const },
            ].map((s) => (
              <PhotoStage key={s.label} ratio={s.ratio} tone="kraft" label={s.label} illustrationClassName="w-7/12 opacity-60" caption={false} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Use-case story — 7/5 split, photograph first ---------------- */

export function UseCaseSection({
  eyebrow,
  title,
  body,
  bullets,
  cta,
  href,
  reverse = false,
  illustrationColor,
  photoLabel,
}: {
  eyebrow?: string;
  title: string;
  body: string;
  bullets: string[];
  cta: string;
  href: string;
  reverse?: boolean;
  illustrationColor?: string;
  photoLabel?: string;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-16">
      <div className={`lg:col-span-7 ${reverse ? "lg:order-2" : ""}`}>
        <PhotoStage ratio="4/5" tone={reverse ? "kraft" : "canvas"} bagColor={illustrationColor} showLogo label={photoLabel ?? title} className="lg:aspect-[5/4]" />
      </div>
      <div className="lg:col-span-5">
        {eyebrow && <Eyebrow className="mb-4">{eyebrow}</Eyebrow>}
        <h2 className="type-h2">{title}</h2>
        <p className="mt-4 text-base leading-body text-brand-ink-2">{body}</p>
        <ul className="mt-6 divide-y divide-brand-hairline border-y border-brand-hairline">
          {bullets.map((b) => (
            <li key={b} className="py-3 text-sm leading-normal text-brand-ink">
              {b}
            </li>
          ))}
        </ul>
        <Button variant="outline" className="mt-8" render={<Link href={href} />}>
          {cta}
        </Button>
      </div>
    </div>
  );
}

/* ---------------- FAQ accordion ---------------- */

export function FAQAccordion({ items }: { items: { q: string; a: string }[] }) {
  return (
    <Accordion className="border-t border-brand-hairline">
      {items.map((item, i) => (
        <AccordionItem key={item.q} value={`faq-${i}`}>
          <AccordionTrigger>{item.q}</AccordionTrigger>
          <AccordionContent>
            <p>{item.a}</p>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

/* ---------------- Final CTA — the page's one accent button ---------------- */

export function FinalCTA({
  heading = "Put your logo on the bag.",
  sub = `Tell us the size, quantity and artwork. Pricing comes back ${QUOTE_CTA.responseTime}, and a digital proof before anything prints.`,
  cta = QUOTE_CTA.label,
  href = QUOTE_CTA.href,
  accent = false,
}: {
  heading?: string;
  sub?: string;
  cta?: string;
  href?: string;
  /** Terracotta fill — only on pages whose hero does not already carry the accent CTA. */
  accent?: boolean;
}) {
  return (
    <section className="border-t border-brand-hairline">
      <div className="container-page section grid gap-8 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-8">
          <h2 className="type-display max-w-3xl">{heading}</h2>
          <p className="mt-5 max-w-xl text-lg leading-body text-brand-ink-2">{sub}</p>
        </div>
        <div className="lg:col-span-4 lg:justify-self-end">
          <Button variant={accent ? "accent" : "default"} size="lg" render={<Link href={href} />}>
            {cta}
          </Button>
          <p className="mt-3 text-sm text-brand-ink-muted">No account, no sales call to start.</p>
        </div>
      </div>
    </section>
  );
}
