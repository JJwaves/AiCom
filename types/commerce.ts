/** Core commerce domain types. Provider-agnostic — Shopify maps onto these. */

export type DimensionUnit = "in" | "cm";

export type SizeOption = {
  id: string;
  label: string;
  /**
   * width × height × side (gusset), in `unit`. The unit is explicit per size
   * because the launch product is specified in centimetres by the factory
   * while the older catalog entries are in inches — a bare number that means
   * inches on one product and centimetres on another is how a customer ends
   * up ordering a bag half the size they expected.
   */
  dimensions: { width: number; height: number; gusset: number };
  unit: DimensionUnit;
  /**
   * Per-unit sell-price delta in cents for choosing this size, applied on top
   * of the quantity tier. 0 for sizes that carry the tier price.
   */
  priceDeltaCents: number;
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

/** A fixed construction/spec fact. NOT customer-selectable. */
export type ProductSpecification = { label: string; value: string };

export type Product = {
  id: string;
  slug: string;
  title: string;
  positioning: string;
  description: string;
  /** Hero product gets top billing everywhere. */
  hero?: boolean;
  /**
   * Is this product part of the current launch?
   *
   * FALSE means the product is not sellable and not publicly rendered: the
   * catalog facade (lib/commerce/catalog.ts) hides it, so its page 404s, it
   * is absent from listings, the sitemap, AI tool results and the Shopify
   * merchandise requirements. The entry stays in the file — catalog
   * architecture for future products is not deleted — but a customer can
   * never reach or buy it.
   *
   * A product carrying demo/unconfirmed production data MUST be
   * launchEnabled: false.
   */
  launchEnabled: boolean;
  sizes: SizeOption[];
  materials: MaterialOption[];
  colors: ColorOption[];
  handles: HandleOption[];
  printOptions: PrintOption[];
  /** Quantity presets surfaced in the selector. */
  quantityPresets: number[];
  /**
   * May a customer type an arbitrary quantity and check out with it?
   *
   * FALSE = the presets ARE the orderable quantities. Anything else routes
   * to the custom-quote flow — enforced in `requiresCustomQuote`, so the
   * server rejects an off-tier quantity even if the browser sends one.
   */
  allowCustomQuantity: boolean;
  minQuantity: number;
  /** Volume tiers, ascending by minQty. Base price before option deltas. */
  pricingTiers: PricingTier[];
  /** "DEMO" pricing renders with a visible notice; "LIVE" is real. */
  pricingStatus: "DEMO" | "LIVE";
  currency: "USD" | "CAD";
  /**
   * Fixed construction facts (material stack, layers). Rendered as product
   * SPECIFICATIONS — never as selectable options.
   */
  specifications: ProductSpecification[];
  /** Short, verifiable selling points rendered as bullets. No unsupported claims. */
  highlights: string[];
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
  /**
   * Durable BagDirect artwork id (`art_…`) — THE authoritative reference to
   * the uploaded file, minted by /api/artwork/upload and backed by the
   * `artworks` row + object storage. Production Launch Session 02 made this
   * the identity that travels into the cart, the order line and Shopify.
   *
   * Optional only for backwards compatibility with configurations persisted
   * before durable storage existed; every NEW artwork has one, and checkout
   * for a print option that requires artwork rejects a ref without it.
   */
  artworkId?: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  /**
   * DEPRECATED as a persistence mechanism. Previously a browser
   * `blob:`/object URL, which died with the tab and could never reach the
   * factory. Never written by the upload flow any more, never persisted, and
   * rejected at the API boundary — `artworkId` replaced it.
   */
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
  | {
      kind: "redirect";
      /** PROVIDER-GENERATED checkout URL. Never accepted from the browser or a model. */
      url: string;
      /**
       * Provider-side handle for the pre-payment checkout (Shopify draft
       * order GID). Stored as `orders.provider_checkout_ref` so the paid
       * order arriving by webhook can be correlated back to this session.
       */
      reference?: string;
    }
  | { kind: "mock"; orderId: string };
