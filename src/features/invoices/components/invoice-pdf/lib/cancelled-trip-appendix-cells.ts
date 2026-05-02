/**
 * cancelled-trip-appendix-cells.ts
 *
 * Appendix-only cell strings for stornierte Fahrten (€0). Differs from the former Haupttabelle
 * mapper: appendix uses `line_net_eur` / `trip_direction_pdf` and never `grouped_route_leistung`
 * (grouped-only keys are absent from `APPENDIX_COLUMNS`).
 *
 * `canceled_reason_notes` is not a PdfColumnKey — use {@link getCanceledReasonNote} in the appendix
 * component for the sub-line under each row.
 */

import type { PdfColumnDef } from '@/features/invoices/lib/pdf-column-catalog';
import type { CancelledTripRow } from '@/features/invoices/types/invoice.types';
import {
  formatInvoicePdfDate,
  formatInvoicePdfEur
} from '@/features/invoices/components/invoice-pdf/lib/invoice-pdf-format';

const EM_DASH = '—';

/** German copy for canceled-trip currency/description cells and the repeating sub-line under each row. */
export const CANCELLED_TRIP_APPENDIX_STATUS_LINE =
  'Storniert – kein Rechnungsbetrag';

function clientLabel(row: CancelledTripRow): string {
  const c = row.client;
  if (!c) return EM_DASH;
  return (
    [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || EM_DASH
  );
}

/** Trims DB `trips.canceled_reason_notes`; never returns `''`. */
export function getCanceledReasonNote(row: CancelledTripRow): string | null {
  const t = row.canceled_reason_notes?.trim();
  return t ? t : null;
}

/** One appendix table cell — `PdfColumnDef` from `appendix_columns` only in practice. */
export function cancelledTripAppendixCell(
  row: CancelledTripRow,
  col: PdfColumnDef
): string {
  const zero = formatInvoicePdfEur(0);

  if (col.valueSource === 'line_net_eur') {
    return zero;
  }
  if (col.valueSource === 'trip_direction_pdf') {
    return EM_DASH;
  }
  if (col.valueSource === 'summary_quantity_x') {
    return EM_DASH;
  }
  if (col.valueSource === 'grouped_route_leistung') {
    return EM_DASH;
  }

  switch (col.format) {
    case 'currency':
      return zero;
    case 'percent':
      return EM_DASH;
    case 'km':
    case 'integer':
      if (col.key === 'position') return EM_DASH;
      return EM_DASH;
    case 'date':
      return row.scheduled_at
        ? formatInvoicePdfDate(row.scheduled_at)
        : EM_DASH;
    case 'address_de':
      if (col.dataField === 'pickup_address')
        return row.pickup_address?.trim() || EM_DASH;
      if (col.dataField === 'dropoff_address')
        return row.dropoff_address?.trim() || EM_DASH;
      return EM_DASH;
    case 'direction':
      return EM_DASH;
    case 'text':
    default:
      if (col.key === 'client_name') return clientLabel(row);
      if (col.dataField === 'pickup_address')
        return row.pickup_address?.trim() || EM_DASH;
      if (col.dataField === 'dropoff_address')
        return row.dropoff_address?.trim() || EM_DASH;
      if (
        col.key === 'description' ||
        col.dataField === 'description' ||
        col.key === 'billing_variant'
      ) {
        return CANCELLED_TRIP_APPENDIX_STATUS_LINE;
      }
      if (col.dataField?.includes('driver_name'))
        return row.driver?.name?.trim() || EM_DASH;
      return EM_DASH;
  }
}
