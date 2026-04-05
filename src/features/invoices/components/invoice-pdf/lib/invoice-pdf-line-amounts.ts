/**
 * Line net/gross for PDF tables — uses frozen price_resolution_snapshot.net when present
 * (tiered km), else unit_price × quantity. KTS lines are €0 net/gross.
 */

import type { InvoiceLineItemRow } from '@/features/invoices/types/invoice.types';

export type PdfLineItemAmountsInput = Pick<
  InvoiceLineItemRow,
  | 'unit_price'
  | 'quantity'
  | 'tax_rate'
  | 'kts_override'
  | 'price_resolution_snapshot'
>;

export function lineNetEurForPdfLineItem(
  item: PdfLineItemAmountsInput
): number {
  if (item.kts_override) return 0;
  const snap = item.price_resolution_snapshot;
  if (snap && typeof snap === 'object' && !Array.isArray(snap)) {
    const n = (snap as Record<string, unknown>).net;
    if (typeof n === 'number' && !Number.isNaN(n)) {
      return Math.round(n * 100) / 100;
    }
  }
  return Math.round((item.unit_price ?? 0) * item.quantity * 100) / 100;
}

export function lineGrossEurForPdfLineItem(
  item: PdfLineItemAmountsInput
): number {
  if (item.kts_override) return 0;
  const net = lineNetEurForPdfLineItem(item);
  return Math.round(net * (1 + item.tax_rate) * 100) / 100;
}
