import type { GoogleAdsCredentialStatus } from "./auth";
import type { CredentialSnapshot } from "@/modules/google-ads-intelligence/connection";

/**
 * The adapter → deterministic-module credential bridge (Session 13).
 *
 * `modules/google-ads-intelligence` must not import `lib/google-ads`, so it
 * declares the shape it accepts and this file — on the ADAPTER side of the
 * boundary — maps the real credential status into it.
 *
 * What crosses the boundary is deliberately minimal and non-secret: whether
 * credentials exist, the NAMES of any missing or unusable env vars, the
 * customer id (an account identifier the owner already sees in the Google Ads
 * UI), and the API version. No token, secret or developer token is
 * representable in the target type at all.
 */
export function credentialSnapshotFrom(status: GoogleAdsCredentialStatus): CredentialSnapshot {
  if (!status.configured) {
    return {
      configured: false,
      missing: status.missing,
      invalid: status.invalid,
      customerId: null,
      apiVersion: null,
    };
  }
  return {
    configured: true,
    missing: [],
    invalid: [],
    customerId: status.customerId,
    apiVersion: status.apiVersion,
  };
}
