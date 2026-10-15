"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { captureVisit } from "@/lib/attribution/attribution";
import { confirmPendingPurchase } from "@/lib/analytics/purchase";
import { setConsent, track } from "@/lib/analytics/track";

/**
 * Analytics + attribution + consent infrastructure.
 *
 * - Captures campaign attribution on every route change.
 * - Fires page_view into the dataLayer.
 * - Loads GTM / gtag (GA4 + Google Ads) / Meta Pixel only when (a) their env
 *   IDs exist and (b) the visitor has granted the RELEVANT consent. No dark
 *   patterns: the banner is dismissible, declines are respected, and nothing
 *   loads before consent.
 * - Consent has two axes: `analytics` gates measurement (GA4), `advertising`
 *   gates the ad platforms (Google Ads, Meta). "Analytics only" is a real
 *   choice, honoured all the way down to `deliverPurchaseConversions`.
 *
 * PENDING PURCHASE CONFIRMATION (Production Launch Session 03 §3, §4). A
 * customer who pays on Shopify comes back to *some* BagDirect page — often
 * the confirmation page, sometimes the home page, sometimes a product page.
 * So the check runs here, once per mount: if a pending order exists, the
 * SERVER is asked whether it is paid, and only a paid answer fires a
 * purchase. Nothing about the return navigation itself is treated as
 * payment.
 */

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;
const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID;
const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

const CONSENT_KEY = "bd_consent_v1";

type Consent = { analytics: boolean; advertising: boolean; ts: string };

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [consent, setStoredConsent] = useState<Consent | null | "unset">("unset");

  // Attribution capture + page_view per navigation
  useEffect(() => {
    captureVisit();
    track({ name: "page_view", params: { page_path: pathname } });
  }, [pathname]);

  // Did a pending checkout become a paid order while the customer was away?
  // Exception-safe by construction (the helper swallows its own failures):
  // an analytics check must never break a page render.
  useEffect(() => {
    void confirmPendingPurchase();
  }, []);

  // Restore consent choice. SSR-safe hydration: localStorage is client-only,
  // so the stored choice can only be read in an effect after mount.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      if (raw) {
        const c = JSON.parse(raw) as Consent;
        setStoredConsent(c);
        setConsent({ analytics: c.analytics, advertising: c.advertising });
      } else {
        setStoredConsent(null);
      }
    } catch {
      setStoredConsent(null);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const decide = (analytics: boolean, advertising: boolean) => {
    const c: Consent = { analytics, advertising, ts: new Date().toISOString() };
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(c));
    } catch {
      /* best effort */
    }
    setStoredConsent(c);
    setConsent({ analytics, advertising });
  };

  const loadTags = consent !== "unset" && consent !== null && consent.analytics;
  const loadAdTags = consent !== "unset" && consent !== null && consent.advertising;

  return (
    <>
      {children}

      {/* GTM — only after analytics consent */}
      {loadTags && GTM_ID && (
        <Script id="gtm" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`}
        </Script>
      )}

      {/*
        gtag (GA4 + Google Ads), when not routed through GTM.

        ONE loader for both destinations, because that is how gtag.js works:
        the library is loaded once and each destination is `config`-ured on
        it. Each config is gated by ITS OWN consent axis, so "Analytics only"
        loads GA4 and never configures the Ads destination.

        `window.gtag` must be a real function, not the local one inside this
        script tag: lib/analytics/conversions.ts sends the purchase through
        `window.gtag`.
      */}
      {!GTM_ID && ((loadTags && GA4_ID) || (loadAdTags && GOOGLE_ADS_ID)) && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${loadTags && GA4_ID ? GA4_ID : GOOGLE_ADS_ID}`}
            strategy="afterInteractive"
          />
          <Script id="gtag-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){dataLayer.push(arguments);};gtag('js',new Date());` +
              `${loadTags && GA4_ID ? `gtag('config','${GA4_ID}');` : ""}` +
              `${loadAdTags && GOOGLE_ADS_ID ? `gtag('config','${GOOGLE_ADS_ID}');` : ""}`}
          </Script>
        </>
      )}

      {/* Meta Pixel — only after advertising consent */}
      {loadAdTags && META_PIXEL_ID && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${META_PIXEL_ID}');fbq('track','PageView');`}
        </Script>
      )}

      {/* Consent banner — appears once, honest options, no pre-ticked dark patterns */}
      {consent === null && (
        <div
          role="region"
          aria-label="Cookie consent"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-md border border-brand-hairline-strong bg-brand-surface p-4 shadow-overlay sm:p-5"
          style={{ boxShadow: "0 4px 24px oklch(24% 0.02 258 / 0.12)" }}
        >
          <p className="text-sm text-ink-2">
            We use optional analytics and advertising cookies to understand how the site is used and to
            measure our ads. Essential functionality works either way.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn--primary text-sm" onClick={() => decide(true, true)}>
              Accept all
            </button>
            <button type="button" className="btn btn--secondary text-sm" onClick={() => decide(true, false)}>
              Analytics only
            </button>
            <button type="button" className="btn btn--ghost text-sm" onClick={() => decide(false, false)}>
              Decline optional
            </button>
          </div>
        </div>
      )}
    </>
  );
}
