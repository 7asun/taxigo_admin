'use client';

import * as React from 'react';
import { parseAsInteger, useQueryState } from 'nuqs';

import { useDataTable } from '@/hooks/use-data-table';
import {
  createKtsAbrechnungColumns,
  type AbrechnungExpandState
} from '@/features/kts/components/kts-abrechnung-table/kts-abrechnung-columns';
import { KtsAbrechnungDataTable } from '@/features/kts/components/kts-abrechnung-table/kts-abrechnung-data-table';
import type { KtsAbrechnungGroup } from '@/features/kts/types/kts-abrechnung-group';
import { TripsRscRefreshChrome } from '@/features/trips/components/trips-rsc-refresh-chrome';

export interface KtsAbrechnungTableProps {
  data: KtsAbrechnungGroup[];
  totalItems: number;
}

export function KtsAbrechnungTable({
  data,
  totalItems
}: KtsAbrechnungTableProps) {
  const [pageSize] = useQueryState('perPage', parseAsInteger.withDefault(50));
  const pageCount = Math.ceil(totalItems / pageSize) || 1;
  const [expandedGroup, setExpandedGroup] =
    React.useState<AbrechnungExpandState>(null);

  const columns = React.useMemo(
    () => createKtsAbrechnungColumns({ expandedGroup, setExpandedGroup }),
    [expandedGroup]
  );

  const { table } = useDataTable({
    data,
    columns,
    pageCount,
    shallow: false,
    debounceMs: 500,
    getRowId: (row) => row.kts_belegnummer,
    enableRowSelection: false
  });

  return (
    <TripsRscRefreshChrome className='flex min-h-0 min-w-0 flex-1 flex-col'>
      <KtsAbrechnungDataTable
        table={table}
        expandedGroup={expandedGroup}
        setExpandedGroup={setExpandedGroup}
        paginationProps={{
          totalDatasetCount: totalItems,
          datasetNounPlural: 'Abrechnungsbelege'
        }}
      />
    </TripsRscRefreshChrome>
  );
}
