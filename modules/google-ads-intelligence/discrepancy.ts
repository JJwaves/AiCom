import { GOOGLE_ADS } from "@/config/google-ads";
import { round2 } from "./native";

/**
 * Google-native vs first-party discrepancy (Session 13 spec §55).
 *
 * This section exists because the two numbers WILL disagree, and the honest
 * response is to show both and explain why — not to pick one, not to
 * average them, and above all not to ask an AI to "reconcile" them.
 *
 * Legitimate reasons the two differ, none of which is a bug:
 *   - Different attribution windows. Google credits a conversion to the
 *     click's date, up to 90 days later; our order lands on the day it was
 *     placed and is attributed through the session that placed it.
 *   - Different attribution models. Google may use data-driven attribution
 *     and report fractional conversions across several campaigns; we count
 *     whole orders against one session.
 *   - Different definitions. A Google "conversion" is whatever the account's
 *     conversion actions count — possibly a form view or a phone call.
 *   - Cross-device. Google can join a phone click to a desktop purchase; we
 *     cannot, because we never build a cross-device identity graph (spec §59).
 *   - Blocked tracking. A visitor who blocks scripts is invisible to us and
 *     may still be counted by Google.
 *
 * So a discrepancy is a QUESTION, routed to review — never a correction.
 */

export type ConversionDiscrepancy = {
  googleConversions: number;
  googleConversionValueCents: number;
  firstPartyOrders: number;
  firstPartyRevenueCents: number;
  /** Google minus first-party. Positive = Google reports more. */
  conversionDifference: number;
  valueDifferenceCents: number;
  /** Difference as a percent of the LARGER side, or null when both are 0. */
  conversionDifferencePct: number | null;
  valueDifferencePct: number | null;
  /** True when the gap crosses the documented attention threshold. */
  material: boolean;
  /** Owner-language reading. Never asserts which side is right. */
  interpretation: string;
  /** The standing reasons the two can differ. Always populated. */
  knownCauses: string[];
};

const KNOWN_CAUSES = [
  "Google credits a conversion to the day of the CLICK, up to 90 days earlier; BagDirect counts an order on the day it was placed.",
  "Google may split one sale across several campaigns as fractional conversions; BagDirect counts whole orders against one session.",
  "A Google “conversion” is whatever the account's conversion actions are set to count, which may include form views or calls, not only purchases.",
  "Google can connect a phone click to a later desktop purchase. BagDirect deliberately builds no cross-device identity, so it cannot.",
  "A visitor who blocks scripts is invisible to BagDirect's first-party tracking but may still be counted by Google.",
];

export function computeDiscrepancy(input: {
  googleConversions: number;
  googleConversionValueCents: number;
  firstPartyOrders: number;
  firstPartyRevenueCents: number;
  currencyCompatible: boolean;
}): ConversionDiscrepancy {
  const conversionDifference = round2(input.googleConversions - input.firstPartyOrders);
  const valueDifferenceCents = input.googleConversionValueCents - input.firstPartyRevenueCents;

  const conversionDifferencePct = relativeGap(input.googleConversions, input.firstPartyOrders);
  const valueDifferencePct = input.currencyCompatible
    ? relativeGap(input.googleConversionValueCents, input.firstPartyRevenueCents)
    : null;

  const material =
    (conversionDifferencePct !== null && conversionDifferencePct >= GOOGLE_ADS.CONVERSION_DISCREPANCY_PCT) ||
    (valueDifferencePct !== null && valueDifferencePct >= GOOGLE_ADS.CONVERSION_DISCREPANCY_PCT);

  return {
    googleConversions: input.googleConversions,
    googleConversionValueCents: input.googleConversionValueCents,
    firstPartyOrders: input.firstPartyOrders,
    firstPartyRevenueCents: input.firstPartyRevenueCents,
    conversionDifference,
    valueDifferenceCents,
    conversionDifferencePct,
    valueDifferencePct,
    material,
    interpretation: interpret(input, conversionDifferencePct),
    knownCauses: KNOWN_CAUSES,
  };
}

/** Gap as a percent of the larger of the two. Null when both sides are zero. */
function relativeGap(a: number, b: number): number | null {
  const larger = Math.max(a, b);
  if (larger <= 0) return null;
  return round2((Math.abs(a - b) / larger) * 100);
}

function interpret(
  input: { googleConversions: number; firstPartyOrders: number },
  pct: number | null,
): string {
  if (input.googleConversions === 0 && input.firstPartyOrders === 0) {
    return "Neither Google nor BagDirect recorded a conversion in this period, so there is nothing to compare.";
  }
  if (input.googleConversions === 0 && input.firstPartyOrders > 0) {
    return `BagDirect attributed ${input.firstPartyOrders} order(s) to Google Ads traffic while Google reported no conversions at all. That usually means Google Ads conversion tracking is not configured on this site — the orders are real either way, but Google cannot optimise toward something it never sees.`;
  }
  if (input.firstPartyOrders === 0 && input.googleConversions > 0) {
    return `Google reported ${input.googleConversions} conversion(s) but BagDirect attributed no orders to Google Ads traffic in this period. Check what the account's conversion actions actually count, and check that landing pages carry the campaign parameters — this is a measurement question before it is a performance question.`;
  }
  if (pct !== null && pct < GOOGLE_ADS.CONVERSION_DISCREPANCY_PCT) {
    return `Google and BagDirect are within ${pct}% of each other on conversion count. Some difference is expected and does not need explaining.`;
  }
  return `Google and BagDirect differ by ${pct}% on conversion count. This is worth understanding, but it is not automatically a bug — the standing causes below explain most gaps of this size.`;
}
