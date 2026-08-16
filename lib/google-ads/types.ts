/**
 * Internal Google Ads vocabulary (Session 13 spec §4).
 *
 * Raw Google Ads API response objects NEVER leave `lib/google-ads`. The
 * adapter maps them into these types at the boundary, and everything above —
 * persistence, the deterministic intelligence module, the admin surface, the
 * agent — speaks only this vocabulary.
 *
 * Two rules are baked into the shapes themselves:
 *
 *  1. MONEY IS INTEGER MICROS AT THE EDGE, INTEGER CENTS INTERNALLY. Google
 *     returns `cost_micros` (1/1,000,000 of the account currency unit). We
 *     convert ONCE, here, to integer cents — the project-wide money
 *     convention — and never let a floating-point dollar become the
 *     persistence authority (spec §13).
 *
 *  2. GOOGLE'S CONVERSIONS ARE NOT OUR ORDERS. Every Google-reported
 *     conversion field carries `google` in its name. There is deliberately
 *     no field called `orders` or `revenueCents` on a Google metrics row,
 *     so the two can never be confused by a careless destructure
 *     (spec §14, §34).
 */

/** Identity of the connected Google Ads account (spec §47–§48). */
export type GoogleAdsAccountInfo = {
  /** Customer id, digits only (no dashes) — the form the API uses. */
  customerId: string;
  /** Human-readable account name as Google reports it. */
  descriptiveName: string | null;
  /** ISO-4217 currency of the ACCOUNT. Never assumed (spec §30). */
  currencyCode: string;
  /** IANA time zone the account reports its days in. Never assumed UTC (spec §29). */
  timeZone: string;
  /** True when this customer is a manager (MCC) account. */
  isManager: boolean;
  /** True when this is a Google Ads test account (no real serving data). */
  isTestAccount: boolean;
  /** The manager id used as `login-customer-id`, when one is configured. */
  loginCustomerId: string | null;
};

/**
 * Google's own campaign status, passed through verbatim as a lowercase
 * string. We do not re-map it to our own vocabulary: it describes THEIR
 * object, and inventing a parallel status model would invite a future
 * writer to think it could be set.
 */
export type GoogleAdsCampaignStatus = string;

/**
 * One campaign × one reporting DAY, as the account's own calendar reports
 * it (spec §29). `date` is a plain `YYYY-MM-DD` string, not a Date, because
 * it is an account-timezone calendar day and converting it to an instant
 * would silently pick a timezone.
 */
export type GoogleAdsCampaignDay = {
  customerId: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: GoogleAdsCampaignStatus;
  /** Google's advertising channel type, e.g. SEARCH / PERFORMANCE_MAX. */
  advertisingChannelType: string | null;
  /** Account-timezone calendar date, `YYYY-MM-DD`. */
  date: string;
  impressions: number;
  clicks: number;
  /** Converted from `cost_micros` to integer cents in the ACCOUNT currency. */
  costCents: number;
  /** Currency of `costCents`. From the account, never assumed. */
  currencyCode: string;
  /**
   * GOOGLE-REPORTED conversions, per the account's own conversion setup.
   * A float on purpose: Google reports fractional conversions under
   * data-driven attribution. This is NOT a BagDirect order count (spec §14).
   */
  googleConversions: number;
  /**
   * GOOGLE-REPORTED conversion value, converted to integer cents in the
   * account currency. This is NOT BagDirect revenue (spec §34).
   */
  googleConversionValueCents: number;
};

/** A bounded report result, with truncation reported rather than hidden. */
export type GoogleAdsReport<T> = {
  rows: T[];
  /** True when the row cap or page cap stopped the fetch early (spec §43). */
  truncated: boolean;
  /** Pages actually fetched — recorded on the sync run for quota accounting. */
  pagesFetched: number;
};

/**
 * Convert Google's micros to integer cents, exactly and safely.
 *
 * 1 unit = 1,000,000 micros = 100 cents, so cents = micros / 10,000.
 * Rounded half-away-from-zero to an integer: sub-cent spend exists in the
 * API (a $0.000031 cost is representable) and truncating it would make a
 * long tail of tiny costs vanish, quietly understating spend.
 */
export function microsToCents(micros: number | string | null | undefined): number {
  if (micros === null || micros === undefined) return 0;
  const value = typeof micros === "string" ? Number(micros) : micros;
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / 10_000);
}

/** Digits-only customer id (Google accepts `123-456-7890` from humans). */
export function normalizeCustomerId(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** `YYYY-MM-DD` validation — the only date shape Google Ads reporting uses. */
export function isReportDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
