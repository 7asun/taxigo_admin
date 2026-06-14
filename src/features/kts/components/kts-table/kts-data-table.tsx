'use client';

import { flexRender, type Table as TanstackTable } from '@tanstack/react-table';
import * as React from 'react';

import {
  DataTablePagination,
  type DataTablePaginationProps
} from '@/components/ui/table/data-table-pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { KtsExpandRow } from '@/features/kts/components/kts-table/kts-expand-row';
import type { KtsExpandState } from '@/features/kts/components/kts-table/kts-actions-cell';
import type { KtsTripRow } from '@/features/kts/types/kts-trip-row';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface KtsDataTableProps<TData> extends React.ComponentProps<'div'> {
  table: TanstackTable<TData>;
  expandedRow: KtsExpandState;
  setExpandedRow: (val: KtsExpandState) => void;
  paginationProps?: Omit<DataTablePaginationProps<TData>, 'table'>;
}

export function KtsDataTable<TData extends KtsTripRow>({
  table,
  expandedRow,
  setExpandedRow,
  paginationProps,
  className,
  children
}: KtsDataTableProps<TData>) {
  const scrollWrapRef = React.useRef<HTMLDivElement>(null);
  // why: single expandedRow (not Set) — admin processes one paper at a time; opening another replaces focus.
  const visibleColumnCount = table.getVisibleLeafColumns().length;

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !expandedRow) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      setExpandedRow(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expandedRow, setExpandedRow]);

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col space-y-4', className)}>
      {children}
      <div className='relative flex min-h-0 flex-1'>
        <div
          ref={scrollWrapRef}
          className='absolute inset-0 flex overflow-hidden rounded-lg border'
        >
          <ScrollArea className='h-full w-full flex-1 overflow-auto'>
            <Table className='min-w-[720px]'>
              <TableHeader className='bg-background sticky top-0 z-10'>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        colSpan={header.colSpan}
                        className='bg-background'
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => {
                    const showErrorRow =
                      row.original.kts_status === 'fehlerhaft' ||
                      row.original.kts_status === 'in_korrektur';

                    return (
                      <React.Fragment key={row.id}>
                        <TableRow
                          data-table-row-id={row.id}
                          className={cn(
                            'hover:bg-muted/50',
                            showErrorRow && 'border-b-0'
                          )}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext()
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                        {showErrorRow ? (
                          <TableRow className='border-b-0 hover:bg-transparent'>
                            <TableCell
                              colSpan={visibleColumnCount}
                              className='px-4 pt-0 pb-2'
                            >
                              <div
                                className={cn(
                                  'text-muted-foreground flex items-start gap-2 rounded-sm border-l-2 px-3 py-1.5 text-xs',
                                  row.original.kts_status === 'fehlerhaft'
                                    ? 'border-l-red-400 bg-red-50/50 dark:bg-red-950/20'
                                    : 'border-l-amber-400 bg-amber-50/50 dark:bg-amber-950/20'
                                )}
                              >
                                {row.original.kts_fehler_beschreibung ? (
                                  row.original.kts_fehler_beschreibung
                                ) : (
                                  <span className='italic opacity-60'>
                                    Keine Fehlerbeschreibung hinterlegt
                                  </span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                        {expandedRow?.id === row.id ? (
                          <TableRow className='hover:bg-transparent'>
                            <TableCell colSpan={visibleColumnCount}>
                              <KtsExpandRow
                                trip={row.original}
                                mode={expandedRow.mode}
                                onClose={() => setExpandedRow(null)}
                              />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </React.Fragment>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={visibleColumnCount}
                      className='h-24 text-center'
                    >
                      Keine KTS-Belege gefunden.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <ScrollBar orientation='horizontal' />
          </ScrollArea>
        </div>
      </div>
      <div className='flex flex-col gap-2.5'>
        <DataTablePagination table={table} {...paginationProps} />
      </div>
    </div>
  );
}
