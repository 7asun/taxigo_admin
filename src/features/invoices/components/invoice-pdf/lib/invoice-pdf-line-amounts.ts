/**
 * Line net/gross for PDF tables.
 * Total line net uses persisted column values (unit_price × quantity + approach_fee_net).
 * Line gross prefers stored `total_price` (matches `invoice_line_items` / gross-anchor pricetag).
 */

import type { InvoiceLineItemRow } from '@/features/invoices/types/invoice.types';

export type PdfLineItemAmountsInput = Pick<
  InvoiceLineItemRow,
  | 'unit_price'
  | 'quantity'
  | 'tax_rate'
  | 'kts_override'
  | 'approach_fee_net'
  | 'total_price'
  | 'price_resolution_snapshot'
>;

/**
 * Total line net for one persisted row: `(unit_price × quantity + approach_fee_net)` rounded to cents.
 * Uses column values, not `price_resolution_snapshot.net` (base transport only; may be null).
 *
 * @note Used to populate the `g.total_price` accumulator in route- and billing-type group loops in
 *   [`build-invoice-pdf-summary.ts`](./build-invoice-pdf-summary.ts). It is **not** used to set the
 *   displayed net on `InvoicePdfSummaryRow` — that net is back-derived from the gross anchor in
 *   `summaryRowFromAgg`, `buildInvoicePdfSingleRow`, and `buildInvoicePdfGroupedByBillingType`.
 *   See the file-level JSDoc in `build-invoice-pdf-summary.ts` and `docs/pricing-engine-3.md`.
 */
export function lineNetEurForPdfLineItem(
  item: PdfLineItemAmountsInput
): number {
  if (item.kts_override) return 0;
  return (
    Math.round(
      ((item.unit_price ?? 0) * item.quantity + (item.approach_fee_net ?? 0)) *
        100
    ) / 100
  );
}

export function lineGrossEurForPdfLineItem(
  item: PdfLineItemAmountsInput
): number {
  if (item.kts_override) return 0;
  const stored = item.total_price;
  if (typeof stored === 'number' && !Number.isNaN(stored)) {
    return Math.round(stored * 100) / 100;
  }
  const net = lineNetEurForPdfLineItem(item);
  return Math.round(net * (1 + item.tax_rate) * 100) / 100;
}
