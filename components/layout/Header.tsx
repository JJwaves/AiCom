"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ANNOUNCEMENT, BUSINESS } from "@/config/business";
import { useCart } from "@/lib/cart/cart-context";

/**
 * N1b nav — wordmark left · links center · cart + primary CTA right.
 * Single hairline bottom border; minimal nav on /lp/* landing pages.
 */

const NAV_LINKS = [
  { href: "/products", label: "Products" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/bulk-takeout-bags", label: "Bulk pricing" },
  { href: "/custom-bags", label: "Custom manufacturing" },
  { href: "/faq", label: "FAQ" },
];

export function Header() {
  const pathname = usePathname();
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  const isLanding = pathname?.startsWith("/lp/");

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/90 backdrop-blur-sm">
      {ANNOUNCEMENT.enabled && !isLanding && (
        <div className="border-b border-rule bg-graphite text-center">
          <Link
            href={ANNOUNCEMENT.href}
            className="label-mono inline-block px-4 py-2 !text-graphite-muted hover:!text-graphite-ink"
          >
            {ANNOUNCEMENT.text}
          </Link>
        </div>
      )}

      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2 no-underline">
          <span className="font-display text-lg font-600 tracking-tight text-ink" style={{ fontWeight: 600 }}>
            {BUSINESS.DISPLAY_NAME}
          </span>
          <span className="label-mono hidden sm:inline">Factory direct</span>
        </Link>

        {!isLanding && (
          <nav aria-label="Main" className="hidden items-center gap-6 lg:flex">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm font-medium transition-colors hover:text-accent ${
                  pathname === l.href ? "text-accent" : "text-ink-2"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/cart" className="btn btn--secondary relative !px-3 text-sm" aria-label={`Cart, ${count} items`}>
            Cart
            {count > 0 && (
              <span
                className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 font-mono text-[11px] font-semibold text-accent-ink"
                aria-hidden="true"
              >
                {count}
              </span>
            )}
          </Link>
          <Link href="/products/custom-non-woven-takeout-bags" className="btn btn--primary hidden text-sm sm:inline-flex">
            Shop takeout bags
          </Link>
          {!isLanding && (
            <button
              type="button"
              className="btn btn--secondary !px-3 text-sm lg:hidden"
              aria-expanded={open}
              aria-controls="mobile-nav"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "Close" : "Menu"}
            </button>
          )}
        </div>
      </div>

      {/* Mobile nav */}
      {open && !isLanding && (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-rule bg-paper lg:hidden">
          <ul className="mx-auto max-w-6xl px-4 py-2 sm:px-6">
            {NAV_LINKS.map((l) => (
              <li key={l.href} className="border-b border-rule last:border-b-0">
                <Link
                  href={l.href}
                  className="block py-3 text-sm font-medium text-ink-2 hover:text-accent"
                  onClick={() => setOpen(false)}
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li className="py-3">
              <Link
                href="/products/custom-non-woven-takeout-bags"
                className="btn btn--primary w-full text-sm"
                onClick={() => setOpen(false)}
              >
                Shop takeout bags
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
