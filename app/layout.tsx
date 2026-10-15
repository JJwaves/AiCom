import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { BUSINESS } from "@/config/business";
import { CartProvider } from "@/lib/cart/cart-context";
import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";
import { PackagingExpertLauncher } from "@/components/ai/PackagingExpertLauncher";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import "./globals.css";

/* Typography — DESIGN.md §3. Space Grotesk 500 for headings, Inter for everything else.
 * JetBrains Mono stays loaded for the (un-redesigned) admin surfaces only. */
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(`https://${BUSINESS.DOMAIN}`),
  title: {
    default: `Custom Printed Insulated Takeout Bags, Factory Direct | ${BUSINESS.DISPLAY_NAME}`,
    template: `%s | ${BUSINESS.DISPLAY_NAME}`,
  },
  description:
    "Custom printed insulated takeout bags for restaurants, catering and food delivery. Two sizes, black or white, 5,000-piece minimum, wholesale pricing on the page. Request a quote — factory direct, shipped within the United States.",
  openGraph: {
    siteName: BUSINESS.DISPLAY_NAME,
    type: "website",
    locale: "en_US",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} min-h-dvh flex flex-col antialiased`}
      >
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <AnalyticsProvider>
          <CartProvider>
            <Header />
            <main id="main" className="flex-1">{children}</main>
            <Footer />
            <PackagingExpertLauncher />
          </CartProvider>
        </AnalyticsProvider>
      </body>
    </html>
  );
}
