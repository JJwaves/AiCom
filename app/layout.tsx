import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { BUSINESS } from "@/config/business";
import { CartProvider } from "@/lib/cart/cart-context";
import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  metadataBase: new URL(`https://${BUSINESS.DOMAIN}`),
  title: {
    default: `Custom Non-Woven Takeout Bags, Factory Direct | ${BUSINESS.DISPLAY_NAME}`,
    template: `%s | ${BUSINESS.DISPLAY_NAME}`,
  },
  description:
    "Custom non-woven takeout bags for restaurants, cafes and food businesses. Add your logo, choose your quantity, see the price, and order online. Factory direct to the US and Canada.",
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
        className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <AnalyticsProvider>
          <CartProvider>
            <Header />
            <main id="main">{children}</main>
            <Footer />
          </CartProvider>
        </AnalyticsProvider>
      </body>
    </html>
  );
}
