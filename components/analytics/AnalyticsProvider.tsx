"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { captureVisit } from "@/lib/attribution/attribution";
import { grantAnalyticsConsent, track } from "@/lib/analytics/track";

/**
 * Analytics + attribution + consent infrastructure.
 *
 * - Captures campaign attribution on every route change.
 * - Fires page_view into the dataLayer.
 * - Loads GTM / GA4 / Meta Pixel only when (a) their env IDs exist and
 *   (b) the visitor has granted consent. No dark patterns: the banner is
 *   dismissible, declines are respected, and nothing loads before consent.
 * - Server-side Meta CAPI uses META_ACCESS_TOKEN (server-only env; never
 *   referenced in client code).
 */

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;
const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID;
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

const CONSENT_KEY = "bd_consent_v1";

type Consent = { analytics: boolean; advertising: boolean; ts: string };

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [consent, setConsent] = useState<Consent | null | "unset">("unset");

  // Attribution capture + page_view per navigation
  useEffect(() => {
    captureVisit();
    track({ name: "page_view", params: { page_path: pathname } });
  }, [pathname]);

  // Restore consent choice. SSR-safe hydration: localStorage is client-only,
  // so the stored choice can only be read in an effect after mount.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      if (raw) {
        const c = JSON.parse(raw) as Consent;
        setConsent(c);
        if (c.analytics) grantAnalyticsConsent();
      } else {
        setConsent(null);
      }
    } catch {
      setConsent(null);
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
    setConsent(c);
    if (analytics) grantAnalyticsConsent();
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

      {/* GA4 direct (when not routed through GTM) */}
      {loadTags && !GTM_ID && GA4_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`} strategy="afterInteractive" />
          <Script id="ga4" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA4_ID}');`}
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
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl surface p-4 sm:p-5"
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
