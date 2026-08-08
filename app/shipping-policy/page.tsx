import type { Metadata } from "next";
import { PolicyPage } from "@/components/layout/PolicyPage";
import { BUSINESS } from "@/config/business";

export const metadata: Metadata = {
  title: "Shipping Policy",
  description: "Shipping to the US and Canada: production time, transit, and cost calculation.",
  alternates: { canonical: "/shipping-policy" },
};

export default function ShippingPolicyPage() {
  return (
    <PolicyPage
      title="Shipping policy"
      intro="We ship to business addresses in the United States and Canada."
      sections={[
        {
          h: "How shipping cost is calculated",
          body: [
            "Shipping is calculated at checkout from your postal code, order weight and carton volume. There are no invented flat rates — what checkout shows is what applies.",
          ],
        },
        {
          h: "Production before shipping",
          body: [
            `Custom-printed orders enter production after proof approval. Current standard production time: ${BUSINESS.STANDARD_PRODUCTION_TIME}. Unprinted orders skip the proof step.`,
          ],
        },
        {
          h: "Transit",
          body: [
            `Standard transit time: ${BUSINESS.STANDARD_SHIPPING_TIME}. Tracking is emailed when the order leaves the dock.`,
            "Canadian orders may be subject to import handling depending on the fulfillment route; any duties or brokerage treatment is stated at checkout, not surprised onto the invoice.",
          ],
        },
      ]}
    />
  );
}
