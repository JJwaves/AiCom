import type { Metadata } from "next";
import { getLandingPage } from "@/config/landing-pages";
import { LandingTemplate } from "@/components/landing/LandingTemplate";

const content = getLandingPage("bulk-takeout-bags")!;

export const metadata: Metadata = {
  title: content.metaTitle,
  description: content.metaDescription,
  alternates: { canonical: "/bulk-takeout-bags" },
};

export default function Page() {
  return <LandingTemplate content={content} />;
}
