/**
 * Line net/gross for PDF tables.
 * Total line net uses persisted column values (unit_price × quantity + approach_fee_net).
 */

import type { InvoiceLineItemRow } from '@/features/invoices/types/invoice.types';

export type PdfLineItemAmountsInput = Pick<
  InvoiceLineItemRow,
  'unit_price' | 'quantity' | 'tax_rate' | 'kts_override' | 'approach_fee_net'
>;

export function lineNetEurForPdfLineItem(
  item: PdfLineItemAmountsInput
): number {
  if (item.kts_override) return 0;
  // Returns total line net including approach fee. Use column values, not snapshot.net
  // (snapshot.net is base transport only and may be null for some strategies).
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
  const net = lineNetEurForPdfLineItem(item);
  return Math.round(net * (1 + item.tax_rate) * 100) / 100;
}
