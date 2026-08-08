import type { Metadata } from "next";
import { PolicyPage } from "@/components/layout/PolicyPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What data this site collects and how it is used.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy policy"
      intro="We collect the minimum needed to make and ship your order, plus optional analytics you can decline."
      sections={[
        {
          h: "Order data",
          body: [
            "Business name, contact details, shipping address, order contents and uploaded artwork are collected to produce and deliver your order and to provide proofs and support. Payment details are processed by the checkout provider and never stored on this site.",
          ],
        },
        {
          h: "Analytics and advertising",
          body: [
            "Analytics and advertising cookies load only after you opt in via the consent banner. Declining keeps the store fully functional. Campaign parameters (UTM tags, ad click IDs) may be associated with your order to measure which advertising works.",
          ],
        },
        {
          h: "Artwork files",
          body: [
            "Uploaded artwork is used solely to produce your order and proofs. Artwork contents are never sent to analytics or advertising platforms.",
          ],
        },
        {
          h: "Your choices",
          body: [
            "You can change consent choices by clearing site data in your browser, and request deletion of your order data by contacting customer service.",
          ],
        },
      ]}
    />
  );
}
