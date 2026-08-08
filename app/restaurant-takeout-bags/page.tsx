import type { Metadata } from "next";
import { getLandingPage } from "@/config/landing-pages";
import { LandingTemplate } from "@/components/landing/LandingTemplate";

const content = getLandingPage("restaurant-takeout-bags")!;

export const metadata: Metadata = {
  title: content.metaTitle,
  description: content.metaDescription,
  alternates: { canonical: "/restaurant-takeout-bags" },
};

export default function Page() {
  return <LandingTemplate content={content} />;
}
