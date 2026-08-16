import { COST_MODEL } from "@/config/costs";
import { available, partial, unavailable, type Metric } from "@/modules/business-intelligence/availability";
import { isCostModelFullyConfigured } from "@/modules/business-intelligence/profitability";
import { GOOGLE_ADS } from "@/config/google-ads";
import { computePaidMediaEconomics } from "@/modules/pricing";
import { round2 } from "./native";

/**
 * Advertising efficiency (Session 13 spec §19–§21, §57).
 *
 * FOUR SEPARATE CONCEPTS, FOUR SEPARATE NAMES. This file exists so nobody
 * ever has to guess which one a number is:
 *
 *   googleReportedCostPerConversion  Google's cost ÷ Google's conversions.
 *                                    Google's conversion actions decide what
 *                                    a "conversion" is. NOT our CAC.
 *   firstPartyCostPerOrder           Google Ads spend ÷ BagDirect orders we
 *                                    attributed to Google Ads. This is the
 *                                    one that means "what an order cost us".
 *   googleReportedRoas               Google's conversion VALUE ÷ Google's cost.
 *   firstPartyRoas                   BagDirect attributed REVENUE ÷ Google's
 *                                    cost. Revenue, not profit.
 *
 * And the fifth, which exists only when profit does:
 *
 *   profitOnAdSpend (POAS)           Contribution profit BEFORE paid media
 *                                    ÷ Google Ads cost (Session 13.5 §19).
 *                                    "How much pre-ad contribution profit did
 *                                    each advertising dollar generate?"
 *                                    UNAVAILABLE while `config/costs.ts` holds
 *                                    null placeholders or the attributed
 *                                    orders carry no cost snapshot. Revenue is
 *                                    NEVER substituted for profit (spec §21,
 *                                    §57; 13.5 §20).
 *
 * ROAS AND POAS ARE NEVER MERGED OR RELABELLED (13.5 §20). ROAS divides
 * REVENUE by spend; POAS divides CONTRIBUTION PROFIT by spend. A campaign can
 * show ROAS 4 and POAS 0.6 — that gap is the reason both exist.
 *
 * CURRENCY IS A HARD GATE (spec §30). Every ratio here mixes a Google Ads
 * figure with a BagDirect figure. If the account currency and the order
 * currency differ, the ratio is meaningless and is returned UNAVAILABLE with
 * that reason — there is no FX model in this session, and inventing a rate
 * would silently corrupt every efficiency number.
 */

export type CurrencyCompatibility =
  | { compatible: true; currency: string }
  | { compatible: false; adCurrency: string | null; revenueCurrencies: string[]; reason: string };

/**
 * Decide whether ad spend and first-party revenue may be divided at all.
 *
 * A period with NO orders is compatible: there is no conflicting currency,
 * and the resulting metrics are honestly zero-numerator rather than blocked.
 */
export function checkCurrencyCompatibility(
  adCurrency: string | null,
  revenueCurrencies: string[],
): CurrencyCompatibility {
  if (!adCurrency) {
    return {
      compatible: false,
      adCurrency: null,
      revenueCurrencies,
      reason:
        "The Google Ads account currency is unknown for this window (no synced data, or more than one currency in the same window), so spend cannot be compared with revenue.",
    };
  }
  const distinct = [...new Set(revenueCurrencies)];
  if (distinct.length === 0) return { compatible: true, currency: adCurrency };
  if (distinct.length > 1) {
    return {
      compatible: false,
      adCurrency,
      revenueCurrencies: distinct,
      reason: `Orders in this period are in more than one currency (${distinct.join(", ")}), so they cannot be combined into a single figure to compare with ${adCurrency} ad spend. No conversion model exists.`,
    };
  }
  if (distinct[0] !== adCurrency) {
    return {
      compatible: false,
      adCurrency,
      revenueCurrencies: distinct,
      reason: `Google Ads reports spend in ${adCurrency} but orders are in ${distinct[0]}. Comparing them requires an exchange-rate model, which this system deliberately does not have — so CAC and ROAS are unavailable rather than wrong.`,
    };
  }
  return { compatible: true, currency: adCurrency };
}

export type AdEfficiency = {
  currency: CurrencyCompatibility;

  /* -------- Google's own lens -------- */
  /** Google cost ÷ Google conversions, cents. Never called CAC (spec §19). */
  googleReportedCostPerConversionCents: Metric<number>;
  /** Google conversion value ÷ Google cost (spec §20). */
  googleReportedRoas: Metric<number>;

  /* -------- BagDirect's lens -------- */
  /**
   * Google Ads spend ÷ ORDERS attributed to Google Ads by first-party data.
   * The denominator is named in `firstPartyCacDenominator` and rendered
   * beside the number everywhere it appears (spec §19).
   */
  firstPartyCostPerOrderCents: Metric<number>;
  firstPartyCacDenominator: string;
  /** Attributed first-party REVENUE ÷ Google Ads spend (spec §20). */
  firstPartyRoas: Metric<number>;

  /* -------- Profit (Session 13.5) -------- */
  /** Contribution profit before paid media on the attributed orders, cents. */
  contributionBeforePaidMediaCents: Metric<number>;
  /** POAS = contribution profit before paid media ÷ ad spend. NOT revenue. */
  profitOnAdSpend: Metric<number>;
  /**
   * Contribution profit AFTER paid media, cents: contribution before paid
   * media − ad spend. May be negative — that is the finding, not an error.
   */
  postAdContributionCents: Metric<number>;
  /** The exact config paths blocking profit-based efficiency. */
  profitBlockers: string[];
};

export type EfficiencyInput = {
  costCents: number;
  adCurrency: string | null;
  googleConversions: number;
  googleConversionValueCents: number;
  /** BagDirect orders attributed to Google Ads (any match quality). */
  firstPartyOrders: number;
  /** BagDirect revenue from those orders, integer cents. */
  firstPartyRevenueCents: number;
  /** Currencies present on those orders. */
  revenueCurrencies: string[];
  /** Share of Google Ads sessions tied to a campaign, or null. */
  attributionMatchedPct: number | null;
  /** True when the reporting window has no synced Google Ads data at all. */
  noAdData: boolean;
  /**
   * Contribution profit before paid media across the attributed orders that
   * carry a cost snapshot, cents. `null` = unavailable — never 0.
   */
  contributionBeforePaidMediaCents: number | null;
  /** How many attributed orders that figure covers (the coverage denominator). */
  ordersWithContribution: number;
};

export function computeEfficiency(input: EfficiencyInput): AdEfficiency {
  const currency = checkCurrencyCompatibility(input.adCurrency, input.revenueCurrencies);
  const profitBlockers = missingCostPaths();

  const noSpend = input.costCents <= 0;
  const spendReason = input.noAdData
    ? "No Google Ads data has been synced for this period, so there is no spend figure to divide. This is not zero spend."
    : "No Google Ads spend was recorded in this period, so cost-based ratios have no denominator.";

  /* ---- Google's lens. Needs no first-party data and no currency check:
   * both sides come from the same account in the same currency. ---- */
  const googleCpa: Metric<number> = input.noAdData
    ? unavailable(spendReason)
    : input.googleConversions > 0
      ? available(Math.round(input.costCents / input.googleConversions))
      : unavailable(
          "Google reported no conversions in this period, so Google's own cost per conversion has no denominator. This does not mean nobody bought — it means Google's conversion tracking counted nothing.",
        );

  const googleRoas: Metric<number> = input.noAdData
    ? unavailable(spendReason)
    : noSpend
      ? unavailable(spendReason)
      : available(round2(input.googleConversionValueCents / input.costCents));

  /* ---- BagDirect's lens. Both the currency gate and the attribution
   * coverage gate apply. ---- */
  const firstPartyCacDenominator =
    "BagDirect orders whose session arrived from a Google Ads click in this period (first-party attribution), NOT Google-reported conversions.";

  let firstPartyCac: Metric<number>;
  let firstPartyRoas: Metric<number>;

  if (input.noAdData || noSpend) {
    firstPartyCac = unavailable(spendReason);
    firstPartyRoas = unavailable(spendReason);
  } else if (!currency.compatible) {
    firstPartyCac = unavailable(currency.reason, ["Google Ads account currency", "order currency"]);
    firstPartyRoas = unavailable(currency.reason, ["Google Ads account currency", "order currency"]);
  } else {
    const coveragePartial =
      input.attributionMatchedPct !== null && input.attributionMatchedPct < GOOGLE_ADS.MIN_ATTRIBUTION_COVERAGE_PCT;
    const coverageReason = `Only ${input.attributionMatchedPct}% of Google Ads sessions could be tied to a campaign, so first-party outcomes are attributed to Google Ads overall but under-assigned per campaign. The account-level figure is complete; campaign-level figures are not.`;

    if (input.firstPartyOrders > 0) {
      const value = Math.round(input.costCents / input.firstPartyOrders);
      firstPartyCac = coveragePartial ? partial(value, coverageReason) : available(value);
    } else {
      firstPartyCac = unavailable(
        "No BagDirect orders in this period were attributed to a Google Ads click, so cost per attributed order has no denominator. Spend was real; the orders it produced, if any, were not identifiable as Google Ads traffic.",
      );
    }

    const roasValue = round2(input.firstPartyRevenueCents / input.costCents);
    firstPartyRoas =
      input.firstPartyOrders === 0
        ? partial(
            roasValue,
            "No orders were attributed to Google Ads in this period, so first-party ROAS is 0 by measurement, not by proof that the advertising produced nothing. Check attribution coverage before concluding anything.",
          )
        : coveragePartial
          ? partial(roasValue, coverageReason)
          : available(roasValue);
  }

  /* ---- Profit (13.5 §18–§20, §35, §36, §57). ----
   *
   * POAS needs FOUR things, and the absence of any one of them makes it
   * unavailable rather than approximate:
   *   1. contribution profit for the attributed orders (costs configured
   *      AND recorded on those orders);
   *   2. real ad spend to divide by;
   *   3. compatible currencies — no FX model exists, none is invented;
   *   4. attribution coverage good enough to say which orders the spend
   *      produced. Weak coverage yields PARTIAL, never a confident number.
   */
  const contributionUnavailableReason =
    profitBlockers.length > 0
      ? "Profit-based advertising efficiency is unavailable — manufacturing costs are not configured, so contribution profit cannot be computed for any order. Revenue-based ROAS is shown instead and is NOT a profitability measure."
      : "Profit-based advertising efficiency is unavailable — the orders attributed to Google Ads in this period carry no cost snapshot, so their contribution profit was never recorded. Today's costs are deliberately not applied backwards.";

  const coverageBelowMinimum =
    input.attributionMatchedPct !== null && input.attributionMatchedPct < GOOGLE_ADS.MIN_ATTRIBUTION_COVERAGE_PCT;
  const contributionCovered =
    input.ordersWithContribution > 0 && input.ordersWithContribution >= input.firstPartyOrders;
  const partialReason = !contributionCovered
    ? `Contribution profit covers ${input.ordersWithContribution} of ${input.firstPartyOrders} attributed orders — the rest carry no cost snapshot, so this figure understates neither profit nor loss; it simply covers fewer orders.`
    : coverageBelowMinimum
      ? `Only ${input.attributionMatchedPct}% of Google Ads sessions could be tied to a campaign, so the profit attributed to advertising is incomplete at campaign level.`
      : undefined;

  let contributionMetric: Metric<number>;
  let profitOnAdSpend: Metric<number>;
  let postAdContributionCents: Metric<number>;

  if (input.contributionBeforePaidMediaCents === null) {
    contributionMetric = unavailable(contributionUnavailableReason, profitBlockers);
    profitOnAdSpend = unavailable(contributionUnavailableReason, profitBlockers);
    postAdContributionCents = unavailable(contributionUnavailableReason, profitBlockers);
  } else if (!currency.compatible) {
    contributionMetric = unavailable(currency.reason, ["Google Ads account currency", "order currency"]);
    profitOnAdSpend = unavailable(currency.reason, ["Google Ads account currency", "order currency"]);
    postAdContributionCents = unavailable(currency.reason, ["Google Ads account currency", "order currency"]);
  } else {
    const contribution = input.contributionBeforePaidMediaCents;
    contributionMetric = partialReason ? partial(contribution, partialReason) : available(contribution);
    const paid = computePaidMediaEconomics({
      contributionBeforePaidMediaCents: contribution,
      adSpendCents: input.costCents,
      partialReason,
    });
    if (paid.status === "UNAVAILABLE") {
      profitOnAdSpend = unavailable(paid.reason, paid.missingInputs);
      postAdContributionCents = unavailable(paid.reason, paid.missingInputs);
    } else {
      const post = paid.postAdContributionCents;
      postAdContributionCents =
        paid.status === "PARTIAL" ? partial(post, paid.reason as string) : available(post);
      profitOnAdSpend =
        paid.poas === null
          ? unavailable(spendReason)
          : paid.status === "PARTIAL"
            ? partial(paid.poas, paid.reason as string)
            : available(paid.poas);
    }
  }

  return {
    currency,
    googleReportedCostPerConversionCents: googleCpa,
    googleReportedRoas: googleRoas,
    firstPartyCostPerOrderCents: firstPartyCac,
    firstPartyCacDenominator,
    firstPartyRoas,
    contributionBeforePaidMediaCents: contributionMetric,
    profitOnAdSpend,
    postAdContributionCents,
    profitBlockers,
  };
}

/**
 * Exact `config/costs.ts` paths that must be filled before any profit-based
 * ad metric could exist. Named individually so the owner sees a task list,
 * not the word "unavailable" (spec §21).
 *
 * The COMPLETENESS VERDICT is not re-implemented here — `modules/business-
 * intelligence/profitability.ts → isCostModelFullyConfigured()` has been the
 * authority since Session 09, and two definitions of "are costs configured?"
 * would eventually disagree. This function only names the gaps.
 */
export function missingCostPaths(): string[] {
  const missing: string[] = [];
  if (COST_MODEL.paymentFee.percentBps === null) missing.push("config/costs.ts → paymentFee.percentBps");
  if (COST_MODEL.paymentFee.fixedCents === null) missing.push("config/costs.ts → paymentFee.fixedCents");
  if (COST_MODEL.orderCosts.packagingCentsPerOrder === null)
    missing.push("config/costs.ts → orderCosts.packagingCentsPerOrder");
  if (COST_MODEL.orderCosts.handlingCentsPerOrder === null)
    missing.push("config/costs.ts → orderCosts.handlingCentsPerOrder");
  if (COST_MODEL.shippingPolicy.customerCharge.kind === "unavailable")
    missing.push("config/costs.ts → shippingPolicy.customerCharge");
  const productFields = [
    "baseManufacturingCentsPerUnit",
    "sizeAdjustmentCentsPerUnit",
    "materialAdjustmentCentsPerUnit",
    "printing",
    "packagingCentsPerUnit",
    "shipping",
    "otherVariableCentsPerUnit",
  ] as const;
  for (const [productId, product] of Object.entries(COST_MODEL.products)) {
    for (const field of productFields) {
      if (product[field] === null) missing.push(`config/costs.ts → products.${productId}.${field}`);
    }
  }
  return missing;
}

/** True when contribution profit could be computed. Delegates to S09. */
export function costModelConfigured(): boolean {
  return isCostModelFullyConfigured();
}
