/** Core commerce domain types. Provider-agnostic — Shopify maps onto these. */

export type SizeOption = {
  id: string;
  label: string;
  /** Inches: width × height × gusset. */
  dimensions: { width: number; height: number; gusset: number };
};

export type MaterialOption = {
  id: string;
  label: string;
  /** GSM if confirmed; null until factory specs are provided. */
  gsm: number | null;
  /** Per-unit price delta in cents (can be 0). */
  priceDeltaCents: number;
};

export type ColorOption = {
  id: string;
  label: string;
  /** CSS color for the swatch. */
  swatch: string;
  custom?: boolean;
};

export type HandleOption = {
  id: string;
  label: string;
  /** Only publish once factory capability is confirmed. */
  confirmed: boolean;
};

export type PrintOption = {
  id: "none" | "one-color" | "two-color" | "full-custom";
  label: string;
  description: string;
  /** Per-unit price delta in cents. */
  priceDeltaCents: number;
  requiresArtwork: boolean;
};

export type PricingTier = {
  /** Minimum quantity for this tier (inclusive). */
  minQty: number;
  /** Unit price in cents. */
  unitPriceCents: number;
};

export type Product = {
  id: string;
  slug: string;
  title: string;
  positioning: string;
  description: string;
  /** Hero product gets top billing everywhere. */
  hero?: boolean;
  sizes: SizeOption[];
  materials: MaterialOption[];
  colors: ColorOption[];
  handles: HandleOption[];
  printOptions: PrintOption[];
  /** Quantity presets surfaced in the selector. */
  quantityPresets: number[];
  minQuantity: number;
  /** Volume tiers, ascending by minQty. Base price before option deltas. */
  pricingTiers: PricingTier[];
  /** "DEMO" pricing renders with a visible notice; "LIVE" is real. */
  pricingStatus: "DEMO" | "LIVE";
  currency: "USD" | "CAD";
  /** Image slots — paths under /public or full URLs; empty = placeholder slot. */
  images: { src: string | null; alt: string; slot: string }[];
};

export type ProductConfiguration = {
  productId: string;
  sizeId: string;
  materialId: string;
  colorId: string;
  printOptionId: PrintOption["id"];
  quantity: number;
  artwork?: ArtworkRef | null;
  customDimensions?: { width: number; height: number; gusset: number } | null;
};

export type ArtworkRef = {
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  /** Object URL / uploaded location. Mock provider keeps a local object URL. */
  url?: string;
  notes?: string;
};

export type CartLine = {
  lineId: string;
  config: ProductConfiguration;
  /** Snapshot at add-to-cart time; re-priced on cart render. */
  unitPriceCents: number;
  totalCents: number;
  title: string;
  optionSummary: string;
};

export type Cart = {
  lines: CartLine[];
  currency: "USD" | "CAD";
};

export type PriceQuote = {
  unitPriceCents: number;
  totalCents: number;
  tier: PricingTier;
  /** Savings vs the first (smallest-qty) tier, 0–1. */
  savingsPct: number;
  currency: "USD" | "CAD";
};

export type CheckoutResult =
  | { kind: "redirect"; url: string }
  | { kind: "mock"; orderId: string };
