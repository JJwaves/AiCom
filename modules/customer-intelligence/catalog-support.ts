import type { Product } from "@/types/commerce";
import type { RequestKind, SupportVerdict } from "./taxonomy";

/**
 * Deterministic catalog-support decisions (Session 08, spec §20).
 *
 * The classifier may EXTRACT a request ("insulated bag", "pink", "500
 * pieces") but it never decides whether we support it — that verdict comes
 * from the ACTUAL catalog passed in here (lib/commerce/catalog), plus the
 * documented custom-quote routes from modules/pricing:
 *   - custom color   → legal custom-quote configuration state
 *   - custom size    → customDimensions quote path
 *   - below MOQ      → custom-quote routing (never a hard "no")
 *
 * Matching is case-insensitive token/substring matching over the real
 * option ids + labels + product titles. It is deliberately conservative:
 * when a request phrase matches nothing we know, the verdict is
 * "unsupported" ONLY for kinds whose full option space is enumerable in
 * the catalog (color/material/printing/product); free-form capacity
 * requests route to the custom-quote path instead of being called gaps.
 */

export type SupportDecision = {
  verdict: SupportVerdict;
  /** Which catalog fact produced the verdict — keeps every decision explainable. */
  reason: string;
};

const norm = (s: string) => s.toLowerCase().trim();

/**
 * True when any candidate term appears inside the request phrase. Terms
 * shorter than 3 chars (size ids "s"/"m"/"l"/"xl") match only as whole
 * words — a bare substring check would find "s" inside "inches".
 */
function phraseMatches(phrase: string, terms: string[]): boolean {
  const p = norm(phrase);
  const words = new Set(p.split(/[^a-z0-9]+/));
  return terms.some((raw) => {
    const t = norm(raw);
    if (t.length === 0) return false;
    return t.length < 3 ? words.has(t) : p.includes(t);
  });
}

/** Terms that describe the product family the catalog actually sells. */
function catalogProductTerms(products: Product[]): string[] {
  const terms = new Set<string>(["non-woven", "non woven", "nonwoven", "takeout bag", "take-out bag", "carryout bag", "carry-out bag", "tote"]);
  for (const p of products) {
    terms.add(norm(p.title));
    for (const word of p.slug.split("-")) if (word.length > 3) terms.add(word);
  }
  return [...terms];
}

export function checkRequestSupport(
  products: Product[],
  request: { kind: RequestKind; normalized: string },
): SupportDecision {
  const phrase = norm(request.normalized);
  if (phrase.length === 0) return { verdict: "supported", reason: "empty request phrase — nothing to assess" };

  switch (request.kind) {
    case "size": {
      const sizeTerms = products.flatMap((p) => p.sizes.flatMap((s) => [s.id, s.label]));
      if (phraseMatches(phrase, sizeTerms)) {
        return { verdict: "supported", reason: "matches a catalog size option" };
      }
      // Custom dimensions are an existing quote path — a size we don't stock is not a product gap.
      return { verdict: "custom_quote_path", reason: "no standard size match; custom dimensions quote path exists" };
    }
    case "color": {
      const colorTerms = products.flatMap((p) => p.colors.filter((c) => !c.custom).flatMap((c) => [c.id, c.label]));
      if (phraseMatches(phrase, colorTerms)) {
        return { verdict: "supported", reason: "matches a standard catalog color" };
      }
      const hasCustomColor = products.some((p) => p.colors.some((c) => c.custom));
      if (hasCustomColor) {
        return { verdict: "custom_quote_path", reason: "not a standard color; custom color quote path exists" };
      }
      return { verdict: "unsupported", reason: "color not in catalog and no custom color option" };
    }
    case "material": {
      const materialTerms = products.flatMap((p) => p.materials.flatMap((m) => [m.id, m.label]));
      if (phraseMatches(phrase, materialTerms)) {
        return { verdict: "supported", reason: "matches a catalog material" };
      }
      return { verdict: "unsupported", reason: "material not offered by any catalog product" };
    }
    case "printing": {
      const printTerms = products.flatMap((p) => p.printOptions.flatMap((o) => [o.id, o.label]));
      if (phraseMatches(phrase, printTerms)) {
        return { verdict: "supported", reason: "matches a catalog print option" };
      }
      return { verdict: "unsupported", reason: "printing method not offered in the catalog" };
    }
    case "product": {
      if (phraseMatches(phrase, catalogProductTerms(products))) {
        return { verdict: "supported", reason: "matches the catalog product family" };
      }
      return { verdict: "unsupported", reason: "no catalog product covers this request" };
    }
    case "capacity":
      // The catalog publishes dimensions, not capacity claims; custom dimensions cover bespoke needs.
      return { verdict: "custom_quote_path", reason: "capacity needs route to sizes/custom dimensions" };
    case "other":
      return { verdict: "custom_quote_path", reason: "unclassified request — routed to human/custom quote, not labeled a gap" };
  }
}

/**
 * Below-MOQ is decided ONLY from real numbers: a stated/configured quantity
 * against the product's actual minQuantity (500 across today's catalog).
 */
export function isBelowMoq(products: Product[], quantity: number, productId?: string | null): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  const product = productId ? products.find((p) => p.id === productId) : undefined;
  if (product) return quantity < product.minQuantity;
  const minMoq = Math.min(...products.map((p) => p.minQuantity));
  return quantity < minMoq;
}
