import type { Metadata } from "next";
import { PolicyPage } from "@/components/layout/PolicyPage";

export const metadata: Metadata = {
  title: "Return Policy",
  description: "Return eligibility for standard and custom-printed non-woven bags.",
  alternates: { canonical: "/return-policy" },
  robots: { index: true },
};

export default function ReturnPolicyPage() {
  return (
    <PolicyPage
      title="Return policy"
      intro="Because logo-printed bags are manufactured to order, return eligibility depends on what went wrong. The categories below are handled differently on purpose — they carry different responsibilities."
      sections={[
        {
          h: "Manufacturing defects",
          body: [
            "Bags with fabric, stitching or construction defects are eligible for replacement or refund. Report defects with photos within the inspection window stated on your order confirmation.",
          ],
        },
        {
          h: "Incorrect production",
          body: [
            "If the delivered bags don't match your approved proof or ordered specification (wrong size, wrong color, wrong print), we remake or refund the affected units.",
          ],
        },
        {
          h: "Customer-approved artwork",
          body: [
            "Orders printed exactly as shown in the artwork proof you approved are not returnable for artwork content (typos, logo versions, color choices visible in the proof). This is why the proof step exists — check it carefully.",
          ],
        },
        {
          h: "Customer ordering mistakes",
          body: [
            "Wrong size or quantity ordered? Contact us immediately — orders can usually be corrected before production starts. After production, custom-printed goods cannot be restocked; unprinted standard bags may be returnable per the terms on your order confirmation.",
          ],
        },
        {
          h: "Shipping damage",
          body: [
            "Damage in transit is covered. Photograph the carton and contents on arrival and report it within the window stated on your order confirmation.",
          ],
        },
      ]}
    />
  );
}
