'use client';

import * as React from 'react';
import { parseAsInteger, useQueryState } from 'nuqs';

import { useDataTable } from '@/hooks/use-data-table';
import { KtsDataTable } from '@/features/kts/components/kts-table/kts-data-table';
import { createKtsColumns } from '@/features/kts/components/kts-table/kts-columns';
import { KtsHandoverBulkBar } from '@/features/kts/components/kts-table/kts-handover-bulk-bar';
import type { KtsExpandState } from '@/features/kts/components/kts-table/kts-actions-cell';
import type { KtsTripRow } from '@/features/kts/types/kts-trip-row';
import { TripsRscRefreshChrome } from '@/features/trips/components/trips-rsc-refresh-chrome';

export interface KtsTableProps {
  data: KtsTripRow[];
  totalItems: number;
}

export function KtsTable({ data, totalItems }: KtsTableProps) {
  const [pageSize] = useQueryState('perPage', parseAsInteger.withDefault(50));
  const pageCount = Math.ceil(totalItems / pageSize) || 1;
  const [expandedRow, setExpandedRow] = React.useState<KtsExpandState>(null);

  const columns = React.useMemo(
    () => createKtsColumns({ expandedRow, setExpandedRow }),
    [expandedRow]
  );

  const { table } = useDataTable({
    data,
    columns,
    pageCount,
    shallow: false,
    debounceMs: 500,
    getRowId: (row) => row.id,
    enableRowSelection: (row) => row.original.kts_status === 'korrekt'
  });

  return (
    <TripsRscRefreshChrome className='flex min-h-0 min-w-0 flex-1 flex-col'>
      <KtsDataTable
        table={table}
        expandedRow={expandedRow}
        setExpandedRow={setExpandedRow}
        paginationProps={{
          totalDatasetCount: totalItems,
          datasetNounPlural: 'KTS-Belege',
          bulkActions: <KtsHandoverBulkBar table={table} />
        }}
      />
    </TripsRscRefreshChrome>
  );
}
