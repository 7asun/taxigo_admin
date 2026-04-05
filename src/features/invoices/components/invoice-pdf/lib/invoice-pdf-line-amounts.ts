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

function priceResolutionRecord(
  snap: PdfLineItemAmountsInput['price_resolution_snapshot']
): Record<string, unknown> | null {
  if (snap == null) return null;
  if (typeof snap === 'string') {
    try {
      const v = JSON.parse(snap) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return v as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof snap === 'object' && !Array.isArray(snap)) {
    return snap as Record<string, unknown>;
  }
  return null;
}

export function lineNetEurForPdfLineItem(
  item: PdfLineItemAmountsInput
): number {
  if (item.kts_override) return 0;
  const snap = priceResolutionRecord(item.price_resolution_snapshot);
  if (snap) {
    const n = snap.net;
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
