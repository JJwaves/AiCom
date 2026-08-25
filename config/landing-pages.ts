/**
 * Landing-page content definitions.
 *
 * One schema drives both the organic SEO pages (/restaurant-takeout-bags, …)
 * and the stripped-down ad landing pages (/lp/*). Every page has
 * differentiated intent and copy — no thin duplicates.
 */

export type LandingContent = {
  slug: string;
  /** SEO page path (organic) — /lp/<slug> is the ad variant. */
  title: string;
  metaTitle: string;
  metaDescription: string;
  hero: { headline: string; sub: string; cta: string };
  productSlug: string;
  bullets: { heading: string; body: string }[];
  emphases: string[];
  faq: { q: string; a: string }[];
  illustrationColor?: string;
};

export const LANDING_PAGES: LandingContent[] = [
  {
    slug: "restaurant-takeout-bags",
    title: "Restaurant takeout bags",
    metaTitle: "Custom Insulated Restaurant Takeout Bags — Logo Printed",
    metaDescription:
      "Custom printed insulated takeout bags for restaurants: two sizes, black or white, your logo, 5,000-piece minimum. Order online. Ships within the United States.",
    hero: {
      headline: "Custom insulated takeout bags for restaurants",
      sub: "Hot food should arrive hot, and it should arrive with your name on it. Configure the bag, upload your logo, approve a digital proof, order online.",
      cta: "Customize your bags",
    },
    productSlug: "custom-insulated-takeout-bags",
    bullets: [
      { heading: "Built for the trip, not the counter", body: "PP laminated outer layer, non-woven fabric middle layer, aluminium foil lining. The construction is fixed — it is what makes the bag insulated." },
      { heading: "Your brand rides along", body: "Takeout and delivery orders leave your dining room behind. A printed bag is the one brand surface that travels with the food." },
      { heading: "Two restaurant-sized formats", body: "Large 26 × 26 × 17 cm and Extra Large 30 × 30 × 20 cm (width × height × side gusset) — sized for stacked containers and family orders." },
      { heading: "Priced on the page", body: "5,000 or 10,000 pieces per design, with the price on screen before you order. No sales call to find out what it costs." },
    ],
    emphases: ["Takeout", "Delivery", "Catering", "Insulated", "Brand visibility", "Custom printing"],
    faq: [
      { q: "How big are the bags?", a: "Large is 26 × 26 × 17 cm and Extra Large is 30 × 30 × 20 cm — width × height × side gusset. Both are on the product page with pricing." },
      { q: "Can I print my restaurant's logo?", a: "Yes. Upload your logo or artwork during configuration; we prepare a digital proof for your approval before anything is printed." },
      { q: "What's the minimum order?", a: "5,000 pieces per design. Direct online ordering is available at 5,000 and 10,000 pieces; anything else is quoted individually." },
    ],
  },
  {
    slug: "coffee-shop-bags",
    title: "Coffee shop & bakery bags",
    metaTitle: "Custom Insulated Bags for Coffee Shops & Bakeries",
    metaDescription:
      "Custom printed insulated bags for cafes and bakeries — your logo, black or white, 5,000-piece minimum, digital proof before production. Ships within the United States.",
    hero: {
      headline: "Custom insulated bags for cafes & bakeries",
      sub: "Pastry boxes, breakfast runs and delivery orders — insulated, printed with your logo, ordered online.",
      cta: "Create your bag",
    },
    productSlug: "custom-insulated-takeout-bags",
    bullets: [
      { heading: "Keeps the order the way it left", body: "The aluminium foil lining is there for the ten minutes between your counter and their desk." },
      { heading: "Looks right on a cafe counter", body: "A black or white base with your artwork printed on it — no third-party branding riding along." },
      { heading: "Flat-bottom gusset", body: "A 17 cm (Large) or 20 cm (Extra Large) side gusset keeps boxes level instead of tipping them into a corner." },
      { heading: "One clear minimum", body: "5,000 pieces per design, at a price you can see before ordering." },
    ],
    emphases: ["Coffee", "Pastries", "Bakery boxes", "Breakfast delivery", "Insulated"],
    faq: [
      { q: "Which size should I pick?", a: "Large (26 × 26 × 17 cm) suits single-order pickups; Extra Large (30 × 30 × 20 cm) suits larger boxes and multi-item orders. Both are configurable on the product page." },
      { q: "Can I match my brand color?", a: "The bag base is black or white for this launch product. Your brand colors come through in the printed artwork. Other base colors are quoted individually through the quote form." },
      { q: "What's the minimum order?", a: "5,000 pieces per design." },
    ],
    illustrationColor: "oklch(97% 0 0)",
  },
  {
    slug: "custom-logo-takeout-bags",
    title: "Custom logo takeout bags",
    metaTitle: "Custom Logo Insulated Takeout Bags — Upload Artwork, See Pricing",
    metaDescription:
      "Put your logo on insulated takeout bags. Upload artwork online, approve a digital proof, and see the price before you order. Ships within the United States.",
    hero: {
      headline: "Your logo, on the bag, without the runaround",
      sub: "Upload artwork while you configure, approve a digital proof, and the factory prints exactly what you approved.",
      cta: "Upload your logo",
    },
    productSlug: "custom-insulated-takeout-bags",
    bullets: [
      { heading: "Upload while configuring, not by email chain", body: "PNG, JPG, PDF, AI or EPS, up to 25 MB, attached to the order itself. A notes field carries placement and ink instructions." },
      { heading: "Proof before production", body: "A digital proof will be provided for your approval before production begins. Production starts after artwork approval — mistakes get caught on a screen, not on 5,000 bags." },
      { heading: "You upload art, not a color count", body: "You do not have to specify how many print colors your logo needs. Our production review determines the color separation when the artwork is prepared." },
      { heading: "Vector or raster, we'll tell you straight", body: "Vector art prints sharpest. If all you have is a screenshot of your logo, upload it anyway — the artwork team will tell you what's workable." },
    ],
    emphases: ["Logo upload", "Digital proof", "Custom artwork", "Insulated bags"],
    faq: [
      { q: "What if my logo file is low quality?", a: "Upload what you have with a note. Our artwork team reviews every file and will tell you if it needs to be redrawn before printing." },
      { q: "How many print colors can I have?", a: "You do not choose a color count. Upload your artwork and production review determines the color separation; you approve the digital proof before anything prints." },
      { q: "Do you accept SVG?", a: "No. Export as PDF, AI, EPS or a high-resolution PNG — any of those prints better anyway." },
    ],
  },
  {
    slug: "bulk-takeout-bags",
    title: "Bulk insulated takeout bags",
    metaTitle: "Bulk Insulated Takeout Bags — Factory-Direct Pricing",
    metaDescription:
      "Bulk custom printed insulated takeout bags at factory-direct pricing: 5,000 or 10,000 pieces per design, price shown on the page. Ships within the United States.",
    hero: {
      headline: "Bulk pricing, printed on the page",
      sub: "No “contact us for pricing.” Pick a size and a quantity, see the per-bag price and the total, order.",
      cta: "See the pricing",
    },
    productSlug: "custom-insulated-takeout-bags",
    bullets: [
      { heading: "Two order sizes, both priced openly", body: "5,000 or 10,000 pieces per design. Large is $950 or $1,500; Extra Large is $1,150 or $1,900. Those are product subtotals." },
      { heading: "Factory direct is the discount", body: "There is no distributor margin to negotiate away — the price on the page is the factory price plus fulfilment." },
      { heading: "One order, one proof, repeatable", body: "Your artwork and specs are saved with the order, so reordering the same bag is a short job." },
      { heading: "Bigger, smaller or bespoke? Quote it", body: "Under 5,000, over 10,000, a custom size or a custom color are all quoted individually through the quote form. Custom sizes carry the same 5,000-piece minimum." },
    ],
    emphases: ["5,000 pieces", "10,000 pieces", "Price transparency", "Reordering", "Custom quotes"],
    faq: [
      { q: "Can I order more than 10,000?", a: "Yes, but not through standard checkout — send the quantity through the quote form and we will price it rather than guess at a number." },
      { q: "What does shipping add?", a: "A flat $100 per order within the United States, charged once for the whole order and shown separately from the product subtotal." },
      { q: "Can I mix sizes within one order?", a: "You can add a Large configuration and an Extra Large configuration to the same order; each is priced at its own quantity, and shipping is still charged once." },
    ],
  },
];

export function getLandingPage(slug: string): LandingContent | undefined {
  return LANDING_PAGES.find((p) => p.slug === slug);
}

/** /lp aliases — ad-campaign URLs mapping onto landing content. */
export const LP_ALIASES: Record<string, string> = {
  "restaurant-bags": "restaurant-takeout-bags",
  "cafe-bags": "coffee-shop-bags",
  "custom-logo-bags": "custom-logo-takeout-bags",
  "bulk-takeout-bags": "bulk-takeout-bags",
};
