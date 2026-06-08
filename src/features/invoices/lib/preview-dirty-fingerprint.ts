/**
 * preview-dirty-fingerprint.ts
 *
 * Dirty-detection fingerprint for the invoice builder PDF preview (Category B).
 * Separate from {@link billing-inclusion.ts} — that module owns **billable slices**
 * for draft building and totals; this module owns **change detection** for the
 * "Vorschau veraltet" banner only.
 *
 * ## Hashed fields (per raw BuilderLineItem)
 *
 * | Field | Why |
 * |-------|-----|
 * | `position` | Row reorder |
 * | `effective_distance_km` | Manual / resolved km edits |
 * | `isBillingIncludedRow` | Opt-out / opt-in (meaningful on **unfiltered** lineItems) |
 * | `price_resolution.net` | Resolved net after pricing / unit / km edits |
 * | `price_resolution.gross` | VAT-included total; tax rate / gross path |
 * | `manualGrossTotal` | Explicit Brutto override in Step 3 |
 *
 * All price fields use `?? 0` so unresolved rows contribute zero (no phantom
 * signature changes when rows first load without prices).
 *
 * Cancelled slices: trip id fold, km, inclusion. Excluded appendix: client name
 * length + exclusion reason char sum.
 *
 * ## Not hashed (no PDF output impact from these alone)
 *
 * Addresses, warnings, `trip_id`, status fields, `unit_price` (reflected in
 * `price_resolution.net` when repriced).
 *
 * ## Category B contract
 *
 * `use-invoice-builder-pdf-preview.tsx` compares consecutive fingerprints in a
 * useEffect; a change sets `categoryBDirty` → "Vorschau veraltet" banner.
 *
 * **Never** use this to build the draft PDF slice — use
 * `billingIncludedLineItems` + `buildDraftInvoiceDetailForPdf` for that.
 *
 * JSON.stringify of full rows was intentionally avoided (performance at 90+
 * trips; see commit caaa514).
 */

import { isBillingIncludedRow } from '@/features/invoices/lib/billing-inclusion';
import type {
  BuilderCancelledTripRow,
  BuilderLineItem,
  ExcludedTripRow
} from '@/features/invoices/types/invoice.types';

function hashLineItems(lineItems: BuilderLineItem[]): number {
  return lineItems.reduce((acc, item) => {
    return (
      acc +
      (item.position ?? 0) * 1000 +
      Math.round((item.effective_distance_km ?? 0) * 100) +
      (isBillingIncludedRow(item) ? 1 : 0) +
      Math.round((item.price_resolution?.net ?? 0) * 100) +
      Math.round((item.price_resolution?.gross ?? 0) * 100) +
      Math.round((item.manualGrossTotal ?? 0) * 100)
    );
  }, 0);
}

function hashCancelledTrips(rows: BuilderCancelledTripRow[]): number {
  return rows.reduce((acc, r) => {
    const idFold = r.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return (
      acc +
      idFold * 1000 +
      Math.round((r.effective_distance_km ?? 0) * 100) +
      (isBillingIncludedRow(r) ? 1 : 0)
    );
  }, 0);
}

function hashExcludedTrips(rows: ExcludedTripRow[]): number {
  return rows.reduce((acc, r) => {
    let reasonFold = 0;
    for (let i = 0; i < r.billing_exclusion_reason.length; i++) {
      reasonFold += r.billing_exclusion_reason.charCodeAt(i);
    }
    return acc + (r.client_name?.length ?? 0) * 1000 + reasonFold;
  }, 0);
}

/**
 * Numeric fingerprint for Category B preview dirty detection.
 *
 * Input must be **raw** `lineItems` from the builder — not
 * `billingIncludedLineItems(...)` — so inclusion and price edits on opted-out
 * rows are visible to the banner.
 */
export function buildPreviewDirtyFingerprint(
  lineItems: BuilderLineItem[],
  billedCancelledTrips: BuilderCancelledTripRow[],
  passiveCancelledTrips: BuilderCancelledTripRow[],
  excludedTrips: ExcludedTripRow[]
): string {
  return `${hashLineItems(lineItems)}_${hashCancelledTrips(billedCancelledTrips)}_${hashCancelledTrips(passiveCancelledTrips)}_${hashExcludedTrips(excludedTrips)}`;
}
