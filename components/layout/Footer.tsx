import Link from "next/link";
import { BUSINESS } from "@/config/business";

/** Ft1 mast-headed footer — wordmark mast + three compact link groups + legal line. */

const GROUPS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Shop",
    links: [
      { href: "/products", label: "All products" },
      { href: "/products/custom-insulated-takeout-bags", label: "Custom insulated takeout bags" },
      { href: "/bulk-takeout-bags", label: "Bulk pricing" },
      { href: "/request-quote", label: "Request a quote" },
    ],
  },
  {
    heading: "For your business",
    links: [
      { href: "/restaurant-takeout-bags", label: "Restaurants" },
      { href: "/coffee-shop-bags", label: "Coffee shops & cafes" },
      { href: "/custom-logo-takeout-bags", label: "Custom logo bags" },
      { href: "/custom-bags", label: "Custom manufacturing" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/about", label: "About the factory" },
      { href: "/how-it-works", label: "How ordering works" },
      { href: "/faq", label: "FAQ" },
      { href: "/contact", label: "Contact" },
      { href: "/order-status", label: "Order status" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-rule bg-paper-2">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.2fr_2fr]">
          <div>
            <p className="font-display text-xl text-ink" style={{ fontWeight: 600 }}>
              {BUSINESS.DISPLAY_NAME}
            </p>
            <p className="mt-2 max-w-xs text-sm text-ink-3">{BUSINESS.TAGLINE}</p>
            <p className="label-mono mt-4">Ships within the U.S. · flat $100 per order</p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {GROUPS.map((g) => (
              <nav key={g.heading} aria-label={g.heading}>
                <p className="label-mono mb-3">{g.heading}</p>
                <ul className="space-y-2">
                  {g.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="text-sm text-ink-2 hover:text-accent">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-rule pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-3">
            © {new Date().getFullYear()} {BUSINESS.BRAND_NAME}. All rights reserved.
          </p>
          <ul className="flex flex-wrap gap-4">
            {[
              { href: "/shipping-policy", label: "Shipping" },
              { href: "/return-policy", label: "Returns" },
              { href: "/privacy", label: "Privacy" },
              { href: "/terms", label: "Terms" },
            ].map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-xs text-ink-3 hover:text-accent">
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
