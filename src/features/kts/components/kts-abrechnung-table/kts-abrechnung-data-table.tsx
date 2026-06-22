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
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import type { AbrechnungExpandState } from '@/features/kts/components/kts-abrechnung-table/kts-abrechnung-columns';
import { KtsAbrechnungExpandRow } from '@/features/kts/components/kts-abrechnung-table/kts-abrechnung-expand-row';
import type { KtsAbrechnungGroup } from '@/features/kts/types/kts-abrechnung-group';
import { cn } from '@/lib/utils';

interface KtsAbrechnungDataTableProps extends React.ComponentProps<'div'> {
  table: TanstackTable<KtsAbrechnungGroup>;
  expandedGroup: AbrechnungExpandState;
  setExpandedGroup: (val: AbrechnungExpandState) => void;
  paginationProps?: Omit<DataTablePaginationProps<KtsAbrechnungGroup>, 'table'>;
}

export function KtsAbrechnungDataTable({
  table,
  expandedGroup,
  setExpandedGroup,
  paginationProps,
  className,
  children
}: KtsAbrechnungDataTableProps) {
  const visibleColumnCount = table.getVisibleLeafColumns().length;

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !expandedGroup) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      setExpandedGroup(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expandedGroup, setExpandedGroup]);

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col space-y-4', className)}>
      {children}
      <div className='relative flex min-h-0 flex-1'>
        <div className='absolute inset-0 flex overflow-hidden rounded-lg border'>
          <ScrollArea className='h-full w-full flex-1 overflow-auto'>
            <Table className='min-w-[760px]'>
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
                  table.getRowModel().rows.map((row) => (
                    <React.Fragment key={row.id}>
                      <TableRow className='hover:bg-muted/50'>
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id}>
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                      {expandedGroup === row.original.kts_belegnummer ? (
                        <TableRow className='hover:bg-transparent'>
                          <TableCell colSpan={visibleColumnCount}>
                            <KtsAbrechnungExpandRow
                              group={row.original}
                              onClose={() => setExpandedGroup(null)}
                            />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </React.Fragment>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={visibleColumnCount}
                      className='h-24 text-center'
                    >
                      Keine Abrechnungsbelege gefunden.
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
