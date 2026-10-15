"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ANNOUNCEMENT, BUSINESS, QUOTE_CTA, isCheckoutEnabled } from "@/config/business";
import { useCart } from "@/lib/cart/cart-context";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/**
 * Site header — DESIGN.md §4 "Navigation".
 * Transparent on canvas, 64px, wordmark left, ≤6 links, ONE button. A hairline
 * appears once the page scrolls. Mobile: full-height sheet with the quote CTA
 * pinned to the bottom. The cart link only exists when checkout is enabled
 * (Phase 2); Phase 1 is quote-led. /lp/* ad pages keep a minimal header.
 */

const NAV_LINKS = [
  { href: "/products/custom-insulated-takeout-bags", label: "Takeout bags" },
  { href: "/custom-logo-takeout-bags", label: "Custom printing" },
  { href: "/bulk-takeout-bags", label: "Wholesale pricing" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
];

export function Header() {
  const pathname = usePathname();
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const isLanding = pathname?.startsWith("/lp/");
  const checkout = isCheckoutEnabled();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isActive = (href: string) => pathname === href || (href !== "/" && pathname?.startsWith(`${href}/`));

  return (
    <header
      className={`sticky top-0 z-40 bg-brand-canvas transition-[border-color] duration-(--duration-fast) ${
        scrolled ? "border-b border-brand-hairline" : "border-b border-transparent"
      }`}
    >
      {ANNOUNCEMENT.enabled && !isLanding && (
        <div className="bg-brand-surface-ink text-center">
          <Link href={ANNOUNCEMENT.href} className="inline-block px-4 py-2 text-sm text-brand-canvas-on-ink hover:underline">
            {ANNOUNCEMENT.text}
          </Link>
        </div>
      )}

      <div className="container-page flex h-16 items-center justify-between gap-6">
        <Link href="/" className="flex items-baseline gap-3 no-underline">
          <span className="font-heading text-xl font-medium tracking-tight text-brand-ink">{BUSINESS.DISPLAY_NAME}</span>
          <span className="eyebrow hidden sm:inline">Factory direct</span>
        </Link>

        {!isLanding && (
          <nav aria-label="Main" className="hidden items-center gap-7 lg:flex">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={isActive(l.href) ? "page" : undefined}
                className={`text-sm font-medium transition-colors hover:text-brand-ink ${
                  isActive(l.href) ? "text-brand-ink underline decoration-brand-accent decoration-2 underline-offset-8" : "text-brand-ink-2"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2 sm:gap-3">
          {checkout && (
            <Button
              variant="outline"
              size="sm"
              className="relative"
              render={<Link href="/cart" aria-label={`Cart, ${count} items`} />}
            >
              Cart
              {count > 0 && (
                <span
                  className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-accent-ink px-1 text-xs font-semibold text-white tabular-nums"
                  aria-hidden="true"
                >
                  {count}
                </span>
              )}
            </Button>
          )}
          <Button size="sm" className="hidden sm:inline-flex" render={<Link href={QUOTE_CTA.href} />}>
            {QUOTE_CTA.label}
          </Button>

          {!isLanding && (
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger render={<Button variant="outline" size="sm" className="lg:hidden" aria-label="Open menu" />}>
                Menu
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-sm" showCloseButton>
                <SheetHeader className="border-b border-brand-hairline px-6 py-5 text-left">
                  <SheetTitle className="font-heading text-xl font-medium text-brand-ink">{BUSINESS.DISPLAY_NAME}</SheetTitle>
                  <SheetDescription className="text-sm text-brand-ink-muted">{BUSINESS.TAGLINE}</SheetDescription>
                </SheetHeader>
                <nav aria-label="Mobile" className="flex-1 overflow-y-auto px-6">
                  <ul>
                    {NAV_LINKS.map((l) => (
                      <li key={l.href} className="border-b border-brand-hairline">
                        <Link
                          href={l.href}
                          onClick={() => setOpen(false)}
                          className="block py-4 font-heading text-xl font-medium text-brand-ink hover:text-brand-accent-ink"
                        >
                          {l.label}
                        </Link>
                      </li>
                    ))}
                    <li className="border-b border-brand-hairline">
                      <Link href="/contact" onClick={() => setOpen(false)} className="block py-4 text-base text-brand-ink-2 hover:text-brand-ink">
                        Contact
                      </Link>
                    </li>
                    {checkout && (
                      <li className="border-b border-brand-hairline">
                        <Link href="/cart" onClick={() => setOpen(false)} className="block py-4 text-base text-brand-ink-2 hover:text-brand-ink">
                          Cart{count > 0 ? ` (${count})` : ""}
                        </Link>
                      </li>
                    )}
                  </ul>
                </nav>
                <div className="border-t border-brand-hairline p-6">
                  <Button variant="accent" size="lg" className="w-full" render={<Link href={QUOTE_CTA.href} onClick={() => setOpen(false)} />}>
                    {QUOTE_CTA.label}
                  </Button>
                  <p className="mt-3 text-center text-sm text-brand-ink-muted">Pricing replies {QUOTE_CTA.responseTime}.</p>
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </div>
    </header>
  );
}
