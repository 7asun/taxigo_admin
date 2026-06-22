'use client';

import { useMemo } from 'react';
import { DndContext } from '@dnd-kit/core';
import { Loader2 } from 'lucide-react';
import type { Database } from '@/types/database.types';
import type { KanbanTrip } from '@/features/trips/lib/kanban-types';
import {
  buildWidgetColumns,
  buildWidgetItemsByColumn
} from '@/features/trips/lib/widget-columns';
import { TripsOverviewWidgetColumn } from './trips-overview-widget-column';

type DriverRow = Pick<
  Database['public']['Tables']['accounts']['Row'],
  'id' | 'name'
>;

interface TripsOverviewWidgetBoardProps {
  trips: KanbanTrip[];
  drivers: DriverRow[];
  selectedDriverIds: string[];
  isLoading: boolean;
  isError: boolean;
}

const UNASSIGNED_COLUMN_ID = 'unassigned';

/**
 * Horizontal driver-column board for one calendar day.
 *
 * v2: replace inert `DndContext` with sensors + `onDragEnd` calling
 * `useWidgetTripAssignment().assignDriver` for cross-column moves.
 */
export function TripsOverviewWidgetBoard({
  trips,
  drivers,
  selectedDriverIds,
  isLoading,
  isError
}: TripsOverviewWidgetBoardProps) {
  const columns = useMemo(() => {
    const allColumns = buildWidgetColumns(trips, drivers);
    const selected = new Set(selectedDriverIds);
    return allColumns.filter(
      (column) => column.id === UNASSIGNED_COLUMN_ID || selected.has(column.id)
    );
  }, [trips, drivers, selectedDriverIds]);

  const itemsByColumn = useMemo(
    () => buildWidgetItemsByColumn(trips, columns),
    [trips, columns]
  );

  const groupLabels = useMemo(() => {
    const ids = [
      ...new Set(trips.map((t) => t.group_id).filter(Boolean))
    ] as string[];
    const withMinTime = ids.map((gid) => {
      const groupTrips = trips.filter((t) => t.group_id === gid);
      const minTime = Math.min(
        ...groupTrips.map((t) =>
          t.scheduled_at ? new Date(t.scheduled_at).getTime() : Infinity
        )
      );
      return { gid, minTime };
    });
    withMinTime.sort((a, b) => a.minTime - b.minTime);
    const map: Record<string, string> = {};
    withMinTime.forEach(({ gid }, i) => {
      map[gid] = `Gruppe ${i + 1}`;
    });
    return map;
  }, [trips]);

  if (isLoading) {
    return (
      <div className='text-muted-foreground flex min-h-0 flex-1 items-center justify-center gap-2 text-sm'>
        <Loader2 className='h-4 w-4 animate-spin' />
        Fahrten werden geladen…
      </div>
    );
  }

  if (isError) {
    return (
      <div className='text-destructive flex min-h-0 flex-1 items-center justify-center text-sm'>
        Fahrten konnten nicht geladen werden.
      </div>
    );
  }

  if (trips.length === 0) {
    return (
      <div className='text-muted-foreground flex min-h-0 flex-1 items-center justify-center text-sm'>
        Keine Fahrten für diesen Tag geplant
      </div>
    );
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <DndContext sensors={[]}>
        <div className='min-h-0 flex-1 overflow-x-auto overflow-y-auto'>
          <div className='inline-flex min-h-full w-max flex-row gap-3 px-1 pb-2'>
            {columns.map((column) => (
              <TripsOverviewWidgetColumn
                key={column.id}
                column={column}
                items={itemsByColumn[column.id] ?? []}
                groupLabels={groupLabels}
              />
            ))}
          </div>
        </div>
      </DndContext>
    </div>
  );
}
