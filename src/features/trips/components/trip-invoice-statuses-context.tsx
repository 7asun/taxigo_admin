'use client';

import React, { createContext, useContext, useMemo } from 'react';

import type { TripInvoiceStatusLineRow } from '@/features/trips/api/trips.service';
import {
  type InvoiceLineItemWithStatus,
  type InvoiceStatusLite
} from '@/features/trips/lib/effective-trip-invoice-status';
import { useTripInvoiceStatuses } from '@/features/trips/hooks/use-trip-invoice-statuses';

function isInvoiceStatusLite(s: string): s is InvoiceStatusLite {
  return (
    s === 'draft' ||
    s === 'sent' ||
    s === 'paid' ||
    s === 'cancelled' ||
    s === 'corrected'
  );
}

function normalizeLineItem(
  row: TripInvoiceStatusLineRow
): InvoiceLineItemWithStatus {
  const inv = row.invoices;
  const embedded = Array.isArray(inv) ? inv[0] : inv;
  const statusRaw = embedded?.status;
  const status =
    typeof statusRaw === 'string' && isInvoiceStatusLite(statusRaw)
      ? statusRaw
      : null;

  return {
    invoice_id: row.invoice_id,
    invoices:
      embedded && status
        ? {
            status,
            paid_at: embedded.paid_at ?? null,
            sent_at: embedded.sent_at ?? null
          }
        : null
  };
}

function buildLineItemsByTripId(
  rows: TripInvoiceStatusLineRow[] | undefined
): Map<string, InvoiceLineItemWithStatus[]> {
  const m = new Map<string, InvoiceLineItemWithStatus[]>();
  if (!rows?.length) return m;
  for (const row of rows) {
    if (!row.trip_id) continue;
    const list = m.get(row.trip_id) ?? [];
    list.push(normalizeLineItem(row));
    m.set(row.trip_id, list);
  }
  return m;
}

type TripInvoiceStatusesContextValue = {
  /** True only on initial load (no cached data yet). */
  isLoading: boolean;
  lineItemsByTripId: Map<string, InvoiceLineItemWithStatus[]>;
};

const TripInvoiceStatusesContext =
  createContext<TripInvoiceStatusesContextValue | null>(null);

export function TripInvoiceStatusesProvider({
  tripIds,
  children
}: {
  tripIds: string[];
  children: React.ReactNode;
}) {
  // Secondary load: line items for badge resolution only (see docs/trips-performance.md).
  const { data, isPending } = useTripInvoiceStatuses(tripIds);
  const lineItemsByTripId = useMemo(() => buildLineItemsByTripId(data), [data]);
  const isLoading = tripIds.length > 0 && isPending;

  const value = useMemo(
    () => ({
      isLoading,
      lineItemsByTripId
    }),
    [isLoading, lineItemsByTripId]
  );

  return (
    <TripInvoiceStatusesContext.Provider value={value}>
      {children}
    </TripInvoiceStatusesContext.Provider>
  );
}

export function useTripInvoiceStatusLineItemsForRow(tripId: string): {
  isLoading: boolean;
  lineItems: InvoiceLineItemWithStatus[];
} {
  const ctx = useContext(TripInvoiceStatusesContext);
  if (!ctx) {
    return { isLoading: false, lineItems: [] };
  }
  return {
    isLoading: ctx.isLoading,
    lineItems: ctx.lineItemsByTripId.get(tripId) ?? []
  };
}
