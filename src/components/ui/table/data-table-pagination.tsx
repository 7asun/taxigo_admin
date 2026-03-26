import type { Table } from '@tanstack/react-table';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ChevronLeftIcon, ChevronRightIcon } from '@radix-ui/react-icons';

export interface DataTablePaginationProps<TData>
  extends React.ComponentProps<'div'> {
  table: Table<TData>;
  pageSizeOptions?: number[];
  /**
   * Total rows in the dataset (e.g. server-side count). When set, the left
   * summary uses this plus `getSelectedRowModel()` instead of filtered/page-only counts.
   */
  totalDatasetCount?: number;
  /** Plural label for `totalDatasetCount` summaries, e.g. "Fahrten". */
  datasetNounPlural?: string;
  /** Rendered in the center when at least one row is selected (e.g. bulk actions). */
  bulkActions?: React.ReactNode;
}

export function DataTablePagination<TData>({
  table,
  pageSizeOptions = [10, 20, 30, 40, 50],
  className,
  totalDatasetCount,
  datasetNounPlural = 'Zeilen',
  bulkActions,
  ...props
}: DataTablePaginationProps<TData>) {
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;

  const selectedCount = table.getSelectedRowModel().rows.length;
  const showBulk = selectedCount > 0 && bulkActions != null;

  const leftSummary = (() => {
    if (totalDatasetCount != null) {
      if (selectedCount > 0) {
        return (
          <>
            {selectedCount} von {totalDatasetCount} {datasetNounPlural}{' '}
            ausgewählt
          </>
        );
      }
      return (
        <>
          {totalDatasetCount} {datasetNounPlural} gesamt
        </>
      );
    }

    if (table.getFilteredSelectedRowModel().rows.length > 0) {
      return (
        <>
          {table.getFilteredSelectedRowModel().rows.length} of{' '}
          {table.getFilteredRowModel().rows.length} row(s) selected.
        </>
      );
    }
    return <>{table.getFilteredRowModel().rows.length} row(s) total.</>;
  })();

  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col gap-2 p-1 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-x-4 md:gap-y-0',
        className
      )}
      {...props}
    >
      <div
        className={cn(
          'text-muted-foreground text-xs whitespace-nowrap sm:text-sm',
          'md:justify-self-start'
        )}
      >
        <span className='hidden sm:inline'>{leftSummary}</span>
        <span className='sm:hidden'>
          {totalDatasetCount != null ? (
            selectedCount > 0 ? (
              <>
                {selectedCount}/{totalDatasetCount} ausgewählt
              </>
            ) : (
              <>{totalDatasetCount} gesamt</>
            )
          ) : (
            leftSummary
          )}
        </span>
      </div>

      {showBulk ? (
        <div className='flex justify-center md:justify-self-center'>
          {bulkActions}
        </div>
      ) : (
        <div
          className='hidden min-h-0 md:mx-auto md:block md:min-w-0'
          aria-hidden
        />
      )}

      <div
        className={cn(
          'flex min-w-0 flex-nowrap items-center gap-2',
          'flex-row-reverse justify-between md:flex-row md:flex-wrap md:justify-end md:gap-x-4 md:justify-self-end'
        )}
      >
        <div className='flex shrink-0 items-center gap-1.5 sm:gap-2'>
          <p className='text-xs font-medium whitespace-nowrap sm:text-sm md:inline'>
            <span className='hidden sm:inline'>Rows per page</span>
            <span className='sm:hidden' aria-hidden>
              Rows
            </span>
          </p>
          <Select
            value={`${pageSize}`}
            onValueChange={(value) => {
              table.setPageSize(Number(value));
            }}
          >
            <SelectTrigger className='h-8 w-[4.5rem] [&[data-size]]:h-8'>
              <SelectValue placeholder={pageSize} />
            </SelectTrigger>
            <SelectContent side='top'>
              {pageSizeOptions.map((pageSizeOption) => (
                <SelectItem key={pageSizeOption} value={`${pageSizeOption}`}>
                  {pageSizeOption}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='flex min-w-0 items-center gap-1 sm:gap-2'>
          <p className='text-xs font-medium whitespace-nowrap sm:text-sm'>
            Page {pageIndex + 1} of {table.getPageCount()}
          </p>
          <div className='flex shrink-0 items-center gap-1'>
            <Button
              aria-label='Go to first page'
              variant='outline'
              size='icon'
              className='hidden size-8 lg:flex'
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronsLeft />
            </Button>
            <Button
              aria-label='Go to previous page'
              variant='outline'
              size='icon'
              className='size-8'
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              aria-label='Go to next page'
              variant='outline'
              size='icon'
              className='size-8'
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronRightIcon />
            </Button>
            <Button
              aria-label='Go to last page'
              variant='outline'
              size='icon'
              className='hidden size-8 lg:flex'
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <ChevronsRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
