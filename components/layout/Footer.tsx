import Link from "next/link";
import { BUSINESS, QUOTE_CTA, isCheckoutEnabled } from "@/config/business";
import { FLAT_US_SHIPPING_COPY } from "@/config/shipping";
import { Button } from "@/components/ui/button";

/**
 * Footer — the page's one dark band (DESIGN.md §5: full-bleed is for photography and the
 * dark footer only). Wordmark + a last quote CTA, three link groups, legal line.
 */

const GROUPS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Products",
    links: [
      { href: "/products/custom-insulated-takeout-bags", label: "Custom insulated takeout bags" },
      { href: "/custom-logo-takeout-bags", label: "Custom logo printing" },
      { href: "/bulk-takeout-bags", label: "Wholesale pricing" },
      { href: "/custom-bags", label: "Custom manufacturing" },
    ],
  },
  {
    heading: "For your business",
    links: [
      { href: "/restaurant-takeout-bags", label: "Restaurants" },
      { href: "/coffee-shop-bags", label: "Coffee shops & cafés" },
      { href: "/how-it-works", label: "How ordering works" },
      { href: QUOTE_CTA.href, label: QUOTE_CTA.label },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/about", label: "About the factory" },
      { href: "/faq", label: "FAQ" },
      { href: "/contact", label: "Contact" },
      ...(isCheckoutEnabled() ? [{ href: "/order-status", label: "Order status" }] : []),
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-(--space-section) bg-brand-surface-ink text-brand-canvas-on-ink">
      <div className="container-page py-16 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <p className="font-heading text-3xl font-medium tracking-tight">{BUSINESS.DISPLAY_NAME}</p>
            <p className="mt-3 max-w-xs text-base text-brand-canvas-on-ink-muted">{BUSINESS.TAGLINE}</p>
            <p className="mt-6 text-sm text-brand-canvas-on-ink-muted">
              Ships within the United States · {FLAT_US_SHIPPING_COPY}
            </p>
            <Button variant="inverse" className="mt-8" render={<Link href={QUOTE_CTA.href} />}>
              {QUOTE_CTA.label}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {GROUPS.map((g) => (
              <nav key={g.heading} aria-label={g.heading}>
                <p className="eyebrow mb-4 text-brand-canvas-on-ink-muted">{g.heading}</p>
                <ul className="space-y-3">
                  {g.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="text-sm text-brand-canvas-on-ink/90 hover:text-white hover:underline">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <div className="mt-16 flex flex-col gap-4 border-t border-white/15 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-brand-canvas-on-ink-muted">
            © {new Date().getFullYear()} {BUSINESS.BRAND_NAME}. All rights reserved.
          </p>
          <ul className="flex flex-wrap gap-5">
            {[
              { href: "/shipping-policy", label: "Shipping" },
              { href: "/return-policy", label: "Returns" },
              { href: "/privacy", label: "Privacy" },
              { href: "/terms", label: "Terms" },
            ].map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-xs text-brand-canvas-on-ink-muted hover:text-white hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
