import type { NeedProfileUpdate } from "@/lib/data/customer-need-service";
import type { Product, ProductConfiguration } from "@/types/commerce";

/**
 * Configuration → CustomerNeedProfile mapping (Session 06). What a customer
 * configures is behavioral evidence about their needs; both the manual
 * configurator sync and the AI updateConfiguration tool record it with
 * CONFIGURATOR provenance through applyNeedProfileUpdate — the rank gate
 * (USER_STATED > ORDER_DATA > CONFIGURATOR > … > AI_INFERRED) decides
 * whether each field actually lands. The mapping mirrors the checkout
 * ORDER_DATA enrichment field-for-field so the profile stays comparable
 * across sources.
 *
 * AI-executed changes deliberately use the SAME CONFIGURATOR rank: the tool
 * records what the configuration now IS (configurator-state evidence). When
 * the customer's own words drove the change ("make it black"), the S05
 * evidence-validated extractor independently grants USER_STATED from the
 * actual message — provenance reflects the original source, and no
 * model-writable path to USER_STATED exists.
 */
export function needUpdateFromConfiguration(product: Product, config: ProductConfiguration): NeedProfileUpdate {
  const size = product.sizes.find((s) => s.id === config.sizeId);
  return {
    productInterest: product.id,
    quantity: config.quantity,
    materialPreference: config.materialId,
    colorPreference: config.colorId,
    printingRequirement: config.printOptionId,
    ...(config.artwork ? { logoAvailable: true } : {}),
    ...(size
      ? {
          desiredWidth: size.dimensions.width,
          desiredHeight: size.dimensions.height,
          desiredGusset: size.dimensions.gusset,
        }
      : {}),
  };
}
