/**
 * build-confirmation-display-rows.ts
 *
 * Single source of truth for Step 4 (Bestätigung) position table and count.
 * Assembles display rows from the same billable slice that feeds
 * `calculateInvoiceTotals` in `use-invoice-builder.ts` (L903–919).
 *
 * ## Why separate from billing-inclusion.ts
 *
 * `billing-inclusion.ts` owns **predicates** (`isBillingIncludedRow`,
 * `billingIncludedLineItems`, `mainCoverLineItems`). This module owns **display
 * assembly** — mapping billable rows into a thin `ConfirmationDisplayRow` shape
 * for Step 4, including cancelled trips that are not `BuilderLineItem`s.
 *
 * ## Mirroring contract
 *
 * Normal rows: `billingIncludedLineItems(lineItems)`.
 * Cancelled rows: `cancelledTrips.filter(c => c.billingInclusion.included && c.price_resolution != null)`.
 *
 * If the `includedCancelled` filter in `use-invoice-builder.ts` L906–908 ever
 * changes, this helper **must** change in the same way — otherwise the
 * confirmation table/count will desync from Netto/MwSt/Brutto.
 *
 * ## rowType
 *
 * `'normal'` — standard trip line item. `'cancelled'` — opted-in storno fee row;
 * used for optional muted styling and tooltip context in Step 4.
 *
 * ## React keys
 *
 * Normal rows: `trip_id ?? position.toString()`. Cancelled rows: trip `id` (not
 * position — positions are renumbered after normal rows).
 *
 * ## Future reuse
 *
 * If a trip-based quote/Angebote builder adds billing inclusion, evaluate
 * reusing this helper before writing a new inline filter.
 *
 * ## Explicitly excluded
 *
 * - Opted-out normal trips (`billingInclusion.included === false`)
 * - Opted-out cancelled trips
 * - Opted-in cancelled trips without `price_resolution` (unpriced)
 */

import { billingIncludedLineItems } from '@/features/invoices/lib/billing-inclusion';
import type {
  BuilderCancelledTripRow,
  BuilderLineItem
} from '@/features/invoices/types/invoice.types';
import type { PriceResolution } from '@/features/invoices/types/pricing.types';

export interface ConfirmationDisplayRow {
  /** Stable React key — trip_id for normal rows, id for cancelled */
  key: string;
  /** 1-based display position */
  position: number;
  /** Human-readable description — from item.description for normal rows; built for cancelled */
  description: string;
  /** Full price_resolution for net/gross display helpers */
  price_resolution: PriceResolution;
  /** Manual gross override — pass through for display helper */
  manualGrossTotal: number | null;
  /** Source type for tooltip and display logic */
  rowType: 'normal' | 'cancelled';
}

function cancelledTripClientLabel(trip: BuilderCancelledTripRow): string {
  const fromClient = trip.client
    ? [trip.client.first_name, trip.client.last_name].filter(Boolean).join(' ')
    : null;
  return fromClient || trip.client_name?.trim() || 'Stornierte Fahrt';
}

function cancelledTripDescription(trip: BuilderCancelledTripRow): string {
  const dateStr = trip.scheduled_at
    ? new Date(trip.scheduled_at).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      })
    : '—';
  return `${dateStr} · ${cancelledTripClientLabel(trip)} (Stornogebühr)`;
}

/**
 * Builds Step 4 confirmation table rows mirroring the totals billable slice.
 */
export function buildConfirmationDisplayRows(
  lineItems: BuilderLineItem[],
  cancelledTrips: BuilderCancelledTripRow[]
): ConfirmationDisplayRow[] {
  const includedNormal = billingIncludedLineItems(lineItems);

  const normalRows: ConfirmationDisplayRow[] = includedNormal.map((item) => ({
    key: item.trip_id ?? item.position.toString(),
    position: item.position,
    description: item.description,
    price_resolution: item.price_resolution,
    manualGrossTotal: item.manualGrossTotal ?? null,
    rowType: 'normal'
  }));

  const includedCancelled = cancelledTrips.filter(
    (c) => c.billingInclusion.included && c.price_resolution != null
  );

  const cancelledRows: ConfirmationDisplayRow[] = includedCancelled.map(
    (trip, idx) => ({
      key: trip.id,
      position: normalRows.length + idx + 1,
      description: cancelledTripDescription(trip),
      price_resolution: trip.price_resolution!,
      manualGrossTotal: null,
      rowType: 'cancelled'
    })
  );

  return [...normalRows, ...cancelledRows].sort(
    (a, b) => a.position - b.position
  );
}
