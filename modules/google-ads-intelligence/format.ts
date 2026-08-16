/**
 * Money formatting for deterministic descriptions (Session 13).
 *
 * `lib/format.ts` only knows the currencies BagDirect sells in (USD/CAD).
 * A Google Ads account can report in any ISO-4217 currency, and this module
 * must be able to SAY what it read without pretending the amount is one of
 * ours. So: integer cents in, "1,234.56 EUR" out — the currency code is
 * always shown, never assumed and never converted.
 */
export function formatMoneyish(cents: number, currencyCode: string | null): string {
  const amount = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currencyCode ? `${amount} ${currencyCode}` : amount;
}
