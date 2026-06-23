'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { Loader2 } from 'lucide-react';
import type { Database } from '@/types/database.types';
import { KanbanDragPreview } from '@/features/trips/components/kanban/kanban-drag-preview';
import type { KanbanTrip } from '@/features/trips/lib/kanban-types';
import { isTripFremdfirma } from '@/features/trips/lib/trip-assignee';
import {
  buildWidgetColumns,
  buildWidgetItemsByColumn,
  resolveWidgetColumnId
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
  onAssign: (trip: KanbanTrip, newDriverId: string | null) => void;
  onCardClick?: (trip: KanbanTrip) => void;
}

const UNASSIGNED_COLUMN_ID = 'unassigned';

/**
 * Horizontal driver-column board for one calendar day with DnD reassignment.
 */
export function TripsOverviewWidgetBoard({
  trips,
  drivers,
  selectedDriverIds,
  isLoading,
  isError,
  onAssign,
  onCardClick
}: TripsOverviewWidgetBoardProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 }
    })
  );

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

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;

    const tripId = String(active.id);
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    if (isTripFremdfirma(trip) || trip.group_id) return;

    let targetColumnId = String(over.id);
    if (targetColumnId.startsWith('trip-')) {
      const targetTrip = trips.find(
        (t) => t.id === targetColumnId.replace(/^trip-/, '')
      );
      if (!targetTrip) return;
      targetColumnId = resolveWidgetColumnId(targetTrip);
    }

    const newDriverId = targetColumnId === 'unassigned' ? null : targetColumnId;
    if (trip.driver_id === newDriverId) return;
    onAssign(trip, newDriverId);
  };

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
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className='min-h-0 flex-1 overflow-x-auto overflow-y-auto'>
          <div className='inline-flex min-h-full w-max flex-row gap-3 px-1 pb-2'>
            {columns.map((column) => (
              <TripsOverviewWidgetColumn
                key={column.id}
                column={column}
                items={itemsByColumn[column.id] ?? []}
                groupLabels={groupLabels}
                onCardClick={onCardClick}
              />
            ))}
          </div>
        </div>
        {/*
         * DragOverlay is a sibling to the scroll container (not nested inside it).
         * dnd-kit portals the overlay, but tree position under DndContext still matters.
         * groupLabels={{}} is safe: KanbanDragPreview only reads groupLabels when
         * activeId.startsWith('group-'); widget v2 drags plain trip UUIDs only.
         */}
        <DragOverlay dropAnimation={null}>
          {activeDragId ? (
            <KanbanDragPreview
              activeId={activeDragId}
              effectiveTrips={trips}
              groupLabels={{}}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
