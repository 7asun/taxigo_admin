/**
 * compute-invoice-km.ts
 *
 * Central KM helper — the **only** place that derives billed kilometres from
 * `invoice_line_items` snapshot fields. All PDF layouts, the detail page, and
 * any future surfaces must call these functions instead of reaching directly
 * for `effective_distance_km` / `distance_km`.
 *
 * ## Why this module exists
 *
 * Before this helper, each consumer independently wrote:
 *   `const lineKm = item.effective_distance_km ?? item.distance_km`
 * The detail page used `distance_km` (routing) only, the PDF used the billed
 * fallback chain, and the builder preview filtered differently. This led to KM
 * totals that disagreed across views for the same invoice — especially visible
 * on branch drafts where inherited `billing_included = false` rows caused silent
 * km losses. See `docs/plans/invoice-km-mismatch-audit.md` for the full audit.
 *
 * ## Rules encoded here
 *
 * K1  Billed km per line = `effective_distance_km ?? distance_km`.
 *     `effective_distance_km` is the admin- or catalog-overridden value used for
 *     pricing and VAT — it is the authoritative "what we billed for" value.
 *     `distance_km` is the routing snapshot fallback (legacy rows where no override
 *     was applied but `effective_distance_km` was not persisted pre-migration).
 *
 * K2  Normal-billed bucket: `billing_included = true` AND `is_cancelled_trip != true`.
 *
 * K3  Cancelled-billed bucket: `billing_included = true` AND `is_cancelled_trip = true`.
 *     These trips billed at €0 in the appendix; their distance is reported
 *     separately so it never inflates Gesamtstrecke.
 *
 * K4  `billing_included = false` rows are ignored in all KM buckets — they were
 *     excluded by the admin and must not contribute to any total.
 *
 * K5  KM is always derived from `invoice_line_items` snapshot columns — never
 *     from live `trips` queries after the invoice has been created.
 *
 * K6  Null propagation per bucket: if any contributing row has null billed km,
 *     the whole bucket returns `null` rather than a partial sum. This matches
 *     the per-group behaviour in `build-invoice-pdf-summary.ts` (`has_null_km`).
 *     `null` renders as `—` in the UI/PDF (unknown distance, not zero).
 */

import { isBillingIncludedRow } from '@/features/invoices/lib/billing-inclusion';

/**
 * Minimal line-item shape needed for KM computation.
 * Matches `InvoiceLineItemRow` distance + inclusion fields.
 */
export type InvoiceKmLineItem = {
  effective_distance_km?: number | null;
  distance_km?: number | null;
  billing_included?: boolean | null;
  is_cancelled_trip?: boolean | null;
};

/**
 * Default for the "show cancelled-billed km on cover" toggle introduced in
 * Step 4. Always `false` — admins opt in explicitly.
 */
export const DEFAULT_SHOW_CANCELLED_BILLED_KM_ON_COVER = false;

/**
 * Internal null-propagating accumulator — used by both buckets in
 * `computeInvoiceKmBuckets`.
 *
 * Returns `null` if *any* contributing row has null billed km (K6), or the
 * rounded sum otherwise. An empty row set returns `0` (not null).
 */
function sumBilledKm(rows: InvoiceKmLineItem[]): number | null {
  let total = 0;
  for (const row of rows) {
    // why: effective_distance_km is the override-aware billed value (K1);
    // distance_km is the routing snapshot used only as a legacy fallback.
    const km = row.effective_distance_km ?? row.distance_km;
    if (km == null) return null; // K6 — any null poisons the bucket
    total += Number(km);
  }
  return Math.round(total * 100) / 100;
}

/**
 * Billed km for a single line item — the value that should appear in any
 * per-row km column. Never reads live trips (K5).
 *
 * Returns `null` when neither distance field is set (renders as `—`).
 */
export function computeInvoiceLineKm(item: InvoiceKmLineItem): number | null {
  // why: effective_distance_km wins because it reflects admin/catalog overrides
  // and is the value used for pricing. distance_km is the routing provider
  // snapshot and acts as a fallback for rows saved before effective_distance_km
  // was tracked (K1).
  const km = item.effective_distance_km ?? item.distance_km;
  if (km == null) return null;
  return km;
}

/**
 * Invoice-wide KM buckets from the **full** `invoice.line_items` array.
 *
 * Pass the raw snapshot array — do **not** pre-filter with `mainCoverLineItems`
 * or `billingIncludedLineItems`. This function applies the correct filter
 * internally for each bucket (K2, K3, K4).
 *
 * Returns:
 * - `normalBilledKm`    — sum for billing-included normal trips (K2)
 * - `cancelledBilledKm` — sum for billing-included cancelled trips (K3)
 *
 * Both can be `null` (unknown total due to missing distances — K6).
 */
export function computeInvoiceKmBuckets(items: InvoiceKmLineItem[]): {
  normalBilledKm: number | null;
  cancelledBilledKm: number | null;
} {
  // why: isBillingIncludedRow handles both persisted (billing_included field)
  // and builder (billingInclusion object) shapes, including legacy null/undefined
  // (treated as included). Do not duplicate that logic here.
  const normalRows = items.filter(
    (r) => isBillingIncludedRow(r) && !(r.is_cancelled_trip ?? false)
  );
  const cancelledRows = items.filter(
    (r) => isBillingIncludedRow(r) && (r.is_cancelled_trip ?? false) === true
  );

  return {
    normalBilledKm: sumBilledKm(normalRows),
    cancelledBilledKm: sumBilledKm(cancelledRows)
  };
}

/**
 * Convenience alias for cover-page KM — semantically identical to
 * `computeInvoiceKmBuckets` but named to document intent at call sites.
 *
 * Used by `InvoicePdfDocument.tsx` to derive the cover Gesamtstrecke block
 * and by `invoice-detail/index.tsx` for the KM summary section.
 */
export function computeInvoiceCoverKm(items: InvoiceKmLineItem[]): {
  normalBilledKm: number | null;
  cancelledBilledKm: number | null;
} {
  return computeInvoiceKmBuckets(items);
}
