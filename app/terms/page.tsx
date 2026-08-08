import type { Metadata } from "next";
import { PolicyPage } from "@/components/layout/PolicyPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing orders, artwork, proofs and custom manufacturing.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <PolicyPage
      title="Terms of service"
      intro="These terms govern orders placed on this site."
      sections={[
        {
          h: "Orders and proofs",
          body: [
            "Printed orders are produced from the artwork proof you approve. Approval authorizes production; changes after approval may not be possible once production starts.",
          ],
        },
        {
          h: "Artwork rights",
          body: [
            "By uploading artwork you confirm you hold the rights to reproduce it. We don't screen trademarks, and printing does not transfer any rights between the parties.",
          ],
        },
        {
          h: "Pricing and payment",
          body: [
            "Prices shown at checkout are binding for that order. Volume tiers, options pricing and shipping are itemized before payment. Payment is processed by the secure checkout provider.",
          ],
        },
        {
          h: "Custom manufacturing",
          body: [
            "Quoted custom work (custom dimensions, matched colors, special handles) is governed by the written quote, which controls where it differs from these terms.",
          ],
        },
      ]}
    />
  );
}
