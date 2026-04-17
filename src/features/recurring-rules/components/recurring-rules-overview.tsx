'use client';

/**
 * Client table shell for Alle Regelfahrten: receives one server-sliced page of
 * rows plus `totalDatasetCount` because `useDataTable` uses manual pagination
 * (same contract as trips). Data is never fetched here — the RSC page owns
 * Supabase — so this stays presentational and safe for the browser bundle.
 * `shallow: false` keeps filter/sort/pagination URL changes triggering RSC
 * refresh with freshly sliced props.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { PlusCircle } from 'lucide-react';
import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import type { RecurringRuleWithClientEmbed } from '@/features/trips/api/recurring-rules.server';
import { CreateRecurringRuleSheet } from './create-recurring-rule-sheet';
import { recurringRulesColumns } from './recurring-rules-columns';
import { RECURRING_RULES_TABLE_DEFAULT_PAGE_SIZE } from '@/features/recurring-rules/lib/recurring-rules-sort-column-ids';

export { RECURRING_RULES_TABLE_DEFAULT_PAGE_SIZE };

export interface RecurringRulesOverviewProps {
  rules: RecurringRuleWithClientEmbed[];
  totalDatasetCount: number;
  /** Page size used for this request (from URL `perPage`, default 50). */
  perPage: number;
  /** One-based page index from URL; must match the server slice. */
  currentPage: number;
}

export function RecurringRulesOverview({
  rules,
  totalDatasetCount,
  perPage,
  currentPage
}: RecurringRulesOverviewProps) {
  const router = useRouter();
  const [isCreateSheetOpen, setIsCreateSheetOpen] = React.useState(false);

  const pageCount = Math.max(1, Math.ceil(totalDatasetCount / perPage));

  const { table } = useDataTable({
    data: rules,
    columns: recurringRulesColumns,
    pageCount,
    initialState: {
      pagination: {
        pageSize: perPage,
        pageIndex: Math.max(0, currentPage - 1)
      }
    },
    shallow: false,
    clearOnDefault: true,
    debounceMs: 500,
    getRowId: (row) => row.id
  });

  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
      <DataTable
        table={table}
        tableClassName='min-w-[900px]'
        paginationProps={{
          totalDatasetCount,
          datasetNounPlural: 'Regeln'
        }}
      >
        <DataTableToolbar table={table} showViewOptions={false}>
          {/* Primary action in the toolbar’s right slot — same flex region as
              `DataTableViewOptions` on other tables (`data-table-toolbar.tsx`). */}
          <Button
            type='button'
            size='sm'
            onClick={() => setIsCreateSheetOpen(true)}
          >
            <PlusCircle className='mr-2 h-4 w-4' />
            Neue Regelfahrt
          </Button>
        </DataTableToolbar>
      </DataTable>

      <CreateRecurringRuleSheet
        isOpen={isCreateSheetOpen}
        onOpenChange={setIsCreateSheetOpen}
        onSuccess={() => {
          router.push('/dashboard/regelfahrten');
        }}
      />
    </div>
  );
}
