import type { Product } from "@/types/commerce";

/**
 * Seed product catalog.
 *
 * ALL PRICING IS DEMO PRICING (pricingStatus: "DEMO") and renders with a
 * visible notice until replaced with factory-confirmed numbers.
 * See BUSINESS_CONFIG_TODO.md → "Price per configuration".
 *
 * In production this file is superseded by the Shopify catalog via
 * lib/commerce/shopify.ts; the shapes are identical.
 */

const STANDARD_SIZES = [
  { id: "s", label: "Small", dimensions: { width: 8, height: 10, gusset: 4 } },
  { id: "m", label: "Medium", dimensions: { width: 12, height: 10, gusset: 8 } },
  { id: "l", label: "Large", dimensions: { width: 14, height: 12, gusset: 9 } },
  { id: "xl", label: "XL", dimensions: { width: 16, height: 14, gusset: 10 } },
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
    slug: "custom-non-woven-takeout-bags",
    title: "Custom Non-Woven Takeout Bag",
    positioning:
      "The workhorse takeout bag: reusable non-woven fabric, your logo, priced by volume.",
    description:
      "A reusable non-woven takeout bag built for restaurant service — wide gusset for takeout containers, loop handles, and custom logo printing. Configure size, color, printing and quantity below; the price updates as you go.",
    hero: true,
    sizes: STANDARD_SIZES,
    materials: STANDARD_MATERIALS,
    colors: STANDARD_COLORS,
    handles: STANDARD_HANDLES,
    printOptions: STANDARD_PRINT_OPTIONS,
    quantityPresets: QTY_PRESETS,
    minQuantity: 500,
    pricingTiers: [
      { minQty: 500, unitPriceCents: 62 },
      { minQty: 1000, unitPriceCents: 54 },
      { minQty: 2500, unitPriceCents: 47 },
      { minQty: 5000, unitPriceCents: 42 },
      { minQty: 10000, unitPriceCents: 37 },
      { minQty: 25000, unitPriceCents: 33 },
    ],
    pricingStatus: "DEMO",
    currency: "USD",
    images: [
      { src: null, alt: "White-background product shot of the custom non-woven takeout bag", slot: "white-background" },
      { src: null, alt: "Dimensions diagram: width, height and gusset", slot: "dimensions" },
      { src: null, alt: "Close-up of 1-color logo printing on the bag face", slot: "print-closeup" },
      { src: null, alt: "Takeout bag in use at a restaurant counter", slot: "restaurant-use" },
      { src: null, alt: "Handle and stitching detail", slot: "handle-detail" },
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
    sizes: STANDARD_SIZES.slice(1),
    materials: [STANDARD_MATERIALS[1]],
    colors: STANDARD_COLORS,
    handles: STANDARD_HANDLES,
    printOptions: STANDARD_PRINT_OPTIONS,
    quantityPresets: QTY_PRESETS,
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
    sizes: STANDARD_SIZES.slice(0, 3),
    materials: STANDARD_MATERIALS,
    colors: STANDARD_COLORS,
    handles: STANDARD_HANDLES,
    printOptions: STANDARD_PRINT_OPTIONS,
    quantityPresets: QTY_PRESETS,
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
    sizes: [STANDARD_SIZES[2], STANDARD_SIZES[3]],
    materials: [STANDARD_MATERIALS[1]],
    colors: STANDARD_COLORS,
    handles: STANDARD_HANDLES,
    printOptions: STANDARD_PRINT_OPTIONS,
    quantityPresets: QTY_PRESETS,
    minQuantity: 500,
    pricingTiers: [
      { minQty: 500, unitPriceCents: 92 },
      { minQty: 1000, unitPriceCents: 83 },
      { minQty: 2500, unitPriceCents: 74 },
      { minQty: 5000, unitPriceCents: 66 },
    ],
    pricingStatus: "DEMO",
    currency: "USD",
    images: [
      { src: null, alt: "White-background product shot of the large catering bag", slot: "white-background" },
      { src: null, alt: "Catering bag holding a full-size tray", slot: "capacity" },
    ],
  },
];

export function getProductBySlug(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

export function getHeroProduct(): Product {
  return PRODUCTS.find((p) => p.hero) ?? PRODUCTS[0];
}
