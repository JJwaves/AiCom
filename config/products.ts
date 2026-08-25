import type { Product } from "@/types/commerce";

/**
 * BagDirect product catalog — THE catalog authority (see config/shopify.ts).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAUNCH SCOPE (Production Configuration — Product #1 MVP)
 * ─────────────────────────────────────────────────────────────────────────
 * Exactly ONE product is `launchEnabled: true`: the Custom Insulated Takeout
 * Bag. Its numbers are factory-confirmed, so it is the only entry with
 * `pricingStatus: "LIVE"`.
 *
 * The other three entries are the original seed catalog. They still carry
 * DEMO pricing and unconfirmed specs, so they are `launchEnabled: false`:
 * the catalog facade hides them, their pages 404, they are absent from
 * listings, the sitemap, AI tool results and the Shopify merchandise
 * requirements. They are kept, not deleted — they are the shape future
 * products take — but no customer can reach or buy one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PRODUCT #1 — production record
 * ─────────────────────────────────────────────────────────────────────────
 * Construction (FIXED — a specification, never a customer choice):
 *   PP laminated outer · non-woven fabric middle · aluminium foil inner.
 * Sizes:      Large 26×26×17 cm · Extra Large 30×30×20 cm  (W × H × gusset)
 * Colors:     Black · White
 * Printing:   custom logo/artwork; production colour separation is decided
 *             in internal production review, NOT by the customer.
 * MOQ:        5,000 pcs per design (confirmed — config/business.ts)
 * Quantities: 5,000 and 10,000 only. Anything else → custom quote.
 * Prices:     Large 5k $950 / 10k $1,500 · XL 5k $1,150 / 10k $1,900
 *             (product subtotals; shipping is a separate $100 flat charge)
 * Lead time:  15–30 days AFTER digital-proof approval.
 * Market:     United States only.
 *
 * HOW THE FOUR PRICES ARE PRODUCED — deterministically, by the existing
 * engine, with no new pricing concepts:
 *
 *   unit price = quantity-tier price + size delta
 *
 *     tier 5,000  → 19¢     Large delta  0¢     XL delta +4¢
 *     tier 10,000 → 15¢
 *
 *     Large  5,000 × 19¢ = $950     XL  5,000 × 23¢ = $1,150
 *     Large 10,000 × 15¢ = $1,500   XL 10,000 × 19¢ = $1,900
 *
 * WHY $0.19/bag AT XL 10,000 AND NOT $0.185: the supplier's own historic XL
 * job sold 10,000 bags for $1,850 ex-shipping — $0.185/bag. BagDirect's money
 * model is integer cents per unit end to end (engine, cart, order rows,
 * Shopify `priceOverride`), and fractional cents are rejected by cost
 * validation on purpose. Rather than introduce a fractional-cent authority
 * for one launch price, the MVP sells at $0.19/bag = $1,900. Documented in
 * BUSINESS_CONFIG_TODO.md → "Product #1".
 */

/* ------------------------------------------------------------------ */
/* PRODUCT #1 — Custom Insulated Takeout Bag (LAUNCH)                  */
/* ------------------------------------------------------------------ */

const INSULATED_SIZES = [
  {
    id: "l",
    label: "Large",
    dimensions: { width: 26, height: 26, gusset: 17 },
    unit: "cm" as const,
    priceDeltaCents: 0,
  },
  {
    id: "xl",
    label: "Extra Large",
    dimensions: { width: 30, height: 30, gusset: 20 },
    unit: "cm" as const,
    priceDeltaCents: 4,
  },
];

/**
 * ONE entry, so the customer chooses nothing here. It exists because the
 * construction is a real product fact that must travel onto the order and
 * the Shopify line, and because merchandise identity is
 * product|size|material|color everywhere in the system.
 */
const INSULATED_MATERIAL = [
  {
    id: "insulated",
    label: "Insulated (PP laminated / non-woven / aluminium foil)",
    gsm: null,
    priceDeltaCents: 0,
  },
];

const INSULATED_COLORS = [
  { id: "black", label: "Black", swatch: "oklch(20% 0 0)" },
  { id: "white", label: "White", swatch: "oklch(97% 0 0)" },
];

/**
 * ONE printing option. The customer uploads artwork; they do NOT pick a
 * colour count. Real factory printing cost depends on production colour
 * separation, which is determined in production review — so exposing
 * "1 colour / 2 colours / 3 colours" would be asking the customer to price
 * something neither they nor this codebase can determine.
 */
const INSULATED_PRINTING = [
  {
    id: "full-custom" as const,
    label: "Custom logo / artwork printing",
    description:
      "Upload your logo or artwork. We prepare a digital proof for your approval before anything is printed.",
    priceDeltaCents: 0,
    requiresArtwork: true,
  },
];

/* ------------------------------------------------------------------ */
/* Seed catalog (launch-disabled) — DEMO data, kept for future products */
/* ------------------------------------------------------------------ */

const STANDARD_SIZES = [
  { id: "s", label: "Small", dimensions: { width: 8, height: 10, gusset: 4 }, unit: "in" as const, priceDeltaCents: 0 },
  { id: "m", label: "Medium", dimensions: { width: 12, height: 10, gusset: 8 }, unit: "in" as const, priceDeltaCents: 0 },
  { id: "l", label: "Large", dimensions: { width: 14, height: 12, gusset: 9 }, unit: "in" as const, priceDeltaCents: 0 },
  { id: "xl", label: "XL", dimensions: { width: 16, height: 14, gusset: 10 }, unit: "in" as const, priceDeltaCents: 0 },
];

const STANDARD_MATERIALS = [
  { id: "standard", label: "Standard", gsm: null, priceDeltaCents: 0 },
  { id: "heavy", label: "Heavy duty", gsm: null, priceDeltaCents: 6 },
];

const STANDARD_COLORS = [
  { id: "white", label: "White", swatch: "oklch(97% 0 0)" },
  { id: "black", label: "Black", swatch: "oklch(20% 0 0)" },
  { id: "kraft", label: "Kraft", swatch: "oklch(75% 0.06 70)" },
  { id: "red", label: "Red", swatch: "oklch(55% 0.19 25)" },
  { id: "navy", label: "Navy", swatch: "oklch(32% 0.08 260)" },
  { id: "green", label: "Forest green", swatch: "oklch(45% 0.09 150)" },
  { id: "custom", label: "Custom color", swatch: "conic-gradient(from 0deg, oklch(60% 0.15 0), oklch(60% 0.15 90), oklch(60% 0.15 180), oklch(60% 0.15 270), oklch(60% 0.15 360))", custom: true },
];

const STANDARD_HANDLES = [
  { id: "loop", label: "Loop handle", confirmed: true },
  { id: "die-cut", label: "Die-cut handle", confirmed: false },
  { id: "reinforced", label: "Reinforced handle", confirmed: false },
];

const STANDARD_PRINT_OPTIONS = [
  {
    id: "none" as const,
    label: "No logo",
    description: "Plain bag in your chosen color.",
    priceDeltaCents: 0,
    requiresArtwork: false,
  },
  {
    id: "one-color" as const,
    label: "1-color print",
    description: "Your logo in one ink color, one or both sides.",
    priceDeltaCents: 5,
    requiresArtwork: true,
  },
  {
    id: "two-color" as const,
    label: "2-color print",
    description: "Two ink colors for logos with a secondary tone.",
    priceDeltaCents: 9,
    requiresArtwork: true,
  },
];

const QTY_PRESETS = [500, 1000, 2500, 5000, 10000, 25000];

export const PRODUCTS: Product[] = [
  {
    id: "p-custom-takeout",
    slug: "custom-insulated-takeout-bags",
    title: "Custom Insulated Takeout Bag",
    positioning:
      "Custom printed insulated bags for restaurants, catering and food delivery.",
    description:
      "An insulated takeout bag built for hot and cold food service: a PP laminated outer layer, a non-woven fabric middle layer and an aluminium foil inner layer, printed with your own logo or artwork. Two restaurant-friendly sizes, black or white, 5,000 pieces per design. We send a digital proof for your approval before production begins.",
    hero: true,
    launchEnabled: true,
    sizes: INSULATED_SIZES,
    materials: INSULATED_MATERIAL,
    colors: INSULATED_COLORS,
    // No handle style is factory-confirmed for this product, so none is
    // offered and none is promised. An empty list is the honest state.
    handles: [],
    printOptions: INSULATED_PRINTING,
    quantityPresets: [5000, 10000],
    allowCustomQuantity: false,
    minQuantity: 5000,
    pricingTiers: [
      { minQty: 5000, unitPriceCents: 19 },
      { minQty: 10000, unitPriceCents: 15 },
    ],
    pricingStatus: "LIVE",
    currency: "USD",
    specifications: [
      { label: "Outer layer", value: "PP laminated" },
      { label: "Middle layer", value: "Non-woven fabric" },
      { label: "Inner layer", value: "Aluminium foil" },
      { label: "Large", value: "26 × 26 × 17 cm (width × height × side gusset)" },
      { label: "Extra Large", value: "30 × 30 × 20 cm (width × height × side gusset)" },
      { label: "Printing", value: "Custom logo / artwork, digital proof before production" },
      { label: "Minimum order", value: "5,000 pieces per design" },
    ],
    highlights: [
      "Custom logo/artwork printing",
      "Black or white",
      "Two restaurant-friendly sizes",
      "5,000-piece minimum",
      "Digital proof before production",
      "15–30 day production after approval",
      "Flat $100 U.S. shipping",
    ],
    // [TO BE PROVIDED] — owner/supplier photography only. No AI-generated
    // product imagery, no invented file paths. Until `src` is filled the page
    // renders a labelled placeholder slot and launch readiness reports the
    // product photography as incomplete.
    images: [
      { src: null, alt: "Black custom printed insulated takeout bag", slot: "hero-black" },
      { src: null, alt: "White insulated restaurant takeout bag", slot: "white" },
      { src: null, alt: "Black and white insulated takeout bags in the two standard base colors", slot: "base-colors" },
      { src: null, alt: "Large and extra-large insulated bag size comparison", slot: "size-guide" },
      { src: null, alt: "Extra-large insulated takeout bag with a real custom print", slot: "xl-print-example" },
      { src: null, alt: "Custom bag artwork proof example", slot: "artwork-proof" },
    ],
  },
  {
    id: "p-heavy-duty",
    slug: "heavy-duty-restaurant-takeout-bag",
    title: "Heavy-Duty Restaurant Takeout Bag",
    positioning:
      "Thicker non-woven fabric for heavy or multi-container orders.",
    description:
      "A heavier-weight version of our standard takeout bag for restaurants moving large orders — family meals, catering trays, multi-bag deliveries. Same customization: size, color, printing, volume pricing.",
    launchEnabled: false,
    sizes: STANDARD_SIZES.slice(1),
    materials: [STANDARD_MATERIALS[1]],
    colors: STANDARD_COLORS,
    handles: STANDARD_HANDLES,
    printOptions: STANDARD_PRINT_OPTIONS,
    quantityPresets: QTY_PRESETS,
    allowCustomQuantity: true,
    minQuantity: 500,
    pricingTiers: [
      { minQty: 500, unitPriceCents: 78 },
      { minQty: 1000, unitPriceCents: 69 },
      { minQty: 2500, unitPriceCents: 61 },
      { minQty: 5000, unitPriceCents: 55 },
      { minQty: 10000, unitPriceCents: 49 },
    ],
    pricingStatus: "DEMO",
    currency: "USD",
    specifications: [],
    highlights: [],
    images: [
      { src: null, alt: "White-background product shot of the heavy-duty takeout bag", slot: "white-background" },
      { src: null, alt: "Heavy-duty bag loaded with multiple takeout containers", slot: "capacity" },
    ],
  },
  {
    id: "p-cafe-carryout",
    slug: "custom-cafe-carryout-bag",
    title: "Custom Cafe Carryout Bag",
    positioning:
      "Sized for coffee, pastries and small orders — with your cafe's logo.",
    description:
      "A smaller-format carryout bag for coffee shops, cafes and bakeries. Fits drink carriers, pastry boxes and small orders. Custom printing turns every to-go order into a branded touchpoint.",
    launchEnabled: false,
    sizes: STANDARD_SIZES.slice(0, 3),
    materials: STANDARD_MATERIALS,
    colors: STANDARD_COLORS,
    handles: STANDARD_HANDLES,
    printOptions: STANDARD_PRINT_OPTIONS,
    quantityPresets: QTY_PRESETS,
    allowCustomQuantity: true,
    minQuantity: 500,
    pricingTiers: [
      { minQty: 500, unitPriceCents: 55 },
      { minQty: 1000, unitPriceCents: 48 },
      { minQty: 2500, unitPriceCents: 42 },
      { minQty: 5000, unitPriceCents: 37 },
      { minQty: 10000, unitPriceCents: 33 },
    ],
    pricingStatus: "DEMO",
    currency: "USD",
    specifications: [],
    highlights: [],
    images: [
      { src: null, alt: "White-background product shot of the cafe carryout bag", slot: "white-background" },
      { src: null, alt: "Cafe carryout bag with a drink carrier and pastry box", slot: "cafe-use" },
    ],
  },
  {
    id: "p-catering",
    slug: "large-catering-takeout-bag",
    title: "Large Catering Takeout Bag",
    positioning:
      "Extra-wide gusset for trays, platters and catering orders.",
    description:
      "Our largest format: an extra-wide gusset that carries catering trays and platters flat. Reinforced construction options and full custom printing for catering and events businesses.",
    launchEnabled: false,
    sizes: [STANDARD_SIZES[2], STANDARD_SIZES[3]],
    materials: [STANDARD_MATERIALS[1]],
    colors: STANDARD_COLORS,
    handles: STANDARD_HANDLES,
    printOptions: STANDARD_PRINT_OPTIONS,
    quantityPresets: QTY_PRESETS,
    allowCustomQuantity: true,
    minQuantity: 500,
    pricingTiers: [
      { minQty: 500, unitPriceCents: 92 },
      { minQty: 1000, unitPriceCents: 83 },
      { minQty: 2500, unitPriceCents: 74 },
      { minQty: 5000, unitPriceCents: 66 },
    ],
    pricingStatus: "DEMO",
    currency: "USD",
    specifications: [],
    highlights: [],
    images: [
      { src: null, alt: "White-background product shot of the large catering bag", slot: "white-background" },
      { src: null, alt: "Catering bag holding a full-size tray", slot: "capacity" },
    ],
  },
];

/**
 * The products a customer may actually see and buy.
 *
 * EVERY customer-facing and commerce read goes through this (via
 * lib/commerce/catalog.ts), so a launch-disabled product cannot be browsed,
 * priced, added to a cart, checked out, described by the AI, listed in the
 * sitemap, or required in the Shopify merchandise map.
 *
 * `PRODUCTS` remains the FULL catalog and is the right input for
 * configuration validation (cost-model coverage), which must still see the
 * entries that exist in the file.
 */
export const LAUNCH_PRODUCTS: Product[] = PRODUCTS.filter((p) => p.launchEnabled);

/** Launch-enabled lookup by slug. A disabled product is "not found". */
export function getProductBySlug(slug: string): Product | undefined {
  return LAUNCH_PRODUCTS.find((p) => p.slug === slug);
}

export function getHeroProduct(): Product {
  return LAUNCH_PRODUCTS.find((p) => p.hero) ?? LAUNCH_PRODUCTS[0];
}
