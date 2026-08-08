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
    metaTitle: "Custom Restaurant Takeout Bags — Bulk & Logo Printed",
    metaDescription:
      "Custom takeout bags for restaurants: reusable non-woven fabric, your logo, bulk volume pricing, online ordering. Ships to the US and Canada.",
    hero: {
      headline: "Custom takeout bags for restaurants",
      sub: "Turn every takeout order into a branded customer touchpoint. Configure the bag, upload your logo, order online.",
      cta: "Customize your bags",
    },
    productSlug: "custom-non-woven-takeout-bags",
    bullets: [
      { heading: "Built for takeout and delivery", body: "Wide gussets hold standard takeout containers flat and upright — no tipped curries in the delivery bag." },
      { heading: "Your brand rides along", body: "Takeout and delivery orders leave your dining room behind. A printed bag is the one brand surface that travels." },
      { heading: "Catering-ready formats", body: "Large and XL sizes carry family meals and catering trays; the heavy-duty line handles multi-container orders." },
      { heading: "Bulk ordering without the distributor", body: "Factory-direct tiers at 1,000 / 2,500 / 5,000 / 10,000+ units — the tier table is on the product page, not behind a sales call." },
    ],
    emphases: ["Takeout", "Delivery", "Catering", "Brand visibility", "Durability", "Custom printing"],
    faq: [
      { q: "How big are the bags relative to takeout containers?", a: "The Medium (12\"W × 10\"H × 8\"G) fits two standard 8×8 clamshells side by side; Large and XL take family-meal volumes. Exact dimensions are on the product page." },
      { q: "Can I print my restaurant's logo?", a: "Yes — 1-color and 2-color printing are configurable online, with an artwork proof emailed before production." },
      { q: "Do prices drop at volume?", a: "Yes. Per-bag pricing steps down at each quantity tier; the full table is visible on every product page." },
    ],
  },
  {
    slug: "coffee-shop-bags",
    title: "Coffee shop bags",
    metaTitle: "Custom Coffee Shop & Cafe Carryout Bags",
    metaDescription:
      "Custom carryout bags for coffee shops, cafes and bakeries — sized for drink carriers and pastry boxes, printed with your logo. Order online, ships to US & Canada.",
    hero: {
      headline: "Custom carryout bags for coffee shops & cafes",
      sub: "Sized for drink carriers, pastry boxes and weekend pastry runs — printed with your cafe's logo.",
      cta: "Create your bag",
    },
    productSlug: "custom-cafe-carryout-bag",
    bullets: [
      { heading: "Sized for cafe orders", body: "Compact formats fit a 4-cup drink carrier or a pastry box without swimming — smaller bags, less material, lower unit cost." },
      { heading: "Looks right on a cafe counter", body: "Kraft, white, black and custom colors; single-color logo printing reads clean on the fabric face." },
      { heading: "Reusable by design", body: "Non-woven fabric survives the commute — regulars bring the bag back, and your logo with it." },
      { heading: "Bakery and dessert friendly", body: "Flat-bottom gusset keeps boxes level, from croissants to quarter-sheet cakes." },
    ],
    emphases: ["Coffee", "Pastries", "Bakery boxes", "Beverages", "Small takeout orders"],
    faq: [
      { q: "Which size fits a drink carrier?", a: "Small (8\"W × 10\"H × 4\"G) carries a 2-cup carrier; Medium fits a 4-cup carrier plus a pastry bag. Dimensions are configurable on the product page." },
      { q: "Can I match my brand color?", a: "Standard colors are orderable online. Pantone-matched custom colors go through the quote form and are priced individually." },
      { q: "What's the minimum order?", a: "500 bags for standard configurations — that's a few weeks of weekend rushes for most cafes." },
    ],
    illustrationColor: "oklch(75% 0.06 70)",
  },
  {
    slug: "custom-logo-takeout-bags",
    title: "Custom logo takeout bags",
    metaTitle: "Custom Logo Takeout Bags — Upload Artwork, See Pricing",
    metaDescription:
      "Put your logo on reusable non-woven takeout bags. Upload artwork online, approve a proof, and get factory-direct volume pricing. US & Canada.",
    hero: {
      headline: "Your logo, on the bag, without the runaround",
      sub: "Upload artwork during checkout, approve an emailed proof, and the factory prints exactly what you approved.",
      cta: "Upload your logo",
    },
    productSlug: "custom-non-woven-takeout-bags",
    bullets: [
      { heading: "Upload at checkout, not by email chain", body: "PNG, JPG, PDF, SVG, AI or EPS — attach the file while configuring. Notes field for placement and ink instructions." },
      { heading: "Proof before production", body: "Every printed order gets an artwork proof. Nothing prints until you approve it — mistakes get caught on a screen, not on 5,000 bags." },
      { heading: "1-color and 2-color printing", body: "Priced per bag, visible in the configurator as you toggle options. Two-color adds a second ink for logos with an accent tone." },
      { heading: "Vector or raster, we'll tell you straight", body: "Vector art prints sharpest. If all you have is a screenshot of your logo, upload it anyway — the artwork team will tell you what's workable." },
    ],
    emphases: ["Logo upload", "Artwork proof", "1-color print", "2-color print", "Placement options"],
    faq: [
      { q: "What if my logo file is low quality?", a: "Upload what you have with a note. Our artwork team reviews every file and will tell you if it needs to be redrawn before printing." },
      { q: "Where does the logo print?", a: "Standard placement is the front face, centered. Use the artwork notes for other placements — both sides, offset, or oversized prints are quoted individually." },
      { q: "Is there a setup fee for printing?", a: "Printing cost appears per-bag in the configurator. Any one-time setup fees are itemized before checkout — never after." },
    ],
  },
  {
    slug: "bulk-takeout-bags",
    title: "Bulk takeout bags",
    metaTitle: "Bulk Takeout Bags — Factory-Direct Volume Pricing",
    metaDescription:
      "Bulk non-woven takeout bags at factory-direct tier pricing: 1,000 to 25,000+ units, custom printing, online ordering. Ships to the US and Canada.",
    hero: {
      headline: "Bulk pricing, printed on the page",
      sub: "No “contact us for pricing.” The tier table is on every product page: pick a quantity, see the per-bag price and the total, order.",
      cta: "See the tier table",
    },
    productSlug: "custom-non-woven-takeout-bags",
    bullets: [
      { heading: "Tiers that reward planning", body: "Per-bag price steps down at 1,000 / 2,500 / 5,000 / 10,000 / 25,000 units. Ordering a quarter's supply at once beats monthly small runs." },
      { heading: "Factory direct is the discount", body: "There's no distributor margin to negotiate away — the tier price is the factory price plus fulfillment." },
      { heading: "One order, one proof, repeatable", body: "Your artwork and specs are saved with the order. Reordering the same bag is a two-minute job." },
      { heading: "Beyond the table? Quote it", body: "Quantities above 25,000, mixed-size runs, or distributor volumes get individual pricing through the quote form." },
    ],
    emphases: ["Volume tiers", "Price transparency", "Reordering", "High-quantity quotes"],
    faq: [
      { q: "Can I mix sizes or colors within one tier?", a: "Tier pricing applies per configuration. Mixed runs are often still cheaper than separate small orders — use the quote form and we'll price the combination." },
      { q: "Is there a discount above 25,000 units?", a: "Yes, quoted individually. Submit the quantity through the quote form for a committed price." },
      { q: "How do I know bulk quality holds up?", a: "Same line, same QC as small runs. If you want to check the material first, order the minimum run of 500 unprinted bags before committing to a large printed order." },
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
