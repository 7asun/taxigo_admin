import { type Table as TanstackTable, flexRender } from '@tanstack/react-table';
import * as React from 'react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy
} from '@dnd-kit/sortable';

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
import { getCommonPinningStyles } from '@/lib/data-table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { DraggableTableHeader, DragAlongCell } from './draggable-column';

interface DataTableProps<TData> extends React.ComponentProps<'div'> {
  table: TanstackTable<TData>;
  actionBar?: React.ReactNode;
  getRowClassName?: (row: any) => string;
  /** Applied to the inner `<table>` (e.g. `min-w-[720px]` for horizontal scroll). */
  tableClassName?: string;
  /** Passed to `DataTablePagination` (except `table`). */
  paginationProps?: Omit<DataTablePaginationProps<TData>, 'table'>;
  /**
   * When set, scrolls this row into view inside the table’s vertical scroll area
   * (e.g. “now − 15 minutes” anchor). No-op if the row is not rendered.
   */
  scrollToRowId?: string | null;
}

export function DataTable<TData>({
  table,
  actionBar,
  getRowClassName,
  tableClassName,
  paginationProps,
  scrollToRowId,
  children
}: DataTableProps<TData>) {
  const dndId = React.useId();
  const scrollWrapRef = React.useRef<HTMLDivElement>(null);

  const rowIdsSignature = table
    .getRowModel()
    .rows.map((r) => r.id)
    .join('|');

  React.useEffect(() => {
    if (scrollToRowId == null || scrollToRowId === '') return;
    const raf = window.requestAnimationFrame(() => {
      const wrap = scrollWrapRef.current;
      if (!wrap) return;
      const viewport = wrap.querySelector(
        '[data-slot="scroll-area-viewport"]'
      ) as HTMLElement | null;
      if (!viewport) return;
      const row = viewport.querySelector(
        `[data-table-row-id="${scrollToRowId}"]`
      ) as HTMLElement | null;
      if (!row) return;
      // Radix ScrollArea scrolls the viewport, not the table; use geometry not scrollIntoView.
      const vp = viewport.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      const nextTop =
        viewport.scrollTop + (rr.top - vp.top) - vp.height / 2 + rr.height / 2;
      const behavior: ScrollBehavior = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches
        ? 'auto'
        : 'smooth';
      viewport.scrollTo({
        top: Math.max(0, nextTop),
        behavior
      });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [scrollToRowId, rowIdsSignature]);

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor)
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      const columnOrder = table.getState().columnOrder;
      const oldIndex = columnOrder.indexOf(active.id as string);
      const newIndex = columnOrder.indexOf(over.id as string);
      table.setColumnOrder(arrayMove(columnOrder, oldIndex, newIndex));
    }
  }

  return (
    <div className='flex flex-1 flex-col space-y-4'>
      {children}
      <div className='relative flex flex-1'>
        <div
          ref={scrollWrapRef}
          className='absolute inset-0 flex overflow-hidden rounded-lg border'
        >
          <ScrollArea className='h-full w-full'>
            <DndContext
              id={dndId}
              collisionDetection={closestCenter}
              modifiers={[restrictToHorizontalAxis]}
              onDragEnd={handleDragEnd}
              sensors={sensors}
            >
              <Table className={tableClassName}>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      <SortableContext
                        items={table.getState().columnOrder}
                        strategy={horizontalListSortingStrategy}
                      >
                        {headerGroup.headers.map((header) => (
                          <DraggableTableHeader
                            key={header.id}
                            header={header}
                          />
                        ))}
                      </SortableContext>
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows?.length ? (
                    table.getRowModel().rows.map((row) => (
                      <TableRow
                        key={row.id}
                        data-table-row-id={row.id}
                        data-state={row.getIsSelected() && 'selected'}
                        className={getRowClassName?.(row.original)}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <SortableContext
                            key={cell.id}
                            items={table.getState().columnOrder}
                            strategy={horizontalListSortingStrategy}
                          >
                            <DragAlongCell key={cell.id} cell={cell} />
                          </SortableContext>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={table.getAllColumns().length}
                        className='h-24 text-center'
                      >
                        No results.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </DndContext>
            <ScrollBar orientation='horizontal' />
          </ScrollArea>
        </div>
      </div>
      <div className='flex flex-col gap-2.5'>
        <DataTablePagination table={table} {...paginationProps} />
        {actionBar &&
          table.getFilteredSelectedRowModel().rows.length > 0 &&
          actionBar}
      </div>
    </div>
  );
}
