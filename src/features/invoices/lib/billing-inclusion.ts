/**
 * billing-inclusion.ts
 *
 * Single source of truth for billing-inclusion filtering across the invoice
 * builder and PDF renderer. Do not duplicate inline `billing_included !== false`
 * or `billingInclusion.included` expressions elsewhere — use these helpers.
 *
 * ## Two representations
 *
 * - **Builder (runtime):** `billingInclusion: { included: boolean; reason: string }`
 *   on `BuilderLineItem` / `BuilderCancelledTripRow`. Always a strict boolean.
 * - **Persisted / PDF / DB:** `billing_included?: boolean | null` on
 *   `InvoiceLineItemRow`. DB column is NOT NULL DEFAULT TRUE; optional on TS
 *   type for pre-migration rows.
 *
 * ## Predicate behaviour (`isBillingIncludedRow`)
 *
 * | Input | Result |
 * |-------|--------|
 * | `billing_included: true` | included |
 * | `billing_included: false` | excluded |
 * | `billing_included: null` / `undefined` / missing | included (legacy) |
 * | `billingInclusion.included: true` | included |
 * | `billingInclusion.included: false` | excluded |
 *
 * We use `!== false` (not `=== true`) for persisted rows so legacy and draft
 * rows without an explicit flag remain included.
 *
 * ## SQL parity (out of scope for this module)
 *
 * Server RPCs use `COALESCE(billing_included, true) = true` or
 * `billing_included = TRUE`, which is equivalent to this predicate. SQL is
 * intentionally not changed by the billing-inclusion helper work.
 *
 * ## Known limitation
 *
 * Invoices saved before this fix was deployed may have incorrect cover table
 * data. These can only be corrected by re-opening the invoice in the builder
 * and re-saving. No automated migration is provided.
 */

import type { BillingInclusionState } from '@/features/invoices/types/invoice.types';

/** Minimal persisted row shape for inclusion checks. */
export type BillingIncludedPersistedRow = {
  billing_included?: boolean | null;
};

/** Minimal builder row shape for inclusion checks. */
export type BillingIncludedBuilderRow = {
  billingInclusion: BillingInclusionState;
};

/** Row readable by {@link isBillingIncludedRow}. */
export type BillingInclusionReadable =
  | BillingIncludedPersistedRow
  | BillingIncludedBuilderRow;

/** Cover-table row — billable normal trips only (excludes cancelled appendix rows). */
export type MainCoverLineItemRow = BillingInclusionReadable & {
  is_cancelled_trip?: boolean | null;
};

/**
 * Returns whether a line item counts toward billing (totals, write-back, etc.).
 *
 * Used by: `billingIncludedLineItems`, `mainCoverLineItems`, `trip-write-back.ts`,
 * and exclusion checks via negation (`!isBillingIncludedRow`).
 *
 * Excludes only rows explicitly opted out (`billing_included === false` or
 * `billingInclusion.included === false`).
 */
export function isBillingIncludedRow(row: BillingInclusionReadable): boolean {
  if ('billingInclusion' in row) {
    return row.billingInclusion.included;
  }
  return row.billing_included !== false;
}

/**
 * Billable line items — included in footer totals, appendix Fahrtendetails,
 * trip write-back, and preview draft input.
 *
 * **Includes** opted-in cancelled trips (`is_cancelled_trip = true`,
 * `billing_included = true`). For the Haupttabelle cover table, use
 * {@link mainCoverLineItems} instead.
 *
 * Consumers: `use-invoice-builder.ts`, `use-invoice-builder-pdf-preview.tsx`,
 * `InvoicePdfDocument.tsx` (appendix + footer calc), `invoice-validators.ts`.
 */
export function billingIncludedLineItems<T extends BillingInclusionReadable>(
  items: T[]
): T[] {
  return items.filter(isBillingIncludedRow);
}

/**
 * Main cover table (Haupttabelle) line items — billing-included **normal** trips
 * only for grouped, single-row, and flat PDF cover layouts.
 *
 * Excludes:
 * - Opted-out normal trips (`billing_included = false`)
 * - All cancelled trip rows (`is_cancelled_trip = true`) — they render in the
 *   Stornierte appendix billed block, not on the cover
 *
 * Consumers: `InvoicePdfDocument.tsx` (`mainLineItems`),
 * `invoice-pdf-cover-body.tsx` (flat layout).
 */
export function mainCoverLineItems<T extends MainCoverLineItemRow>(
  items: T[]
): T[] {
  return items.filter(
    (li) => isBillingIncludedRow(li) && !(li.is_cancelled_trip ?? false)
  );
}
