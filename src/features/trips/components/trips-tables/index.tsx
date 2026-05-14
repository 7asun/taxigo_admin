'use client';

import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { useDataTable } from '@/hooks/use-data-table';
import { cn } from '@/lib/utils';
import * as React from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { parseAsInteger, useQueryState } from 'nuqs';
import { columns } from './columns';
import { useTripsTableStore } from '@/features/trips/stores/use-trips-table-store';
import { getUrgencyLevel } from '@/features/trips/lib/urgency-logic';
import { URGENCY_STYLES } from '@/features/trips/constants/urgency-config';
import { useIsNarrowScreen } from '@/hooks/use-is-narrow-screen';
import { TripsMobileCardList } from './trips-mobile-card-list';
import { TripsPaginationBulkActions } from './trips-pagination-bulk-actions';
import type { Trip } from '@/features/trips/api/trips.service';
import { getTripListScrollAnchorId } from '@/features/trips/lib/trip-list-scroll-anchor';
import { TripsRscRefreshChrome } from '@/features/trips/components/trips-rsc-refresh-chrome';
import { TripInvoiceStatusesProvider } from '@/features/trips/components/trip-invoice-statuses-context';
import { TRIPS_SORTABLE_IDS } from '@/features/trips/trips-sort-map';

export { columns };

interface TripsTableParams<TData, TValue> {
  data: TData[];
  totalItems: number;
  columns: ColumnDef<TData, TValue>[];
  /**
   * Trip IDs on the current list page (from RSC). Seeds the deferred invoice-status
   * query on first paint without waiting for a client-only effect.
   */
  invoiceStatusTripIds?: string[];
}

export function TripsTable<TData, TValue>({
  data,
  totalItems,
  columns,
  invoiceStatusTripIds
}: TripsTableParams<TData, TValue>) {
  const isNarrow = useIsNarrowScreen(768);
  const [pageSize] = useQueryState('perPage', parseAsInteger.withDefault(50));
  const pageCount = Math.ceil(totalItems / pageSize);

  const { table } = useDataTable({
    data,
    columns,
    pageCount: pageCount,
    shallow: false,
    debounceMs: 500,
    getRowId: (row) => (row as Trip).id,
    // Must match RSC `getSortingStateParser` + `TRIPS_SORT_MAP` — not every column `id`.
    sortParserValidKeys: TRIPS_SORTABLE_IDS,
    // reha_schein: hidden by default (subset of trips); matches DEFAULT_COLUMN_VISIBILITY in ansichten-dropdown.
    initialState: {
      columnVisibility: {
        net_price: false,
        tax_rate: false,
        reha_schein: false
      }
    }
  });

  const setTable = useTripsTableStore((s) => s.setTable);
  const setColumnVisibility = useTripsTableStore((s) => s.setColumnVisibility);
  const setColumnOrder = useTripsTableStore((s) => s.setColumnOrder);
  const pendingColumnVisibility = useTripsTableStore(
    (s) => s.pendingColumnVisibility
  );
  const setPendingColumnVisibility = useTripsTableStore(
    (s) => s.setPendingColumnVisibility
  );
  const pendingColumnOrder = useTripsTableStore((s) => s.pendingColumnOrder);
  const setPendingColumnOrder = useTripsTableStore(
    (s) => s.setPendingColumnOrder
  );

  React.useEffect(() => {
    setTable(table as any);
    return () => setTable(null);
  }, [table, setTable]);

  // Apply preset column visibility once the list table exists (see pendingColumnVisibility).
  React.useEffect(() => {
    if (pendingColumnVisibility === null) return;
    table.setColumnVisibility(pendingColumnVisibility);
    setPendingColumnVisibility(null);
  }, [table, pendingColumnVisibility, setPendingColumnVisibility]);

  // Apply queued column order after table mounted (Kanban → Liste).
  React.useEffect(() => {
    if (pendingColumnOrder === null) return;
    table.setColumnOrder(pendingColumnOrder);
    setPendingColumnOrder(null);
  }, [table, pendingColumnOrder, setPendingColumnOrder]);

  const columnVisibility = table.getState().columnVisibility;
  React.useEffect(() => {
    setColumnVisibility(columnVisibility);
  }, [columnVisibility, setColumnVisibility]);

  const columnOrder = table.getState().columnOrder;
  React.useEffect(() => {
    setColumnOrder(columnOrder);
  }, [columnOrder, setColumnOrder]);

  const scrollToRowId = React.useMemo(
    () =>
      getTripListScrollAnchorId(
        data as { id: string; scheduled_at: string | null }[]
      ),
    [data]
  );

  // Calculate groups for visual indicators
  const groupCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach((item: any) => {
      if (item.group_id) {
        counts[item.group_id] = (counts[item.group_id] || 0) + 1;
      }
    });
    return counts;
  }, [data]);

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  };

  const getRowClassName = (row: any) => {
    const classes: string[] = [];

    const scheduledAt = row.scheduled_at;
    const status = row.status;
    const urgency = getUrgencyLevel(scheduledAt, status);
    const style = URGENCY_STYLES[urgency];

    if (row.group_id && groupCounts[row.group_id] > 1) {
      classes.push(
        'border-l-4 border-l-green-500 bg-green-50/10 dark:bg-green-950/5'
      );
    } else if (style && style.rowClass) {
      classes.push(style.rowClass);
    }

    if (scheduledAt) {
      const date = new Date(scheduledAt);
      if (isToday(date)) {
        classes.push('bg-muted/10');
      }
    }

    return cn(classes);
  };

  const tripIdsForInvoiceBadges = React.useMemo(
    () =>
      invoiceStatusTripIds?.length
        ? invoiceStatusTripIds
        : (data as Trip[]).map((r) => r.id),
    [invoiceStatusTripIds, data]
  );

  if (isNarrow) {
    return (
      <TripInvoiceStatusesProvider tripIds={tripIdsForInvoiceBadges}>
        <TripsRscRefreshChrome className='flex min-h-0 min-w-0 flex-1 flex-col space-y-4'>
          <DataTableToolbar table={table} showViewOptions={false} />
          <TripsMobileCardList
            table={table}
            getRowClassName={getRowClassName}
            totalDatasetCount={totalItems}
            scrollToRowId={scrollToRowId}
          />
        </TripsRscRefreshChrome>
      </TripInvoiceStatusesProvider>
    );
  }

  return (
    <TripInvoiceStatusesProvider tripIds={tripIdsForInvoiceBadges}>
      <TripsRscRefreshChrome className='flex min-h-0 min-w-0 flex-1 flex-col'>
        <DataTable
          table={table}
          tableClassName='min-w-[720px]'
          getRowClassName={getRowClassName}
          paginationProps={{
            totalDatasetCount: totalItems,
            datasetNounPlural: 'Fahrten',
            bulkActions: <TripsPaginationBulkActions table={table} />
          }}
          scrollToRowId={scrollToRowId}
        >
          <DataTableToolbar table={table} showViewOptions={false} />
        </DataTable>
      </TripsRscRefreshChrome>
    </TripInvoiceStatusesProvider>
  );
}
