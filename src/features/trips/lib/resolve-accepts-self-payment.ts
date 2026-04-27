/**
 * Effective Selbstzahler flag: one family-level tier (non-null
 * `billing_types.accepts_self_payment` wins) then payer.
 *
 * Three-tier intent: (1) family if set, (2) else payer, (3) `null` = neither
 * configured (UI warning in Schichtzettel). There is no variant tier in v1
 * (see `billing_variants` deferred).
 *
 * `billingTypeValue` and `null`: "inherit" at family = skip tier-1, use payer.
 * `undefined`: caller has no `billing_type_id` (or no embed) — same as
 * skipping tier-1; `null` and `undefined` for tier-1 are equivalent for
 * resolution (both fall through to payer).
 */
export function resolveAcceptsSelfPayment(
  billingTypeValue: boolean | null | undefined,
  payerValue: boolean | null | undefined
): boolean | null {
  if (billingTypeValue !== null && billingTypeValue !== undefined) {
    return billingTypeValue;
  }
  return payerValue ?? null;
}
