import type { Metadata } from "next";
import { PolicyPage } from "@/components/layout/PolicyPage";
import { BUSINESS } from "@/config/business";
import { FLAT_US_SHIPPING_COPY } from "@/config/shipping";

export const metadata: Metadata = {
  title: "Shipping Policy",
  description: "U.S. shipping: flat $100 per order, production time, and transit.",
  alternates: { canonical: "/shipping-policy" },
};

export default function ShippingPolicyPage() {
  return (
    <PolicyPage
      title="Shipping policy"
      intro="We ship to business addresses in the United States. Canada is not served during the current launch."
      sections={[
        {
          h: "What shipping costs",
          body: [
            `${FLAT_US_SHIPPING_COPY}. It is charged once for the whole order, however many configurations are on it, and it is shown separately from the product subtotal at checkout.`,
            "This is a shipping charge, not a tax and not a duty. Any sales tax is calculated separately by our checkout at payment.",
          ],
        },
        {
          h: "Production before shipping",
          body: [
            "An order does not enter manufacturing at checkout. We prepare a digital proof for your approval first, and production starts after you approve it.",
            `Current standard production time: ${BUSINESS.STANDARD_PRODUCTION_TIME}.`,
          ],
        },
        {
          h: "Transit",
          body: [
            `Standard transit time: ${BUSINESS.STANDARD_SHIPPING_TIME}. Tracking is emailed when the order leaves the dock.`,
          ],
        },
      ]}
    />
  );
}
